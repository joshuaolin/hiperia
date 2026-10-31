import test from "node:test";
import assert from "node:assert/strict";
import BN from "bn.js";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import { DodosClient, UAT_ADMIN } from "./DodosClient.js";
import { getConfigPda } from "./pdas.js";

function ruleValues() {
  return {
    revision: 3,
    minNumber: 2,
    maxNumber: 22,
    pickCount: 2,
    winningNumbers: [2, 22],
    quickTicketCostLamports: new BN(7_200_000),
    dailyTicketCostLamports: new BN(6_250_000),
    quickPayoutLamports: new BN(1_000_000_000),
    dailyPayoutLamports: new BN(2_000_000_000),
    dailyHours: [2, 6, 10, 14, 18, 22],
    scheduleIntervalSeconds: 14_400,
    scheduleOffsetSeconds: 7_200,
    buyAheadSeconds: 86_400,
  };
}

function fixture() {
  let time = 1000;
  const state = { calls: 0, values: ruleValues(), mutate: () => {} };
  const connection = new Connection("http://127.0.0.1:8899");
  const now = () => time;
  const client = new DodosClient({ connection, now });
  connection.simulateTransaction = async (transaction, options) => {
    state.calls += 1;
    state.transaction = transaction;
    state.options = options;
    if (state.gate) await state.gate;
    if (state.failure) throw state.failure;
    const bytes = client.program.coder.types.encode("uatRules", state.values);
    assert.equal(bytes.length, 56);
    const response = {
      context: { slot: 1 },
      value: {
        err: null,
        returnData: {
          programId: client.program.programId.toBase58(),
          data: [bytes.toString("base64"), "base64"],
        },
      },
    };
    state.mutate(response);
    return response;
  };
  return {
    client,
    connection,
    now,
    state,
    advance: (elapsed) => {
      time += elapsed;
    },
  };
}

test("chain rules use the actual IDL coder and an unsigned read-only metadata instruction", async () => {
  const { client, state } = fixture();
  const rules = await client.getRules();
  assert.deepEqual(rules.winningNumbers, [2, 22]);
  assert.equal(rules.dailyTicketCostLamports.toString(), "6250000");
  assert.equal(rules.dailyPayoutLamports.toString(), "2000000000");
  assert.deepEqual(rules.dailyHours, [2, 6, 10, 14, 18, 22]);
  const { message, signatures } = state.transaction;
  assert.equal(message.staticAccountKeys[0].toBase58(), UAT_ADMIN);
  assert.equal(message.header.numRequiredSignatures, 1);
  assert.equal(message.header.numReadonlyUnsignedAccounts, 2);
  assert.equal(signatures.length, 1);
  assert.ok(signatures[0].every((byte) => byte === 0));
  assert.equal(message.compiledInstructions.length, 1);
  const instruction = message.compiledInstructions[0];
  assert.equal(
    message.staticAccountKeys[instruction.programIdIndex].toBase58(),
    client.program.programId.toBase58(),
  );
  assert.equal(instruction.accountKeyIndexes.length, 1);
  assert.equal(
    message.staticAccountKeys[instruction.accountKeyIndexes[0]].toBase58(),
    getConfigPda()[0].toBase58(),
  );
  assert.deepEqual(state.options, {
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: "confirmed",
  });
});

test("public chain rules deduplicate concurrent loads and share only metadata across wallets", async () => {
  const { client, connection, state, now, advance } = fixture();
  let release;
  state.gate = new Promise((resolve) => {
    release = resolve;
  });
  const otherWallet = new DodosClient({
    connection,
    now,
    wallet: {
      publicKey: new PublicKey("Ghxn7ree6MFQxC8hFTJ8Lo319xEZzqVFLcmDLKVFpPaa"),
    },
  });
  const first = client.getRules();
  const second = otherWallet.getRules();
  release();
  assert.deepEqual(await first, await second);
  assert.equal(state.calls, 1);
  advance(29_999);
  await client.getRules();
  assert.equal(state.calls, 1);
  advance(1);
  await client.getRules();
  assert.equal(state.calls, 2);
  await client.getRules({ fresh: true });
  assert.equal(state.calls, 3);
  assert.equal(
    state.transaction.message.staticAccountKeys[0].toBase58(),
    UAT_ADMIN,
  );
});

test("failed or unsupported rules are never cached and RPC rate limits remain recognizable", async () => {
  for (const mutate of [
    (response) => {
      response.value.err = { InstructionError: [0, "InvalidInstructionData"] };
    },
    (response) => {
      delete response.value.returnData;
    },
    (response) => {
      response.value.returnData.programId = SystemProgram.programId.toBase58();
    },
    (response) => {
      response.value.returnData.data[0] = Buffer.alloc(55).toString("base64");
    },
    (response) => {
      response.value.returnData.data[0] += "!";
    },
  ]) {
    const { client, state } = fixture();
    state.mutate = mutate;
    await assert.rejects(client.getRules(), /rules could not be verified/);
    state.mutate = () => {};
    await client.getRules();
    assert.equal(state.calls, 2);
  }
  const { client, state } = fixture();
  state.failure = Error("429 Too many requests");
  await assert.rejects(client.getRules(), /429/);
  state.failure = null;
  await client.getRules();
  assert.equal(state.calls, 2);
});

test("invalid rule revisions, pool, schedule and unsafe amounts keep UAT unverified", async () => {
  for (const change of [
    { revision: 2 },
    { revision: 6 },
    { minNumber: 1 },
    { winningNumbers: [2, 2] },
    { dailyHours: [2, 6, 10, 14, 16, 22] },
    { scheduleIntervalSeconds: 7200 },
    { quickTicketCostLamports: new BN(0) },
    { dailyPayoutLamports: new BN("9007199254740992") },
  ]) {
    const { client, state } = fixture();
    Object.assign(state.values, change);
    await assert.rejects(client.getRules(), /rules could not be verified/);
  }
});

test("revision four enables permissionless settlement only after metadata verification", async () => {
  const { client, state } = fixture();
  state.values.revision = 4;
  assert.equal((await client.getRules()).revision, 4);
});

test("revision five retains verified schedule and settlement metadata", async () => {
  const { client, state } = fixture();
  state.values.revision = 5;
  assert.equal((await client.getRules()).revision, 5);
});

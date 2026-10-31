import test from "node:test";
import assert from "node:assert/strict";
import BN from "bn.js";
import { Program } from "@coral-xyz/anchor";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import vrfIdl from "../../idl/hiperia_vrf.json" with { type: "json" };
import { DodosClient, UAT_ADMIN } from "./DodosClient.js";
import { loadAccessRules } from "./chainRules.js";
import { getConfigPda } from "./pdas.js";

function fixture() {
  let time = 1_000;
  const connection = new Connection("http://127.0.0.1:8899");
  const now = () => time;
  const rules = {
    revision: 4,
    quickTicketCostLamports: new BN(7_200_000),
    dailyTicketCostLamports: new BN(6_250_000),
    quickPayoutLamports: new BN(1_000_000_000),
    dailyPayoutLamports: new BN(2_000_000_000),
  };
  const state = {
    calls: 0,
    values: { revision: 1, publicPlay: true, publicResults: true },
    mutate: () => {},
    config: {
      padding: Array.from(new PublicKey(UAT_ADMIN).toBytes()),
      ticketCostLamports: rules.quickTicketCostLamports,
      payoutLamports: rules.quickPayoutLamports,
    },
  };
  const client = new DodosClient({
    connection,
    program: new Program(vrfIdl, { connection }),
    now,
    rulesLoader: async () => rules,
  });
  client.program.account.config.fetchNullable = async () => state.config;
  connection.simulateTransaction = async (transaction, options) => {
    state.calls += 1;
    state.transaction = transaction;
    state.options = options;
    if (state.gate) await state.gate;
    if (state.failure) throw state.failure;
    if (state.legacyError) return { value: { err: state.legacyError } };
    const bytes =
      state.raw ??
      client.program.coder.types.encode("accessRules", state.values);
    const response = {
      context: { slot: 100 },
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
    state,
    now,
    advance: (elapsed) => {
      time += elapsed;
    },
  };
}

test("public access requires verified three-byte readonly program metadata", async () => {
  const { client, state } = fixture();
  assert.deepEqual(await client.getAccessRules(), {
    revision: 1,
    publicPlayEnabled: true,
    publicResultsEnabled: true,
  });
  const { message, signatures } = state.transaction;
  assert.equal(message.staticAccountKeys[0].toBase58(), UAT_ADMIN);
  assert.equal(message.compiledInstructions.length, 1);
  assert.ok(
    signatures.every((signature) => signature.every((byte) => byte === 0)),
  );
  const [instruction] = message.compiledInstructions;
  assert.equal(
    client.program.coder.instruction.decode(Buffer.from(instruction.data)).name,
    "getAccessRules",
  );
  assert.equal(instruction.accountKeyIndexes.length, 1);
  const [index] = instruction.accountKeyIndexes;
  assert.equal(
    message.staticAccountKeys[index].toBase58(),
    getConfigPda(client.program.programId)[0].toBase58(),
  );
  assert.equal(message.isAccountWritable(index), false);
  assert.equal(message.isAccountSigner(index), false);
  assert.deepEqual(state.options, {
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: "confirmed",
  });
  const config = await client.getConfig();
  assert.equal(config.publicPlayEnabled, true);
  assert.equal(config.publicResultsEnabled, true);
  assert.equal(config.accessRulesRevision, 1);
  assert.equal(config.rulesRevision, 4);
  assert.equal(config.permissionlessSettlement, true);
  assert.equal(state.calls, 1);
});

test("access metadata deduplicates concurrent callers and expires after thirty seconds", async () => {
  const { client, connection, state, now, advance } = fixture();
  let release;
  state.gate = new Promise((resolve) => {
    release = resolve;
  });
  const other = new DodosClient({
    connection,
    now,
    program: new Program(vrfIdl, { connection }),
  });
  const first = client.getAccessRules();
  const second = other.getAccessRules();
  release();
  assert.deepEqual(await first, await second);
  assert.equal(state.calls, 1);
  advance(29_999);
  await client.getAccessRules();
  assert.equal(state.calls, 1);
  advance(1);
  await client.getAccessRules();
  assert.equal(state.calls, 2);
  await client.getAccessRules({ fresh: true });
  assert.equal(state.calls, 3);
});

test("legacy programs retain restricted flags without changing their base rules", async () => {
  const { client, state } = fixture();
  state.legacyError = { InstructionError: [0, { Custom: 101 }] };
  assert.equal(await client.getAccessRules(), null);
  const config = await client.getConfig();
  assert.equal(config.uatEnabled, true);
  assert.equal(config.rulesRevision, 4);
  assert.equal(config.publicPlayEnabled, false);
  assert.equal(config.publicResultsEnabled, false);
  assert.equal(config.accessRulesRevision, null);
  assert.equal(await loadAccessRules({ program: { methods: {} } }), null);
  state.legacyError = { InstructionError: [0, { Custom: 6000 }] };
  await assert.rejects(
    client.getAccessRules({ fresh: true }),
    /rules could not be verified/,
  );
});

test("restricted, public-play and public-result flags preserve their separate on-chain values", async () => {
  for (const [publicPlay, publicResults] of [
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ]) {
    const { client, state } = fixture();
    state.values = { revision: 1, publicPlay, publicResults };
    const config = await client.getConfig();
    assert.equal(config.publicPlayEnabled, publicPlay);
    assert.equal(config.publicResultsEnabled, publicResults);
  }
  const { client, state } = fixture();
  state.config.padding = Array(32).fill(0);
  const config = await client.getConfig();
  assert.equal(config.uatEnabled, false);
  assert.equal(config.publicPlayEnabled, false);
  assert.equal(config.publicResultsEnabled, false);
  assert.equal(state.calls, 0);
});

test("malformed access metadata never opens play and failed responses are not cached", async () => {
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
      response.value.returnData.data[0] = Buffer.from([1, 1]).toString(
        "base64",
      );
    },
    (response) => {
      response.value.returnData.data[0] = Buffer.from([2, 1, 1]).toString(
        "base64",
      );
    },
    (response) => {
      response.value.returnData.data[0] = Buffer.from([1, 2, 1]).toString(
        "base64",
      );
    },
    (response) => {
      response.value.returnData.data[0] = Buffer.from([1, 1, 2]).toString(
        "base64",
      );
    },
    (response) => {
      response.value.returnData.data[0] += "!";
    },
  ]) {
    const { client, state } = fixture();
    state.mutate = mutate;
    await assert.rejects(client.getConfig(), /rules could not be verified/);
    state.mutate = () => {};
    assert.equal((await client.getConfig()).publicPlayEnabled, true);
    assert.equal(state.calls, 2);
  }
  const { client, state } = fixture();
  state.failure = Error("429 Too many requests");
  await assert.rejects(client.getConfig(), /429/);
  state.failure = null;
  assert.equal((await client.getConfig()).publicPlayEnabled, true);
  assert.equal(state.calls, 2);
});

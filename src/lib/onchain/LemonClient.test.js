import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import BN from "bn.js";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { LemonClient } from "./LemonClient.js";
import {
  deriveLemonOracleSeed,
  lemonNumbersFromRandomness,
  LEMON_PROGRAM_ID,
  validFruitNumbers,
} from "./lemonProtocol.js";
import { ORAO_PROGRAM_ID } from "./vrfProtocol.js";
import { getDrawPda, getOracleClientPda, getOracleRequestPda } from "./pdas.js";
import { UAT_ADMIN } from "./DodosClient.js";
import { DEVNET_GENESIS_HASH, MAINNET_GENESIS_HASH } from "../network.js";
import { createRpcProxy, validateRpcRequest } from "../rpcProxy.js";

const NOW = 1_800_000_000_000;
function fixture() {
  const connection = new Connection("http://127.0.0.1:8899");
  const owner = Keypair.fromSeed(new Uint8Array(32).fill(21));
  const client = new LemonClient({
    connection,
    wallet: {
      publicKey: owner.publicKey,
      signTransaction: async (tx) => tx,
      signAllTransactions: async (txs) => txs,
    },
    storage: null,
    now: () => NOW,
  });
  const state = {
    responseOwner: LEMON_PROGRAM_ID,
    extra: false,
    rentSizes: [],
    sent: [],
    metadata: {
      getrules: {
        type: "lemonRules",
        value: {
          revision: 1,
          minNumber: 0,
          maxNumber: 9,
          pickCount: 3,
          repeatsAllowed: true,
          ordered: true,
          outcomeCount: 1000,
          quickTicketCostLamports: new BN(7_200_000),
          dailyTicketCostLamports: new BN(6_250_000),
          quickPayoutLamports: new BN(2_500_000_000),
          dailyPayoutLamports: new BN(4_750_000_000),
          dailyHours: [2, 6, 10, 14, 18, 22],
          scheduleIntervalSeconds: 14_400,
          scheduleOffsetSeconds: 7200,
          buyAheadSeconds: 86_400,
        },
      },
      getaccessrules: {
        type: "accessRules",
        value: { revision: 1, publicPlay: true, publicResults: true },
      },
      getrandomnessrules: {
        type: "randomnessRules",
        value: {
          revision: 1,
          oracleProgram: new PublicKey(ORAO_PROGRAM_ID),
          refundAfterSeconds: 86_400,
          pendingRequestSpace: 749,
        },
      },
      getbankrollrules: {
        type: "bankrollRules",
        value: {
          revision: 1,
          dailyEnabled: true,
          quickEnabled: true,
          entryRefundsReserved: true,
          prizeReservedAtPurchase: false,
          claimRequiresFunding: true,
          ticketVersion: 4,
          ledgerAccountSpace: 50,
        },
      },
    },
  };
  client.program.account.config.fetchNullable = async () => ({
    isInitialized: true,
    ticketCostLamports: new BN(7_200_000),
    payoutLamports: new BN(2_500_000_000),
    padding: [...new PublicKey(UAT_ADMIN).toBytes()],
  });
  connection.simulateTransaction = async (tx) => {
    const decoded = client.program.coder.instruction.decode(
      Buffer.from(tx.message.compiledInstructions[0].data),
    );
    const metadata =
      state.metadata[decoded.name.replaceAll("_", "").toLowerCase()];
    let bytes = client.program.coder.types.encode(
      metadata.type,
      metadata.value,
    );
    if (state.extra) bytes = Buffer.concat([bytes, Buffer.from([0])]);
    return {
      value: {
        err: null,
        returnData: {
          programId: state.responseOwner,
          data: [bytes.toString("base64"), "base64"],
        },
      },
    };
  };
  connection.getGenesisHash = async () => DEVNET_GENESIS_HASH;
  connection.getAccountInfo = async () => null;
  connection.getMinimumBalanceForRentExemption = async (size) => {
    state.rentSizes.push(size);
    return size * 10;
  };
  client.program.account.draw.fetchNullable = async () => null;
  client.getCapacity = async () => ({
    freeLamports: 0,
    vaultLamports: 1176240,
    reservedLamports: 0,
  });
  return { client, state, connection, owner };
}

test("Lemon verifies separate metadata and reads every entry/prize from its own chain rules", async () => {
  const { client } = fixture();
  const config = await client.getConfig();
  assert.equal(config.programId, LEMON_PROGRAM_ID);
  assert.equal(config.outcomes, 1000);
  assert.equal(config.entryLamports, 6_250_000);
  assert.equal(config.prizeLamports, 4_750_000_000);
  assert.equal(config.capacity.dailySlots, null);
  assert.equal(config.bankrollRules.prizeReservedAtPurchase, false);
});

test("Lemon metadata rejects another program, extra bytes, changed odds and prize reservations", async () => {
  for (const mutate of [
    (state) => {
      state.responseOwner = ORAO_PROGRAM_ID;
    },
    (state) => {
      state.extra = true;
    },
    (state) => {
      state.metadata.getrules.value.outcomeCount = 999;
    },
    (state) => {
      state.metadata.getbankrollrules.value.prizeReservedAtPurchase = true;
    },
    (state) => {
      state.metadata.getaccessrules.value.publicPlay = false;
    },
  ]) {
    const { client, state } = fixture();
    mutate(state);
    await assert.rejects(client.getConfig(), /could not be verified/);
  }
});

test("three fruits allow zero and repetitions without accepting invalid lengths or digits", () => {
  assert.ok(validFruitNumbers([0, 0, 0]));
  assert.ok(validFruitNumbers([9, 9, 9]));
  for (const numbers of [
    [0, 0],
    [0, 0, 0, 0],
    [-1, 0, 0],
    [10, 0, 0],
    [1.1, 0, 0],
    ["0", 0, 0],
  ])
    assert.equal(validFruitNumbers(numbers), false);
});

test("all 65000 accepted entropy samples map equally to 1000 ordered fruit triples", async () => {
  const counts = new Map();
  for (let sample = 0; sample < 65_000; sample++) {
    const bytes = new Uint8Array(64).fill(255);
    bytes[0] = sample & 255;
    bytes[1] = sample >> 8;
    const result = await lemonNumbersFromRandomness(bytes);
    counts.set(result.join(""), (counts.get(result.join("")) ?? 0) + 1);
  }
  assert.equal(counts.size, 1000);
  assert.deepEqual([...new Set(counts.values())], [65]);
});

test("rejected entropy uses the exact contract expansion domain rather than a biased modulo fallback", async () => {
  const randomness = new Uint8Array(64).fill(255);
  const hash = createHash("sha256")
    .update(
      Buffer.concat([
        Buffer.from("hiperia-lemon-vrf-expand-v1"),
        randomness,
        Buffer.alloc(4),
      ]),
    )
    .digest();
  let rank;
  for (let index = 0; index < hash.length; index += 2)
    if (hash.readUInt16LE(index) < 65_000) {
      rank = hash.readUInt16LE(index) % 1000;
      break;
    }
  assert.deepEqual(await lemonNumbersFromRandomness(randomness), [
    Math.floor(rank / 100),
    Math.floor(rank / 10) % 10,
    rank % 10,
  ]);
  await assert.rejects(
    lemonNumbersFromRandomness(new Uint8Array(63)),
    /64-byte/,
  );
});

test("Lemon oracle seed is separated from Dodos and bound to its program/draw/nonce", async () => {
  const { client } = fixture();
  const draw = getDrawPda(1_800_000_001, client.program.programId)[0];
  const nonce = Array(32).fill(7);
  const expected = createHash("sha256")
    .update(
      Buffer.concat([
        Buffer.from("hiperia-lemon-vrf-v1"),
        client.program.programId.toBuffer(),
        draw.toBuffer(),
        Buffer.from(nonce),
      ]),
    )
    .digest();
  assert.deepEqual(
    Buffer.from(await deriveLemonOracleSeed(LEMON_PROGRAM_ID, draw, nonce)),
    expected,
  );
  await assert.rejects(
    deriveLemonOracleSeed(LEMON_PROGRAM_ID, draw, [1]),
    /nonce/,
  );
});

test("Lemon checkout quotes correct triple account rents and permits zero operator capital", async () => {
  const { client, state } = fixture();
  const config = await client.getConfig();
  const quote = await client.getPurchaseQuote([0, 0, 0], {
    drawTime: NOW / 1000 + 60,
    config,
  });
  assert.equal(quote.canPurchase, true);
  assert.equal(quote.requiredBackingLamports, 0);
  assert.ok(state.rentSizes.includes(182));
  assert.ok(state.rentSizes.includes(101));
  assert.ok(!state.rentSizes.includes(181));
  assert.equal(
    quote.totalLamports,
    quote.entryLamports + quote.accountRentLamports,
  );
  assert.doesNotThrow(() => client.assertPurchaseQuote(quote, { quote }));
  assert.throws(
    () =>
      client.assertPurchaseQuote(
        { ...quote, totalLamports: quote.totalLamports + 1 },
        { quote },
      ),
    /changed or expired/,
  );
  assert.throws(
    () =>
      client.assertPurchaseQuote(quote, {
        quote: { ...quote, numbers: [1, 0, 0] },
      }),
    /changed or expired/,
  );
  assert.throws(
    () =>
      client.assertPurchaseQuote(quote, {
        quote: { ...quote, walletAddress: UAT_ADMIN },
      }),
    /changed or expired/,
  );
});

test("zero-zero-zero is a real published Lemon result only after verified finalization", () => {
  const { client } = fixture();
  const time = NOW / 1000 - 1;
  const seed = Array(32).fill(7);
  const raw = {
    drawTime: new BN(time),
    bump: getDrawPda(time, client.program.programId)[1],
    status: 2,
    ticketCount: new BN(1),
    seed,
    oracleRequest: getOracleRequestPda(seed)[0],
    oracleClient: getOracleClientPda(time, client.program.programId)[0],
    requestedBy: new PublicKey(UAT_ADMIN),
    requestedAt: new BN(time),
    numbers: [0, 0, 0],
    isDaily: false,
    ticketCostLamports: new BN(7_200_000),
    payoutLamports: new BN(2_500_000_000),
  };
  assert.deepEqual(
    client.resultRecord(client.drawRecord(raw)).numbers,
    [0, 0, 0],
  );
  assert.equal(
    client.resultRecord(client.drawRecord({ ...raw, status: 1 })),
    null,
  );
  assert.throws(
    () => client.drawRecord({ ...raw, numbers: [0, 0, 10] }),
    /invalid/,
  );
});

test("Lemon prevents mainnet writes and price increases beyond an explicitly reviewed reveal", async () => {
  const { client, connection, owner } = fixture();
  connection.getGenesisHash = async () => MAINNET_GENESIS_HASH;
  await assert.rejects(client.assertDevnet(), /Devnet/);
  const fresh = {
    feeLamports: 100,
    totalLamports: 200,
    treasury: UAT_ADMIN,
    oracleProgram: ORAO_PROGRAM_ID,
    networkAddress: owner.publicKey.toBase58(),
  };
  const quote = {
    ...fresh,
    requiresPayment: true,
    drawTime: 123,
    walletAddress: owner.publicKey.toBase58(),
    sourceProgram: LEMON_PROGRAM_ID,
    validUntil: NOW + 1000,
  };
  assert.doesNotThrow(() =>
    client.assertOracleQuote(fresh, { quote, drawTime: 123 }),
  );
  assert.throws(
    () =>
      client.assertOracleQuote(
        { ...fresh, feeLamports: 101 },
        { quote, drawTime: 123 },
      ),
    /changed or expired/,
  );
  assert.throws(
    () =>
      client.assertOracleQuote(fresh, {
        quote: { ...quote, validUntil: NOW },
        drawTime: 123,
      }),
    /changed or expired/,
  );
});

test("proxy permits only exact Lemon readonly metadata without arbitrary unsigned mutations", async () => {
  const { client } = fixture();
  const instruction = await client.program.methods
    .getRules()
    .accountsStrict({ config: client.configAddress })
    .instruction();
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: new PublicKey(UAT_ADMIN),
      recentBlockhash: SystemProgram.programId.toBase58(),
      instructions: [instruction],
    }).compileToV0Message(),
  );
  const request = {
    jsonrpc: "2.0",
    id: 1,
    method: "simulateTransaction",
    params: [
      Buffer.from(tx.serialize()).toString("base64"),
      {
        encoding: "base64",
        sigVerify: false,
        replaceRecentBlockhash: true,
        commitment: "confirmed",
      },
    ],
  };
  assert.doesNotThrow(() => validateRpcRequest(request));
  const proxy = (length) =>
    createRpcProxy({
      fetchUpstream: async () =>
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: {
              value: {
                err: null,
                returnData: {
                  programId: LEMON_PROGRAM_ID,
                  data: [Buffer.alloc(length).toString("base64"), "base64"],
                },
              },
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    });
  assert.equal(
    (await proxy(58)(request, "lemon-metadata-test")).result.value.returnData
      .programId,
    LEMON_PROGRAM_ID,
  );
  await assert.rejects(
    proxy(59)(request, "lemon-metadata-test"),
    /Unexpected Hiperia metadata/,
  );
  const mutated = new VersionedTransaction(
    new TransactionMessage({
      payerKey: new PublicKey(UAT_ADMIN),
      recentBlockhash: SystemProgram.programId.toBase58(),
      instructions: [{ ...instruction, data: Buffer.alloc(8, 7) }],
    }).compileToV0Message(),
  );
  assert.throws(
    () =>
      validateRpcRequest({
        ...request,
        params: [
          Buffer.from(mutated.serialize()).toString("base64"),
          request.params[1],
        ],
      }),
    /read-only/,
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import BN from "bn.js";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  processingOptions,
  processDraws,
  ProcessingReceipt,
  OperatorConnection,
  settlementDecision,
  ticketRecord,
} from "./process-vrf-due.js";
import { getTicketPda } from "../../src/lib/onchain/pdas.js";
import { VRF_PROGRAM_ID } from "../../src/lib/onchain/vrfProtocol.js";
import { MAINNET_GENESIS_HASH } from "../../src/lib/network.js";

const owner = Keypair.fromSeed(new Uint8Array(32).fill(42));
const programId = new PublicKey(VRF_PROGRAM_ID);
const quote = {
  feeLamports: 300_123,
  pendingRentLamports: 4_455_161,
  clientRentLamports: 650_241,
  totalLamports: 5_405_525,
  treasury: "treasury",
  networkAddress: "network",
  oracleProgram: "oracle",
};

function account(nonce, numbers = [22, 2], drawTime = 100) {
  const padding = Buffer.alloc(32);
  padding[0] = 2;
  padding.writeBigUInt64LE(2_000_000_000n, 1);
  return {
    user: owner.publicKey,
    nonce: new BN(nonce),
    drawTime: new BN(drawTime),
    numbers,
    padding,
    settled: false,
    paidLamports: new BN(6_250_000),
  };
}

function record(value) {
  return {
    publicKey: getTicketPda(value.user, value.nonce, programId)[0],
    account: value,
  };
}

function setup({
  phase = "final",
  records = [account(1), account(2, [2, 22])],
  args = [],
} = {}) {
  const calls = [];
  const logs = [];
  const values = new Map(
    records.map((value) => {
      const entry = record(value);
      return [entry.publicKey.toBase58(), value];
    }),
  );
  const client = {
    program: {
      programId,
      account: {
        ticket: {
          fetchMultiple: async (addresses) =>
            addresses.map((address) => values.get(address.toBase58())),
        },
      },
    },
    getOracleQuote: async () => {
      calls.push("quote");
      return quote;
    },
    recordDraw: async (drawTime, options) => {
      calls.push("record");
      if (phase === "open") options.onProgress({ phase: "request", quote });
      return { draw: { drawTime, status: "final", numbers: [2, 22] } };
    },
    settleBatch: async (tickets) => {
      calls.push({ settle: tickets.map((ticket) => ticket.id) });
      return { settled: tickets.length, signatures: ["signature"] };
    },
  };
  const draws = [
    ...new Set(records.map((value) => value.drawTime.toNumber())),
  ].map((drawTime) => ({
    drawTime,
    status: phase,
    numbers: phase === "final" ? [2, 22] : null,
  }));
  return {
    client,
    calls,
    logs,
    input: {
      client,
      draws,
      tickets: records.map((value) => ticketRecord(record(value))),
      chainTime: 200,
      refundAfterSeconds: 86_400,
      options: processingOptions(args, {}),
      receipt: { assertWritable() {}, assertResolved() {} },
      log: (value) => logs.push(value),
    },
  };
}

test("operator defaults to dry-run and requires an explicit wallet for execution", () => {
  assert.equal(processingOptions([], {}).execute, false);
  assert.equal(processingOptions([], {}).walletPath, null);
  assert.equal(processingOptions([], {}).maxOracleLamports, 0);
  assert.throws(
    () => processingOptions(["--execute"], {}),
    /requires --wallet/,
  );
  assert.equal(
    processingOptions(["--execute"], {
      HIPERIA_OPERATOR_WALLET: "explicit.json",
    }).walletPath,
    "explicit.json",
  );
  for (const args of [
    ["--include-wins"],
    ["--max-draws", "0"],
    ["--max-draws", "11"],
    ["--max-settlements", "101"],
    ["--batch-size", "7"],
    ["--max-oracle-lamports", "-1"],
    ["--wait-seconds", "91"],
    ["--execute", "--execute"],
    ["--max-transactions", "1", "--max-transactions", "2"],
  ])
    assert.throws(() => processingOptions(args, {}));
});

test("ticket scans bind canonical address, immutable owner and exact snapshot", () => {
  const valid = record(account(1));
  assert.equal(ticketRecord(valid).payoutLamports, "2000000000");
  assert.throws(
    () => ticketRecord({ ...valid, publicKey: owner.publicKey }),
    /canonical/,
  );
  for (const corrupt of [
    (padding) => {
      padding[0] = 1;
    },
    (padding) => {
      padding[9] = 2;
    },
    (padding) => {
      padding[10] = 1;
    },
    (padding) => padding.fill(0, 1, 9),
  ]) {
    const entry = record(account(1));
    corrupt(entry.account.padding);
    assert.throws(() => ticketRecord(entry));
  }
});

test("dry-run reports actual losses/wins without calling any mutating SDK method", async () => {
  const fixture = setup();
  const summary = await processDraws(fixture.input);
  assert.deepEqual(fixture.calls, []);
  assert.equal(summary.settledLosses, 0);
  assert.equal(summary.preservedWins, 1);
  assert.equal(fixture.logs[0].unsettledLiabilityLamports, "4000000000");
  assert.equal(fixture.logs[1].releasableLosses, 1);
});

test("one-shot settlement excludes all winning and already settled tickets", async () => {
  const done = account(3);
  done.settled = true;
  const fixture = setup({
    records: [account(1), account(2, [2, 22]), done],
    args: ["--execute", "--wallet", "explicit.json"],
  });
  const summary = await processDraws(fixture.input);
  assert.deepEqual(fixture.calls, [{ settle: ["1"] }]);
  assert.equal(summary.preservedWins, 1);
  const winning = fixture.input.tickets[1];
  assert.equal(
    settlementDecision(
      winning,
      fixture.input.draws[0],
      Number.MAX_SAFE_INTEGER,
    ),
    "preserve-win",
  );
  assert.throws(
    () =>
      settlementDecision(
        winning,
        { ...fixture.input.draws[0], drawTime: 101 },
        200,
      ),
    /does not match/,
  );
});

test("fresh ticket state is read again and a transaction failure stops all later batches", async () => {
  const fixture = setup({
    records: [account(1), account(2), account(3)],
    args: ["--execute", "--wallet", "explicit.json", "--batch-size", "1"],
  });
  fixture.client.settleBatch = async () => {
    fixture.calls.push("failed-write");
    throw new Error("confirmation uncertain");
  };
  await assert.rejects(processDraws(fixture.input), /uncertain/);
  assert.deepEqual(fixture.calls, ["failed-write"]);
  fixture.calls.length = 0;
  fixture.client.program.account.ticket.fetchMultiple = async (addresses) =>
    addresses.map((address) => {
      const ticket = fixture.input.tickets.find(
        (entry) => entry.address === address.toBase58(),
      );
      return { ...account(ticket.id), settled: true };
    });
  fixture.input.options.maxSettlements = 1;
  const summary = await processDraws(fixture.input);
  assert.equal(summary.settledLosses, 0);
  assert.deepEqual(fixture.calls, []);
});

test("reveal funding needs a reviewed bounded budget, pending requests never get quoted again", async () => {
  const open = setup({
    phase: "open",
    args: ["--execute", "--wallet", "explicit.json"],
  });
  await assert.rejects(processDraws(open.input), /max-oracle-lamports/);
  assert.deepEqual(open.calls, ["quote"]);
  const pending = setup({
    phase: "pending",
    args: ["--execute", "--wallet", "explicit.json"],
  });
  await processDraws(pending.input);
  assert.ok(!pending.calls.includes("quote"));
  assert.equal(pending.calls.filter((value) => value === "record").length, 1);
  const funded = setup({
    phase: "open",
    args: [
      "--execute",
      "--wallet",
      "explicit.json",
      "--max-oracle-lamports",
      String(quote.totalLamports),
    ],
  });
  const summary = await processDraws(funded.input);
  assert.equal(summary.approvedOracleLamports, quote.totalLamports);
  assert.equal(summary.settledLosses, 1);
});

test("changed oracle fees abort before the SDK request write", async () => {
  const fixture = setup({
    phase: "open",
    args: [
      "--execute",
      "--wallet",
      "explicit.json",
      "--max-oracle-lamports",
      "99999999",
    ],
  });
  fixture.client.recordDraw = async (_drawTime, options) => {
    options.onProgress({
      phase: "request",
      quote: { ...quote, feeLamports: quote.feeLamports + 1 },
    });
    throw new Error("should never get here");
  };
  await assert.rejects(processDraws(fixture.input), /quote changed/);
  assert.deepEqual(fixture.calls, ["quote"]);
});

test("the oracle funding budget applies to the whole run rather than each draw", async () => {
  const fixture = setup({
    phase: "open",
    records: [account(1), account(2, [22, 2], 101)],
    args: [
      "--execute",
      "--wallet",
      "explicit.json",
      "--max-oracle-lamports",
      String(quote.totalLamports),
    ],
  });
  await assert.rejects(processDraws(fixture.input), /max-oracle-lamports/);
  assert.deepEqual(fixture.calls, [
    "quote",
    "record",
    { settle: ["1"] },
    "quote",
  ]);
});

test("expired open draws preserve entry refunds and pending Oracle outages stay unresolved", async () => {
  const expired = setup({
    phase: "open",
    args: ["--execute", "--wallet", "explicit.json"],
  });
  expired.input.chainTime = 100 + 86_400;
  await processDraws(expired.input);
  assert.deepEqual(expired.calls, []);
  const pending = setup({
    phase: "pending",
    args: ["--execute", "--wallet", "explicit.json"],
  });
  pending.client.recordDraw = async (drawTime) => ({
    draw: { drawTime, status: "pending", oracleRequest: "request" },
    pending: true,
  });
  const summary = await processDraws(pending.input);
  assert.equal(summary.settledLosses, 0);
  assert.deepEqual(pending.calls, []);
});

test("draw and settlement bounds cap work while preserving all wins", async () => {
  const fixture = setup({
    records: [account(1), account(2), account(3, [22, 2], 101)],
    args: [
      "--execute",
      "--wallet",
      "explicit.json",
      "--max-draws",
      "1",
      "--max-settlements",
      "1",
    ],
  });
  const summary = await processDraws(fixture.input);
  assert.equal(summary.processedDraws, 1);
  assert.equal(summary.settledLosses, 1);
  assert.deepEqual(fixture.calls, [{ settle: ["1"] }]);
});

test("signed receipts persist before send and block any next write until resolved", () => {
  const directory = mkdtempSync(join(tmpdir(), "hiperia-vrf-receipt-"));
  try {
    const path = join(directory, "receipt.json");
    const receipt = new ProcessingReceipt(path, { maxTransactions: 1 });
    const transaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: owner.publicKey,
        recentBlockhash: owner.publicKey.toBase58(),
        instructions: [
          SystemProgram.transfer({
            fromPubkey: owner.publicKey,
            toPubkey: programId,
            lamports: 1,
          }),
        ],
      }).compileToV0Message(),
    );
    transaction.sign([owner]);
    receipt.context = { kind: "release-losses", drawTime: 100 };
    const prepared = receipt.prepare(transaction.serialize());
    assert.equal(
      JSON.parse(readFileSync(path, "utf8")).steps[0].signature,
      prepared.signature,
    );
    assert.throws(() => receipt.assertWritable(), /unresolved/);
    assert.throws(() => receipt.prepare(transaction.serialize()), /unresolved/);
    receipt.status(prepared.signature, "confirmed");
    assert.doesNotThrow(() => receipt.assertResolved());
    assert.throws(() => receipt.assertWritable(), /limit/);
    receipt.data.maxTransactions = 2;
    assert.throws(
      () => receipt.prepare(transaction.serialize()),
      /already has a receipt/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("operator connection cannot send in dry-run or on a non-Devnet genesis", async () => {
  const dry = new OperatorConnection("https://api.devnet.solana.com");
  await assert.rejects(dry.sendRawTransaction(Buffer.alloc(1)), /Dry runs/);
  let prepared = false;
  const wrongNetwork = new OperatorConnection("https://api.devnet.solana.com", {
    prepare() {
      prepared = true;
    },
  });
  wrongNetwork.getGenesisHash = async () => MAINNET_GENESIS_HASH;
  await assert.rejects(
    wrongNetwork.sendRawTransaction(Buffer.alloc(1), { maxRetries: 0 }),
  );
  assert.equal(prepared, false);
});

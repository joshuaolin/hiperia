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
  TransactionInstruction,
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

function account(nonce, numbers = [22, 2], drawTime = 100, reserveVersion = 2) {
  const padding = Buffer.alloc(32);
  padding[0] = reserveVersion;
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

test("pooled ticket scans preserve their v3 settlement route and immutable prize", () => {
  const pooled = ticketRecord(record(account(1, [2, 22], 100, 3)));
  assert.equal(pooled.reserveVersion, 3);
  assert.equal(pooled.pooled, true);
  assert.equal(pooled.payoutLamports, "2000000000");
  assert.equal(pooled.user, owner.publicKey.toBase58());
  const invalid = account(2, [2, 22], 100, 5);
  assert.throws(() => ticketRecord(record(invalid)), /snapshot/);
});

test("pooled dry-run reports the actual aggregate reserve rather than summed prizes", async () => {
  const fixture = setup({
    records: [
      account(1),
      account(2, [22, 2], 100, 3),
      account(3, [2, 22], 100, 3),
    ],
  });
  fixture.client.drawRisk = {
    read: async () => ({ phase: 0, reservedLamports: new BN(2_006_250_000) }),
  };
  const summary = await processDraws(fixture.input);
  assert.deepEqual(fixture.calls, []);
  assert.equal(fixture.logs[0].unsettledLiabilityLamports, "4006250000");
  assert.equal(fixture.logs[0].legacyFullPrizeLiabilityLamports, "2000000000");
  assert.equal(fixture.logs[0].pooledReservedLiabilityLamports, "2006250000");
  assert.equal(fixture.logs[0].pooledUnsettledTickets, 2);
  assert.equal(fixture.logs[0].pooledReconciliationRequired, true);
  assert.equal(summary.reconciledDraws, 0);
  assert.equal(summary.preservedWins, 1);
});

function pooledOperatorFixture({
  records = [account(1, [2, 22], 100, 3)],
  phase = 0,
} = {}) {
  const fixture = setup({
    records,
    args: ["--execute", "--wallet", "explicit.json"],
  });
  const risk = { phase, reservedLamports: new BN(2_000_000_000) };
  fixture.client.drawRisk = { read: async () => ({ ...risk }) };
  fixture.client.reconcileDrawRiskInstruction = async (drawTime) => {
    assert.equal(drawTime, 100);
    return new TransactionInstruction({
      programId,
      keys: [],
      data: Buffer.from([1]),
    });
  };
  fixture.client.program.provider = {
    sendAndConfirm: async (transaction, signers, options) => {
      assert.equal(transaction.instructions.length, 1);
      assert.deepEqual(signers, []);
      assert.equal(options.maxRetries, 0);
      assert.equal(options.commitment, "confirmed");
      assert.equal(
        fixture.input.receipt.context.kind,
        "reconcile-pooled-backing",
      );
      fixture.calls.push("reconcile");
      risk.phase = 1;
      return "confirmed-reconciliation";
    },
  };
  return fixture;
}

test("one explicit operator transaction reconciles a finalized pooled draw with winners only", async () => {
  const fixture = pooledOperatorFixture();
  const summary = await processDraws(fixture.input);
  assert.deepEqual(fixture.calls, ["reconcile"]);
  assert.equal(summary.reconciledDraws, 1);
  assert.equal(summary.preservedWins, 1);
  assert.equal(summary.settledLosses, 0);
  assert.equal(fixture.logs[1].pooledBackingReconciled, true);
  assert.equal(fixture.logs[1].signature, "confirmed-reconciliation");
});

test("pooled losing cleanup uses v3 instructions after a confirmed reconciliation", async () => {
  const fixture = pooledOperatorFixture({
    records: [account(1, [22, 2], 100, 3), account(2, [2, 22], 100, 3)],
  });
  fixture.client.settleBatch = async (tickets) => {
    assert.deepEqual(
      tickets.map((ticket) => ticket.reserveVersion),
      [3],
    );
    fixture.calls.push({ settle: tickets.map((ticket) => ticket.id) });
    return { settled: tickets.length, signatures: ["confirmed-loss"] };
  };
  const summary = await processDraws(fixture.input);
  assert.deepEqual(fixture.calls, ["reconcile", { settle: ["1"] }]);
  assert.equal(summary.settledLosses, 1);
  assert.equal(summary.preservedWins, 1);
});

test("already reconciled pooled backing never adds a standalone transaction", async () => {
  const fixture = pooledOperatorFixture({ phase: 1 });
  const summary = await processDraws(fixture.input);
  assert.deepEqual(fixture.calls, []);
  assert.equal(summary.reconciledDraws, 0);
  assert.equal(summary.preservedWins, 1);
});

test("unavailable pooled backing reports unknown liability without inventing a total", async () => {
  const fixture = pooledOperatorFixture();
  fixture.client.drawRisk.read = async () => {
    throw new Error("RPC unavailable");
  };
  const summary = await processDraws(fixture.input);
  assert.equal(fixture.logs[0].unsettledLiabilityLamports, null);
  assert.equal(fixture.logs[0].pooledReservedLiabilityLamports, null);
  assert.equal(fixture.logs[0].pooledBackingStatus, "unavailable");
  assert.equal(fixture.logs[0].pooledUnsettledTickets, 1);
  assert.equal(summary.reconciledDraws, 0);
  assert.deepEqual(fixture.calls, []);
  assert.match(
    fixture.logs[1].pooledReconciliationSkipped,
    /no standalone transaction/,
  );
});

test("an uncertain pooled reconciliation stops before all later writes without resubmission", async () => {
  const fixture = pooledOperatorFixture({
    records: [account(1, [22, 2], 100, 3)],
  });
  fixture.client.program.provider.sendAndConfirm = async () => {
    fixture.calls.push("uncertain-reconcile");
    throw new Error("Reconciliation confirmation is uncertain.");
  };
  await assert.rejects(processDraws(fixture.input), /uncertain/);
  assert.deepEqual(fixture.calls, ["uncertain-reconcile"]);
});

test("the transaction bound also blocks a dedicated pooled reconciliation", async () => {
  const fixture = pooledOperatorFixture();
  let checks = 0;
  fixture.input.receipt.assertWritable = () => {
    checks += 1;
    throw new Error("The transaction limit was reached.");
  };
  await assert.rejects(processDraws(fixture.input), /transaction limit/);
  assert.equal(checks, 1);
  assert.deepEqual(fixture.calls, []);
});

test("bankroll scans retain the v4 route without treating fixed prize snapshots as reserves", () => {
  const bankroll = ticketRecord(record(account(1, [2, 22], 100, 4)));
  assert.equal(bankroll.reserveVersion, 4);
  assert.equal(bankroll.bankroll, true);
  assert.equal(bankroll.pooled, false);
  assert.equal(bankroll.payoutLamports, "2000000000");
  assert.equal(bankroll.paidLamports, "6250000");
  assert.equal(bankroll.user, owner.publicKey.toBase58());
});

test("bankroll dry-run reports actual entry holds alongside protected old reserves without signing", async () => {
  const fixture = setup({
    records: [
      account(1),
      account(2, [22, 2], 100, 3),
      account(3, [2, 22], 100, 4),
      account(4, [22, 2], 100, 4),
    ],
  });
  fixture.client.drawRisk = {
    read: async () => ({ phase: 0, reservedLamports: new BN(2_000_000_000) }),
  };
  fixture.client.bankroll = {
    read: async () => ({ phase: 0, pendingEntryLamports: new BN(12_500_000) }),
  };
  const summary = await processDraws(fixture.input);
  assert.deepEqual(fixture.calls, []);
  assert.equal(fixture.logs[0].legacyFullPrizeLiabilityLamports, "2000000000");
  assert.equal(fixture.logs[0].pooledReservedLiabilityLamports, "2000000000");
  assert.equal(fixture.logs[0].bankrollPendingEntryLamports, "12500000");
  assert.equal(fixture.logs[0].unsettledLiabilityLamports, "4012500000");
  assert.equal(fixture.logs[0].bankrollUnsettledTickets, 2);
  assert.equal(fixture.logs[0].bankrollPrizesReserved, false);
  assert.equal(fixture.logs[0].bankrollBackingStatus, "verified");
  assert.equal(fixture.logs[0].bankrollReconciliationRequired, true);
  assert.equal(summary.reconciledDraws, 0);
  assert.equal(summary.preservedWins, 1);
});

function bankrollOperatorFixture({
  records = [account(1, [2, 22], 100, 4)],
  phase = 0,
} = {}) {
  const fixture = setup({
    records,
    args: ["--execute", "--wallet", "explicit.json"],
  });
  const ledger = {
    phase,
    pendingEntryLamports: new BN(phase === 0 ? records.length * 6_250_000 : 0),
  };
  fixture.client.bankroll = { read: async () => ({ ...ledger }) };
  fixture.client.reconcileBankrollDrawInstruction = async (drawTime) => {
    assert.equal(drawTime, 100);
    return new TransactionInstruction({
      programId,
      keys: [],
      data: Buffer.from([4]),
    });
  };
  fixture.client.program.provider = {
    sendAndConfirm: async (transaction, signers, options) => {
      assert.equal(transaction.instructions.length, 1);
      assert.deepEqual(signers, []);
      assert.equal(options.maxRetries, 0);
      assert.equal(options.commitment, "confirmed");
      assert.equal(options.preflightCommitment, "confirmed");
      assert.equal(
        fixture.input.receipt.context.kind,
        "reconcile-bankroll-entries",
      );
      fixture.calls.push("reconcile-bankroll");
      ledger.phase = 1;
      ledger.pendingEntryLamports = new BN(0);
      return "confirmed-bankroll-reconciliation";
    },
  };
  return fixture;
}

test("an explicit bankroll reconciliation releases entry holds while preserving all unpaid winners", async () => {
  const fixture = bankrollOperatorFixture();
  const summary = await processDraws(fixture.input);
  assert.deepEqual(fixture.calls, ["reconcile-bankroll"]);
  assert.equal(summary.reconciledDraws, 1);
  assert.equal(summary.preservedWins, 1);
  assert.equal(summary.settledLosses, 0);
  assert.equal(fixture.logs[1].bankrollEntriesReconciled, true);
  assert.equal(fixture.logs[1].signature, "confirmed-bankroll-reconciliation");
  const repeated = await processDraws(fixture.input);
  assert.equal(repeated.reconciledDraws, 0);
  assert.equal(repeated.preservedWins, 1);
  assert.deepEqual(fixture.calls, ["reconcile-bankroll"]);
});

test("bankroll loss cleanup retains its v4 handler hint after a fresh canonical scan", async () => {
  const fixture = bankrollOperatorFixture({
    records: [account(1, [22, 2], 100, 4), account(2, [2, 22], 100, 4)],
  });
  fixture.client.settleBatch = async (tickets) => {
    assert.equal(tickets.length, 1);
    assert.equal(tickets[0].reserveVersion, 4);
    assert.equal(tickets[0].bankroll, true);
    assert.equal(tickets[0].pooled, false);
    fixture.calls.push({
      releaseBankrollLosses: tickets.map((ticket) => ticket.id),
    });
    return { settled: tickets.length, signatures: ["confirmed-bankroll-loss"] };
  };
  const summary = await processDraws(fixture.input);
  assert.deepEqual(fixture.calls, [
    "reconcile-bankroll",
    { releaseBankrollLosses: ["1"] },
  ]);
  assert.equal(summary.settledLosses, 1);
  assert.equal(summary.preservedWins, 1);
});

test("unavailable bankroll ledgers report unknown holds without substituting prize sums", async () => {
  const fixture = bankrollOperatorFixture();
  fixture.client.bankroll.read = async () => {
    throw new Error("RPC unavailable");
  };
  const summary = await processDraws(fixture.input);
  assert.equal(fixture.logs[0].unsettledLiabilityLamports, null);
  assert.equal(fixture.logs[0].bankrollPendingEntryLamports, null);
  assert.equal(fixture.logs[0].bankrollBackingStatus, "unavailable");
  assert.equal(fixture.logs[0].legacyFullPrizeLiabilityLamports, "0");
  assert.equal(summary.reconciledDraws, 0);
  assert.equal(summary.preservedWins, 1);
  assert.deepEqual(fixture.calls, []);
  assert.match(
    fixture.logs[1].bankrollReconciliationSkipped,
    /no standalone transaction/,
  );
});

test("a failed bankroll reconciliation stops all loss cleanup and later draws without resubmission", async () => {
  const fixture = bankrollOperatorFixture({
    records: [account(1, [22, 2], 100, 4), account(2, [22, 2], 101, 4)],
  });
  fixture.client.program.provider.sendAndConfirm = async () => {
    fixture.calls.push("uncertain-bankroll-reconcile");
    throw new Error("Bankroll reconciliation confirmation is uncertain.");
  };
  await assert.rejects(processDraws(fixture.input), /uncertain/);
  assert.deepEqual(fixture.calls, ["uncertain-bankroll-reconcile"]);
});

test("the transaction bound applies before a bankroll reconciliation is built or signed", async () => {
  const fixture = bankrollOperatorFixture();
  fixture.input.receipt.assertWritable = () => {
    throw new Error("The transaction limit was reached.");
  };
  await assert.rejects(processDraws(fixture.input), /transaction limit/);
  assert.deepEqual(fixture.calls, []);
});

import test from "node:test";
import assert from "node:assert/strict";
import BN from "bn.js";
import {
  processingOptions,
  settlementDecision,
} from "../../../hiperia_program/scripts/process-due.js";

test("operator processing preserves unclaimed wins unless explicitly requested", () => {
  const ticket = { drawTime: new BN(100), settled: false, numbers: [2, 22] };
  const result = { drawTime: new BN(100), isPublished: true, numbers: [2, 22] };
  assert.equal(settlementDecision(ticket, result, 100, false), "unclaimed-win");
  assert.equal(settlementDecision(ticket, result, 100, true), "pay-owner");
  assert.equal(
    settlementDecision({ ...ticket, numbers: [22, 2] }, result, 100, false),
    "release-loss",
  );
  assert.equal(settlementDecision(ticket, result, 99, true), "upcoming");
  assert.equal(
    settlementDecision({ ...ticket, settled: true }, result, 100, true),
    "settled",
  );
  assert.equal(settlementDecision(ticket, null, 100, true), "unpublished");
  assert.throws(
    () =>
      settlementDecision(
        ticket,
        { ...result, drawTime: new BN(101) },
        200,
        true,
      ),
    /does not belong/,
  );
});

test("operator processing bounds paid work and rejects ambiguous options", () => {
  assert.deepEqual(processingOptions([]), {
    includeWins: false,
    maxTransactions: 20,
  });
  assert.deepEqual(
    processingOptions(["--include-wins", "--max-transactions", "4"]),
    { includeWins: true, maxTransactions: 4 },
  );
  for (const args of [
    ["--include-wins", "--include-wins"],
    ["--all"],
    ["--max-transactions"],
    ["--max-transactions", "0"],
    ["--max-transactions", "51"],
    ["--max-transactions", "1e2"],
  ])
    assert.throws(() => processingOptions(args));
});

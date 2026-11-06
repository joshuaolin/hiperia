import test from "node:test";
import assert from "node:assert/strict";
import { dodosErrorMessage } from "./errors.js";

test("reserve rejection explains capacity rather than implying one daily entry", () => {
  for (const failure of [
    { error: { errorCode: { code: "InsufficientVaultFunds" } } },
    new Error("Error Number: 6014. Error Message: Insufficient vault"),
    new Error("custom program error: 0x177e"),
  ]) {
    assert.match(
      dodosErrorMessage(failure),
      /Multiple entries for the same draw are allowed/,
    );
    assert.match(dodosErrorMessage(failure), /winning prizes stay reserved/);
  }
  assert.equal(
    dodosErrorMessage(new Error("Wallet rejected")),
    "Wallet rejected",
  );
  assert.equal(
    dodosErrorMessage(new Error("custom program error: 0x177f")),
    "custom program error: 0x177f",
  );
});

test("a raced unfunded claim remains unpaid and waits for a top-up without automatic resubmission", () => {
  for (const failure of [
    { error: { errorCode: { code: "ClaimAwaitingFunds" } } },
    new Error("Error Number: 6034. Error Message: Treasury needs funding"),
    new Error("custom program error: 0x1792"),
    new Error("Batch not confirmed", { cause: new Error("custom program error: 0x1792") }),
  ]) {
    assert.match(dodosErrorMessage(failure), /remains unpaid/);
    assert.match(dodosErrorMessage(failure), /operator tops up/);
  }
});

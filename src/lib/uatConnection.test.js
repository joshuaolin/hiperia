import test from "node:test";
import assert from "node:assert/strict";
import { pollTransaction } from "./uatConnection.js";

const signature = "1".repeat(88);

test("UAT confirms with HTTP polling when WebSocket confirmation is unavailable", async () => {
  let reads = 0;
  let elapsed = 0;
  const connection = {
    async getSignatureStatuses() {
      reads += 1;
      return {
        context: { slot: reads },
        value: [
          reads === 1 ? null : { confirmationStatus: "confirmed", err: null },
        ],
      };
    },
    async getBlockHeight() {
      return 10;
    },
  };
  const result = await pollTransaction(
    connection,
    { signature, lastValidBlockHeight: 20 },
    "confirmed",
    {
      now: () => elapsed,
      delay: async () => {
        elapsed += 1500;
      },
    },
  );
  assert.deepEqual(result, { context: { slot: 2 }, value: { err: null } });
  assert.equal(reads, 2);
});

test("UAT polling preserves failed confirmations and stops at expiry, timeout and abort", async () => {
  const confirmedFailure = {
    async getSignatureStatuses() {
      return {
        context: { slot: 1 },
        value: [
          {
            confirmationStatus: "confirmed",
            err: { InstructionError: [0, "Custom"] },
          },
        ],
      };
    },
  };
  assert.deepEqual(
    (await pollTransaction(confirmedFailure, signature)).value.err,
    { InstructionError: [0, "Custom"] },
  );
  let elapsed = 0;
  const pending = {
    async getSignatureStatuses() {
      return { context: { slot: 1 }, value: [null] };
    },
    async getBlockHeight() {
      return 21;
    },
  };
  await assert.rejects(
    pollTransaction(pending, { signature, lastValidBlockHeight: 20 }),
    /block height exceeded/,
  );
  await assert.rejects(
    pollTransaction(pending, signature, "confirmed", {
      now: () => elapsed,
      delay: async () => {
        elapsed += 1000;
      },
      timeout: 1000,
    }),
    /not confirmed/,
  );
  await assert.rejects(
    pollTransaction(pending, {
      signature,
      abortSignal: AbortSignal.abort(new Error("stop")),
    }),
    /stop/,
  );
});

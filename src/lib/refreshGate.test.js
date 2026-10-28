import test from "node:test";
import assert from "node:assert/strict";
import {
  RefreshGate,
  RefreshCooldownError,
  isRateLimitError,
} from "./refreshGate.js";

test("refresh spam shares one read and manual refresh waits eight seconds", async () => {
  let now = 1000;
  let reads = 0;
  let release;
  const gate = new RefreshGate({ now: () => now });
  const read = () => {
    reads += 1;
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  const first = gate.run(read);
  const second = gate.run(read, { manual: true });
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(reads, 1);
  release("real account data");
  assert.equal(await first, "real account data");
  await assert.rejects(
    gate.run(read, { manual: true }),
    (error) => error instanceof RefreshCooldownError && error.retryAt === 9000,
  );
  assert.equal(reads, 1);
  now = 9000;
  assert.equal(
    await gate.run(
      () => {
        reads += 1;
        return "new data";
      },
      { manual: true },
    ),
    "new data",
  );
  assert.equal(reads, 2);
});

test("post-transaction reads bypass manual cooldown but respect rate-limit backoff", async () => {
  let now = 0;
  const gate = new RefreshGate({ now: () => now });
  await gate.run(() => "initial accounts");
  assert.equal(await gate.run(() => "confirmed ticket"), "confirmed ticket");
  await assert.rejects(
    gate.run(() => {
      throw new Error("429 Too Many Requests");
    }),
    /429/,
  );
  let calls = 0;
  await assert.rejects(
    gate.run(() => {
      calls += 1;
    }),
    RefreshCooldownError,
  );
  assert.equal(calls, 0);
  now = 8000;
  assert.equal(
    await gate.run(() => "fresh chain receipt"),
    "fresh chain receipt",
  );
  assert.equal(gate.retryAt, 0);
});

test("429 backoff grows, honors Retry-After and caps at sixty seconds", async () => {
  let now = 0;
  const gate = new RefreshGate({ now: () => now });
  for (const seconds of [8, 16, 32, 60, 60]) {
    await assert.rejects(
      gate.run(() => {
        throw { status: 429 };
      }),
    );
    assert.equal(gate.retryAt - now, seconds * 1000);
    now = gate.retryAt;
  }
  await gate.run(() => "recovered");
  await assert.rejects(
    gate.run(() => {
      throw {
        response: {
          status: 429,
          headers: new Headers({ "retry-after": "25" }),
        },
      };
    }),
  );
  assert.equal(gate.retryAt - now, 25_000);
  now = gate.retryAt;
  await gate.run(() => "recovered");
  await assert.rejects(
    gate.run(() => {
      throw { status: 429, retryAfter: new Date(now + 45_000).toUTCString() };
    }),
  );
  assert.equal(gate.retryAt - now, 45_000);
  now = gate.retryAt;
  await gate.run(() => "recovered");
  await assert.rejects(
    gate.run(() => {
      throw { status: 429, retryAfter: "120" };
    }),
  );
  assert.equal(gate.retryAt - now, 60_000);
});

test("a confirmed transaction waits for an earlier read then fetches a fresh receipt", async () => {
  const gate = new RefreshGate({ now: () => 1000 });
  let finishEarlierRead;
  let freshReads = 0;
  const earlier = gate.run(
    () =>
      new Promise((resolve) => {
        finishEarlierRead = resolve;
      }),
  );
  await Promise.resolve();
  const afterTransaction = gate.run(
    () => {
      freshReads += 1;
      return "new confirmed ticket";
    },
    { freshAfterPending: true },
  );
  assert.equal(freshReads, 0);
  finishEarlierRead("old accounts before transaction");
  assert.equal(await earlier, "old accounts before transaction");
  assert.equal(await afterTransaction, "new confirmed ticket");
  assert.equal(freshReads, 1);
});

test("wallet-scoped gates cannot share another wallet's account data or failures", async () => {
  const firstWallet = new RefreshGate({ now: () => 1000 });
  const secondWallet = new RefreshGate({ now: () => 1000 });
  await assert.rejects(
    firstWallet.run(() => {
      throw new Error("429 Too Many Requests");
    }),
  );
  assert.equal(
    await secondWallet.run(() => "second wallet ticket"),
    "second wallet ticket",
  );
  assert.equal(secondWallet.retryAt, 0);
  assert.equal(
    isRateLimitError(new Error("gateway", { cause: { statusCode: 429 } })),
    true,
  );
});

test("failed refreshes neither retry automatically nor turn failures into cached success", async () => {
  let calls = 0;
  const gate = new RefreshGate({ now: () => 1000 });
  await assert.rejects(
    gate.run(() => {
      calls += 1;
      throw new Error("503 temporarily unavailable");
    }),
    /503/,
  );
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(gate.retryAt, 0);
  assert.equal(
    await gate.run(() => {
      calls += 1;
      return "actual chain data";
    }),
    "actual chain data",
  );
  assert.equal(calls, 2);
});

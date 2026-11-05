import test from "node:test";
import assert from "node:assert/strict";
import { VRF_PROGRAM_ID } from "../../lib/onchain/vrfProtocol.js";
import {
  executeRevealDraws,
  getRevealDraws,
  revealCostTotal,
  revealDrawKey,
  reviewedQuoteFor,
} from "./revealDraws.js";

const now = 1_800_000_000;
const ticket = (id, overrides = {}) => ({
  id,
  address: `ticket-${id}`,
  sourceProgram: VRF_PROGRAM_ID,
  drawTime: now - 60,
  numbers: [2, 22],
  draw: { status: "open" },
  ...overrides,
});
const reviewed = (entry, cost = 1000) => ({
  sourceProgram: entry.sourceProgram,
  drawTime: entry.drawTime,
  totalLamports: cost,
});

test("several daily tickets share one draw operation and oracle charge", () => {
  const first = ticket("first");
  const second = ticket("second");
  const third = ticket("third");
  const quick = ticket("quick", { drawTime: now - 10 });
  const draws = getRevealDraws([first, second, third, quick], now);
  assert.equal(draws.length, 2);
  assert.deepEqual(draws[0].tickets, [first, second, third]);
  assert.equal(revealDrawKey(first), revealDrawKey(second));
  assert.notEqual(revealDrawKey(first), revealDrawKey(quick));
  const quotes = {
    [revealDrawKey(first)]: reviewed(first, "7123001"),
    [revealDrawKey(quick)]: reviewed(quick, "8123001"),
  };
  assert.equal(revealCostTotal(draws, quotes), "15246002");
  assert.deepEqual(
    reviewedQuoteFor(quotes, second),
    quotes[revealDrawKey(first)],
  );
});

test("only due, unresolved public draws enter bulk reveal operations", () => {
  const active = ticket("active");
  const ignored = [
    ticket("future", { drawTime: now + 1 }),
    ticket("settled", { settled: true }),
    ticket("refund", { refunded: true }),
    ticket("expired", { refundEligible: true }),
    ticket("win", { result: { isPublished: true, numbers: [2, 22] } }),
    ticket("legacy", { sourceProgram: "legacy", legacy: true }),
    ticket("missing-source", { sourceProgram: undefined }),
    ticket("bad-time", { drawTime: NaN }),
    ticket("missing-status", { draw: null }),
    ticket("final", { draw: { status: "final" } }),
  ];
  assert.deepEqual(getRevealDraws([active, ...ignored], now)[0].tickets, [
    active,
  ]);
  assert.equal(getRevealDraws(ignored, now).length, 0);
});

test("pending and fulfilled draws do not add another oracle charge", () => {
  const entries = [
    ticket("pending", { draw: { status: "pending" } }),
    ticket("fulfilled", {
      drawTime: now - 10,
      draw: { status: "fulfilled" },
    }),
  ];
  assert.equal(revealCostTotal(getRevealDraws(entries, now), {}), "0");
  const refreshed = ticket("refreshed", { draw: { status: "fulfilled" } });
  const shared = getRevealDraws([ticket("stale"), refreshed, refreshed], now);
  assert.equal(shared.length, 1);
  assert.equal(shared[0].status, "fulfilled");
  assert.equal(shared[0].ticket.id, "refreshed");
  assert.equal(shared[0].tickets.length, 2);
});

test("missing, invalid or differently sourced quotes cannot produce a bulk total", () => {
  const entry = ticket("entry");
  const draws = getRevealDraws([entry], now);
  for (const quote of [
    undefined,
    reviewed(entry, -1),
    reviewed(entry, "invalid"),
    { ...reviewed(entry), sourceProgram: "legacy" },
    { ...reviewed(entry), drawTime: entry.drawTime + 1 },
  ]) {
    assert.equal(
      revealCostTotal(draws, { [revealDrawKey(entry)]: quote }),
      null,
    );
  }
});

test("bulk execution submits one operation per unique draw, sequentially", async () => {
  const entries = [
    ticket("first"),
    ticket("duplicate"),
    ticket("second-draw", { drawTime: now - 10 }),
  ];
  const calls = [];
  let running = false;
  const progress = await executeRevealDraws(entries, now, {
    recordDraw: async (entry) => {
      assert.equal(running, false);
      running = true;
      calls.push(entry.id);
      await Promise.resolve();
      running = false;
      return entry.id === "first"
        ? { phase: "final", signature: "confirmed-completion" }
        : { phase: "pending", pending: true, signature: "confirmed-request" };
    },
  });
  assert.deepEqual(calls, ["first", "second-draw"]);
  assert.equal(progress.completed, 1);
  assert.equal(progress.pending, 1);
  assert.equal(progress.results.length, 2);
});

test("a rejected or uncertain draw stops the batch and preserves confirmed progress", async () => {
  const entries = [
    ticket("first"),
    ticket("second", { drawTime: now - 10 }),
    ticket("third", { drawTime: now - 5 }),
  ];
  const calls = [];
  await assert.rejects(
    executeRevealDraws(entries, now, {
      recordDraw: async (entry) => {
        calls.push(entry.id);
        if (entry.id === "second") throw new Error("Wallet rejected approval.");
        return { phase: "final", signature: "confirmed" };
      },
    }),
    (failure) => {
      assert.equal(failure.confirmedDraws.completed, 1);
      assert.equal(
        failure.confirmedDraws.results[0].result.signature,
        "confirmed",
      );
      assert.match(failure.message, /1 earlier draw completed/);
      assert.match(failure.message, /no replacement transaction was sent/);
      return true;
    },
  );
  assert.deepEqual(calls, ["first", "second"]);
});

test("wallet changes stop before another draw can request an approval", async () => {
  let active = true;
  const calls = [];
  await assert.rejects(
    executeRevealDraws(
      [ticket("first"), ticket("second", { drawTime: now - 10 })],
      now,
      {
        assertActive: () => {
          if (!active) throw new Error("Wallet changed.");
        },
        recordDraw: async (entry) => {
          calls.push(entry.id);
          active = false;
          return { phase: "pending", pending: true };
        },
      },
    ),
    /1 awaiting the oracle.*Wallet changed/,
  );
  assert.deepEqual(calls, ["first"]);
});

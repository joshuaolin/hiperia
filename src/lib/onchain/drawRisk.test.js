import test from "node:test";
import assert from "node:assert/strict";
import { orderedPairIndex, pooledLiability, pooledEntryQuote } from "./drawRisk.js";

const entry = 6_250_000n, prize = 2_000_000_000n;
const empty = () => Array(420).fill(0n);

test("all ordered distinct 02-22 combinations have unique canonical risk buckets", () => {
  const indexes = new Set();
  for (let first = 2; first <= 22; first++)
    for (let second = 2; second <= 22; second++)
      if (first !== second) indexes.add(orderedPairIndex([first, second]));
  assert.equal(indexes.size, 420);
  assert.equal(Math.min(...indexes), 0);
  assert.equal(Math.max(...indexes), 419);
  for (const invalid of [[1, 2], [2, 2], [2, 23], [], [2.5, 3]])
    assert.throws(() => orderedPairIndex(invalid));
});

test("diversified entries share backing while same-pair winners retain full prizes", () => {
  assert.equal(pooledLiability(Array(420).fill(1n), entry, prize).reservedLamports, 4_618_750_000n);
  const counts = empty();
  counts[orderedPairIndex([2, 22])] = 10n;
  assert.equal(pooledLiability(counts, entry, prize).reservedLamports, 20_000_000_000n);
  const newPair = pooledEntryQuote(counts, [3, 22], entry, prize);
  assert.equal(newPair.requiredBackingLamports, 0n);
  assert.equal(pooledEntryQuote(counts, [2, 22], entry, prize).requiredBackingLamports, prize - entry);
});

test("backing covers partial refunds followed by any possible late winning result", () => {
  let random = 17;
  const next = () => (random = (Math.imul(random, 1664525) + 1013904223) >>> 0);
  for (let scenario = 0; scenario < 100; scenario++) {
    const counts = Array.from({ length: 420 }, () => BigInt(next() % 4));
    const initial = pooledLiability(counts, entry, prize).reservedLamports;
    let refunds = 0n;
    for (let action = 0; action < 80; action++) {
      const index = next() % 420;
      if (counts[index] === 0n) continue;
      counts[index]--;
      refunds += entry;
      assert.ok(initial - refunds >= pooledLiability(counts, entry, prize).reservedLamports);
    }
    for (let winner = 0; winner < 420; winner++)
      assert.ok(initial - refunds >= pooledLiability(counts, entry, prize, winner).reservedLamports);
  }
});

test("counts, total liability and final winner indexing reject overflow or malformed data", () => {
  const counts = empty();
  counts[0] = (1n << 64n) - 1n;
  assert.throws(() => pooledLiability(counts, entry, prize));
  assert.throws(() => pooledLiability([], entry, prize));
  assert.throws(() => pooledLiability(empty(), 0n, prize));
  assert.throws(() => pooledLiability(empty(), prize, entry));
  assert.throws(() => pooledLiability(empty(), entry, prize, 420));
});

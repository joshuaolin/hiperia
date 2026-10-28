import test from "node:test";
import assert from "node:assert/strict";
import {
  MIN_NUMBER,
  MAX_NUMBER,
  PICK_COUNT,
  NUMBER_OPTIONS,
  ORDERED_PAIR_COUNT,
  createQuickPick,
  QUICK_PAYOUT_MULTIPLIER,
  DAILY_PAYOUT_MULTIPLIER,
} from "./rules.js";

test("the current selection pool is exactly 02 through 22 with 420 ordered pairs", () => {
  assert.equal(MIN_NUMBER, 2);
  assert.equal(MAX_NUMBER, 22);
  assert.equal(PICK_COUNT, 2);
  assert.deepEqual(
    NUMBER_OPTIONS,
    Array.from({ length: 21 }, (_, index) => index + 2),
  );
  assert.equal(ORDERED_PAIR_COUNT, 420);
  assert.equal(QUICK_PAYOUT_MULTIPLIER, 1);
  assert.equal(DAILY_PAYOUT_MULTIPLIER, 2);
  assert.equal(NUMBER_OPTIONS.includes(1), false);
});

test("quick pick includes both range edges without duplicates or number 01", () => {
  for (const [samples, expected] of [
    [
      [0, 0],
      [2, 3],
    ],
    [
      [0, 0.9999999999999999],
      [2, 22],
    ],
    [
      [0.9999999999999999, 0],
      [22, 2],
    ],
    [
      [0.9999999999999999, 0.9999999999999999],
      [22, 21],
    ],
  ]) {
    const values = [...samples];
    assert.deepEqual(
      createQuickPick(() => values.shift()),
      expected,
    );
  }
});

test("quick pick can produce every valid ordered pair exactly once across its index mapping", () => {
  const pairs = new Set();
  for (let first = 0; first < 21; first += 1) {
    for (let second = 0; second < 20; second += 1) {
      const values = [(first + 0.5) / 21, (second + 0.5) / 20];
      const pair = createQuickPick(() => values.shift());
      assert.equal(pair.length, PICK_COUNT);
      assert.ok(
        pair.every(
          (number) =>
            Number.isInteger(number) &&
            number >= MIN_NUMBER &&
            number <= MAX_NUMBER,
        ),
      );
      assert.notEqual(pair[0], pair[1]);
      pairs.add(pair.join(","));
    }
  }
  assert.equal(pairs.size, ORDERED_PAIR_COUNT);
});

test("invalid quick-pick samples cannot yield an out-of-range selection", () => {
  for (const value of [-0.1, 1, Infinity, NaN, "0.5"]) {
    assert.throws(() => createQuickPick(() => value), RangeError);
  }
});

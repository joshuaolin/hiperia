import test from "node:test";
import assert from "node:assert/strict";
import {
  getNextDrawTime,
  getUpcomingDrawTimes,
  formatCountdown,
  formatDrawTime,
  formatDailyDrawHours,
  getSelectedDrawTime,
  isDailyDrawTime,
  getUatDrawTime,
} from "./time.js";

const timestamp = (value) => Date.parse(value);
const seconds = (value) => timestamp(value) / 1000;

test("daily choices include six exact draws spaced four hours apart in Manila", () => {
  assert.equal(formatDailyDrawHours(), "2 AM, 6 AM, 10 AM, 2 PM, 6 PM, 10 PM");
  assert.deepEqual(getUpcomingDrawTimes(timestamp("2026-10-28T05:59:59Z")), [
    seconds("2026-10-28T06:00:00Z"),
    seconds("2026-10-28T10:00:00Z"),
    seconds("2026-10-28T14:00:00Z"),
    seconds("2026-10-28T18:00:00Z"),
    seconds("2026-10-28T22:00:00Z"),
    seconds("2026-10-29T02:00:00Z"),
  ]);
  assert.deepEqual(getUpcomingDrawTimes(timestamp("2026-10-28T06:00:00Z")), [
    seconds("2026-10-28T10:00:00Z"),
    seconds("2026-10-28T14:00:00Z"),
    seconds("2026-10-28T18:00:00Z"),
    seconds("2026-10-28T22:00:00Z"),
    seconds("2026-10-29T02:00:00Z"),
    seconds("2026-10-29T06:00:00Z"),
  ]);
  for (const draw of getUpcomingDrawTimes(timestamp("2026-10-28T05:59:59Z"))) {
    assert.equal(isDailyDrawTime(draw), true);
    assert.equal(getNextDrawTime(draw * 1000 - 1), draw);
    assert.equal(getNextDrawTime(draw * 1000), draw + 14_400);
  }
});

test("daily schedule handles local date and year rollover within 24 hours", () => {
  for (const now of [
    "2026-12-31T16:00:00Z",
    "2026-12-31T09:01:00Z",
    "2028-02-28T23:00:00Z",
  ]) {
    const choices = getUpcomingDrawTimes(timestamp(now));
    assert.equal(choices.length, 6);
    assert.equal(getNextDrawTime(timestamp(now)), choices[0]);
    assert.ok(
      choices.every(
        (draw) => draw > seconds(now) && draw <= seconds(now) + 86_400,
      ),
    );
  }
  assert.match(
    formatDrawTime(seconds("2027-01-01T06:00:00Z")),
    /Jan 1.*2:00 PM/,
  );
  assert.throws(() => getUpcomingDrawTimes(NaN), /finite timestamp/);
});

test("checkout preserves the selected occurrence and rejects it after the draw starts", () => {
  const before = timestamp("2026-10-28T05:59:59Z");
  const selected = getNextDrawTime(timestamp("2026-10-28T05:59:59Z"));
  assert.equal(getSelectedDrawTime(String(selected), before), selected);
  assert.throws(
    () =>
      getSelectedDrawTime(String(selected), timestamp("2026-10-28T06:00:00Z")),
    /not be moved automatically/,
  );
  assert.throws(
    () =>
      getSelectedDrawTime(String(selected), timestamp("2026-10-28T06:00:01Z")),
    /not be moved automatically/,
  );
  assert.equal(
    getSelectedDrawTime("quick", before),
    Math.floor(before / 1000) + 60,
  );
  assert.throws(
    () => getSelectedDrawTime(String(seconds("2026-10-28T08:00:00Z")), before),
    /scheduled daily draws or Quick draw/,
  );
});

test("countdown renders long waits, final seconds and elapsed draws", () => {
  assert.equal(formatCountdown(3661), "1h 1m 1s");
  assert.equal(formatCountdown(59), "0m 59s");
  assert.equal(formatCountdown(-1), "0m 0s");
});

test("only the six exact Manila slots count as daily draws", () => {
  for (const value of [
    "2026-10-27T18:00:00Z",
    "2026-10-27T22:00:00Z",
    "2026-10-28T02:00:00Z",
    "2026-10-28T06:00:00Z",
    "2026-10-28T10:00:00Z",
    "2026-10-28T14:00:00Z",
    "2027-01-01T06:00:00Z",
  ]) {
    const draw = seconds(value);
    assert.equal(isDailyDrawTime(draw), true);
    assert.equal(isDailyDrawTime(draw - 1), false);
    assert.equal(isDailyDrawTime(draw + 1), false);
  }
  for (const draw of [
    NaN,
    Infinity,
    -1,
    0,
    "1793167200",
    seconds("2026-10-28T13:00:00Z"),
    seconds("2026-10-28T06:00:00Z") + 0.5,
  ]) {
    assert.equal(isDailyDrawTime(draw), false);
  }
});

test("quick test draws avoid daily prize slots at checkout, including custom test delays", () => {
  for (const daily of [
    "2026-10-27T18:00:00Z",
    "2026-10-27T22:00:00Z",
    "2026-10-28T02:00:00Z",
    "2026-10-28T06:00:00Z",
    "2026-10-28T10:00:00Z",
    "2026-10-28T14:00:00Z",
    "2027-01-01T06:00:00Z",
  ]) {
    for (const delay of [25, 35, 60]) {
      const now = timestamp(daily) - delay * 1000;
      const quick = getUatDrawTime(now, delay);
      assert.equal(quick, seconds(daily) + 1);
      assert.equal(isDailyDrawTime(quick), false);
      assert.ok(quick > Math.floor(now / 1000));
      if (delay === 60) assert.equal(getSelectedDrawTime("quick", now), quick);
    }
  }
  const ordinary = timestamp("2026-10-28T23:59:40Z");
  assert.equal(getUatDrawTime(ordinary), seconds("2026-10-29T00:00:40Z"));
  assert.throws(() => getUatDrawTime(NaN), /finite timestamp/);
  for (const delay of [0, -1, 0.5, Infinity])
    assert.throws(() => getUatDrawTime(ordinary, delay), /positive whole/);
});

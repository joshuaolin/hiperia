import test from "node:test";
import assert from "node:assert/strict";
import {
  LEMON_DAILY_HOURS,
  upcomingLemonDrawTimes,
  isLemonDailyDrawTime,
  selectedLemonDrawTime,
} from "./lemonSchedule.js";
import { getUpcomingDrawTimes as dodosDraws } from "../../lib/onchain/time.js";

test("Lemon's six UTC+8 draws start one hour after Dodos and retain a 24-hour horizon", () => {
  const now = Date.parse("2026-11-16T16:00:00Z");
  const times = upcomingLemonDrawTimes(now);
  assert.equal(times.length, 6);
  assert.deepEqual(
    times.map((time) => ((time + 28_800) % 86400) / 3600),
    LEMON_DAILY_HOURS,
  );
  assert.deepEqual(
    times.map((time, index) => time - dodosDraws(now)[index]),
    Array(6).fill(3600),
  );
  assert.ok(
    times.every(
      (time) =>
        isLemonDailyDrawTime(time) &&
        time * 1000 > now &&
        time * 1000 <= now + 86_400_000,
    ),
  );
});

test("Lemon daily selection handles midnight/year rollover and exact sales close", () => {
  const now = Date.parse("2026-12-31T14:59:59Z");
  const [first, second] = upcomingLemonDrawTimes(now);
  assert.equal(
    new Date(first * 1000).toISOString(),
    "2026-12-31T15:00:00.000Z",
  );
  assert.equal(
    new Date(second * 1000).toISOString(),
    "2026-12-31T19:00:00.000Z",
  );
  assert.equal(selectedLemonDrawTime(String(first), now), first);
  assert.throws(
    () => selectedLemonDrawTime(String(first), first * 1000),
    /upcoming/,
  );
  assert.throws(
    () => selectedLemonDrawTime(String(first - 3600), now - 3600000),
    /upcoming/,
  );
});

test("quick Lemon avoids the new daily prize second while actual metadata determines listed slots", () => {
  const draw = Date.parse("2026-11-16T19:00:00Z") / 1000;
  assert.equal(selectedLemonDrawTime("quick", (draw - 60) * 1000), draw + 1);
  assert.equal(isLemonDailyDrawTime(draw - 3600), false);
  assert.deepEqual(upcomingLemonDrawTimes(draw * 1000, []), []);
  assert.throws(() => upcomingLemonDrawTimes(NaN), /clock/);
  assert.throws(() => upcomingLemonDrawTimes(Date.now(), [24]), /schedule/);
});

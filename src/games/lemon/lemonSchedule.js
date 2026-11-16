import { formatDrawTime } from "../../lib/onchain/time.js";

export const LEMON_DAILY_HOURS = Object.freeze([3, 7, 11, 15, 19, 23]);

export function isLemonDailyDrawTime(timestamp) {
  return (
    Number.isSafeInteger(timestamp) &&
    timestamp > 0 &&
    timestamp % 14_400 === 10_800
  );
}

export function upcomingLemonDrawTimes(
  now = Date.now(),
  hours = LEMON_DAILY_HOURS,
) {
  if (!Number.isFinite(now)) throw new TypeError("Invalid draw clock.");
  if (
    !Array.isArray(hours) ||
    hours.some((hour) => !Number.isInteger(hour) || hour < 0 || hour > 23)
  )
    throw new TypeError("Invalid on-chain draw schedule.");
  const day = 86_400_000;
  const start = Math.floor((now + 28_800_000) / day) * day - 28_800_000;
  return [
    ...new Set(
      [0, 1].flatMap((days) =>
        hours.map((hour) => start + days * day + hour * 3_600_000),
      ),
    ),
  ]
    .sort((a, b) => a - b)
    .filter((draw) => draw > now && draw <= now + day)
    .map((draw) => Math.floor(draw / 1000));
}

export function nextLemonDrawTime(now = Date.now()) {
  return upcomingLemonDrawTimes(now)[0];
}

export function selectedLemonDrawTime(choice, now = Date.now()) {
  const seconds = Math.floor(now / 1000);
  let timestamp = choice === "quick" ? seconds + 60 : Number(choice);
  if (
    choice === "quick" &&
    (isLemonDailyDrawTime(timestamp) || timestamp % 14_400 === 7200)
  )
    timestamp++;
  if (
    !Number.isSafeInteger(timestamp) ||
    timestamp <= seconds ||
    timestamp > seconds + 86_400 ||
    (choice !== "quick" && !isLemonDailyDrawTime(timestamp))
  )
    throw new RangeError(
      "Choose an upcoming Lemon daily draw or Quick draw within 24 hours.",
    );
  return timestamp;
}

export { formatDrawTime };

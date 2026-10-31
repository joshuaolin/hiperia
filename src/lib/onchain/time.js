import { DAILY_DRAW_HOURS } from "./rules.js";

export class DrawSchedule {
  upcomingDrawTimes(now = Date.now()) {
    if (!Number.isFinite(now))
      throw new TypeError("Current time must be a finite timestamp.");
    const day = 86_400_000;
    const offset = 28_800_000;
    const start = Math.floor((now + offset) / day) * day - offset;
    return [0, 1]
      .flatMap((days) =>
        DAILY_DRAW_HOURS.map((hour) => start + days * day + hour * 3_600_000),
      )
      .filter((draw) => draw > now && draw <= now + day)
      .map((draw) => Math.floor(draw / 1000));
  }

  nextDrawTime(now = Date.now()) {
    return this.upcomingDrawTimes(now)[0];
  }

  format(drawTime) {
    return new Intl.DateTimeFormat("en-PH", {
      timeZone: "Asia/Manila",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(Number(drawTime) * 1000));
  }
}

const schedule = new DrawSchedule();
export const getNextDrawTime = (now = Date.now()) => schedule.nextDrawTime(now);
export const getUpcomingDrawTimes = (now = Date.now()) =>
  schedule.upcomingDrawTimes(now);
export const formatDrawTime = (time) => schedule.format(time);
export const formatDailyDrawHours = () =>
  DAILY_DRAW_HOURS.map(
    (hour) => `${hour % 12 || 12} ${hour < 12 ? "AM" : "PM"}`,
  ).join(", ");
export function isDailyDrawTime(drawTime) {
  return (
    Number.isSafeInteger(drawTime) &&
    drawTime > 0 &&
    DAILY_DRAW_HOURS.some(
      (hour) => ((hour + 16) % 24) * 3600 === drawTime % 86_400,
    )
  );
}
export function getUatDrawTime(now = Date.now(), delay = 60) {
  if (!Number.isFinite(now))
    throw new TypeError("Current time must be a finite timestamp.");
  if (!Number.isSafeInteger(delay) || delay < 1)
    throw new RangeError(
      "The test draw delay must be a positive whole number of seconds.",
    );
  const candidate = Math.floor(now / 1000) + delay;
  const drawTime = isDailyDrawTime(candidate) ? candidate + 1 : candidate;
  if (!Number.isSafeInteger(drawTime))
    throw new RangeError("The test draw timestamp must be a safe integer.");
  return drawTime;
}
export function getSelectedDrawTime(choice, now = Date.now()) {
  if (!Number.isFinite(now))
    throw new TypeError("Current time must be a finite timestamp.");
  const currentSeconds = Math.floor(now / 1000);
  const drawTime = choice === "quick" ? getUatDrawTime(now) : Number(choice);
  if (!Number.isSafeInteger(drawTime) || drawTime > currentSeconds + 86_400)
    throw new RangeError("Choose a draw within the next 24 hours.");
  if (drawTime <= currentSeconds)
    throw new RangeError(
      "Your selected draw has started. Choose the next draw; your ticket will not be moved automatically.",
    );
  if (choice !== "quick" && !isDailyDrawTime(drawTime))
    throw new RangeError("Choose one of the scheduled daily draws or Quick draw.");
  return drawTime;
}
export function formatCountdown(seconds) {
  const remaining = Math.max(0, Math.ceil(seconds));
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  return `${hours ? `${hours}h ` : ""}${minutes}m ${remaining % 60}s`;
}

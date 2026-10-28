const DAY_SECONDS = 86_400;
const MANILA_OFFSET = 28_800;
const SESSIONS = new Set(["all", "14", "16", "test"]);
const dateFormatter = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  month: "short",
  day: "numeric",
  year: "numeric",
});
const timeFormatter = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

function queryError(message, field) {
  return Object.assign(new RangeError(message), { field });
}

function dayStart(value, field) {
  if (!value) return null;
  const label = field === "from" ? "From" : "To";
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw queryError(`Enter a valid ${label} date.`, field);
  const milliseconds = Date.parse(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString().slice(0, 10) !== value
  )
    throw queryError(`Enter a valid ${label} date.`, field);
  return milliseconds / 1000 - MANILA_OFFSET;
}

export function getDrawSession(drawTime) {
  const seconds = Number(drawTime);
  if (!Number.isSafeInteger(seconds)) return null;
  const local =
    (((seconds + MANILA_OFFSET) % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS;
  if (local === 14 * 3600) return "14";
  if (local === 16 * 3600) return "16";
  return "test";
}

export function drawSessionLabel(drawTime) {
  return (
    { 14: "2 PM draw", 16: "4 PM draw", test: "UAT test draw" }[
      getDrawSession(drawTime)
    ] ?? "Unknown session"
  );
}

export function formatCombination(numbers) {
  if (
    !Array.isArray(numbers) ||
    numbers.length !== 2 ||
    !numbers.every(
      (number) => Number.isInteger(number) && number >= 1 && number <= 22,
    )
  )
    return "Unavailable";
  return numbers.map((number) => String(number).padStart(2, "0")).join(" – ");
}

export function formatResultDate(drawTime) {
  return dateFormatter.format(new Date(Number(drawTime) * 1000));
}

export function formatResultTime(drawTime) {
  return timeFormatter.format(new Date(Number(drawTime) * 1000));
}

export class DrawHistory {
  constructor(records = []) {
    this.records = (Array.isArray(records) ? records : [])
      .filter(
        (record) =>
          record &&
          record.drawTime !== null &&
          Number.isSafeInteger(Number(record.drawTime)) &&
          Number.isFinite(new Date(Number(record.drawTime) * 1000).getTime()),
      )
      .map((record) => ({ ...record, drawTime: Number(record.drawTime) }))
      .sort((first, second) => second.drawTime - first.drawTime);
  }

  query({ from = "", to = "", session = "all", page = 1, pageSize = 10 } = {}) {
    const start = dayStart(from, "from");
    const end = dayStart(to, "to");
    if (start !== null && end !== null && start > end)
      throw queryError("From date must be on or before To date.", "range");
    if (!SESSIONS.has(session))
      throw queryError("Choose a valid draw session.", "session");
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50)
      throw queryError("Page size must be between 1 and 50.", "page");
    if (!Number.isInteger(page) || page < 1)
      throw queryError("Choose a valid results page.", "page");
    const matches = this.records.filter(
      (record) =>
        (start === null || record.drawTime >= start) &&
        (end === null || record.drawTime < end + DAY_SECONDS) &&
        (session === "all" || getDrawSession(record.drawTime) === session),
    );
    const pages = Math.max(1, Math.ceil(matches.length / pageSize));
    const currentPage = Math.min(page, pages);
    const offset = (currentPage - 1) * pageSize;
    return {
      records: matches.slice(offset, offset + pageSize),
      total: matches.length,
      loaded: this.records.length,
      page: currentPage,
      pages,
      first: matches.length ? offset + 1 : 0,
      last: Math.min(offset + pageSize, matches.length),
    };
  }
}

const DAY_SECONDS = 86_400;
const MANILA_OFFSET = 28_800;
const SESSIONS = new Set([
  "all",
  "quick",
  "daily",
  "unknown",
  ...Array.from({ length: 24 }, (_, hour) => String(hour)),
]);
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

export function getDrawSession(value) {
  const record = value !== null && typeof value === "object" ? value : null;
  const seconds = Number(record?.drawTime);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return null;
  if (record?.drawType === "quick") return "quick";
  if (record?.drawType !== "daily") return "unknown";
  const local =
    (((seconds + MANILA_OFFSET) % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS;
  return local % 3600 === 0 ? String(local / 3600) : "daily";
}

export function formatSessionHour(hour) {
  return `${hour % 12 || 12} ${hour < 12 ? "AM" : "PM"}`;
}

export function drawSessionLabel(value) {
  const session = getDrawSession(value);
  if (session === "quick") return "Quick draw";
  if (session === "daily") return "Daily draw";
  return session === null || session === "unknown"
    ? "Type not recorded"
    : `${formatSessionHour(Number(session))} daily draw`;
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
        (session === "all" || getDrawSession(record) === session),
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

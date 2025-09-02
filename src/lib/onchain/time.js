// next draw: 14:00 or 16:00 in UTC+8, return unix seconds (UTC)
export function nextDrawTimeUtcSeconds(now = new Date()) {
  const tz = "Asia/Shanghai";
  const asTz = new Date(now.toLocaleString("en-US", { timeZone: tz }));
  const drawHours = [14, 16];

  let next = new Date(asTz);
  for (const h of drawHours) {
    const d = new Date(asTz);
    d.setHours(h, 0, 0, 0);
    if (d > asTz) { next = d; break; }
  }
  if (next <= asTz) {
    next = new Date(asTz);
    next.setDate(asTz.getDate() + 1);
    next.setHours(drawHours[0], 0, 0, 0);
  }
  // convert that wall time (UTC+8) to epoch seconds (UTC)
  const utcIso = new Date(next.toLocaleString("en-US", { timeZone: "UTC" })).toISOString();
  return Math.floor(new Date(utcIso).getTime() / 1000);
}

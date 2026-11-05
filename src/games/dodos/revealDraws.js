import { getTicketState } from "../../components/ticketStates.js";
import { VRF_PROGRAM_ID } from "../../lib/onchain/vrfProtocol.js";

export function revealDrawKey(ticket) {
  if (
    ticket?.sourceProgram !== VRF_PROGRAM_ID ||
    !Number.isSafeInteger(ticket.drawTime) ||
    ticket.drawTime <= 0
  )
    return null;
  return `${ticket.sourceProgram}:${ticket.drawTime}`;
}

export function getRevealDraws(tickets, nowSeconds) {
  const groups = new Map();
  const priorities = { open: 0, pending: 1, fulfilled: 2 };
  for (const ticket of tickets) {
    const key = revealDrawKey(ticket);
    const state = getTicketState(ticket, nowSeconds);
    const status = ticket.draw?.status;
    if (
      !key ||
      ticket.legacy === true ||
      !state.due ||
      state.published ||
      state.settled ||
      state.refunded ||
      !Object.hasOwn(priorities, status) ||
      (status === "open" && ticket.refundEligible === true)
    )
      continue;
    let group = groups.get(key);
    if (!group) {
      group = { key, ticket, tickets: [], status };
      groups.set(key, group);
    }
    if (priorities[status] > priorities[group.status]) {
      group.status = status;
      group.ticket = ticket;
    }
    if (
      !group.tickets.some(
        (entry) =>
          (entry.address ?? entry.id) === (ticket.address ?? ticket.id),
      )
    )
      group.tickets.push(ticket);
  }
  return [...groups.values()].sort(
    (first, second) => first.ticket.drawTime - second.ticket.drawTime,
  );
}

export function reviewedQuoteFor(quotes, ticket) {
  const key = revealDrawKey(ticket);
  const quote = key ? quotes?.[key] : null;
  return quote?.drawTime === ticket.drawTime &&
    quote.sourceProgram === ticket.sourceProgram
    ? quote
    : null;
}

export function revealCostTotal(draws, quotes) {
  let total = 0n;
  for (const draw of draws) {
    if (draw.status !== "open") continue;
    const quote = reviewedQuoteFor(quotes, draw.ticket);
    try {
      if (quote?.totalLamports == null) return null;
      const cost = BigInt(quote.totalLamports.toString());
      if (cost < 0n) return null;
      total += cost;
    } catch {
      return null;
    }
  }
  return total.toString();
}

export async function executeRevealDraws(
  tickets,
  nowSeconds,
  { recordDraw, assertActive = () => {}, onProgress = () => {} },
) {
  const draws = getRevealDraws(tickets, nowSeconds);
  const progress = { completed: 0, pending: 0, results: [] };
  for (const [index, draw] of draws.entries()) {
    try {
      assertActive();
      onProgress({ index, total: draws.length, draw });
      const result = await recordDraw(draw.ticket);
      if (result.pending || result.phase === "pending") progress.pending += 1;
      else if (result.phase === "final" || result.draw?.status === "final")
        progress.completed += 1;
      else throw new Error("The next draw's recorded status is unavailable.");
      progress.results.push({ key: draw.key, result });
    } catch (cause) {
      const recorded = progress.completed + progress.pending;
      const prefix = recorded
        ? `${progress.completed} earlier draw${progress.completed === 1 ? "" : "s"} completed; ${progress.pending} awaiting the oracle. `
        : "";
      const failure = new Error(
        `${prefix}${cause.message || "The next draw was not confirmed."} Stopped before the next draw. Refresh to check recorded progress; no replacement transaction was sent.`,
        { cause },
      );
      failure.confirmedDraws = progress;
      throw failure;
    }
  }
  return progress;
}

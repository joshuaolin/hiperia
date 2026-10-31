import { Transaction } from "@solana/web3.js";

export const SETTLEMENT_BATCH_SIZE = 6;

export async function sendSettlementBatches({
  tickets,
  instructionFor,
  send,
  pendingTickets = async (batch) => batch,
  assertActive = () => {},
  batchSize = SETTLEMENT_BATCH_SIZE,
}) {
  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > SETTLEMENT_BATCH_SIZE
  )
    throw new RangeError(
      "Settlement batches must contain between one and six tickets.",
    );
  const signatures = [];
  let settled = 0;
  const unique = [
    ...new Map(tickets.map((ticket) => [ticket.address, ticket])).values(),
  ];
  for (let offset = 0; offset < unique.length; offset += batchSize) {
    assertActive();
    const candidates = unique.slice(offset, offset + batchSize);
    const active = await pendingTickets(candidates);
    if (!active.length) continue;
    const transaction = new Transaction();
    for (const ticket of active) {
      const instructions = await instructionFor(ticket);
      transaction.add(
        ...(Array.isArray(instructions) ? instructions : [instructions]),
      );
    }
    assertActive();
    try {
      signatures.push(await send(transaction));
      settled += active.length;
    } catch (cause) {
      const failure = new Error(
        `${settled ? `${settled} ticket${settled === 1 ? " was" : "s were"} processed. ` : ""}The next batch was not confirmed. Refresh to check on-chain status before trying again. No replacement transaction was sent. ${cause.message || ""}`,
        { cause },
      );
      failure.confirmedSettlements = settled;
      failure.confirmedSignatures = [...signatures];
      throw failure;
    }
  }
  return { settled, signatures };
}

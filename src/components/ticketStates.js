export const TICKET_FILTERS = [
  { id: "ongoing", label: "Ongoing" },
  { id: "win", label: "Win" },
  { id: "done", label: "Done" },
];

function isNumberPair(numbers) {
  return (
    Array.isArray(numbers) &&
    numbers.length === 2 &&
    numbers.every(
      (number) => Number.isInteger(number) && number >= 1 && number <= 22,
    ) &&
    numbers[0] !== numbers[1]
  );
}

export function getTicketState(ticket, nowSeconds) {
  const due =
    Number.isSafeInteger(ticket.drawTime) &&
    ticket.drawTime > 0 &&
    Number.isFinite(nowSeconds) &&
    nowSeconds >= ticket.drawTime;
  const refunded = ticket.refunded === true;
  const published =
    !refunded &&
    ticket.result?.isPublished === true &&
    isNumberPair(ticket.result.numbers);
  const won =
    published &&
    isNumberPair(ticket.numbers) &&
    ticket.numbers.every(
      (number, index) => number === ticket.result.numbers[index],
    );
  const settled = ticket.settled === true;
  const needsFundingCheck = ticket.reserveVersion === 4 || ticket.bankroll === true;
  const funded = !needsFundingCheck || (ticket.claimFundingVerified === true && ticket.claimFunded === true);
  return {
    due,
    published,
    won,
    settled,
    refunded,
    funded,
    awaitingFunding: due && won && !settled && !refunded && needsFundingCheck && ticket.claimFundingVerified === true && ticket.claimFunded === false,
    fundingUnknown: due && won && !settled && !refunded && needsFundingCheck && ticket.claimFundingVerified !== true,
    claimable: due && won && !settled && !refunded && funded,
    group:
      refunded || settled || (published && !won)
        ? "done"
        : won
          ? "win"
          : "ongoing",
  };
}

export function groupTicketsByState(tickets, nowSeconds) {
  return tickets.reduce(
    (groups, ticket) => {
      groups[getTicketState(ticket, nowSeconds).group].push(ticket);
      return groups;
    },
    { ongoing: [], win: [], done: [] },
  );
}

export function getClaimableTickets(tickets, nowSeconds) {
  return tickets.filter(
    (ticket) => getTicketState(ticket, nowSeconds).claimable,
  );
}

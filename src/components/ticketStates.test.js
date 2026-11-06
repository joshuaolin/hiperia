import test from "node:test";
import assert from "node:assert/strict";
import {
  getClaimableTickets,
  getTicketState,
  groupTicketsByState,
} from "./ticketStates.js";

const now = 1_700_000_000;

function ticket(overrides = {}) {
  return {
    id: "1",
    drawTime: now - 60,
    numbers: [2, 22],
    settled: false,
    result: null,
    ...overrides,
  };
}

function result(numbers = [2, 22], isPublished = true) {
  return { numbers, isPublished };
}

test("unfunded and unknown-funding v4 winners remain in Win until an actual settlement", () => {
  const win = ticket({ reserveVersion: 4, bankroll: true, result: result() });
  for (const funding of [
    { claimFundingVerified: false, claimFunded: false },
    { claimFundingVerified: true, claimFunded: false },
  ]) {
    const unpaid = { ...win, ...funding };
    assert.equal(getTicketState(unpaid, now).group, "win");
    assert.equal(getTicketState(unpaid, now).claimable, false);
    assert.equal(getClaimableTickets([unpaid], now).length, 0);
  }
  const funded = { ...win, claimFundingVerified: true, claimFunded: true };
  assert.equal(getTicketState(funded, now).claimable, true);
  assert.equal(getTicketState({ ...funded, settled: true }, now).group, "done");
  for (const reserveVersion of [2, 3])
    assert.equal(getTicketState({ ...win, bankroll: false, reserveVersion, claimFundingVerified: false }, now).claimable, true);
});

test("ticket filters separate upcoming, awaiting, unclaimed wins, losses, and settled tickets", () => {
  const tickets = [
    ticket({ id: "upcoming", drawTime: now + 1 }),
    ticket({ id: "awaiting" }),
    ticket({ id: "winner", result: result() }),
    ticket({ id: "loss", result: result([22, 2]) }),
    ticket({ id: "claimed", result: result(), settled: true }),
    ticket({ id: "closed", result: result([22, 2]), settled: true }),
  ];
  const groups = groupTicketsByState(tickets, now);
  assert.deepEqual(
    groups.ongoing.map(({ id }) => id),
    ["upcoming", "awaiting"],
  );
  assert.deepEqual(
    groups.win.map(({ id }) => id),
    ["winner"],
  );
  assert.deepEqual(
    groups.done.map(({ id }) => id),
    ["loss", "claimed", "closed"],
  );
  assert.deepEqual(
    getClaimableTickets(tickets, now).map(({ id }) => id),
    ["winner"],
  );
  assert.equal(tickets[3].settled, false);
});

test("claim eligibility needs the actual published ordered pair and a due, unsettled ticket", () => {
  for (const overrides of [
    { result: result([22, 2]) },
    { result: result([2, 22], false) },
    { result: result([2]) },
    { result: result([2, 22]), drawTime: now + 1 },
    { result: result([2, 22]), settled: true },
    { result: result([2, 22]), numbers: [2] },
    { result: result([2, 22]), drawTime: NaN },
  ]) {
    assert.equal(getTicketState(ticket(overrides), now).claimable, false);
  }
  assert.equal(
    getTicketState(ticket({ result: result(), drawTime: now }), now).claimable,
    true,
  );
});

test("historical winning pairs keep their recorded values and can still be claimed", () => {
  for (const numbers of [
    [6, 9],
    [1, 22],
  ]) {
    const historical = ticket({ numbers, result: result(numbers) });
    assert.equal(getTicketState(historical, now).group, "win");
    assert.deepEqual(getClaimableTickets([historical], now), [historical]);
  }
});

test("unpublished or malformed result records cannot fabricate a completed or winning ticket", () => {
  for (const numbers of [[], [2], [2, 2], [2, 23], [2, "22"], null]) {
    const state = getTicketState(ticket({ result: result(numbers) }), now);
    assert.equal(state.group, "ongoing");
    assert.equal(state.claimable, false);
    assert.equal(state.published, false);
  }
});

test("empty filters and claims stay empty without changing the input order", () => {
  assert.deepEqual(groupTicketsByState([], now), {
    ongoing: [],
    win: [],
    done: [],
  });
  assert.deepEqual(getClaimableTickets([], now), []);
  const tickets = [
    ticket({ id: "newer", result: result() }),
    ticket({ id: "older", result: result() }),
  ];
  assert.deepEqual(getClaimableTickets(tickets, now), tickets);
  assert.deepEqual(
    tickets.map(({ id }) => id),
    ["newer", "older"],
  );
});

test("refunded entries are Done without inventing a losing result or another prize", () => {
  for (const overrides of [
    { refunded: true, settled: true },
    { refunded: true, result: result() },
    { refunded: true },
  ]) {
    const state = getTicketState(ticket(overrides), now);
    assert.equal(state.refunded, true);
    assert.equal(state.group, "done");
    assert.equal(state.published, false);
    assert.equal(state.won, false);
    assert.equal(state.claimable, false);
  }
});

test("oracle progress alone cannot manufacture a published result or a win", () => {
  for (const status of ["open", "pending", "fulfilled", "final"]) {
    const state = getTicketState(ticket({ draw: { status } }), now);
    assert.equal(state.group, "ongoing");
    assert.equal(state.published, false);
    assert.equal(state.claimable, false);
  }
});

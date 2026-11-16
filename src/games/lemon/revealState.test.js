import test from "node:test";
import assert from "node:assert/strict";
import { LemonDrawProgress } from "./revealState.js";
import { LEMON_PROGRAM_ID } from "../../lib/onchain/lemonProtocol.js";

const draw = {
  drawTime: 1794765600,
  address: "verified-draw-address",
  status: "final",
  numbers: [0, 0, 0],
  oracleRequest: "verified-oracle-request",
};
const tickets = [1, 2].map((id) => ({
  id: String(id),
  sourceProgram: LEMON_PROGRAM_ID,
  drawTime: draw.drawTime,
  numbers: [0, 0, 0],
  settled: false,
  refunded: false,
  draw: { status: "open" },
}));

test("one confirmed result updates every same-draw ticket without inventing paid markers or duplicate rows", () => {
  const progress = new LemonDrawProgress();
  progress.remember(draw);
  const snapshot = progress.merge({ tickets, results: [] });
  assert.equal(snapshot.results.length, 1);
  for (const ticket of snapshot.tickets) {
    assert.equal(ticket.draw.status, "final");
    assert.deepEqual(ticket.result.numbers, [0, 0, 0]);
    assert.equal(ticket.settled, false);
  }
  assert.equal(progress.merge(snapshot).results.length, 1);
});

test("stale refreshes cannot resurrect a completed or already requested draw", () => {
  const progress = new LemonDrawProgress();
  progress.remember({ ...draw, status: "pending", numbers: null });
  progress.remember({ ...draw, status: "open", numbers: null });
  assert.equal(progress.merge({ tickets }).tickets[0].draw.status, "pending");
  progress.remember(draw);
  progress.remember({ ...draw, status: "pending", numbers: null });
  assert.equal(
    progress.merge({ tickets, results: [] }).results[0].isPublished,
    true,
  );
});

test("remembered draws never affect another program, draw, or existing settled/refunded rights", () => {
  const progress = new LemonDrawProgress();
  progress.remember(draw);
  const rows = [
    ...tickets,
    { ...tickets[0], id: "other-program", sourceProgram: "other" },
    { ...tickets[0], id: "other-draw", drawTime: draw.drawTime + 1 },
    { ...tickets[0], id: "paid", settled: true },
    { ...tickets[0], id: "refund", refunded: true, settled: true },
  ];
  const result = progress.merge({ tickets: rows }).tickets;
  assert.equal(result[2].draw.status, "open");
  assert.equal(result[3].draw.status, "open");
  assert.equal(result[4].settled, true);
  assert.equal(result[5].refunded, true);
  assert.throws(
    () => progress.remember({ ...draw, numbers: [0, 0] }),
    /finalized/,
  );
  assert.throws(
    () => progress.remember({ ...draw, sourceProgram: "other" }),
    /recorded/,
  );
});

test("successful refresh learns finalization before a later stale RPC snapshot", () => {
  const progress = new LemonDrawProgress();
  progress.remember({ ...draw, status: "pending", numbers: null });
  const finalTickets = tickets.map((ticket) => ({
    ...ticket,
    draw,
    result: {
      ...draw,
      id: draw.address,
      sourceProgram: LEMON_PROGRAM_ID,
      isPublished: true,
    },
  }));
  assert.equal(
    progress.merge({ tickets: finalTickets, results: [] }).tickets[0].draw
      .status,
    "final",
  );
  const stale = progress.merge({ tickets, results: [] });
  assert.equal(stale.tickets[0].draw.status, "final");
  assert.equal(stale.results.length, 1);
  assert.equal(stale.tickets[0].settled, false);
});

test("fresh pending accounts replace incomplete local request progress without losing verified addresses", () => {
  const progress = new LemonDrawProgress();
  progress.remember({
    ...draw,
    status: "pending",
    numbers: null,
    oracleClient: null,
  });
  const actual = {
    ...draw,
    status: "pending",
    numbers: null,
    oracleClient: "actual-client",
    seed: Array(32).fill(7),
  };
  const merged = progress.merge({
    tickets: [{ ...tickets[0], draw: actual }],
    results: [],
  });
  assert.equal(merged.tickets[0].draw.oracleClient, "actual-client");
  assert.equal(
    progress.merge({ tickets, results: [] }).tickets[0].draw.oracleClient,
    "actual-client",
  );
});

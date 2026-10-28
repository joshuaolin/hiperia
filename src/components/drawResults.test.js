import test from "node:test";
import assert from "node:assert/strict";
import {
  DrawHistory,
  formatCombination,
  getDrawSession,
} from "./drawResults.js";

const timestamp = (value) => Date.parse(value) / 1000;
const record = (id, date, numbers = [6, 9]) => ({
  id,
  drawTime: timestamp(date),
  numbers,
});

test("draw history dates include the entire selected Manila day and exclude adjacent midnights", () => {
  const history = new DrawHistory([
    record("before", "2026-10-27T15:59:59Z"),
    record("start", "2026-10-27T16:00:00Z"),
    record("last", "2026-10-28T15:59:59Z"),
    record("after", "2026-10-28T16:00:00Z"),
  ]);
  assert.deepEqual(
    history
      .query({ from: "2026-10-28", to: "2026-10-28" })
      .records.map(({ id }) => id),
    ["last", "start"],
  );
  assert.deepEqual(
    history.query({ from: "2026-10-29" }).records.map(({ id }) => id),
    ["after"],
  );
  assert.deepEqual(
    history.query({ to: "2026-10-27" }).records.map(({ id }) => id),
    ["before"],
  );
});

test("draw history rejects reversed dates, impossible dates and invalid query fields", () => {
  const history = new DrawHistory();
  for (const query of [
    { from: "2026-10-29", to: "2026-10-28" },
    { from: "2026-02-31" },
    { to: "2025-02-29" },
    { from: "2026-13-01" },
    { from: "10/28/2026" },
    { session: "17" },
    { page: 0 },
    { pageSize: 0 },
    { pageSize: 51 },
  ])
    assert.throws(() => history.query(query), RangeError);
  assert.doesNotThrow(() =>
    history.query({ from: "2028-02-29", to: "2028-02-29" }),
  );
  assert.equal(history.query().total, 0);
});

test("draw sessions require exact 2 PM or 4 PM Manila timestamps", () => {
  const history = new DrawHistory([
    record("two", "2026-10-28T06:00:00Z"),
    record("four", "2026-10-28T08:00:00Z"),
    record("test", "2026-10-28T06:00:01Z"),
    record("near", "2026-10-28T07:59:59Z"),
  ]);
  assert.equal(getDrawSession(timestamp("2026-10-28T06:00:00Z")), "14");
  assert.deepEqual(
    history.query({ session: "14" }).records.map(({ id }) => id),
    ["two"],
  );
  assert.deepEqual(
    history.query({ session: "16" }).records.map(({ id }) => id),
    ["four"],
  );
  assert.deepEqual(
    history.query({ session: "test" }).records.map(({ id }) => id),
    ["near", "test"],
  );
});

test("history preserves older recorded combinations, sorts copies and paginates filtered records", () => {
  const records = Array.from({ length: 23 }, (_, index) =>
    record(
      String(index),
      `2026-10-${String(index + 1).padStart(2, "0")}T06:00:00Z`,
      index === 0 ? [19, 3] : [6, 9],
    ),
  );
  const original = JSON.stringify(records);
  const history = new DrawHistory(records);
  assert.deepEqual(
    history.query().records.map(({ id }) => id),
    ["22", "21", "20", "19", "18", "17", "16", "15", "14", "13"],
  );
  assert.equal(history.query().pages, 3);
  assert.deepEqual(
    history.query({ page: 3 }).records.map(({ id }) => id),
    ["2", "1", "0"],
  );
  assert.deepEqual(history.query({ page: 99 }), history.query({ page: 3 }));
  assert.equal(history.query({ page: 3 }).first, 21);
  assert.equal(history.query({ page: 3 }).last, 23);
  assert.equal(history.query({ from: "2026-10-22", page: 3 }).page, 1);
  assert.equal(JSON.stringify(records), original);
  assert.equal(
    formatCombination(history.query({ page: 3 }).records.at(-1).numbers),
    "19 – 03",
  );
  assert.equal(formatCombination([6, 9]), "06 – 09");
});

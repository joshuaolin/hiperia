import test from "node:test";
import assert from "node:assert/strict";
import {
  DrawHistory,
  drawSessionLabel,
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
    { session: "24" },
    { session: "legacy16" },
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

test("recorded daily metadata determines session filters without guessing legacy types", () => {
  const history = new DrawHistory([
    { ...record("two", "2026-10-28T06:00:00Z"), drawType: "daily" },
    record("four", "2026-10-28T08:00:00Z"),
    record("test", "2026-10-28T06:00:01Z"),
    record("near", "2026-10-28T07:59:59Z"),
  ]);
  assert.equal(getDrawSession(timestamp("2026-10-28T06:00:00Z")), null);
  assert.deepEqual(
    history.query({ session: "14" }).records.map(({ id }) => id),
    ["two"],
  );
  assert.deepEqual(
    history.query({ session: "unknown" }).records.map(({ id }) => id),
    ["four", "near", "test"],
  );
  assert.deepEqual(
    history.query({ session: "quick" }).records.map(({ id }) => id),
    [],
  );
  for (const hour of [2, 6, 10, 14, 18, 22]) {
    const drawTime = timestamp("2026-10-27T16:00:00Z") + hour * 3600;
    assert.equal(getDrawSession({ drawTime, drawType: "daily" }), String(hour));
    assert.equal(getDrawSession({ drawTime }), "unknown");
    assert.equal(getDrawSession({ drawTime: drawTime + 1 }), "unknown");
    assert.equal(
      new DrawHistory([
        { id: String(hour), drawTime, drawType: "daily" },
      ]).query({
        session: String(hour),
      }).total,
      1,
    );
  }
  assert.equal(
    drawSessionLabel(timestamp("2026-10-28T08:00:00Z")),
    "Type not recorded",
  );
  assert.equal(
    drawSessionLabel(timestamp("2026-10-27T18:00:00Z")),
    "Type not recorded",
  );
  assert.equal(getDrawSession(null), null);
});

test("quick and daily labels require metadata and preserve unknown historical fields", () => {
  const legacy = record("legacy-four", "2026-10-28T08:00:00Z");
  const quickAtFour = {
    ...legacy,
    id: "quick-four",
    drawType: "quick",
    numbers: [2, 22],
  };
  const quickAtTwo = {
    ...record("quick-two", "2026-10-29T06:00:00Z"),
    drawType: "quick",
  };
  const daily = {
    ...record("daily", "2026-10-29T06:00:00Z"),
    drawType: "daily",
  };
  const history = new DrawHistory([legacy, quickAtFour, quickAtTwo, daily]);
  assert.equal(drawSessionLabel(quickAtFour), "Quick draw");
  assert.equal(drawSessionLabel(legacy), "Type not recorded");
  assert.equal(drawSessionLabel(daily), "2 PM daily draw");
  assert.deepEqual(
    history.query({ session: "quick" }).records.map(({ id }) => id),
    ["quick-two", "quick-four"],
  );
  assert.deepEqual(
    history.query({ session: "unknown" }).records.map(({ id }) => id),
    ["legacy-four"],
  );
  assert.deepEqual(
    history.query({ session: "14" }).records.map(({ id }) => id),
    ["daily"],
  );
});

test("empty history has no placeholder results and older fixed UAT combinations remain unchanged", () => {
  assert.deepEqual(new DrawHistory().query().records, []);
  const history = new DrawHistory([
    record("previous", "2026-10-28T06:00:00Z", [6, 9]),
    record("current", "2026-10-29T06:00:00Z", [2, 22]),
    record("legacy", "2026-10-27T06:00:00Z", [1, 22]),
  ]);
  assert.deepEqual(
    history.query().records.map(({ numbers }) => numbers),
    [
      [2, 22],
      [6, 9],
      [1, 22],
    ],
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

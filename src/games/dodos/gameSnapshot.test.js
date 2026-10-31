import test from "node:test";
import assert from "node:assert/strict";
import {
  assertReviewedOracleQuote,
  gameSources,
  loadGameSnapshot,
  PartialGameReadError,
  sameOracleQuote,
} from "./gameSnapshot.js";
import { isRateLimitError } from "../../lib/refreshGate.js";

function source(address, entries = {}) {
  return {
    program: {
      programId: { toBase58: () => address },
      account: { config: { fetchNullable: async () => ({}) } },
    },
    recoverPendingPurchase: async () => null,
    getConfig: async () => ({ publicPlayEnabled: true }),
    getTickets: async () => entries.tickets ?? [],
    getResults: async () => entries.results ?? [],
  };
}

function multiplex(primary = source("public"), legacy = source("legacy")) {
  return {
    primary,
    legacy,
    getConfig: () => primary.getConfig(),
  };
}

test("public and legacy history load independently of new game metadata", async () => {
  const primary = source("public", {
    tickets: [{ id: "new-win", drawTime: 300 }],
  });
  const legacy = source("legacy", {
    tickets: [{ id: "old-win", drawTime: 200 }],
    results: [{ id: "old-result", drawTime: 200 }],
  });
  primary.getConfig = async () => {
    throw new Error("Randomness metadata unavailable");
  };
  let snapshot;
  await assert.rejects(
    loadGameSnapshot(multiplex(primary, legacy)),
    (error) => {
      assert.ok(error instanceof PartialGameReadError);
      snapshot = error.snapshot;
      return true;
    },
  );
  assert.equal(snapshot.configVerified, false);
  assert.equal(snapshot.historyLoaded, true);
  assert.deepEqual(
    snapshot.tickets.map(({ id, sourceProgram, legacy }) => ({
      id,
      sourceProgram,
      legacy,
    })),
    [
      { id: "new-win", sourceProgram: "public", legacy: false },
      { id: "old-win", sourceProgram: "legacy", legacy: true },
    ],
  );
  assert.equal(snapshot.results[0].sourceProgram, "legacy");
});

test("a partial RPC failure retains the same wallet's prior source and backs off", async () => {
  const primary = source("public", {
    tickets: [{ id: "new-win", drawTime: 300 }],
  });
  const legacy = source("legacy", {
    tickets: [{ id: "old-win", drawTime: 200 }],
  });
  const client = multiplex(primary, legacy);
  const previous = await loadGameSnapshot(client);
  primary.getTickets = async () => {
    throw Object.assign(new Error("Too many requests"), { status: 429 });
  };
  legacy.getTickets = async () => [{ id: "old-claimed", drawTime: 400 }];
  await assert.rejects(loadGameSnapshot(client, { previous }), (error) => {
    assert.equal(isRateLimitError(error), true);
    assert.equal(error.snapshot.configVerified, true);
    assert.deepEqual(
      error.snapshot.tickets.map((ticket) => ticket.id),
      ["old-claimed", "new-win"],
    );
    return true;
  });
});

test("a failed metadata refresh preserves display values and disables new entries", async () => {
  const primary = source("public");
  const client = multiplex(primary);
  const previous = await loadGameSnapshot(client);
  primary.getConfig = async () => {
    throw new Error("Invalid current rule proof");
  };
  await assert.rejects(loadGameSnapshot(client, { previous }), (error) => {
    assert.deepEqual(error.snapshot.config, previous.config);
    assert.equal(error.snapshot.configVerified, false);
    assert.equal(error.snapshot.historyLoaded, true);
    return true;
  });
});

test("prior history from another client is never adopted", async () => {
  const first = multiplex(
    source("public", { tickets: [{ id: "wallet-a", drawTime: 300 }] }),
  );
  const previous = await loadGameSnapshot(first);
  const other = multiplex();
  other.primary.getTickets = async () => {
    throw new Error("Unavailable");
  };
  await assert.rejects(loadGameSnapshot(other, { previous }), (error) => {
    assert.deepEqual(error.snapshot.tickets, []);
    return true;
  });
});

test("recovering one program's purchase survives another program's read failure", async () => {
  const client = multiplex();
  client.primary.recoverPendingPurchase = async () => {
    throw new Error("Primary pending receipt unavailable");
  };
  client.legacy.recoverPendingPurchase = async () => ({ id: "old-confirmed" });
  await assert.rejects(loadGameSnapshot(client), (error) => {
    assert.deepEqual(error.snapshot.recovered, { id: "old-confirmed" });
    return true;
  });
});

test("legacy mode retains its existing client and loads actual entries without config", async () => {
  const client = source("legacy", {
    tickets: [{ id: "snapshot-prize", drawTime: 100 }],
  });
  client.getConfig = async () => null;
  assert.deepEqual(gameSources(client), [{ client }]);
  const snapshot = await loadGameSnapshot(client);
  assert.equal(snapshot.config, null);
  assert.equal(snapshot.historyLoaded, true);
  assert.equal(snapshot.tickets[0].id, "snapshot-prize");
  assert.equal(snapshot.tickets[0].legacy, undefined);
});

const quote = {
  feeLamports: 300_123,
  pendingRentLamports: 4_455_160,
  clientRentLamports: 650_240,
  totalLamports: 5_405_523,
  treasury: "treasury-account",
  networkAddress: "network-account",
  oracleProgram: "oracle-program",
};
const ticket = { drawTime: 300, sourceProgram: "public" };
const reviewed = { ...quote, ...ticket };

test("the exact reviewed oracle budget, draw and source are required before signing", () => {
  assert.equal(sameOracleQuote(reviewed, quote), true);
  assert.equal(
    sameOracleQuote(reviewed, { ...quote, feeLamports: "300123" }),
    true,
  );
  assert.doesNotThrow(() => assertReviewedOracleQuote(reviewed, quote, ticket));
  for (const [field, value] of Object.entries(quote)) {
    const changed = typeof value === "number" ? value + 1 : `${value}-changed`;
    assert.throws(
      () =>
        assertReviewedOracleQuote(
          reviewed,
          { ...quote, [field]: changed },
          ticket,
        ),
      /No request was sent/,
    );
  }
  assert.throws(
    () =>
      assertReviewedOracleQuote(reviewed, quote, { ...ticket, drawTime: 301 }),
    /No request was sent/,
  );
  assert.throws(
    () =>
      assertReviewedOracleQuote(reviewed, quote, {
        ...ticket,
        sourceProgram: "legacy",
      }),
    /No request was sent/,
  );
});

test("missing or invalid oracle amounts cannot pass a quote review", () => {
  for (const invalid of [null, undefined, NaN, -1, 2.5, "wrong"]) {
    assert.equal(sameOracleQuote(null, quote), false);
    assert.equal(
      sameOracleQuote(
        { ...reviewed, feeLamports: invalid },
        { ...quote, feeLamports: invalid },
      ),
      false,
    );
  }
});

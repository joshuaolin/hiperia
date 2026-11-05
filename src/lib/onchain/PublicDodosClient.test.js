import test from "node:test";
import assert from "node:assert/strict";
import { Connection, PublicKey } from "@solana/web3.js";
import { PublicDodosClient, createDodosClient } from "./PublicDodosClient.js";
import { DodosClient } from "./DodosClient.js";
import { PROGRAM_ID } from "./idl.js";
import { VRF_PROGRAM_ID } from "./vrfProtocol.js";

function fixture() {
  const make = (sourceProgram) => {
    const client = {
      program: {
        programId: new PublicKey(sourceProgram),
        account: { config: { fetchNullable: async () => ({}) } },
      },
      configAddress: new PublicKey(sourceProgram),
      entries: [],
      results: [],
      calls: [],
      now: () => 1_800_000_000_000,
      requireSigner() {},
      getPendingPurchase: () => null,
      recoverPendingPurchase: async () => null,
      getTickets: async () => client.entries,
      getResults: async () => client.results,
      buyTicket: async () => {
        client.calls.push("buy");
        return { sourceProgram };
      },
      settleTicket: async (ticket) => {
        client.calls.push(["settle", ticket.address]);
        return "settled";
      },
      recordDraw: async (_, options) => {
        client.calls.push(["record", options.ticket?.address]);
        return {};
      },
      checkTicket: async () => ({ status: "won" }),
      settleBatch: async (tickets) => {
        client.calls.push(["batch", tickets.map((ticket) => ticket.address)]);
        return {
          settled: tickets.length,
          signatures: [`${sourceProgram}-confirmed`],
        };
      },
    };
    return client;
  };
  const primary = make(VRF_PROGRAM_ID);
  const legacy = make(PROGRAM_ID);
  const mux = new PublicDodosClient({ primary, legacy });
  const ticket = (id, overrides = {}) => ({
    id: String(id),
    address: `${id}-address`,
    drawTime: 1_799_999_999,
    numbers: [7, 13],
    settled: false,
    result: { isPublished: true, numbers: [7, 13] },
    ...overrides,
  });
  return { mux, primary, legacy, ticket };
}

test("the VRF factory requires an explicit public Devnet build profile", () => {
  const options = {
    connection: new Connection("http://127.0.0.1:8899"),
    storage: null,
  };
  const devnet = "https://api.devnet.solana.com";
  for (const env of [
    {},
    { VITE_APP_ENV: "testnet-demo", VITE_SOLANA_RPC: devnet },
    { VITE_APP_ENV: "uat", VITE_SOLANA_RPC: devnet },
    { VITE_APP_ENV: "testnet-demo", VITE_GAME_VERSION: "vrf" },
    {
      VITE_APP_ENV: "testnet-demo",
      VITE_GAME_VERSION: "vrf",
      VITE_SOLANA_RPC: "https://api.mainnet-beta.solana.com",
    },
    {
      VITE_APP_ENV: "uat",
      VITE_GAME_VERSION: "vrf",
      VITE_SOLANA_RPC: "https://api.testnet.solana.com",
    },
    {
      VITE_APP_ENV: "production",
      VITE_GAME_VERSION: "vrf",
      VITE_SOLANA_RPC: devnet,
    },
  ])
    assert.ok(createDodosClient(options, env) instanceof DodosClient);
  for (const VITE_APP_ENV of ["uat", "testnet-demo"])
    assert.ok(
      createDodosClient(options, {
        VITE_APP_ENV,
        VITE_GAME_VERSION: "vrf",
        VITE_SOLANA_RPC: devnet,
      }) instanceof PublicDodosClient,
    );
});

test("legacy and new tickets preserve identical nonces as distinct on-chain accounts", async () => {
  const { mux, primary, legacy, ticket } = fixture();
  primary.entries = [ticket(1, { address: "new-address" })];
  legacy.entries = [ticket(1, { address: "old-address" })];
  primary.results = [{ id: "new-draw", drawTime: 10, numbers: [7, 13] }];
  legacy.results = [{ id: "old-result", drawTime: 9, numbers: [6, 9] }];
  const tickets = await mux.getTickets();
  assert.equal(tickets.length, 2);
  assert.deepEqual(
    tickets.map((entry) => entry.id),
    ["1", "1"],
  );
  assert.deepEqual(
    tickets.map((entry) => entry.legacy),
    [false, true],
  );
  await mux.settleTicket(tickets[0]);
  await mux.settleTicket(tickets[1]);
  assert.deepEqual(primary.calls, [["settle", "new-address"]]);
  assert.deepEqual(legacy.calls, [["settle", "old-address"]]);
  const results = await mux.getResults();
  assert.deepEqual(
    results.map((entry) => entry.numbers),
    [
      [7, 13],
      [6, 9],
    ],
  );
  assert.deepEqual(
    results.map((entry) => entry.sourceProgram),
    [VRF_PROGRAM_ID, PROGRAM_ID],
  );
});

test("new purchases always target VRF while legacy draw actions stay with their original program", async () => {
  const { mux, primary, legacy, ticket } = fixture();
  await mux.buyTicket([2, 3]);
  await mux.recordDraw(10, {
    ticket: ticket(1, { sourceProgram: PROGRAM_ID }),
  });
  assert.deepEqual(primary.calls, ["buy"]);
  assert.deepEqual(legacy.calls, [["record", "1-address"]]);
  assert.throws(
    () => mux.clientFor({ sourceProgram: "unknown" }),
    /unsupported game program/,
  );
});

test("claim all preserves confirmed legacy progress if a later VRF group has an unknown outcome", async () => {
  const { mux, primary, legacy, ticket } = fixture();
  legacy.entries = [ticket(1), ticket(2)];
  primary.entries = [ticket(3)];
  primary.settleBatch = async () => {
    const error = Error("The next batch was not confirmed");
    error.confirmedSettlements = 1;
    error.confirmedSignatures = ["new-confirmed"];
    throw error;
  };
  await assert.rejects(mux.claimAll(), (failure) => {
    assert.match(failure.message, /2 earlier prizes were confirmed/);
    assert.equal(failure.confirmedSettlements, 3);
    assert.deepEqual(failure.confirmedSignatures, [
      `${PROGRAM_ID}-confirmed`,
      "new-confirmed",
    ]);
    return true;
  });
  legacy.entries.forEach((entry) => {
    entry.settled = true;
  });
  primary.entries[0].settled = true;
  assert.equal((await mux.claimAll()).settled, 0);
  assert.equal(legacy.calls.length, 1);
});

test("an unresolved old purchase is never shown as a retry of a new VRF purchase", () => {
  const { mux, legacy } = fixture();
  legacy.getPendingPurchase = () => ({ id: "1" });
  assert.equal(mux.getPendingPurchase(), null);
  assert.equal(mux.getLegacyPendingPurchase().id, "1");
});

test("loaded winning tickets remain claimable when new metadata reads fail", async () => {
  const { mux, primary, legacy, ticket } = fixture();
  primary.getTickets = async () => {
    throw Error("429 metadata temporarily unavailable");
  };
  const tickets = [
    ticket(1, { sourceProgram: PROGRAM_ID }),
    ticket(2, { sourceProgram: VRF_PROGRAM_ID }),
    ticket(3, { sourceProgram: VRF_PROGRAM_ID, settled: true }),
    ticket(4, {
      sourceProgram: VRF_PROGRAM_ID,
      result: { isPublished: true, numbers: [2, 22] },
    }),
  ];
  const result = await mux.claimAll({ tickets });
  assert.equal(result.settled, 2);
  assert.deepEqual(legacy.calls, [["batch", ["1-address"]]]);
  assert.deepEqual(primary.calls, [["batch", ["2-address"]]]);
});

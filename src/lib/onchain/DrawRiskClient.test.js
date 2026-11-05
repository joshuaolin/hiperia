import test from "node:test";
import assert from "node:assert/strict";
import BN from "bn.js";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import idl from "../../idl/hiperia_vrf.json" with { type: "json" };
import { DrawRiskClient } from "./DrawRiskClient.js";
import { getDrawRiskPda } from "./pdas.js";
import { orderedPairIndex, pooledLiability } from "./drawRisk.js";

const time = 1_800_007_200;
const metadata = { revision: 1, dailyPooled: true, quickPooled: false, pairCount: 420, riskAccountSpace: 3398 };
function fixture() {
  const accounts = new Map();
  const connection = { getAccountInfo: async (address) => accounts.get(address.toBase58()) ?? null,
    getMinimumBalanceForRentExemption: async (space) => space * 100 };
  const program = new Program(idl, { connection });
  const config = { randomnessVerified: true, liabilityRules: metadata,
    dailyTicketCostLamports: new BN(6_250_000), dailyPayoutLamports: new BN(2_000_000_000) };
  const state = { draw: null, freeLamports: 0 };
  const client = { connection, program, getLiabilityRules: async () => metadata,
    getDraw: async () => state.draw, getCapacity: async () => ({ freeLamports: state.freeLamports }) };
  const riskClient = new DrawRiskClient(client);
  async function riskRecord(counts, changes = {}, accountChanges = {}) {
    const [address, bump] = getDrawRiskPda(time, program.programId);
    const value = pooledLiability(counts, config.dailyTicketCostLamports, config.dailyPayoutLamports);
    const values = { drawTime: new BN(time), bump, phase: 0,
      totalCount: new BN(value.totalCount.toString()), reservedLamports: new BN(value.reservedLamports.toString()),
      counts: counts.map((count) => new BN(count.toString())), ...changes };
    const data = Buffer.alloc(metadata.riskAccountSpace);
    const { layout, discriminator } = program.coder.accounts.accountLayouts.get("drawRisk");
    Buffer.from(discriminator).copy(data);
    layout.encode(values, data.subarray(8));
    accounts.set(address.toBase58(), { data, lamports: 339_800, owner: program.programId, executable: false, ...accountChanges });
    state.draw = { status: 0, ticketCostLamports: config.dailyTicketCostLamports, payoutLamports: config.dailyPayoutLamports };
  }
  return { client, state, config, riskClient, riskRecord, accounts };
}

test("a real IDL-backed quote separates first-draw account rents and existing prize backing", async () => {
  const { riskClient, config, state } = fixture();
  const quote = await riskClient.quote([2, 22], { drawTime: time, config });
  assert.equal(quote.entryLamports, 6_250_000);
  assert.equal(quote.prizeLamports, 2_000_000_000);
  assert.equal(quote.requiredBackingLamports, 1_993_750_000);
  assert.equal(quote.riskRentLamports, 339_800);
  assert.equal(quote.drawRentLamports, 18_100);
  assert.equal(quote.ticketRentLamports, 10_000);
  assert.equal(quote.accountRentLamports, 367_900);
  assert.equal(quote.canPurchase, false);
  state.freeLamports = 1_993_750_000;
  assert.equal((await riskClient.quote([2, 22], { drawTime: time, config })).canPurchase, true);
});

test("a different combination can join a funded draw with zero extra treasury backing", async () => {
  const { riskClient, config, riskRecord } = fixture();
  const counts = Array(420).fill(0n);
  counts[orderedPairIndex([2, 22])] = 10n;
  await riskRecord(counts);
  const different = await riskClient.quote([3, 22], { drawTime: time, config });
  assert.equal(different.canPurchase, true);
  assert.equal(different.requiredBackingLamports, 0);
  assert.equal(different.reserveIncreaseLamports, 6_250_000);
  assert.equal(different.riskRentLamports, 0);
  assert.equal(different.drawRentLamports, 0);
  assert.equal((await riskClient.quote([2, 22], { drawTime: time, config })).canPurchase, false);
});

test("quotes reject substituted owners, invalid risk totals, closed draws and changed offers", async () => {
  for (const change of [
    async (setup) => setup.riskRecord(Array(420).fill(0n), {}, { owner: SystemProgram.programId }),
    async (setup) => setup.riskRecord(Array(420).fill(0n), { totalCount: new BN(1) }),
    async (setup) => setup.riskRecord(Array(420).fill(0n), { reservedLamports: new BN(1) }),
    async (setup) => setup.riskRecord(Array(420).fill(0n), { phase: 1 }),
    async (setup) => { setup.state.draw = { status: 1 }; },
    async (setup) => { setup.state.draw = { status: 0, ticketCostLamports: new BN(1), payoutLamports: new BN(2) }; },
  ]) {
    const setup = fixture(); await change(setup);
    await assert.rejects(setup.riskClient.quote([2, 22], { drawTime: time, config: setup.config }));
  }
  const setup = fixture();
  setup.accounts.set(setup.riskClient.address(time).toBase58(), { owner: new PublicKey(idl.address), executable: false, data: Buffer.alloc(5), lamports: 0 });
  await assert.rejects(setup.riskClient.read(time), /unexpected size/);
});

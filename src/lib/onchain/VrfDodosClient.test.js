import test from "node:test";
import assert from "node:assert/strict";
import BN from "bn.js";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { VrfDodosClient } from "./VrfDodosClient.js";
import { DEVNET_GENESIS_HASH, MAINNET_GENESIS_HASH } from "../network.js";
import {
  getDrawPda,
  getBankrollDrawPda,
  getOracleClientPda,
  getOracleRequestPda,
  getTicketPda,
} from "./pdas.js";
import { ORAO_PROGRAM_ID, VRF_PROGRAM_ID } from "./vrfProtocol.js";
import { deriveOracleSeed } from "./OracleClient.js";
import { winningNumbersFromRandomness } from "./vrfRandomness.js";
import { isDailyDrawTime } from "./time.js";

const NOW = 1_800_000_000;
const drawTime = NOW - 1;

function fixture() {
  const owner = Keypair.fromSeed(new Uint8Array(32).fill(28));
  const connection = new Connection("http://127.0.0.1:8899");
  const entries = new Map();
  const storage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: (key) => entries.delete(key),
  };
  let nonce = 0;
  const client = new VrfDodosClient({
    connection,
    storage,
    wallet: {
      publicKey: owner.publicKey,
      signTransaction: async (tx) => tx,
      signAllTransactions: async (txs) => txs,
    },
    now: () => NOW * 1000,
    nonceFactory: () => String(++nonce),
    oracleNonceFactory: () => new Uint8Array(32).fill(5),
    delay: async () => {},
  });
  const draws = new Map();
  const tickets = new Map();
  const ledgers = new Map();
  const oracleAccounts = new Map();
  const state = {
    sent: [],
    genesis: DEVNET_GENESIS_HASH,
    quoteFee: 321_123,
    fail: null,
    landBeforeFailure: false,
    oracleFulfilled: false,
    metadataCalls: 0,
    receiverExecutable: false,
    receiverReadError: null,
    failReclaim: null,
    vaultLamports: 5_001_176_240,
    reservedLamports: 0,
  };
  const config = {
    rulesRevision: 6,
    randomnessVerified: true,
    randomnessRules: {
      revision: 1,
      oracleProgram: ORAO_PROGRAM_ID,
      refundAfterSeconds: 86_400,
      pendingRequestSpace: 749,
    },
    quickTicketCostLamports: new BN(7_200_000),
    dailyTicketCostLamports: new BN(6_250_000),
    quickPayoutLamports: new BN(1_000_000_000),
    dailyPayoutLamports: new BN(2_000_000_000),
    bankrollRules: { revision: 1, dailyEnabled: true, quickEnabled: true, entryRefundsReserved: true,
      prizeReservedAtPurchase: false, claimRequiresFunding: true, ticketVersion: 4, ledgerAccountSpace: 50 },
  };
  const rawConfig = {
    isInitialized: true,
    bump: 1,
    ticketCostLamports: config.quickTicketCostLamports,
    payoutLamports: config.quickPayoutLamports,
    padding: Array.from(owner.publicKey.toBytes()),
  };
  const makeDraw = (time, overrides = {}) => ({
    drawTime: new BN(time),
    bump: getDrawPda(time)[1],
    status: 0,
    ticketCount: new BN(1),
    seed: Array(32).fill(0),
    oracleRequest: SystemProgram.programId,
    oracleClient: SystemProgram.programId,
    requestedBy: SystemProgram.programId,
    requestedAt: new BN(0),
    numbers: [0, 0],
    isDaily: false,
    ticketCostLamports: config.quickTicketCostLamports,
    payoutLamports: config.quickPayoutLamports,
    ...overrides,
  });
  draws.set(getDrawPda(drawTime)[0].toBase58(), makeDraw(drawTime));
  client.program.account.config.fetchNullable = async () => rawConfig;
  client.program.account.draw.fetchNullable = async (address) =>
    draws.get(address.toBase58()) ?? null;
  client.program.account.draw.fetchMultiple = async (addresses) =>
    addresses.map((address) => draws.get(address.toBase58()) ?? null);
  client.program.account.draw.all = async () =>
    [...draws].map(([key, account]) => ({
      publicKey: new PublicKey(key),
      account,
    }));
  client.program.account.ticket.fetchNullable = async (address) =>
    tickets.get(address.toBase58()) ?? null;
  client.program.account.ticket.fetchMultiple = async (addresses) => {
    if (state.ticketRefreshError) throw state.ticketRefreshError;
    return addresses.map((address) => tickets.get(address.toBase58()) ?? null);
  };
  client.program.account.ticket.all = async (filters) => {
    state.ticketFilters = filters;
    if (state.ticketScanError) throw state.ticketScanError;
    return [...tickets].map(([key, account]) => ({
      publicKey: new PublicKey(key),
      account,
    }));
  };
  connection.getGenesisHash = async () => state.genesis;
  connection.getMinimumBalanceForRentExemption = async (size) =>
    size === 749 ? 4_455_160 : size === 0 ? 890_880 : 1_176_240;
  connection.getAccountInfo = async (address) => {
    if (address.equals(owner.publicKey)) {
      if (state.receiverReadError) throw state.receiverReadError;
      return {
        owner: SystemProgram.programId,
        executable: state.receiverExecutable,
        lamports: 1_000_000,
        data: Buffer.alloc(0),
      };
    }
    if (address.equals(client.vaultAddress))
      return {
        owner: client.program.programId,
        lamports: state.vaultLamports,
        data: await client.program.coder.accounts.encode("vault", {
          bump: 1,
          padding: (() => { const bytes = Buffer.alloc(32); bytes.writeBigUInt64LE(BigInt(state.reservedLamports)); return [...bytes]; })(),
        }),
      };
    if (ledgers.has(address.toBase58())) return { owner: client.program.programId, executable: false,
      lamports: 1_176_240, data: await client.program.coder.accounts.encode("bankrollDraw", ledgers.get(address.toBase58())) };
    if (draws.has(address.toBase58())) return { owner: client.program.programId, executable: false,
      lamports: 1_176_240, data: await client.program.coder.accounts.encode("draw", draws.get(address.toBase58())) };
    if (address.equals(client.oracle.networkAddress)) {
      const data = Buffer.alloc(472);
      data.set([212, 237, 148, 56, 97, 245, 51, 169]);
      data.set(owner.publicKey.toBytes(), 40);
      data.writeBigUInt64LE(BigInt(state.quoteFee), 72);
      data.writeUInt32LE(4, 80);
      return { owner: new PublicKey(ORAO_PROGRAM_ID), data, executable: false };
    }
    const entry = oracleAccounts.get(address.toBase58());
    if (entry && state.oracleFulfilled && entry.data[8] === 0) {
      entry.data = Buffer.from(entry.data.subarray(0, 137));
      entry.data[8] = 1;
      entry.data.fill(8, 73);
    }
    return entry ?? null;
  };
  connection.getMultipleAccountsInfoAndContext = async (addresses, commitment) => {
    state.fundingSnapshotReads = (state.fundingSnapshotReads ?? 0) + 1;
    state.fundingSnapshotAddresses = addresses;
    assert.equal(commitment, "confirmed");
    const snapshot = { context: { slot: 123 }, value: await Promise.all(addresses.map((address) => connection.getAccountInfo(address))) };
    return state.fundingSnapshotMutation ? state.fundingSnapshotMutation(snapshot) : snapshot;
  };
  connection.simulateTransaction = async (transaction) => {
    state.metadataCalls++;
    const ix = transaction.message.compiledInstructions[0];
    const name = client.program.coder.instruction.decode(
      Buffer.from(ix.data),
    ).name;
    let type;
    let data;
    if (name === "getRules") {
      type = "uatRules";
      data = {
        revision: 6,
        minNumber: 2,
        maxNumber: 22,
        pickCount: 2,
        winningNumbers: [0, 0],
        quickTicketCostLamports: config.quickTicketCostLamports,
        dailyTicketCostLamports: config.dailyTicketCostLamports,
        quickPayoutLamports: config.quickPayoutLamports,
        dailyPayoutLamports: config.dailyPayoutLamports,
        dailyHours: [2, 6, 10, 14, 18, 22],
        scheduleIntervalSeconds: 14_400,
        scheduleOffsetSeconds: 7_200,
        buyAheadSeconds: 86_400,
      };
    } else if (name === "getAccessRules") {
      type = "accessRules";
      data = { revision: 1, publicPlay: true, publicResults: true };
    } else if (name === "getLiabilityRules") {
      type = "liabilityRules";
      data = { revision: 1, dailyPooled: true, quickPooled: false, pairCount: 420, riskAccountSpace: 3398 };
    } else if (name === "getBankrollRules") {
      type = "bankrollRules";
      data = config.bankrollRules;
    } else {
      type = "randomnessRules";
      data = {
        ...config.randomnessRules,
        oracleProgram: new PublicKey(ORAO_PROGRAM_ID),
      };
    }
    if (state.metadataOverride) data = state.metadataOverride(type, data);
    const bytes = client.program.coder.types.encode(type, data);
    return {
      value: {
        err: null,
        returnData: {
          programId: VRF_PROGRAM_ID,
          data: [bytes.toString("base64"), "base64"],
        },
      },
    };
  };
  client.program.provider.sendAndConfirm = async (
    transaction,
    _signers,
    options,
  ) => {
    assert.equal(options.maxRetries, 0);
    transaction.feePayer = owner.publicKey;
    transaction.recentBlockhash = SystemProgram.programId.toBase58();
    transaction.sign(owner);
    assert.ok(transaction.serialize().length <= 1232);
    const instruction = transaction.instructions[0];
    const decoded = client.program.coder.instruction.decode(instruction.data);
    const instructions = transaction.instructions.map((instruction) => ({
      instruction,
      ...client.program.coder.instruction.decode(instruction.data),
    }));
    state.sent.push({
      name: decoded.name,
      instruction,
      data: decoded.data,
      instructions,
    });
    if (
      state.failReclaim &&
      instructions.some((entry) => entry.name === "reclaimOracleFunding")
    )
      throw state.failReclaim;
    if (state.fail && !state.landBeforeFailure) throw state.fail;
    if (decoded.name === "buyBankrollTicket") {
      const data = decoded.data;
      const daily = isDailyDrawTime(data.drawTime.toNumber());
      const cost = daily ? config.dailyTicketCostLamports : config.quickTicketCostLamports;
      const prize = daily ? config.dailyPayoutLamports : config.quickPayoutLamports;
      const padding = Buffer.alloc(32);
      padding[0] = 4;
      padding.writeBigUInt64LE(BigInt(prize.toString()), 1);
      tickets.set(instruction.keys[2].pubkey.toBase58(), {
        user: owner.publicKey,
        nonce: data.ticketNonce,
        numbers: data.numbers,
        drawTime: data.drawTime,
        settled: false,
        paidLamports: cost,
        padding,
        bump: getTicketPda(owner.publicKey, data.ticketNonce, client.program.programId)[1],
      });
      state.vaultLamports += Number(cost.toString());
      state.reservedLamports += Number(cost.toString());
      const time = data.drawTime.toNumber();
      const [ledgerAddress, bump] = getBankrollDrawPda(time, client.program.programId);
      const ledger = ledgers.get(ledgerAddress.toBase58()) ?? { drawTime: data.drawTime, bump, phase: 0,
        pendingEntryLamports: new BN(0), unsettledEntries: new BN(0), padding: Array(16).fill(0) };
      ledger.pendingEntryLamports = ledger.pendingEntryLamports.add(cost);
      ledger.unsettledEntries = ledger.unsettledEntries.addn(1);
      ledgers.set(ledgerAddress.toBase58(), ledger);
      if (!draws.has(getDrawPda(time)[0].toBase58()))
        draws.set(getDrawPda(time)[0].toBase58(), makeDraw(time, { isDaily: daily, ticketCostLamports: cost, payoutLamports: prize }));
      else draws.get(getDrawPda(time)[0].toBase58()).ticketCount = draws.get(getDrawPda(time)[0].toBase58()).ticketCount.addn(1);
    } else if (decoded.name === "requestDraw") {
      const time = decoded.data.drawTime.toNumber();
      const draw = draws.get(getDrawPda(time)[0].toBase58());
      const seed = await deriveOracleSeed(
        VRF_PROGRAM_ID,
        getDrawPda(time)[0],
        decoded.data.nonce,
      );
      const request = getOracleRequestPda(seed)[0];
      const payer = getOracleClientPda(time)[0];
      Object.assign(draw, {
        status: 1,
        seed: Array.from(seed),
        oracleRequest: request,
        oracleClient: payer,
        requestedBy: owner.publicKey,
        requestedAt: new BN(NOW),
      });
      const bytes = Buffer.alloc(749);
      bytes.set([139, 239, 184, 215, 227, 86, 191, 226]);
      bytes[8] = 0;
      bytes.set(payer.toBytes(), 9);
      bytes.set(seed, 41);
      oracleAccounts.set(request.toBase58(), {
        owner: new PublicKey(ORAO_PROGRAM_ID),
        executable: false,
        data: bytes,
      });
    } else if (decoded.name === "finalizeDraw") {
      const draw = draws.get(
        getDrawPda(decoded.data.drawTime.toNumber())[0].toBase58(),
      );
      draw.status = 2;
      draw.numbers = await winningNumbersFromRandomness(Buffer.alloc(64, 8));
    }
    for (const entry of instructions) {
      if (entry.name === "reconcileBankrollDraw") {
        const ledger = ledgers.get(entry.instruction.keys[2].pubkey.toBase58());
        if (ledger?.phase === 0) {
          state.reservedLamports -= Number(ledger.pendingEntryLamports.toString());
          ledger.pendingEntryLamports = new BN(0);
          ledger.phase = 1;
        }
      }
      if (entry.name === "releaseBankrollLosingTicket") {
        const ticket = tickets.get(entry.instruction.keys[1].pubkey.toBase58());
        if (ticket) {
          ticket.settled = true;
          const ledger = ledgers.get(entry.instruction.keys[3].pubkey.toBase58());
          if (ledger?.phase === 0) {
            state.reservedLamports -= Number(ledger.pendingEntryLamports.toString());
            ledger.pendingEntryLamports = new BN(0);
            ledger.phase = 1;
          }
          if (ledger) ledger.unsettledEntries = ledger.unsettledEntries.subn(1);
        }
      }
      if (entry.name === "settleBankrollTicket") {
        const ticket = tickets.get(entry.instruction.keys[1].pubkey.toBase58());
        const ledger = ledgers.get(getBankrollDrawPda(ticket.drawTime.toString(), client.program.programId)[0].toBase58());
        if (ledger?.phase === 0) {
          state.reservedLamports -= Number(ledger.pendingEntryLamports.toString());
          ledger.pendingEntryLamports = new BN(0);
          ledger.phase = 1;
        }
        ledger.unsettledEntries = ledger.unsettledEntries.subn(1);
        ticket.settled = true;
        state.vaultLamports -= Number(Buffer.from(ticket.padding).readBigUInt64LE(1));
      }
      if (entry.name !== "releaseLosingTicket") continue;
      const ticket = tickets.get(entry.instruction.keys[2].pubkey.toBase58());
      if (ticket) ticket.settled = true;
    }
    if (state.fail) throw state.fail;
    return `confirmed-${state.sent.length}`;
  };
  return {
    client,
    owner,
    config,
    state,
    draws,
    tickets,
    makeDraw,
    oracleAccounts,
    storage,
    ledgers,
  };
}

test("verified revision six uses zero winning sentinels only with the new oracle metadata and actual vault capacity", async () => {
  const { client } = fixture();
  const config = await client.getConfig();
  assert.equal(config.randomnessMode, "orao-vrf");
  assert.equal(config.randomnessVerified, true);
  assert.deepEqual(config.winningNumbers, [0, 0]);
  assert.equal(config.randomnessRules.oracleProgram, ORAO_PROGRAM_ID);
  assert.equal(config.capacity.freeLamports, 5_000_000_000);
  assert.equal(config.liabilityRules.dailyPooled, true);
  assert.equal(config.bankrollRules.ticketVersion, 4);
  assert.equal(config.capacity.dailySlots, null);
  assert.equal(config.capacity.quickSlots, null);
});

test("new purchases use the VRF program and draw account, with distinct identities for repeated same-time entries", async () => {
  const { client, config, state } = fixture();
  const first = await client.buyTicket([2, 3], { config, drawTime: NOW + 60 });
  const second = await client.buyTicket([3, 2], { config, drawTime: NOW + 60 });
  assert.notEqual(first.id, second.id);
  assert.equal(state.sent.length, 2);
  for (const sent of state.sent) {
    assert.equal(sent.name, "buyBankrollTicket");
    assert.equal(sent.instruction.programId.toBase58(), VRF_PROGRAM_ID);
    assert.equal(
      sent.instruction.keys[3].pubkey.toBase58(),
      getDrawPda(NOW + 60)[0].toBase58(),
    );
  }
  const tickets = await client.getTickets(config);
  assert.equal(tickets.length, 2);
  assert.ok(
    tickets.every((ticket) => !ticket.legacy && ticket.result === null),
  );
});

test("more than twenty quick entries do not consume treasury capital, even with zero available funds", async () => {
  const { client, config, state } = fixture();
  state.vaultLamports = 1_176_240;
  const before = await client.getCapacity(config);
  assert.equal(before.freeLamports, 0);
  for (let index = 0; index < 25; index++) {
    const receipt = await client.buyTicket([2, 22], { config, drawTime: NOW + 60 + index });
    assert.equal(receipt.reserveVersion, 4);
  }
  const after = await client.getCapacity(config);
  assert.equal(state.sent.length, 25);
  assert.equal(after.freeLamports, 0);
  assert.equal(after.vaultLamports - before.vaultLamports, 25 * 7_200_000);
  assert.equal(after.reservedLamports, 25 * 7_200_000);
});

test("daily checkout quotes actual entry-only holds and shared account rents without a capital gate", async () => {
  const { client, config, state } = fixture();
  state.vaultLamports = 1_176_240;
  const time = 1_800_007_200;
  const first = await client.getPurchaseQuote([2, 22], { drawTime: time, config });
  assert.equal(first.bankroll, true);
  assert.equal(first.quick, false);
  assert.equal(first.entryLamports, 6_250_000);
  assert.equal(first.prizeLamports, 2_000_000_000);
  assert.equal(first.requiredBackingLamports, 0);
  assert.equal(first.canPurchase, true);
  assert.ok(first.ledgerRentLamports > 0);
  await client.buyTicket([2, 22], { config, drawTime: time });
  const second = await client.getPurchaseQuote([2, 22], { drawTime: time, config });
  assert.equal(second.ledgerRentLamports, 0);
  assert.equal(second.drawRentLamports, 0);
  await client.buyTicket([2, 22], { config, drawTime: time });
  const capacity = await client.getCapacity(config);
  assert.equal(capacity.freeLamports, 0);
  assert.equal(capacity.reservedLamports, 12_500_000);
  assert.equal((await client.getTickets(config))[0].payoutLamports, 2_000_000_000);
});

test("missing or malformed bankroll metadata pauses new entries without falling back to a backed purchase", async () => {
  for (const change of [
    { revision: 2 }, { entryRefundsReserved: false }, { prizeReservedAtPurchase: true },
    { ticketVersion: 3 }, { ledgerAccountSpace: 49 }, { claimRequiresFunding: false },
  ]) {
    const { client, config, state } = fixture();
    state.metadataOverride = (type, data) => type === "bankrollRules" ? { ...data, ...change } : data;
    assert.equal((await client.getConfig()).bankrollRules, null);
    await assert.rejects(client.buyTicket([2, 22], { config, drawTime: NOW + 60 }), /could not be verified/);
    assert.equal(state.sent.length, 0);
  }
});

async function winningBankrollFixture(count = 1) {
  const setup = fixture();
  const { client, config, draws } = setup;
  for (let index = 0; index < count; index++)
    await client.buyTicket([2, 22], { config, drawTime: NOW + 60 });
  Object.assign(draws.get(getDrawPda(NOW + 60)[0].toBase58()), {
    status: 2, numbers: [2, 22], oracleClient: getOracleClientPda(NOW + 60)[0],
    oracleRequest: getOracleRequestPda(Array(32).fill(0))[0],
  });
  client.now = () => (NOW + 100) * 1000;
  return setup;
}

test("an unfunded win stays unpaid, refilling enables the same ticket and duplicate claims are refused", async () => {
  const { client, config, state } = await winningBankrollFixture();
  state.vaultLamports = 1_176_240 + state.reservedLamports;
  const [waiting] = await client.getTickets(config);
  assert.equal(waiting.claimFundingVerified, true);
  assert.equal(waiting.claimFunded, false);
  assert.equal(waiting.settled, false);
  const attempts = state.sent.length;
  await assert.rejects(client.settleTicket(waiting), /Waiting for treasury funding/);
  assert.equal(state.sent.length, attempts);
  state.vaultLamports += 1_000_000_000;
  const [funded] = await client.getTickets(config);
  assert.equal(funded.claimFunded, true);
  await client.settleTicket(funded);
  assert.equal(state.sent.at(-1).name, "settleBankrollTicket");
  assert.equal((await client.getTickets(config))[0].settled, true);
  const paidAttempts = state.sent.length;
  await assert.rejects(client.settleTicket(funded), /already claimed/);
  assert.equal(state.sent.length, paidAttempts);
});

test("claim funding can release its own finalized entry hold but cannot spend another draw or old ticket holds", async () => {
  const { client, state, config } = await winningBankrollFixture();
  state.reservedLamports = 2_007_200_000;
  state.vaultLamports = 3_000_000_000 + 1_176_240;
  const [ticket] = await client.getTickets(config);
  assert.equal(ticket.claimAvailableLamports, 1_000_000_000);
  assert.equal(ticket.claimFunded, true);
  await client.settleTicket(ticket);
  assert.equal(state.reservedLamports, 2_000_000_000);
  assert.equal(state.vaultLamports, 2_000_000_000 + 1_176_240);
});

test("claim funding uses one coherent ledger/draw/vault snapshot and ignores stale display capacity", async () => {
  const { client, config, state, ledgers } = await winningBankrollFixture();
  const [ticket] = await client.getTickets(config);
  const ledger = ledgers.get(getBankrollDrawPda(ticket.drawTime)[0].toBase58());
  ledger.phase = 1;
  ledger.pendingEntryLamports = new BN(0);
  state.reservedLamports = 0;
  state.vaultLamports = 1_176_240;
  client.bankroll.read = async () => { throw new Error("Independent ledger reads must not be used for a claim quote"); };
  const before = state.fundingSnapshotReads;
  const funding = await client.bankroll.funding(ticket, { freeLamports: 20_000_000_000 });
  assert.equal(state.fundingSnapshotReads, before + 1);
  assert.deepEqual(state.fundingSnapshotAddresses.map((address) => address.toBase58()), [
    getBankrollDrawPda(ticket.drawTime)[0].toBase58(), getDrawPda(ticket.drawTime)[0].toBase58(), client.vaultAddress.toBase58(),
  ]);
  assert.equal(funding.fundingSlot, 123);
  assert.equal(funding.releasableEntryLamports, 0);
  assert.equal(funding.claimAvailableLamports, 0);
  assert.equal(funding.claimFunded, false);
});

test("unverified funding snapshot accounts cannot enable a v4 claim approval", async () => {
  for (const mutate of [
    (snapshot) => ({ ...snapshot, context: { slot: null } }),
    (snapshot) => ({ ...snapshot, value: snapshot.value.slice(0, 2) }),
    (snapshot) => { snapshot.value[0].owner = SystemProgram.programId; return snapshot; },
    (snapshot) => { snapshot.value[1].data[0] ^= 1; return snapshot; },
    (snapshot) => { snapshot.value[2].data[17] = 1; return snapshot; },
    (snapshot) => { snapshot.value[0].data = snapshot.value[0].data.subarray(1); return snapshot; },
    (snapshot) => { snapshot.value[0].data.writeBigUInt64LE(2n, 26); return snapshot; },
    (snapshot) => { snapshot.value[0].data.writeBigUInt64LE(1n, 18); return snapshot; },
  ]) {
    const { client, config, state } = await winningBankrollFixture();
    const [ticket] = await client.getTickets(config);
    state.fundingSnapshotMutation = mutate;
    const approvals = state.sent.length;
    await assert.rejects(client.settleTicket(ticket));
    assert.equal(state.sent.length, approvals);
  }
});

test("claim all rechecks funds after each actual payment and leaves later unfunded wins unpaid", async () => {
  const { client, config, state } = await winningBankrollFixture(3);
  state.vaultLamports = state.reservedLamports + 1_176_240 + 1_000_000_000;
  const tickets = await client.getTickets(config);
  const result = await client.settleBatch(tickets);
  assert.equal(result.settled, 1);
  assert.equal(result.waiting, 2);
  const refreshed = await client.getTickets(config);
  assert.equal(refreshed.filter((ticket) => ticket.settled).length, 1);
  assert.equal(refreshed.filter((ticket) => !ticket.settled && !ticket.claimFunded).length, 2);
});

test("a concurrently refunded v4 ticket is skipped without stopping later valid claims", async () => {
  const { client, config, state, tickets } = await winningBankrollFixture(2);
  const loaded = await client.getTickets(config);
  const refunded = tickets.get(loaded[0].address);
  refunded.settled = true;
  refunded.padding[9] = 1;
  const before = state.sent.length;
  const result = await client.settleBatch(loaded);
  assert.equal(result.settled, 1);
  assert.equal(state.sent.length, before + 1);
  assert.equal(state.sent.at(-1).name, "settleBankrollTicket");
});

test("later claim funding read failures preserve an earlier actual v4 payout", async () => {
  const { client, config, state } = await winningBankrollFixture(2);
  const loaded = await client.getTickets(config);
  state.fundingSnapshotMutation = (snapshot) => {
    if (state.sent.some((entry) => entry.name === "settleBankrollTicket"))
      throw new Error("Funding RPC unavailable after the first confirmed payout");
    return snapshot;
  };
  await assert.rejects(client.settleBatch(loaded), (failure) => {
    assert.equal(failure.confirmedSettlements, 1);
    assert.equal(failure.confirmedSignatures.length, 1);
    return true;
  });
  assert.equal(state.sent.filter((entry) => entry.name === "settleBankrollTicket").length, 1);
});

test("unverified oracle metadata or fixed winning numbers never enable the new public game", async () => {
  for (const change of [
    (type, data) =>
      type === "randomnessRules"
        ? { ...data, oracleProgram: SystemProgram.programId }
        : data,
    (type, data) =>
      type === "randomnessRules" ? { ...data, pendingRequestSpace: 748 } : data,
    (type, data) =>
      type === "uatRules" ? { ...data, winningNumbers: [2, 22] } : data,
  ]) {
    const { client, state } = fixture();
    state.metadataOverride = change;
    await assert.rejects(client.getConfig(), /rules could not be verified/);
    assert.equal(state.sent.length, 0);
  }
});

test("a public VRF transaction refuses Mainnet before asking the wallet to sign", async () => {
  const { client, state, config } = fixture();
  state.genesis = MAINNET_GENESIS_HASH;
  await assert.rejects(
    client.buyTicket([2, 3], { config, drawTime: NOW + 60 }),
    /requires Solana Devnet/,
  );
  assert.equal(state.sent.length, 0);
});

test("requesting then recording a fulfilled draw uses two explicit approvals and the immutable rent recipient", async () => {
  const { client, state, owner } = fixture();
  state.oracleFulfilled = true;
  const phases = [];
  const result = await client.recordDraw(drawTime, {
    waitMs: 0,
    onProgress: ({ phase }) => phases.push(phase),
  });
  assert.equal(result.pending, false);
  assert.equal(result.phase, "final");
  assert.deepEqual(
    state.sent.map((sent) => sent.name),
    ["requestDraw", "finalizeDraw"],
  );
  assert.equal(
    state.sent[0].data.maxFeeLamports.toString(),
    String(state.quoteFee),
  );
  assert.equal(
    state.sent[1].instructions[1].instruction.keys[3].pubkey.toBase58(),
    owner.publicKey.toBase58(),
  );
  assert.equal(
    state.sent[1].instructions[1].instruction.keys[3].isSigner,
    false,
  );
  assert.deepEqual(
    state.sent[1].instructions.map((instruction) => instruction.name),
    ["finalizeDraw", "reclaimOracleFunding"],
  );
  assert.equal(state.sent[1].instruction.keys.length, 3);
  assert.equal(state.sent[1].instruction.keys[0].isWritable, false);
  assert.equal(state.sent[1].instruction.keys[1].isWritable, true);
  assert.equal(state.sent[1].instruction.keys[2].isWritable, false);
  assert.deepEqual(phases, ["request", "finalize"]);
  const results = await client.getResults();
  assert.equal(results.length, 1);
  assert.deepEqual(results[0].numbers, [20, 18]);
  assert.equal(results[0].oracleProgram, ORAO_PROGRAM_ID);
  assert.equal(results[0].id, getDrawPda(drawTime)[0].toBase58());
});

test("an executable requester cannot block finalizing verified randomness", async () => {
  const { client, state } = fixture();
  state.oracleFulfilled = true;
  state.receiverExecutable = true;
  const result = await client.recordDraw(drawTime, { waitMs: 0 });
  assert.equal(result.draw.status, "final");
  assert.equal(result.reclaimSkipped, true);
  assert.deepEqual(
    state.sent[1].instructions.map((instruction) => instruction.name),
    ["finalizeDraw"],
  );
  assert.equal(state.sent[1].instruction.keys.length, 3);
});

test("an optional requester read failure finalizes without a funding transfer", async () => {
  const { client, state } = fixture();
  state.oracleFulfilled = true;
  state.receiverReadError = Error(
    "Requester account is temporarily unavailable",
  );
  const result = await client.recordDraw(drawTime, { waitMs: 0 });
  assert.equal(result.draw.status, "final");
  assert.equal(result.reclaimSkipped, true);
  assert.deepEqual(
    state.sent[1].instructions.map((instruction) => instruction.name),
    ["finalizeDraw"],
  );
  state.receiverReadError = null;
  await client.reclaimOracleFunding(drawTime);
  assert.equal(state.sent[2].name, "reclaimOracleFunding");
});

test("an executable requester race fails once and waits for explicit finalization retry", async () => {
  const { client, state } = fixture();
  state.oracleFulfilled = true;
  await client.requestDraw(drawTime);
  state.failReclaim = Error("The requester became executable before signing");
  await assert.rejects(
    client.finalizeDraw(drawTime),
    /No replacement transaction/,
  );
  assert.equal(state.sent.length, 2);
  assert.equal((await client.getDraw(drawTime)).status, 1);
  state.receiverExecutable = true;
  state.failReclaim = null;
  const result = await client.finalizeDraw(drawTime);
  assert.equal(result.draw.status, "final");
  assert.equal(result.reclaimSkipped, true);
  assert.equal(state.sent.length, 3);
  assert.deepEqual(
    state.sent[2].instructions.map((instruction) => instruction.name),
    ["finalizeDraw"],
  );
  assert.equal(
    state.sent.filter((entry) => entry.name === "requestDraw").length,
    1,
  );
});

test("another wallet can finalize and reclaim only to the original requester after its owner changes", async () => {
  const { client, state, draws } = fixture();
  state.oracleFulfilled = true;
  await client.requestDraw(drawTime);
  const originalRequester = Keypair.fromSeed(
    new Uint8Array(32).fill(30),
  ).publicKey;
  draws.get(getDrawPda(drawTime)[0].toBase58()).requestedBy = originalRequester;
  const readAccount = client.connection.getAccountInfo;
  client.connection.getAccountInfo = async (address) =>
    address.equals(originalRequester)
      ? {
          owner: new PublicKey(ORAO_PROGRAM_ID),
          executable: false,
          data: Buffer.alloc(20),
          lamports: 1_000_000,
        }
      : readAccount(address);
  await client.finalizeDraw(drawTime);
  const reclaim = state.sent[1].instructions[1].instruction;
  assert.equal(reclaim.keys[3].pubkey.toBase58(), originalRequester.toBase58());
  assert.equal(reclaim.keys[3].isSigner, false);
  assert.equal(
    reclaim.keys[2].pubkey.toBase58(),
    getOracleClientPda(drawTime)[0].toBase58(),
  );
});

test("request funding cannot be reclaimed before finalization or sent to an executable requester", async () => {
  const { client, state } = fixture();
  await client.requestDraw(drawTime);
  await assert.rejects(
    client.reclaimOracleFunding(drawTime),
    /Complete this draw/,
  );
  state.oracleFulfilled = true;
  state.receiverExecutable = true;
  await client.finalizeDraw(drawTime);
  await assert.rejects(
    client.reclaimOracleFunding(drawTime),
    /original requester is executable/,
  );
  assert.equal(state.sent.length, 2);
});

test("an unfulfilled request returns pending and a later explicit action reuses it without requesting a new seed", async () => {
  const { client, state } = fixture();
  const first = await client.recordDraw(drawTime, { waitMs: 0 });
  assert.equal(first.pending, true);
  assert.equal(first.phase, "pending");
  assert.equal(state.sent.length, 1);
  const seed = [...first.draw.seed];
  state.oracleFulfilled = true;
  const next = await client.recordDraw(drawTime, { waitMs: 0 });
  assert.equal(next.pending, false);
  assert.deepEqual(next.draw.seed, seed);
  assert.deepEqual(
    state.sent.map((sent) => sent.name),
    ["requestDraw", "finalizeDraw"],
  );
});

test("an unknown request confirmation is recovered from the draw without automatic resubmission", async () => {
  const { client, state } = fixture();
  state.fail = Error("Confirmation unavailable");
  state.landBeforeFailure = true;
  const result = await client.requestDraw(drawTime);
  assert.equal(result.recovered, true);
  assert.equal(result.draw.status, "pending");
  assert.equal(state.sent.length, 1);
  const retry = await client.requestDraw(drawTime);
  assert.equal(retry.recovered, true);
  assert.equal(state.sent.length, 1);
});

test("an unresolved request error persists its nonce and retries only when explicitly requested", async () => {
  const { client, state, storage } = fixture();
  state.fail = Error("RPC unavailable");
  await assert.rejects(
    client.requestDraw(drawTime),
    /saved nonce will be reused/,
  );
  const saved = storage.getItem(client.requestStorageKey(drawTime));
  assert.ok(saved);
  assert.equal(state.sent.length, 1);
  const firstNonce = state.sent[0].data.nonce;
  state.fail = null;
  await client.requestDraw(drawTime);
  assert.deepEqual(state.sent[1].data.nonce, firstNonce);
  assert.equal(state.sent.length, 2);
});

test("wallet changes prevent the second approval after oracle fulfillment", async () => {
  const { client, state } = fixture();
  state.oracleFulfilled = true;
  let attempts = 0;
  await assert.rejects(
    client.recordDraw(drawTime, {
      waitMs: 0,
      assertActive: () => {
        if (++attempts > 2) throw Error("Wallet changed");
      },
    }),
    /Wallet changed/,
  );
  assert.deepEqual(
    state.sent.map((sent) => sent.name),
    ["requestDraw"],
  );
});

test("new settlements keep the original owner as a non-signing recipient", async () => {
  const { client, owner } = fixture();
  const ticket = { id: "1", user: owner.publicKey.toBase58(), drawTime, reserveVersion: 2 };
  const instruction = await client.settleInstruction(ticket);
  assert.equal(
    instruction.keys[4].pubkey.toBase58(),
    owner.publicKey.toBase58(),
  );
  assert.equal(instruction.keys[4].isSigner, false);
  assert.equal(
    instruction.keys[3].pubkey.toBase58(),
    getDrawPda(drawTime)[0].toBase58(),
  );
  assert.equal(
    instruction.keys[2].pubkey.toBase58(),
    getTicketPda(owner.publicKey, "1", VRF_PROGRAM_ID)[0].toBase58(),
  );
});

test("published losing tickets release reserves without involving their recipient", async () => {
  const { client, state, draws } = fixture();
  const address = getDrawPda(drawTime)[0].toBase58();
  Object.assign(draws.get(address), {
    status: 2,
    numbers: [7, 13],
    oracleClient: getOracleClientPda(drawTime)[0],
    oracleRequest: getOracleRequestPda(Array(32).fill(0))[0],
  });
  const user = Keypair.fromSeed(new Uint8Array(32).fill(31)).publicKey;
  const ticket = {
    id: "1",
    user: user.toBase58(),
    reserveVersion: 2,
    drawTime,
    numbers: [8, 13],
  };
  await client.settleTicket(ticket);
  assert.equal(state.sent[0].name, "releaseLosingTicket");
  const instruction = state.sent[0].instruction;
  assert.equal(instruction.keys.length, 4);
  assert.ok(instruction.keys.every((account) => !account.pubkey.equals(user)));
  assert.equal(instruction.keys[3].isWritable, false);
  assert.equal(
    instruction.keys[2].pubkey.toBase58(),
    getTicketPda(user, "1", VRF_PROGRAM_ID)[0].toBase58(),
  );
});

test("actual published winners retain the normal owner-directed payout instruction", async () => {
  const { client, owner, draws } = fixture();
  Object.assign(draws.get(getDrawPda(drawTime)[0].toBase58()), {
    status: 2,
    numbers: [7, 13],
    oracleClient: getOracleClientPda(drawTime)[0],
    oracleRequest: getOracleRequestPda(Array(32).fill(0))[0],
  });
  const instruction = await client.settleInstruction({
    id: "1",
    reserveVersion: 2,
    user: owner.publicKey.toBase58(),
    drawTime,
    numbers: [7, 13],
  });
  assert.equal(
    client.program.coder.instruction.decode(instruction.data).name,
    "settleTicket",
  );
  assert.equal(
    instruction.keys[4].pubkey.toBase58(),
    owner.publicKey.toBase58(),
  );
  assert.equal(instruction.keys[4].isSigner, false);
});

test("an unpublished draw does not route an apparent loss through reserve release", async () => {
  const { client, owner } = fixture();
  const instruction = await client.settleInstruction({
    id: "1",
    reserveVersion: 2,
    user: owner.publicKey.toBase58(),
    drawTime,
    numbers: [8, 13],
  });
  assert.equal(
    client.program.coder.instruction.decode(instruction.data).name,
    "settleTicket",
  );
});

test("an explicit losing-ticket release keeps wallet-change protection and never retries", async () => {
  const { client, owner, state } = fixture();
  const ticket = { id: "1", user: owner.publicKey.toBase58(), drawTime, reserveVersion: 2 };
  await assert.rejects(
    client.releaseLosingTicket(ticket, {
      assertActive: () => {
        throw Error("Wallet changed");
      },
    }),
    /Wallet changed/,
  );
  assert.equal(state.sent.length, 0);
  state.fail = Error("Confirmation unavailable");
  await assert.rejects(
    client.releaseLosingTicket(ticket),
    /Confirmation unavailable/,
  );
  assert.equal(state.sent.length, 1);
  assert.equal(state.sent[0].name, "releaseLosingTicket");
});

test("an externally pre-requested known seed cannot supply the draw outcome", async () => {
  const { client, oracleAccounts, state } = fixture();
  let nonceCalls = 0;
  client.oracleNonceFactory = () =>
    new Uint8Array(32).fill(++nonceCalls === 1 ? 5 : 6);
  const seed = await deriveOracleSeed(
    VRF_PROGRAM_ID,
    getDrawPda(drawTime)[0],
    new Uint8Array(32).fill(5),
  );
  const data = Buffer.alloc(137);
  data.set([139, 239, 184, 215, 227, 86, 191, 226]);
  data[8] = 1;
  data.set(SystemProgram.programId.toBytes(), 9);
  data.set(seed, 41);
  data.fill(22, 73);
  oracleAccounts.set(getOracleRequestPda(seed)[0].toBase58(), {
    owner: new PublicKey(ORAO_PROGRAM_ID),
    data,
    lamports: 1_346_200,
  });
  const result = await client.requestDraw(drawTime);
  assert.equal(state.sent.length, 1);
  assert.equal(state.sent[0].data.nonce[0], 6);
  assert.notDeepEqual(result.draw.seed, Array.from(seed));
  assert.equal(result.draw.status, "pending");
});

test("a matching program-owned oracle request cannot be rerolled during a stale draw read", async () => {
  const { client, oracleAccounts, state } = fixture();
  const seed = await deriveOracleSeed(
    VRF_PROGRAM_ID,
    getDrawPda(drawTime)[0],
    new Uint8Array(32).fill(5),
  );
  const data = Buffer.alloc(137);
  data.set([139, 239, 184, 215, 227, 86, 191, 226]);
  data[8] = 1;
  data.set(getOracleClientPda(drawTime)[0].toBytes(), 9);
  data.set(seed, 41);
  oracleAccounts.set(getOracleRequestPda(seed)[0].toBase58(), {
    owner: new PublicKey(ORAO_PROGRAM_ID),
    data,
    lamports: 1_346_200,
  });
  await assert.rejects(client.requestDraw(drawTime), /already exists/);
  assert.equal(state.sent.length, 0);
});

test("unrequested expired draws refund through the System Program sentinel without touching accepted prizes", async () => {
  const { client, owner, draws, makeDraw, state } = fixture();
  const time = NOW - 86_400;
  draws.set(getDrawPda(time)[0].toBase58(), makeDraw(time));
  await client.refundTicket({
    id: "1",
    reserveVersion: 2,
    user: owner.publicKey.toBase58(),
    drawTime: time,
  });
  const sent = state.sent[0];
  assert.equal(sent.name, "refundTicket");
  assert.equal(
    sent.instruction.keys[5].pubkey.toBase58(),
    SystemProgram.programId.toBase58(),
  );
  assert.equal(
    sent.instruction.keys[4].pubkey.toBase58(),
    owner.publicKey.toBase58(),
  );
  assert.equal(sent.instruction.keys[4].isSigner, false);
  await assert.rejects(client.requestDraw(time), /request window has ended/);
  await assert.rejects(
    client.refundTicket({
      id: "1",
      user: owner.publicKey.toBase58(),
      drawTime,
    }),
    /not eligible/,
  );
});

test("fulfilled randomness blocks refunds even when its finalization has not been recorded", async () => {
  const { client, owner, draws, makeDraw, state, oracleAccounts } = fixture();
  const time = NOW - 86_401;
  const seed = new Uint8Array(32).fill(3);
  const oracleClient = getOracleClientPda(time)[0];
  const request = getOracleRequestPda(seed)[0];
  draws.set(
    getDrawPda(time)[0].toBase58(),
    makeDraw(time, {
      status: 1,
      seed: Array.from(seed),
      oracleRequest: request,
      oracleClient,
      requestedBy: owner.publicKey,
      requestedAt: new BN(time + 10),
    }),
  );
  const data = Buffer.alloc(137);
  data.set([139, 239, 184, 215, 227, 86, 191, 226]);
  data[8] = 1;
  data.set(oracleClient.toBytes(), 9);
  data.set(seed, 41);
  data.fill(8, 73);
  oracleAccounts.set(request.toBase58(), {
    owner: new PublicKey(ORAO_PROGRAM_ID),
    data,
  });
  await assert.rejects(
    client.refundTicket({
      id: "1",
      user: owner.publicKey.toBase58(),
      drawTime: time,
    }),
    /fulfilled draw cannot be refunded/,
  );
  assert.equal(state.sent.length, 0);
});

test("a temporary randomness metadata failure does not hide or block an existing winning claim", async () => {
  const { client, owner, state, draws, tickets, makeDraw } = fixture();
  const seed = new Uint8Array(32).fill(3);
  draws.set(
    getDrawPda(drawTime)[0].toBase58(),
    makeDraw(drawTime, {
      status: 2,
      numbers: [7, 13],
      seed: Array.from(seed),
      oracleClient: getOracleClientPda(drawTime)[0],
      oracleRequest: getOracleRequestPda(seed)[0],
      requestedBy: owner.publicKey,
      requestedAt: new BN(drawTime),
    }),
  );
  const padding = Buffer.alloc(32);
  padding[0] = 2;
  padding.writeBigUInt64LE(1_000_000_000n, 1);
  tickets.set(
    getTicketPda(owner.publicKey, "1", VRF_PROGRAM_ID)[0].toBase58(),
    {
      user: owner.publicKey,
      nonce: new BN(1),
      numbers: [7, 13],
      drawTime: new BN(drawTime),
      settled: false,
      paidLamports: new BN(7_200_000),
      padding,
    },
  );
  client.getRandomnessRules = async () => {
    throw Error("429 Temporarily unavailable");
  };
  const [ticket] = await client.getTickets();
  assert.deepEqual(ticket.result.numbers, [7, 13]);
  assert.equal(ticket.refundEligible, false);
  await client.settleTicket(ticket);
  assert.equal(state.sent.at(-1).name, "settleTicket");
});

function addCleanupTicket(fixture, nonce, overrides = {}) {
  const { owner, tickets } = fixture;
  const user = overrides.user ?? owner.publicKey;
  const [address, bump] = getTicketPda(user, nonce, VRF_PROGRAM_ID);
  const padding = Buffer.alloc(32);
  padding[0] = 2;
  padding.writeBigUInt64LE(1_000_000_000n, 1);
  const account = {
    user,
    nonce: new BN(nonce),
    bump,
    drawTime: new BN(drawTime),
    numbers: [2, 3],
    settled: false,
    paidLamports: new BN(7_200_000),
    padding,
    ...overrides,
  };
  tickets.set(address.toBase58(), account);
  return { address, account };
}

async function cleanupPlan(fixture, options) {
  const { client, state } = fixture;
  state.oracleFulfilled = true;
  await client.requestDraw(drawTime);
  const draw = client.drawRecord(await client.getDraw(drawTime));
  const proof = await client.oracle.readRequest({
    seed: draw.seed,
    client: draw.oracleClient,
    address: draw.oracleRequest,
  });
  return client.finalizationPlan(draw, proof, options);
}

test("verified v4 completion reconciles entry holds and releases only actual losses without any owner account", async () => {
  const setup = fixture();
  const { client, owner, draws, ledgers, state } = setup;
  const loser = addCleanupTicket(setup, 1);
  const winner = addCleanupTicket(setup, 2, { numbers: [20, 18] });
  loser.account.padding[0] = 4;
  winner.account.padding[0] = 4;
  const [ledgerAddress, bump] = getBankrollDrawPda(drawTime);
  ledgers.set(ledgerAddress.toBase58(), { drawTime: new BN(drawTime), bump, phase: 0,
    pendingEntryLamports: new BN(14_400_000), unsettledEntries: new BN(2), padding: Array(16).fill(0) });
  state.reservedLamports = 14_400_000;
  draws.get(getDrawPda(drawTime)[0].toBase58()).ticketCount = new BN(2);
  const plan = await cleanupPlan(setup);
  const decoded = plan.transaction.instructions.map((instruction) => ({ instruction,
    name: client.program.coder.instruction.decode(instruction.data).name }));
  assert.equal(plan.bankrollReconcileIncluded, true);
  assert.equal(plan.plannedLosses, 1);
  assert.ok(plan.packetBytes <= 1232);
  assert.ok(decoded.some((entry) => entry.name === "reconcileBankrollDraw"));
  const cleanup = decoded.find((entry) => entry.name === "releaseBankrollLosingTicket").instruction;
  assert.equal(cleanup.keys.length, 4);
  assert.ok(cleanup.keys.every((entry) => !entry.pubkey.equals(owner.publicKey)));
  assert.equal(cleanup.keys[1].pubkey.toBase58(), loser.address.toBase58());
  const result = await client.finalizeDraw(drawTime);
  assert.equal(result.releasedLosses, 1);
  assert.equal(state.reservedLamports, 0);
  assert.equal(loser.account.settled, true);
  assert.equal(winner.account.settled, false);
});

test("optional bankroll ledger reads cannot block valid draw finalization", async () => {
  const setup = fixture();
  setup.client.bankroll.read = async () => { throw new Error("Bankroll account read unavailable"); };
  const plan = await cleanupPlan(setup);
  assert.equal(plan.bankrollReconcileIncluded, false);
  assert.ok(plan.packetBytes <= 1232);
  const result = await setup.client.finalizeDraw(drawTime);
  assert.equal(result.draw.status, "final");
});

test("completion includes at most six actual losses from the fulfilled proof and preserves winners, refunds, settled and malformed records", async () => {
  const setup = fixture();
  for (let nonce = 1; nonce <= 9; nonce++) addCleanupTicket(setup, nonce);
  const winner = addCleanupTicket(setup, 10, { numbers: [20, 18] });
  const settled = addCleanupTicket(setup, 11, { settled: true });
  const refund = addCleanupTicket(setup, 12);
  refund.account.padding[9] = 1;
  const otherDraw = addCleanupTicket(setup, 13, {
    drawTime: new BN(drawTime - 10),
  });
  const malformed = addCleanupTicket(setup, 14);
  malformed.account.padding[31] = 1;
  const wrongAddress = addCleanupTicket(setup, 15);
  setup.tickets.delete(wrongAddress.address.toBase58());
  setup.tickets.set(
    Keypair.generate().publicKey.toBase58(),
    wrongAddress.account,
  );
  const entries = [...setup.tickets.entries()];
  setup.tickets.clear();
  for (const [address, account] of [
    ...entries.slice(9),
    ...entries.slice(0, 9),
  ])
    setup.tickets.set(address, account);
  const plan = await cleanupPlan(setup);
  assert.equal(plan.plannedLosses, 6);
  assert.equal(plan.transaction.instructions.length, 8);
  assert.ok(plan.packetBytes <= 1232);
  assert.equal(plan.cleanupSkipped, true);
  assert.deepEqual(plan.winningNumbers, [20, 18]);
  for (const excluded of [
    winner,
    settled,
    refund,
    otherDraw,
    malformed,
    wrongAddress,
  ])
    assert.ok(!plan.addresses.includes(excluded.address.toBase58()));
  assert.equal(setup.state.ticketFilters[0].memcmp.offset, 48);
  assert.equal(setup.state.sent.length, 1);
});

test("compute budget prefixes count toward the eight instruction bound", async () => {
  const setup = fixture();
  for (let nonce = 1; nonce <= 9; nonce++) addCleanupTicket(setup, nonce);
  const prefixInstructions = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
  ];
  const plan = await cleanupPlan(setup, { prefixInstructions });
  assert.equal(plan.plannedLosses, 4);
  assert.equal(plan.transaction.instructions.length, 8);
  assert.equal(plan.transaction.instructions[0], prefixInstructions[0]);
  assert.ok(plan.packetBytes <= 1232);
  assert.equal(prefixInstructions.length, 2);
});

test("cleanup is trimmed further when a prefix consumes the packet byte budget", async () => {
  const setup = fixture();
  for (let nonce = 1; nonce <= 9; nonce++) addCleanupTicket(setup, nonce);
  const plan = await cleanupPlan(setup, {
    prefixInstructions: [
      new TransactionInstruction({
        programId: ComputeBudgetProgram.programId,
        keys: [],
        data: Buffer.alloc(650),
      }),
    ],
  });
  assert.ok(plan.plannedLosses < 5);
  assert.ok(plan.packetBytes <= 1232);
  assert.equal(plan.cleanupSkipped, true);
  assert.equal(plan.reclaimSkipped, false);
  const walletTransaction = new Transaction({
    feePayer: setup.client.wallet.publicKey,
    recentBlockhash: SystemProgram.programId.toBase58(),
  }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
    ...plan.transaction.instructions,
  );
  const walletPacketBytes = walletTransaction.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  }).length;
  assert.ok(walletPacketBytes <= 1232);
  assert.equal(plan.packetBytes, walletPacketBytes);
});

test("completion reserves packet space for only the missing wallet budget instructions", async () => {
  for (const existingBudget of [[], [2], [3], [2, 3]]) {
    const setup = fixture();
    for (let nonce = 1; nonce <= 9; nonce++) addCleanupTicket(setup, nonce);
    const instructions = new Map([
      [2, ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 })],
      [3, ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 })],
    ]);
    const plan = await cleanupPlan(setup, {
      prefixInstructions: existingBudget.map((tag) => instructions.get(tag)),
    });
    const walletTransaction = new Transaction({
      feePayer: setup.client.wallet.publicKey,
      recentBlockhash: SystemProgram.programId.toBase58(),
    }).add(
      ...[2, 3]
        .filter((tag) => !existingBudget.includes(tag))
        .map((tag) => instructions.get(tag)),
      ...plan.transaction.instructions,
    );
    const walletPacketBytes = walletTransaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }).length;
    assert.ok(walletPacketBytes <= 1232);
    assert.equal(plan.packetBytes, walletPacketBytes);
    assert.ok(plan.plannedLosses <= 6);
    assert.ok(plan.transaction.instructions.length <= 8);
    assert.equal(setup.state.sent.length, 1);
  }
});

test("an optional cleanup scan failure does not block finalization or add another approval", async () => {
  const setup = fixture();
  addCleanupTicket(setup, 1);
  setup.state.oracleFulfilled = true;
  setup.state.ticketScanError = Error(
    "429 ticket scan temporarily unavailable",
  );
  const result = await setup.client.recordDraw(drawTime, { waitMs: 0 });
  assert.equal(result.draw.status, "final");
  assert.equal(result.cleanupSkipped, true);
  assert.equal(result.releasedLosses, 0);
  assert.equal(setup.state.sent.length, 2);
  assert.deepEqual(
    setup.state.sent[1].instructions.map((entry) => entry.name),
    ["finalizeDraw", "reclaimOracleFunding"],
  );
});

test("confirmed completion reports only its actual freshly read releases and keeps the original winner claimable", async () => {
  const setup = fixture();
  const loser = addCleanupTicket(setup, 1);
  const winner = addCleanupTicket(setup, 2, { numbers: [20, 18] });
  setup.state.oracleFulfilled = true;
  const result = await setup.client.recordDraw(drawTime, { waitMs: 0 });
  assert.equal(result.releasedLosses, 1);
  assert.equal(result.settled, 1);
  assert.equal(result.refreshWarning, false);
  assert.equal(loser.account.settled, true);
  assert.equal(winner.account.settled, false);
  assert.equal(setup.state.sent.length, 2);
  assert.deepEqual(
    setup.state.sent[1].instructions.map((entry) => entry.name),
    ["finalizeDraw", "reclaimOracleFunding", "releaseLosingTicket"],
  );
});

test("a cleanup confirmation read failure preserves the confirmed draw and reports zero unverified releases", async () => {
  const setup = fixture();
  addCleanupTicket(setup, 1);
  setup.state.oracleFulfilled = true;
  setup.state.ticketRefreshError = Error("429 ticket refresh unavailable");
  const result = await setup.client.recordDraw(drawTime, { waitMs: 0 });
  assert.equal(result.draw.status, "final");
  assert.equal(result.releasedLosses, 0);
  assert.equal(result.settled, 0);
  assert.equal(result.refreshWarning, true);
  assert.equal(setup.state.sent.length, 2);
});

test("recovering an already recorded result never claims another completion's reserve releases", async () => {
  const setup = fixture();
  addCleanupTicket(setup, 1);
  setup.state.oracleFulfilled = true;
  await setup.client.requestDraw(drawTime);
  setup.state.fail = Error("Confirmation unavailable");
  setup.state.landBeforeFailure = true;
  const result = await setup.client.finalizeDraw(drawTime);
  assert.equal(result.recovered, true);
  assert.equal(result.signature, null);
  assert.equal(result.releasedLosses, 0);
  assert.equal(setup.state.sent.length, 2);
});

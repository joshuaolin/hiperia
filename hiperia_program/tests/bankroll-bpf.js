import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

const root = resolve(
  process.env.HIPERIA_BPF_ROOT ??
    resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
);
const elf = resolve(
  root,
  process.env.HIPERIA_VRF_ELF ?? "hiperia_program/target/deploy/hiperia_vrf.so",
);
const scratch = resolve(
  process.env.HIPERIA_BPF_SCRATCH ?? resolve(root, ".local/bankroll-bpf"),
  `${Date.now()}-${process.pid}`,
);
mkdirSync(scratch, { recursive: true });
const program = new PublicKey("6SWK5s22L7HDzvNdFbMhTjtMQNPfUmMzM4D8S3ZRRgRy");
const oracle = new PublicKey("VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y");
const system = SystemProgram.programId;
const payer = Keypair.generate();
const owner = Keypair.generate();
const stranger = Keypair.generate();
const nonSystemOwner = Keypair.generate().publicKey;
const admin = new PublicKey("2txjN4S6WEiDDT8R3QvGFgwZrchQ8k5kBXRhbYFX1eSz");
const cost = 6_250_000n;
const prize = 2_000_000_000n;
const quickCost = 7_200_000n;
const quickPrize = 1_000_000_000n;
const interval = 14_400;
const offset = 7_200;
const now = Math.floor(Date.now() / 1000);
const daily = Math.floor((now - offset) / interval) * interval + offset;
const hash = (value) => createHash("sha256").update(value).digest();
const disc = (namespace, name) => hash(`${namespace}:${name}`).subarray(0, 8);
const u64 = (value) => {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(value));
  return bytes;
};
const i64 = (value) => {
  const bytes = Buffer.alloc(8);
  bytes.writeBigInt64LE(BigInt(value));
  return bytes;
};
const pda = (...seeds) => PublicKey.findProgramAddressSync(seeds, program);
const [config, configBump] = pda(Buffer.from("config"));
const [vault, vaultBump] = pda(Buffer.from("vault"));
const rank = ([first, second]) =>
  (first - 2) * 20 + second - 2 - Number(second > first);
const rent = (size) => 890_880n + BigInt(size) * 6_960n;
const meta = (pubkey, isWritable = false, isSigner = false) => ({
  pubkey,
  isWritable,
  isSigner,
});
const instruction = (name, keys, args = []) =>
  new TransactionInstruction({
    programId: program,
    keys,
    data: Buffer.concat([disc("global", name), ...args]),
  });
const initialAccounts = new Map();
const results = [];
const execution = [];
let svm;
let FailedTransactionMetadata;
let Account;
let nextNonce = 1n;

function seedAccount(
  address,
  accountOwner,
  data = Buffer.alloc(0),
  lamports = rent(data.length),
) {
  const record = {
    address,
    owner: accountOwner,
    data: Buffer.from(data),
    lamports: BigInt(lamports),
  };
  initialAccounts.set(address.toBase58(), record);
  if (svm)
    svm.setAccount(
      address.toBuffer(),
      new Account(
        record.lamports,
        record.data,
        accountOwner.toBuffer(),
        false,
        0n,
      ),
    );
}

function fixture(time, picks, options = {}) {
  const [draw, bump] = pda(Buffer.from("draw"), i64(time));
  const [ledger, ledgerBump] = pda(
    Buffer.from("bankroll-draw"),
    Buffer.from("v1"),
    i64(time),
  );
  const [risk, riskBump] = pda(
    Buffer.from("draw-risk"),
    Buffer.from("v1"),
    i64(time),
  );
  const [client] = pda(Buffer.from("oracle-client"), i64(time));
  const seed = hash(`synthetic-bankroll-fixture:${time}`);
  const [request] = PublicKey.findProgramAddressSync(
    [Buffer.from("orao-vrf-randomness-request"), seed],
    oracle,
  );
  const version = options.version ?? 4;
  const status = options.status ?? 1;
  const phase = options.phase ?? 0;
  const winning = options.winning ?? [2, 22];
  const dailyDraw = (time - offset) % interval === 0;
  const paid = dailyDraw ? cost : quickCost;
  const payout = dailyDraw ? prize : quickPrize;
  const ticketOwner = options.ticketOwner ?? owner.publicKey;
  const counts = Array.from({ length: 420 }, () => 0n);
  const tickets = picks.map((numbers, index) => {
    counts[rank(numbers)] += 1n;
    const nonce = BigInt(time) * 100n + BigInt(index + 1);
    const [address, ticketBump] = pda(
      Buffer.from("ticket"),
      ticketOwner.toBuffer(),
      u64(nonce),
    );
    const padding = Buffer.alloc(32);
    padding[0] = version;
    padding.writeBigUInt64LE(payout, 1);
    seedAccount(
      address,
      program,
      Buffer.concat([
        disc("account", "Ticket"),
        ticketOwner.toBuffer(),
        u64(nonce),
        i64(time),
        u64(paid),
        Buffer.from([0, ticketBump, ...numbers]),
        padding,
      ]),
    );
    return { address, nonce, numbers };
  });
  let reserved = 0n;
  if (version === 4) {
    reserved = phase === 0 ? BigInt(picks.length) * paid : 0n;
    seedAccount(
      ledger,
      options.ledgerOwner ?? program,
      Buffer.concat([
        disc("account", "BankrollDraw"),
        i64(time),
        Buffer.from([ledgerBump, phase]),
        u64(reserved),
        u64(picks.length),
        Buffer.alloc(16),
      ]),
    );
  } else if (version === 3) {
    reserved =
      phase === 0
        ? BigInt(picks.length) * paid +
          counts.reduce((max, value) => (value > max ? value : max), 0n) *
            (payout - paid)
        : counts[rank(winning)] * payout;
    const length = Buffer.alloc(4);
    length.writeUInt32LE(420);
    seedAccount(
      risk,
      program,
      Buffer.concat([
        disc("account", "DrawRisk"),
        i64(time),
        Buffer.from([riskBump, phase]),
        u64(picks.length),
        u64(reserved),
        length,
        ...counts.map(u64),
      ]),
    );
  } else reserved = BigInt(picks.length) * payout;
  seedAccount(
    draw,
    program,
    Buffer.concat([
      disc("account", "Draw"),
      i64(time),
      Buffer.from([bump, status]),
      u64(picks.length),
      seed,
      request.toBuffer(),
      client.toBuffer(),
      stranger.publicKey.toBuffer(),
      i64(time),
      Buffer.from(status === 2 ? winning : [0, 0]),
      Buffer.from([Number(dailyDraw)]),
      u64(paid),
      u64(payout),
    ]),
  );
  const fulfilled = options.fulfilled ?? true;
  const oracleData = Buffer.alloc(fulfilled ? 137 : 749);
  Buffer.from([139, 239, 184, 215, 227, 86, 191, 226]).copy(oracleData);
  oracleData[8] = Number(fulfilled);
  client.toBuffer().copy(oracleData, 9);
  seed.copy(oracleData, 41);
  if (fulfilled) oracleData.writeUInt16LE(rank(winning), 73);
  seedAccount(request, options.oracleOwner ?? oracle, oracleData);
  return {
    time,
    draw,
    ledger,
    risk,
    request,
    client,
    tickets,
    reserved,
    oracleData,
    version,
    paid,
    payout,
  };
}

seedAccount(
  config,
  program,
  Buffer.concat([
    disc("account", "Config"),
    Buffer.from([1, configBump]),
    u64(quickCost),
    u64(quickPrize),
    admin.toBuffer(),
  ]),
);
seedAccount(owner.publicKey, system, Buffer.alloc(0), 1_000_000_000n);
seedAccount(stranger.publicKey, system, Buffer.alloc(0), 1_000_000_000n);
seedAccount(nonSystemOwner, program, Buffer.alloc(32), rent(32));
const ready = fixture(daily - interval, [
  [2, 22],
  [2, 22],
  [3, 4],
]);
const noWin = fixture(daily - 2 * interval, [
  [3, 4],
  [5, 6],
]);
const oldV2 = fixture(
  daily - 3 * interval,
  [
    [2, 22],
    [3, 4],
  ],
  { version: 2, status: 2 },
);
const oldV3 = fixture(
  daily - 4 * interval,
  [
    [2, 22],
    [3, 4],
  ],
  { version: 3, status: 2, phase: 1 },
);
const pending = fixture(
  daily - 8 * interval,
  [
    [2, 22],
    [2, 22],
    [3, 4],
  ],
  { fulfilled: false },
);
const open = fixture(daily - 9 * interval, [[7, 9]], {
  status: 0,
  fulfilled: false,
});
const tooSoon = fixture(daily - 1, [[2, 22]], { status: 0, fulfilled: false });
const fulfilledTimeout = fixture(daily - 10 * interval, [[2, 22]]);
const badOwner = fixture(daily - 11 * interval, [[2, 22]], {
  oracleOwner: system,
});
const badLedgerOwner = fixture(daily - 12 * interval, [[2, 22]], {
  ledgerOwner: system,
});
const badSeed = fixture(daily - 13 * interval, [[2, 22]]);
badSeed.oracleData[41] ^= 1;
seedAccount(badSeed.request, oracle, badSeed.oracleData);
const badClient = fixture(daily - 14 * interval, [[2, 22]]);
badClient.oracleData[9] ^= 1;
seedAccount(badClient.request, oracle, badClient.oracleData);
const expired = fixture(daily - 2_190 * interval, [[2, 22]], {
  status: 2,
  phase: 1,
});
const automatic = fixture(daily - 15 * interval, [[2, 22]], { status: 2 });
const ownerless = fixture(
  daily - 16 * interval,
  [
    [3, 4],
    [2, 22],
  ],
  { ticketOwner: nonSystemOwner },
);
const fixtures = [
  ready,
  noWin,
  oldV2,
  oldV3,
  pending,
  open,
  tooSoon,
  fulfilledTimeout,
  badOwner,
  badLedgerOwner,
  badSeed,
  badClient,
  expired,
  automatic,
  ownerless,
];
const initialReserved = fixtures.reduce((sum, item) => sum + item.reserved, 0n);
seedAccount(
  vault,
  program,
  Buffer.concat([
    disc("account", "Vault"),
    Buffer.from([vaultBump]),
    u64(initialReserved),
    Buffer.alloc(24),
  ]),
  rent(41) + initialReserved + 20_000_000_000n,
);

function account(address) {
  const state = svm.getAccount(address.toBuffer());
  assert(state, `Missing ${address.toBase58()}`);
  return {
    owner: new PublicKey(state.owner()),
    data: Buffer.from(state.data()),
    lamports: BigInt(state.lamports()),
  };
}
const balance = (address) => account(address).lamports;
const vaultReserved = () => account(vault).data.readBigUInt64LE(9);
const spendable = () => balance(vault) - rent(41) - vaultReserved();
const ledgerState = (item) => {
  const data = account(item.ledger).data;
  assert.equal(data.length, 50);
  return {
    phase: data[17],
    held: data.readBigUInt64LE(18),
    unsettled: data.readBigUInt64LE(26),
  };
};
const finalIx = (item, request = item.request) =>
  instruction(
    "finalize_draw",
    [meta(config), meta(item.draw, true), meta(request)],
    [i64(item.time)],
  );
const reconcileIx = (item, ledger = item.ledger) =>
  instruction(
    "reconcile_bankroll_draw",
    [meta(vault, true), meta(item.draw), meta(ledger, true)],
    [i64(item.time)],
  );
const settleIx = (item, ticket, recipient = owner.publicKey) =>
  instruction("settle_bankroll_ticket", [
    meta(vault, true),
    meta(ticket.address, true),
    meta(item.draw),
    meta(item.ledger, true),
    meta(recipient, true),
  ]);
const releaseIx = (item, ticket) =>
  instruction("release_bankroll_losing_ticket", [
    meta(vault, true),
    meta(ticket.address, true),
    meta(item.draw),
    meta(item.ledger, true),
  ]);
const refundIx = (item, ticket, recipient = owner.publicKey) =>
  instruction("refund_bankroll_ticket", [
    meta(vault, true),
    meta(ticket.address, true),
    meta(item.draw),
    meta(item.ledger, true),
    meta(item === open || item === tooSoon ? system : item.request),
    meta(recipient, true),
  ]);
const oldSettleIx = (item, ticket, recipient = owner.publicKey) =>
  instruction(item.version === 3 ? "settle_pooled_ticket" : "settle_ticket", [
    meta(config),
    meta(vault, true),
    meta(ticket.address, true),
    meta(item.draw),
    ...(item.version === 3 ? [meta(item.risk, true)] : []),
    meta(recipient, true),
    meta(system),
  ]);

function transaction(instructions, signers = []) {
  svm.expireBlockhash();
  const tx = new Transaction().add(...[instructions].flat());
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = svm.latestBlockhash();
  tx.sign(payer, ...signers);
  return tx;
}

async function send(instructions, signers = []) {
  const outcome = svm.sendLegacyTransaction(
    transaction(instructions, signers).serialize(),
  );
  const failed = outcome instanceof FailedTransactionMetadata;
  const metadata = failed ? outcome.meta() : outcome;
  execution.push({
    success: !failed,
    computeUnits: Number(metadata.computeUnitsConsumed()),
    logs: metadata.logs(),
  });
  if (failed)
    throw new Error(`${outcome.err()}\n${metadata.logs().join("\n")}`);
  return Buffer.from(metadata.signature()).toString("hex");
}
async function check(name, fn) {
  await fn();
  results.push({ name, passed: true });
  console.log(`PASS ${name}`);
}
async function rejects(name, ix, expected, extras = []) {
  await check(name, async () => {
    const addresses = [vault, owner.publicKey, ...extras];
    const before = addresses.map(account);
    await assert.rejects(send(ix), (error) => {
      if (expected) assert.match(String(error), expected);
      return true;
    });
    addresses.forEach((address, index) =>
      assert.deepEqual(account(address), before[index]),
    );
  });
}
function purchase(time, numbers = [2, 22], options = {}) {
  const nonce = nextNonce++;
  const [draw] = pda(Buffer.from("draw"), i64(time));
  const [ledger] = pda(
    Buffer.from("bankroll-draw"),
    Buffer.from("v1"),
    i64(time),
  );
  const [risk] = pda(Buffer.from("draw-risk"), Buffer.from("v1"), i64(time));
  const [ticket] = pda(
    Buffer.from("ticket"),
    payer.publicKey.toBuffer(),
    u64(nonce),
  );
  const name = options.old ?? "buy_bankroll_ticket";
  const keys =
    name === "buy_bankroll_ticket"
      ? [
          meta(config),
          meta(vault, true),
          meta(ticket, true),
          meta(draw, true),
          meta(options.ledger ?? ledger, true),
          meta(payer.publicKey, true, true),
          meta(system),
        ]
      : [
          meta(config),
          meta(vault, true),
          meta(ticket, true),
          meta(payer.publicKey, true, true),
          meta(system),
          meta(draw, true),
          ...(name === "buy_pooled_ticket" ? [meta(risk, true)] : []),
        ];
  return {
    time,
    draw,
    ledger,
    ticket,
    ix: instruction(name, keys, [u64(nonce), i64(time), Buffer.from(numbers)]),
  };
}

async function run() {
  const native = await import("litesvm/dist/internal.js");
  ({ Account, FailedTransactionMetadata } = native);
  svm = new native.LiteSvm();
  svm.setRent(new native.Rent(6960n, 1, 50));
  assert.equal(svm.minimumBalanceForRentExemption(41n), rent(41));
  svm.setClock(new native.Clock(1n, BigInt(now), 0n, 0n, BigInt(now)));
  svm.addProgramFromFile(program.toBuffer(), elf);
  for (const entry of initialAccounts.values())
    seedAccount(entry.address, entry.owner, entry.data, entry.lamports);
  svm.airdrop(payer.publicKey.toBuffer(), 1_000_000_000_000n);
  await check(
    "bankroll metadata is actual executable BPF return data",
    async () => {
      const result = svm.simulateLegacyTransaction(
        transaction(
          instruction("get_bankroll_rules", [meta(config)]),
        ).serialize(),
      );
      assert(
        !(result instanceof FailedTransactionMetadata),
        String(result.err?.()),
      );
      const data = Buffer.from(result.meta().returnData().data());
      assert.deepEqual([...data.subarray(0, 7)], [1, 1, 1, 1, 0, 1, 4]);
      assert.equal(data.readUInt16LE(7), 50);
    },
  );
  await check(
    "twenty-five daily entries exceed twenty-SOL fixed-prize capacity without reducing capital",
    async () => {
      const before = balance(vault),
        reserveBefore = vaultReserved(),
        freeBefore = spendable();
      for (let i = 0; i < 25; i += 1) {
        const entry = purchase(daily + interval);
        await send(entry.ix);
        const data = account(entry.ticket).data;
        assert.equal(data[68], 4);
        assert.equal(data.readBigUInt64LE(56), cost);
        assert.equal(data.readBigUInt64LE(69), prize);
      }
      assert.equal(balance(vault), before + 25n * cost);
      assert.equal(vaultReserved(), reserveBefore + 25n * cost);
      assert.equal(spendable(), freeBefore);
    },
  );
  await check(
    "twenty-five independent quick entries reserve only incoming refundable entries",
    async () => {
      const before = balance(vault),
        reserveBefore = vaultReserved(),
        freeBefore = spendable();
      for (let i = 0; i < 25; i += 1) {
        const entry = purchase(now + 3_600 + i);
        await send(entry.ix);
        const data = account(entry.ticket).data;
        assert.equal(data[68], 4);
        assert.equal(data.readBigUInt64LE(56), quickCost);
        assert.equal(data.readBigUInt64LE(69), quickPrize);
      }
      assert.equal(balance(vault), before + 25n * quickCost);
      assert.equal(vaultReserved(), reserveBefore + 25n * quickCost);
      assert.equal(spendable(), freeBefore);
    },
  );
  await check(
    "zero available bankroll still accepts daily and quick entry payments without reducing old reserves",
    async () => {
      const state = account(vault),
        capital = spendable();
      seedAccount(vault, program, state.data, rent(41) + vaultReserved());
      const before = balance(vault),
        reserveBefore = vaultReserved();
      await send(purchase(daily + 2 * interval, [9, 11]).ix);
      await send(purchase(now + 5_000, [9, 11]).ix);
      assert.equal(balance(vault), before + cost + quickCost);
      assert.equal(vaultReserved(), reserveBefore + cost + quickCost);
      assert.equal(spendable(), 0n);
      await send(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: vault,
          lamports: Number(capital),
        }),
      );
      assert.equal(spendable(), capital);
    },
  );
  await rejects(
    "cached v2 quick admissions are disabled",
    purchase(now + 4_000, [2, 22], { old: "buy_ticket" }).ix,
    /NewPurchasesRequireBankroll/,
  );
  await rejects(
    "cached v2 daily admissions are disabled",
    purchase(daily + interval, [2, 22], { old: "buy_ticket" }).ix,
    /NewPurchasesRequireBankroll/,
  );
  await rejects(
    "cached v3 daily admissions are disabled",
    purchase(daily + interval, [2, 22], { old: "buy_pooled_ticket" }).ix,
    /NewPurchasesRequireBankroll/,
  );
  await rejects(
    "forged bankroll PDA cannot bypass entry holds",
    purchase(daily + interval, [2, 22], { ledger: stranger.publicKey }).ix,
    /ConstraintSeeds/,
  );
  await rejects(
    "invalid duplicate-number combination is rejected",
    purchase(daily + interval, [2, 2]).ix,
    /InvalidNumbers/,
  );
  await rejects(
    "new entries cannot be purchased after sales close",
    purchase(daily - interval).ix,
    /BadDrawTime/,
  );
  await rejects(
    "unfulfilled proof cannot finalize",
    finalIx(pending),
    /RandomnessPending/,
    [pending.draw],
  );
  await rejects(
    "wrong oracle owner cannot finalize",
    finalIx(badOwner),
    /InvalidOracleRequest/,
    [badOwner.draw],
  );
  await rejects(
    "wrong oracle address cannot replace committed request",
    finalIx(ready, badOwner.request),
    /InvalidOracleRequest/,
    [ready.draw],
  );
  await rejects(
    "wrong oracle seed cannot finalize",
    finalIx(badSeed),
    /InvalidOracleRequest/,
    [badSeed.draw],
  );
  await rejects(
    "wrong oracle client cannot finalize",
    finalIx(badClient),
    /InvalidOracleRequest/,
    [badClient.draw],
  );
  await rejects(
    "unfinalized bankroll draw cannot release refundable entry holds",
    reconcileIx(ready),
    /ResultNotPublished/,
    [ready.ledger],
  );
  await rejects(
    "entry refund requires verified twenty-four-hour timeout",
    refundIx(tooSoon, tooSoon.tickets[0]),
    /RefundNotAvailable/,
    [tooSoon.tickets[0].address, tooSoon.ledger],
  );
  await rejects(
    "fulfilled proof prevents timeout refund",
    refundIx(fulfilledTimeout, fulfilledTimeout.tickets[0]),
    /RefundNotAvailable/,
    [fulfilledTimeout.tickets[0].address, fulfilledTimeout.ledger],
  );
  await rejects(
    "refund cannot redirect immutable owner",
    refundIx(pending, pending.tickets[0], stranger.publicKey),
    /Unauthorized/,
    [pending.tickets[0].address, pending.ledger],
  );
  await rejects(
    "v4 entry refund cannot enter old full-prize refund accounting",
    instruction("refund_ticket", [
      meta(config),
      meta(vault, true),
      meta(pending.tickets[0].address, true),
      meta(pending.draw),
      meta(owner.publicKey, true),
      meta(pending.request),
      meta(system),
    ]),
    /InvalidTicketReserve/,
    [pending.tickets[0].address, pending.ledger],
  );
  await check(
    "partial pending timeout refunds actual paid entry while preserving remaining holds",
    async () => {
      const before = balance(vault),
        reserveBefore = vaultReserved(),
        recipientBefore = balance(owner.publicKey);
      await send(refundIx(pending, pending.tickets[0]));
      assert.equal(balance(vault), before - cost);
      assert.equal(vaultReserved(), reserveBefore - cost);
      assert.equal(balance(owner.publicKey), recipientBefore + cost);
      assert.deepEqual(ledgerState(pending), {
        phase: 0,
        held: 2n * cost,
        unsettled: 2n,
      });
      assert.equal(account(pending.tickets[0].address).data[64], 1);
      assert.equal(account(pending.tickets[0].address).data[77], 1);
    },
  );
  await rejects(
    "refunded ticket cannot be refunded twice",
    refundIx(pending, pending.tickets[0]),
    /AlreadySettled/,
    [pending.tickets[0].address, pending.ledger],
  );
  await check(
    "open draw timeout returns its last refundable entry without prize expense",
    async () => {
      const before = balance(vault),
        reserveBefore = vaultReserved();
      await send(refundIx(open, open.tickets[0]));
      assert.equal(balance(vault), before - cost);
      assert.equal(vaultReserved(), reserveBefore - cost);
      assert.deepEqual(ledgerState(open), {
        phase: 0,
        held: 0n,
        unsettled: 0n,
      });
    },
  );
  await check(
    "verified finalization releases only this draw entry holds and pays nobody",
    async () => {
      const before = balance(vault),
        reserveBefore = vaultReserved(),
        ownerBefore = balance(owner.publicKey);
      await send([finalIx(ready), reconcileIx(ready)]);
      assert.equal(balance(vault), before);
      assert.equal(balance(owner.publicKey), ownerBefore);
      assert.equal(vaultReserved(), reserveBefore - 3n * cost);
      assert.deepEqual(ledgerState(ready), {
        phase: 1,
        held: 0n,
        unsettled: 3n,
      });
      assert.deepEqual(
        [...account(ready.draw).data.subarray(162, 164)],
        [2, 22],
      );
      assert.equal(account(ready.tickets[2].address).data[64], 0);
    },
  );
  await check("bankroll reconciliation is idempotent", async () => {
    const before = vaultReserved();
    await send(reconcileIx(ready));
    assert.equal(vaultReserved(), before);
  });
  await rejects(
    "finalized draw cannot reroll",
    finalIx(ready),
    /RandomnessAlreadyRequested|DrawAlreadyFinalized|DrawNotPending/,
    [ready.draw],
  );
  await rejects(
    "wrong ledger PDA cannot release another draw holds",
    reconcileIx(ready, pending.ledger),
    /ConstraintSeeds/,
    [ready.ledger, pending.ledger],
  );
  await send(finalIx(badLedgerOwner));
  await rejects(
    "wrong ledger owner cannot release entry holds",
    reconcileIx(badLedgerOwner),
    /AccountOwnedByWrongProgram/,
    [badLedgerOwner.ledger],
  );
  await check(
    "program-owned losing wallet cannot block finalization or owner-independent cleanup",
    async () => {
      const before = balance(vault),
        reservedBefore = vaultReserved(),
        ownerBefore = account(nonSystemOwner);
      await send([
        finalIx(ownerless),
        releaseIx(ownerless, ownerless.tickets[0]),
      ]);
      assert.equal(balance(vault), before);
      assert.equal(vaultReserved(), reservedBefore - 2n * cost);
      assert.deepEqual(account(nonSystemOwner), ownerBefore);
      assert.deepEqual(ledgerState(ownerless), {
        phase: 1,
        held: 0n,
        unsettled: 1n,
      });
      assert.equal(account(ownerless.tickets[0].address).data[64], 1);
      assert.equal(account(ownerless.tickets[1].address).data[64], 0);
    },
  );
  await rejects(
    "owner-independent cleanup never discards a winning ticket",
    releaseIx(ownerless, ownerless.tickets[1]),
    /WinningTicketCannotRelease/,
    [ownerless.tickets[1].address, ownerless.ledger, nonSystemOwner],
  );
  await rejects(
    "owner-independent losing cleanup cannot be replayed",
    releaseIx(ownerless, ownerless.tickets[0]),
    /AlreadySettled/,
    [ownerless.tickets[0].address, ownerless.ledger, nonSystemOwner],
  );
  await rejects(
    "v4 winner cannot use old v2 release accounting",
    oldSettleIx({ ...ready, version: 2 }, ready.tickets[0]),
    /InvalidTicketReserve/,
    [ready.tickets[0].address],
  );
  await rejects(
    "v4 winner cannot use old v3 release accounting",
    oldSettleIx({ ...ready, version: 3, risk: oldV3.risk }, ready.tickets[0]),
    /ConstraintSeeds|InvalidTicketReserve/,
    [ready.tickets[0].address],
  );
  await rejects(
    "winning payout cannot be redirected",
    settleIx(ready, ready.tickets[0], stranger.publicKey),
    /Unauthorized/,
    [ready.tickets[0].address, ready.ledger],
  );
  await rejects(
    "v4 loser cannot enter old full-prize release accounting",
    instruction("release_losing_ticket", [
      meta(config),
      meta(vault, true),
      meta(ready.tickets[2].address, true),
      meta(ready.draw),
    ]),
    /InvalidTicketReserve/,
    [ready.tickets[2].address, ready.ledger],
  );
  await check(
    "loser settles without reducing treasury or unrelated reserved backing",
    async () => {
      const before = balance(vault),
        reserveBefore = vaultReserved();
      await send(settleIx(ready, ready.tickets[2]));
      assert.equal(balance(vault), before);
      assert.equal(vaultReserved(), reserveBefore);
      assert.equal(account(ready.tickets[2].address).data[64], 1);
    },
  );
  await check(
    "winner remains unpaid and unchanged when spendable treasury excludes protected reserves",
    async () => {
      const state = account(vault);
      seedAccount(
        vault,
        program,
        state.data,
        rent(41) + vaultReserved() + 1_000_000_000n,
      );
      const before = account(ready.tickets[0].address),
        ledgerBefore = account(ready.ledger),
        recipientBefore = balance(owner.publicKey),
        vaultBefore = account(vault);
      await assert.rejects(
        send(settleIx(ready, ready.tickets[0])),
        /ClaimAwaitingFunds/,
      );
      assert.deepEqual(account(ready.tickets[0].address), before);
      assert.deepEqual(account(ready.ledger), ledgerBefore);
      assert.deepEqual(account(vault), vaultBefore);
      assert.equal(balance(owner.publicKey), recipientBefore);
      assert.equal(before.data[64], 0);
    },
  );
  await rejects(
    "unfunded claim rolls back its automatic entry reconciliation and preserves unpaid ticket",
    settleIx(automatic, automatic.tickets[0]),
    /ClaimAwaitingFunds/,
    [automatic.tickets[0].address, automatic.ledger],
  );
  await check(
    "manual refill makes the original winning claim payable exactly once",
    async () => {
      await send(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: vault,
          lamports: 2_000_000_000,
        }),
      );
      const before = balance(vault),
        reservedBefore = vaultReserved(),
        recipientBefore = balance(owner.publicKey);
      await send(settleIx(ready, ready.tickets[0]));
      assert.equal(balance(vault), before - prize);
      assert.equal(vaultReserved(), reservedBefore);
      assert.equal(balance(owner.publicKey), recipientBefore + prize);
      assert.equal(account(ready.tickets[0].address).data[64], 1);
    },
  );
  await rejects(
    "same winning ticket cannot drain treasury on replay",
    settleIx(ready, ready.tickets[0]),
    /AlreadySettled/,
    [ready.tickets[0].address, ready.ledger],
  );
  await rejects(
    "second valid winner waits instead of consuming old v2 v3 or refund holds",
    settleIx(ready, ready.tickets[1]),
    /ClaimAwaitingFunds/,
    [ready.tickets[1].address, ready.ledger],
  );
  await check(
    "old v2 accepted winner still receives protected snapshot payout",
    async () => {
      const before = balance(owner.publicKey),
        reservedBefore = vaultReserved(),
        freeBefore = spendable();
      await send(oldSettleIx(oldV2, oldV2.tickets[0]));
      assert.equal(balance(owner.publicKey), before + prize);
      assert.equal(vaultReserved(), reservedBefore - prize);
      assert.equal(spendable(), freeBefore);
    },
  );
  await check(
    "old v3 accepted winner still receives protected pooled snapshot payout",
    async () => {
      const before = balance(owner.publicKey),
        reservedBefore = vaultReserved(),
        freeBefore = spendable();
      await send(oldSettleIx(oldV3, oldV3.tickets[0]));
      assert.equal(balance(owner.publicKey), before + prize);
      assert.equal(vaultReserved(), reservedBefore - prize);
      assert.equal(spendable(), freeBefore);
    },
  );
  await check(
    "new purchases still work while an unrelated winning prize awaits funding",
    async () => {
      const freeBefore = spendable(),
        before = balance(vault),
        entry = purchase(daily + interval, [7, 9]);
      await send(entry.ix);
      assert.equal(spendable(), freeBefore);
      assert.equal(balance(vault), before + cost);
    },
  );
  await check(
    "late fulfilled oracle finalizes after partial refund and releases only remaining entries",
    async () => {
      const data = Buffer.from(pending.oracleData.subarray(0, 137));
      data[8] = 1;
      data.writeUInt16LE(rank([2, 22]), 73);
      seedAccount(pending.request, oracle, data);
      await assert.rejects(
        send(refundIx(pending, pending.tickets[1])),
        /RefundNotAvailable/,
      );
      const before = balance(vault),
        reservedBefore = vaultReserved();
      await send([finalIx(pending), reconcileIx(pending)]);
      assert.equal(balance(vault), before);
      assert.equal(vaultReserved(), reservedBefore - 2n * cost);
      assert.deepEqual(ledgerState(pending), {
        phase: 1,
        held: 0n,
        unsettled: 2n,
      });
    },
  );
  await rejects(
    "refunded eventual winner cannot claim after late oracle fulfillment",
    settleIx(pending, pending.tickets[0]),
    /AlreadySettled/,
    [pending.tickets[0].address, pending.ledger],
  );
  await check(
    "no-win draw releases entry holds without a prize payment or marking tickets settled",
    async () => {
      const before = balance(vault),
        reservedBefore = vaultReserved();
      await send([finalIx(noWin), reconcileIx(noWin)]);
      assert.equal(balance(vault), before);
      assert.equal(vaultReserved(), reservedBefore - 2n * cost);
      assert.equal(account(noWin.tickets[0].address).data[64], 0);
    },
  );
  await check(
    "independent valid winners serialize without overdrawing protected reserves",
    async () => {
      await send(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: vault,
          lamports: 2_000_000_000,
        }),
      );
      const ownerBefore = balance(owner.publicKey),
        reservedBefore = vaultReserved();
      const protectedStates = [
        vault,
        ready.ledger,
        pending.ledger,
        ready.tickets[1].address,
        pending.tickets[1].address,
        owner.publicKey,
      ].map(account);
      await assert.rejects(
        send([
          settleIx(ready, ready.tickets[1]),
          settleIx(pending, pending.tickets[1]),
        ]),
        /ClaimAwaitingFunds/,
      );
      [
        vault,
        ready.ledger,
        pending.ledger,
        ready.tickets[1].address,
        pending.tickets[1].address,
        owner.publicKey,
      ].forEach((address, index) =>
        assert.deepEqual(account(address), protectedStates[index]),
      );
      const outcomes = await Promise.allSettled([
        send(settleIx(ready, ready.tickets[1])),
        send(settleIx(pending, pending.tickets[1])),
      ]);
      assert.equal(
        outcomes.filter((item) => item.status === "fulfilled").length,
        1,
      );
      const failed = outcomes.find((item) => item.status === "rejected");
      assert.match(String(failed.reason), /ClaimAwaitingFunds/);
      assert.equal(balance(owner.publicKey), ownerBefore + prize);
      assert.equal(vaultReserved(), reservedBefore);
      assert.equal(account(pending.tickets[1].address).data[64], 0);
    },
  );
  await check(
    "unpaid prize does not expire and remains claimable after refill",
    async () => {
      await send(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: vault,
          lamports: 4_000_000_000,
        }),
      );
      const before = balance(owner.publicKey);
      await send(settleIx(expired, expired.tickets[0]));
      await send(settleIx(pending, pending.tickets[1]));
      assert.equal(balance(owner.publicKey), before + 2n * prize);
    },
  );
  await rejects(
    "late winner remains once-only after successful refill payout",
    settleIx(pending, pending.tickets[1]),
    /AlreadySettled/,
    [pending.tickets[1].address, pending.ledger],
  );
  await check(
    "two simultaneous requests for one winning ticket pay once including automatic reconciliation",
    async () => {
      await send(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: vault,
          lamports: 2_000_000_000,
        }),
      );
      const ownerBefore = balance(owner.publicKey),
        reservedBefore = vaultReserved(),
        vaultBefore = balance(vault);
      const outcomes = await Promise.allSettled([
        send(settleIx(automatic, automatic.tickets[0])),
        send(settleIx(automatic, automatic.tickets[0])),
      ]);
      assert.equal(
        outcomes.filter((item) => item.status === "fulfilled").length,
        1,
      );
      assert.match(
        String(outcomes.find((item) => item.status === "rejected").reason),
        /AlreadySettled/,
      );
      assert.equal(balance(owner.publicKey), ownerBefore + prize);
      assert.equal(balance(vault), vaultBefore - prize);
      assert.equal(vaultReserved(), reservedBefore - cost);
      assert.deepEqual(ledgerState(automatic), {
        phase: 1,
        held: 0n,
        unsettled: 0n,
      });
    },
  );
}

let failure;
export let bpfReport;
try {
  await run();
} catch (error) {
  failure = error;
  console.error(error);
  process.exitCode = 1;
} finally {
  bpfReport = {
    timestamp: new Date().toISOString(),
    program: program.toBase58(),
    endpoint: null,
    syntheticGenesisOnly: true,
    publicOracleExecution: false,
    backend: "litesvm-1.6.2",
    elf,
    elfSha256: hash(readFileSync(elf)).toString("hex"),
    passed: results.length,
    failed: failure ? String(failure) : null,
    failureStack: failure?.stack ?? null,
    results,
    execution,
  };
  const path = resolve(scratch, "report.json");
  writeFileSync(path, `${JSON.stringify(bpfReport, null, 2)}\n`);
  console.log(`BPF report: ${path}`);
}

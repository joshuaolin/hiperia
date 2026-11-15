import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

const root = resolve(process.env.HIPERIA_BPF_ROOT ?? process.cwd());
const elf = resolve(
  root,
  process.env.HIPERIA_LEMON_ELF ??
    "hiperia_program/target/deploy/hiperia_lemon.so",
);
const scratch = resolve(
  process.env.HIPERIA_BPF_SCRATCH ?? resolve(root, ".local/lemon-bpf"),
  `${Date.now()}-${process.pid}`,
);
mkdirSync(scratch, { recursive: true });
const program = new PublicKey("7ZDTrz498pQuMyV4frPv2cZu5vR1ZrpfzFWAPGpVGcYr");
const oracle = new PublicKey("VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y");
const admin = new PublicKey("2txjN4S6WEiDDT8R3QvGFgwZrchQ8k5kBXRhbYFX1eSz");
const system = SystemProgram.programId;
const payer = Keypair.generate(),
  owner = Keypair.generate(),
  stranger = Keypair.generate();
const nonSystemOwner = Keypair.generate().publicKey;
const cost = 6_250_000n,
  prize = 4_750_000_000n,
  quickCost = 7_200_000n,
  quickPrize = 2_500_000_000n;
const interval = 14_400,
  offset = 7_200;
const now = Math.floor(Date.now() / 1000);
const daily = Math.floor((now - offset) / interval) * interval + offset;
const hash = (value) => createHash("sha256").update(value).digest();
const disc = (namespace, name) => hash(`${namespace}:${name}`).subarray(0, 8);
const u64 = (value) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(value));
  return b;
};
const i64 = (value) => {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(BigInt(value));
  return b;
};
const pda = (...seeds) => PublicKey.findProgramAddressSync(seeds, program);
const [config, configBump] = pda(Buffer.from("config"));
const [vault, vaultBump] = pda(Buffer.from("vault"));
const rent = (size) => 890_880n + BigInt(size) * 6_960n;
const rank = ([a, b, c]) => a * 100 + b * 10 + c;
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
const initialAccounts = new Map(),
  results = [],
  execution = [];
let svm,
  Account,
  FailedTransactionMetadata,
  nextNonce = 1n;

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
  const [client] = pda(Buffer.from("oracle-client"), i64(time));
  const seed = hash(`synthetic-lemon-fixture:${time}`);
  const [request] = PublicKey.findProgramAddressSync(
    [Buffer.from("orao-vrf-randomness-request"), seed],
    oracle,
  );
  const status = options.status ?? 1,
    phase = options.phase ?? 0,
    winning = options.winning ?? [0, 0, 0];
  const dailyDraw = (time - offset) % interval === 0;
  const paid = dailyDraw ? cost : quickCost,
    payout = dailyDraw ? prize : quickPrize;
  const ticketOwner = options.ticketOwner ?? owner.publicKey;
  const tickets = picks.map((numbers, index) => {
    const nonce = BigInt(time) * 100n + BigInt(index + 1);
    const [address, ticketBump] = pda(
      Buffer.from("ticket"),
      ticketOwner.toBuffer(),
      u64(nonce),
    );
    const padding = Buffer.alloc(32);
    padding[0] = options.version ?? 4;
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
  const reserved = phase === 0 ? BigInt(picks.length) * paid : 0n;
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
      (options.requestedBy ?? stranger.publicKey).toBuffer(),
      i64(time),
      Buffer.from(status === 2 ? winning : [0, 0, 0]),
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
    request,
    client,
    seed,
    tickets,
    reserved,
    oracleData,
    paid,
    payout,
    status,
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
seedAccount(nonSystemOwner, program, Buffer.alloc(32));
const ready = fixture(
  daily - interval,
  [
    [0, 0, 0],
    [0, 0, 0],
    [1, 2, 3],
  ],
  { requestedBy: nonSystemOwner },
);
const pending = fixture(
  daily - 8 * interval,
  [
    [0, 0, 0],
    [0, 0, 0],
    [1, 2, 3],
  ],
  { fulfilled: false },
);
const open = fixture(daily - 9 * interval, [[7, 7, 7]], {
  status: 0,
  fulfilled: false,
});
const tooSoon = fixture(daily - 1, [[0, 0, 0]], {
  status: 0,
  fulfilled: false,
});
const fulfilledTimeout = fixture(daily - 10 * interval, [[0, 0, 0]]);
const badOwner = fixture(daily - 11 * interval, [[0, 0, 0]], {
  oracleOwner: system,
});
const badLedgerOwner = fixture(daily - 12 * interval, [[0, 0, 0]], {
  ledgerOwner: system,
});
const badSeed = fixture(daily - 13 * interval, [[0, 0, 0]]);
badSeed.oracleData[41] ^= 1;
seedAccount(badSeed.request, oracle, badSeed.oracleData);
const badClient = fixture(daily - 14 * interval, [[0, 0, 0]]);
badClient.oracleData[9] ^= 1;
seedAccount(badClient.request, oracle, badClient.oracleData);
const expired = fixture(daily - 2190 * interval, [[0, 0, 0]], {
  status: 2,
  phase: 1,
});
const automatic = fixture(daily - 15 * interval, [[0, 0, 0]], { status: 2 });
const ownerless = fixture(
  daily - 16 * interval,
  [
    [1, 2, 3],
    [0, 0, 0],
  ],
  { ticketOwner: nonSystemOwner },
);
const wrongMarker = fixture(daily - 17 * interval, [[0, 0, 0]], {
  version: 3,
  status: 2,
});
const highTriple = fixture(daily - 18 * interval, [[9, 9, 9]], {
  winning: [9, 9, 9],
});
const fixtures = [
  ready,
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
  wrongMarker,
  highTriple,
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
  assert(state, `Missing ${address}`);
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
    meta(item.status === 0 ? system : item.request),
    meta(recipient, true),
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
  const failed = outcome instanceof FailedTransactionMetadata,
    metadata = failed ? outcome.meta() : outcome;
  execution.push({
    success: !failed,
    computeUnits: Number(metadata.computeUnitsConsumed()),
    logs: metadata.logs(),
  });
  if (failed) throw Error(`${outcome.err()}\n${metadata.logs().join("\n")}`);
  return Buffer.from(metadata.signature()).toString("hex");
}
async function check(name, fn) {
  await fn();
  results.push({ name, passed: true });
  console.log(`PASS ${name}`);
}
async function rejects(name, ix, expected, extras = []) {
  await check(name, async () => {
    const addresses = [vault, owner.publicKey, ...extras],
      before = addresses.map(account);
    await assert.rejects(send(ix), (error) => {
      if (expected) assert.match(String(error), expected);
      return true;
    });
    addresses.forEach((address, index) =>
      assert.deepEqual(account(address), before[index]),
    );
  });
}
function purchase(time, numbers = [0, 0, 0], options = {}) {
  const nonce = nextNonce++,
    [draw] = pda(Buffer.from("draw"), i64(time));
  const [ledger] = pda(
    Buffer.from("bankroll-draw"),
    Buffer.from("v1"),
    i64(time),
  );
  const [ticket] = pda(
    Buffer.from("ticket"),
    payer.publicKey.toBuffer(),
    u64(nonce),
  );
  return {
    time,
    draw,
    ledger,
    ticket,
    ix: instruction(
      "buy_bankroll_ticket",
      [
        meta(config),
        meta(vault, true),
        meta(ticket, true),
        meta(draw, true),
        meta(options.ledger ?? ledger, true),
        meta(payer.publicKey, true, true),
        meta(system),
      ],
      [u64(nonce), i64(time), Buffer.from(numbers)],
    ),
  };
}

async function run() {
  const native = await import("litesvm/dist/internal.js");
  ({ Account, FailedTransactionMetadata } = native);
  svm = new native.LiteSvm();
  svm.setRent(new native.Rent(6960n, 1, 50));
  svm.setClock(new native.Clock(1n, BigInt(now), 0n, 0n, BigInt(now)));
  svm.addProgramFromFile(program.toBuffer(), elf);
  for (const entry of initialAccounts.values())
    seedAccount(entry.address, entry.owner, entry.data, entry.lamports);
  svm.airdrop(payer.publicKey.toBuffer(), 1_000_000_000_000n);
  await check(
    "actual BPF metadata exposes all 1000 ordered triples and exact current offers",
    async () => {
      const response = svm.simulateLegacyTransaction(
        transaction(instruction("get_rules", [meta(config)])).serialize(),
      );
      assert(
        !(response instanceof FailedTransactionMetadata),
        String(response.err?.()),
      );
      const data = Buffer.from(response.meta().returnData().data());
      assert.equal(data.length, 58);
      assert.deepEqual([...data.subarray(0, 6)], [1, 0, 9, 3, 1, 1]);
      assert.equal(data.readUInt16LE(6), 1000);
      assert.equal(data.readBigUInt64LE(8), quickCost);
      assert.equal(data.readBigUInt64LE(16), cost);
      assert.equal(data.readBigUInt64LE(24), quickPrize);
      assert.equal(data.readBigUInt64LE(32), prize);
    },
  );
  await check(
    "actual bankroll and public-access metadata match checked client ABI",
    async () => {
      for (const [name, expected] of [
        ["get_bankroll_rules", [1, 1, 1, 1, 0, 1, 4, 50, 0]],
        ["get_access_rules", [1, 1, 1]],
      ]) {
        const response = svm.simulateLegacyTransaction(
          transaction(instruction(name, [meta(config)])).serialize(),
        );
        assert(
          !(response instanceof FailedTransactionMetadata),
          String(response.err?.()),
        );
        assert.deepEqual([...response.meta().returnData().data()], expected);
      }
    },
  );
  await check(
    "fifty multiple daily and quick entries reserve only incoming entries and keep all capital",
    async () => {
      const before = balance(vault),
        reserveBefore = vaultReserved(),
        capital = spendable();
      for (let i = 0; i < 25; i++) {
        for (const [time, fee, payout] of [
          [daily + interval, cost, prize],
          [now + 3600 + i, quickCost, quickPrize],
        ]) {
          const entry = purchase(time, [i % 10, i % 10, i % 10]);
          await send(entry.ix);
          const data = account(entry.ticket).data;
          assert.equal(data.length, 101);
          assert.equal(data[69], 4);
          assert.equal(data.readBigUInt64LE(56), fee);
          assert.equal(data.readBigUInt64LE(70), payout);
        }
      }
      assert.equal(balance(vault), before + 25n * (cost + quickCost));
      assert.equal(vaultReserved(), reserveBefore + 25n * (cost + quickCost));
      assert.equal(spendable(), capital);
    },
  );
  await rejects(
    "invalid fruit digit cannot purchase",
    purchase(daily + interval, [0, 0, 10]).ix,
    /InvalidNumbers/,
  );
  await rejects(
    "forged ledger PDA cannot bypass entry holds",
    purchase(daily + interval, [0, 0, 0], { ledger: stranger.publicKey }).ix,
    /ConstraintSeeds/,
  );
  await rejects(
    "sales close before accepted oracle requests",
    purchase(daily - interval).ix,
    /BadDrawTime/,
  );
  await rejects(
    "buy-ahead window cannot be bypassed",
    purchase(now + 86_401).ix,
    /BadDrawTime/,
  );
  await rejects(
    "pending proof cannot finalize",
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
    "wrong oracle request address cannot replace commitment",
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
    "unfinalized draw cannot reconcile refundable entries",
    reconcileIx(ready),
    /ResultNotPublished/,
    [ready.ledger],
  );
  await rejects(
    "foreign-owned ledger cannot reconcile",
    reconcileIx(badLedgerOwner),
    /AccountOwnedByWrongProgram/,
    [badLedgerOwner.ledger],
  );
  await rejects(
    "refund before 24 hours is rejected",
    refundIx(tooSoon, tooSoon.tickets[0]),
    /RefundNotAvailable/,
    [tooSoon.tickets[0].address, tooSoon.ledger],
  );
  await rejects(
    "fulfilled proof disables timeout refund",
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
  await check(
    "pending timeout refund pays exactly actual entry and records once-only refund",
    async () => {
      const before = balance(vault),
        reservedBefore = vaultReserved(),
        ownerBefore = balance(owner.publicKey);
      await send(refundIx(pending, pending.tickets[0]));
      assert.equal(balance(vault), before - cost);
      assert.equal(vaultReserved(), reservedBefore - cost);
      assert.equal(balance(owner.publicKey), ownerBefore + cost);
      assert.equal(account(pending.tickets[0].address).data[78], 1);
      assert.deepEqual(ledgerState(pending), {
        phase: 0,
        held: 2n * cost,
        unsettled: 2n,
      });
    },
  );
  await rejects(
    "same refund cannot replay",
    refundIx(pending, pending.tickets[0]),
    /AlreadySettled/,
    [pending.tickets[0].address, pending.ledger],
  );
  await check(
    "open never-requested timeout refund is safe without an oracle account",
    async () => {
      const before = balance(owner.publicKey);
      await send(refundIx(open, open.tickets[0]));
      assert.equal(balance(owner.publicKey), before + cost);
      assert.deepEqual(ledgerState(open), {
        phase: 0,
        held: 0n,
        unsettled: 0n,
      });
    },
  );
  await check(
    "finalize and reconcile pay nothing and do not need requester's current wallet type",
    async () => {
      const before = balance(vault),
        ownerBefore = balance(owner.publicKey),
        reserveBefore = vaultReserved();
      await send([finalIx(ready), reconcileIx(ready)]);
      assert.deepEqual(
        [...account(ready.draw).data.subarray(162, 165)],
        [0, 0, 0],
      );
      assert.equal(account(ready.draw).data[17], 2);
      assert.equal(balance(vault), before);
      assert.equal(balance(owner.publicKey), ownerBefore);
      assert.equal(vaultReserved(), reserveBefore - 3n * cost);
      assert.equal(account(ready.tickets[2].address).data[64], 0);
    },
  );
  await rejects(
    "finalized draw cannot reroll",
    finalIx(ready),
    /DrawNotPending/,
    [ready.draw],
  );
  await check("reconciliation is idempotent", async () => {
    const before = vaultReserved();
    await send(reconcileIx(ready));
    assert.equal(vaultReserved(), before);
  });
  await check(
    "higher fruit triples are derived from proof without sentinel confusion",
    async () => {
      await send(finalIx(highTriple));
      assert.deepEqual(
        [...account(highTriple.draw).data.subarray(162, 165)],
        [9, 9, 9],
      );
    },
  );
  await rejects(
    "winning ticket cannot use losing cleanup",
    releaseIx(ready, ready.tickets[0]),
    /WinningTicketCannotRelease/,
    [ready.tickets[0].address, ready.ledger],
  );
  await rejects(
    "winning payment cannot redirect owner",
    settleIx(ready, ready.tickets[0], stranger.publicKey),
    /Unauthorized/,
    [ready.tickets[0].address, ready.ledger],
  );
  await rejects(
    "Lemon rejects legacy ticket snapshot markers",
    settleIx(wrongMarker, wrongMarker.tickets[0]),
    /InvalidTicketReserve/,
    [wrongMarker.tickets[0].address, wrongMarker.ledger],
  );
  await check(
    "owner-independent losing cleanup needs no owner account or signature",
    async () => {
      const before = balance(vault),
        ownerBefore = account(nonSystemOwner);
      await send([
        finalIx(ownerless),
        releaseIx(ownerless, ownerless.tickets[0]),
      ]);
      assert.equal(balance(vault), before);
      assert.deepEqual(account(nonSystemOwner), ownerBefore);
      assert.equal(account(ownerless.tickets[0].address).data[64], 1);
      assert.equal(account(ownerless.tickets[1].address).data[64], 0);
    },
  );
  await check(
    "unfunded winning claim fails atomically then succeeds once after explicit top-up",
    async () => {
      const state = account(vault),
        capital = spendable();
      seedAccount(
        vault,
        program,
        state.data,
        rent(41) + vaultReserved() + prize - 1n,
      );
      const addresses = [
          vault,
          owner.publicKey,
          ready.ledger,
          ready.tickets[0].address,
        ],
        before = addresses.map(account);
      await assert.rejects(
        send(settleIx(ready, ready.tickets[0])),
        /ClaimAwaitingFunds/,
      );
      addresses.forEach((address, index) =>
        assert.deepEqual(account(address), before[index]),
      );
      await send(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: vault,
          lamports: 1,
        }),
      );
      const ownerBefore = balance(owner.publicKey),
        reserveBefore = vaultReserved(),
        vaultBefore = balance(vault);
      await send(settleIx(ready, ready.tickets[0]));
      assert.equal(balance(owner.publicKey), ownerBefore + prize);
      assert.equal(balance(vault), vaultBefore - prize);
      assert.equal(vaultReserved(), reserveBefore);
      assert.equal(account(ready.tickets[0].address).data[64], 1);
      await send(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: vault,
          lamports: Number(capital),
        }),
      );
    },
  );
  await rejects(
    "same winning ticket cannot drain vault by replay",
    settleIx(ready, ready.tickets[0]),
    /AlreadySettled/,
    [ready.tickets[0].address, ready.ledger],
  );
  await check(
    "very old accepted winning tickets retain claims without expiry",
    async () => {
      const before = balance(owner.publicKey);
      await send(settleIx(expired, expired.tickets[0]));
      assert.equal(balance(owner.publicKey), before + prize);
    },
  );
  await check("claim auto-reconciles only its own draw's entries", async () => {
    const before = balance(vault),
      reserveBefore = vaultReserved();
    await send(settleIx(automatic, automatic.tickets[0]));
    assert.equal(balance(vault), before - prize);
    assert.equal(vaultReserved(), reserveBefore - cost);
    assert.deepEqual(ledgerState(automatic), {
      phase: 1,
      held: 0n,
      unsettled: 0n,
    });
  });
  await check(
    "late fulfillment after a partial refund preserves remaining ticket rights",
    async () => {
      const data = Buffer.alloc(137);
      Buffer.from([139, 239, 184, 215, 227, 86, 191, 226]).copy(data);
      data[8] = 1;
      pending.client.toBuffer().copy(data, 9);
      pending.seed.copy(data, 41);
      seedAccount(pending.request, oracle, data);
      await send([finalIx(pending), reconcileIx(pending)]);
      assert.deepEqual(ledgerState(pending), {
        phase: 1,
        held: 0n,
        unsettled: 2n,
      });
      await assert.rejects(
        send(settleIx(pending, pending.tickets[0])),
        /AlreadySettled/,
      );
      const before = balance(owner.publicKey);
      await send(settleIx(pending, pending.tickets[1]));
      assert.equal(balance(owner.publicKey), before + prize);
      assert.equal(account(pending.tickets[2].address).data[64], 0);
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
  writeFileSync(
    resolve(scratch, "report.json"),
    JSON.stringify(bpfReport, null, 2) + "\n",
  );
}

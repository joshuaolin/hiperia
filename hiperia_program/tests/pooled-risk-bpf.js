import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Connection,
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
const useSvm = process.env.HIPERIA_BPF_BACKEND === "litesvm";
const binary = resolve(
  root,
  process.env.SOLANA_TEST_VALIDATOR ??
    ".tools/solana-release/bin/solana-test-validator.exe",
);
const elf = resolve(
  root,
  process.env.HIPERIA_VRF_ELF ?? "hiperia_program/target/deploy/hiperia_vrf.so",
);
const scratchRoot = resolve(
  process.env.HIPERIA_BPF_SCRATCH ?? resolve(root, ".local/pooled-bpf"),
);
const scratch = resolve(scratchRoot, `${Date.now()}-${process.pid}`);
assert(
  scratch.startsWith(`${scratchRoot}\\`) ||
    scratch.startsWith(`${scratchRoot}/`),
);
assert(useSvm || existsSync(binary), `Missing local validator: ${binary}`);
assert(existsSync(elf), `Missing compiled program: ${elf}`);
mkdirSync(scratch, { recursive: true });
const program = new PublicKey("6SWK5s22L7HDzvNdFbMhTjtMQNPfUmMzM4D8S3ZRRgRy");
const oracle = new PublicKey("VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y");
const system = SystemProgram.programId;
const payer = Keypair.generate();
const owner = Keypair.generate();
const stranger = Keypair.generate();
const admin = new PublicKey(
  Uint8Array.from([
    28, 43, 82, 159, 210, 138, 77, 138, 204, 1, 163, 32, 151, 71, 49, 247, 221,
    252, 123, 74, 21, 62, 203, 193, 151, 138, 173, 173, 138, 5, 57, 119,
  ]),
);
const cost = 6_250_000n;
const prize = 2_000_000_000n;
const interval = 14_400;
const offset = 7_200;
const now = Math.floor(Date.now() / 1000);
const daily = Math.floor((now - offset) / interval) * interval + offset;
const accounts = new Map();
const results = [];
const tracked = new Set();
let validator;
let connection;
let svm;
const execution = [];

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
const reserve = (counts, phase = 0, winning = [2, 22]) =>
  phase === 0
    ? counts.reduce((sum, count) => sum + count, 0n) * cost +
      counts.reduce((max, count) => (count > max ? count : max), 0n) *
        (prize - cost)
    : counts[rank(winning)] * prize;

function seedAccount(
  address,
  accountOwner,
  data = Buffer.alloc(0),
  lamports = rent(data.length),
) {
  const key = address.toBase58();
  tracked.add(key);
  accounts.set(key, {
    pubkey: key,
    account: {
      lamports: Number(lamports),
      data: [Buffer.from(data).toString("base64"), "base64"],
      owner: accountOwner.toBase58(),
      executable: false,
      rentEpoch: 0,
      space: data.length,
    },
  });
}

function fixture(time, picks, options = {}) {
  const [draw, bump] = pda(Buffer.from("draw"), i64(time));
  const [risk, riskBump] = pda(
    Buffer.from("draw-risk"),
    Buffer.from("v1"),
    i64(time),
  );
  const [client] = pda(Buffer.from("oracle-client"), i64(time));
  const seed = hash(`synthetic-local-only:${time}`);
  const [request] = PublicKey.findProgramAddressSync(
    [Buffer.from("orao-vrf-randomness-request"), seed],
    oracle,
  );
  const status = options.status ?? 1;
  const winning = options.winning ?? [2, 22];
  const counts = Array.from({ length: 420 }, () => 0n);
  const tickets = picks.map((numbers, index) => {
    counts[rank(numbers)] += 1n;
    const nonce = BigInt(time) * 100n + BigInt(index + 1);
    const [ticket, ticketBump] = pda(
      Buffer.from("ticket"),
      owner.publicKey.toBuffer(),
      u64(nonce),
    );
    const padding = Buffer.alloc(32);
    padding[0] = 3;
    padding.writeBigUInt64LE(prize, 1);
    seedAccount(
      ticket,
      program,
      Buffer.concat([
        disc("account", "Ticket"),
        owner.publicKey.toBuffer(),
        u64(nonce),
        i64(time),
        u64(cost),
        Buffer.from([0, ticketBump, ...numbers]),
        padding,
      ]),
    );
    return { address: ticket, nonce, numbers };
  });
  const phase = options.phase ?? 0;
  const reserved = reserve(counts, phase, winning);
  const vectorLength = Buffer.alloc(4);
  vectorLength.writeUInt32LE(420);
  seedAccount(
    risk,
    options.riskOwner ?? program,
    Buffer.concat([
      disc("account", "DrawRisk"),
      i64(time),
      Buffer.from([riskBump, phase]),
      u64(picks.length),
      u64(reserved),
      vectorLength,
      ...counts.map(u64),
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
      stranger.publicKey.toBuffer(),
      i64(time),
      Buffer.from(status === 2 ? winning : [0, 0]),
      Buffer.from([1]),
      u64(cost),
      u64(prize),
    ]),
  );
  const fulfilled = options.fulfilled ?? true;
  const oracleData = Buffer.alloc(fulfilled ? 137 : 749);
  disc("account", "RandomnessV2").copy(oracleData);
  Buffer.from([139, 239, 184, 215, 227, 86, 191, 226]).copy(oracleData);
  oracleData[8] = Number(fulfilled);
  client.toBuffer().copy(oracleData, 9);
  seed.copy(oracleData, 41);
  if (fulfilled) oracleData.writeUInt16LE(rank(winning), 73);
  seedAccount(request, options.oracleOwner ?? oracle, oracleData);
  return {
    time,
    draw,
    risk,
    request,
    client,
    tickets,
    counts,
    reserved,
    oracleData,
    winning,
  };
}

seedAccount(
  config,
  program,
  Buffer.concat([
    disc("account", "Config"),
    Buffer.from([1, configBump]),
    u64(7_200_000),
    u64(1_000_000_000),
    admin.toBuffer(),
  ]),
);
seedAccount(owner.publicKey, system, Buffer.alloc(0), 10_000_000_000n);
seedAccount(stranger.publicKey, system, Buffer.alloc(0), 1_000_000_000n);
const final = fixture(daily - interval, [
  [2, 22],
  [3, 4],
  [3, 4],
  [3, 4],
]);
final.legacyTickets = [
  [2, 22],
  [3, 4],
].map((numbers, index) => {
  const nonce = BigInt(final.time) * 100n + BigInt(90 + index);
  const [address, bump] = pda(
    Buffer.from("ticket"),
    owner.publicKey.toBuffer(),
    u64(nonce),
  );
  const padding = Buffer.alloc(32);
  padding[0] = 2;
  padding.writeBigUInt64LE(prize, 1);
  seedAccount(
    address,
    program,
    Buffer.concat([
      disc("account", "Ticket"),
      owner.publicKey.toBuffer(),
      u64(nonce),
      i64(final.time),
      u64(cost),
      Buffer.from([0, bump, ...numbers]),
      padding,
    ]),
  );
  return { address, nonce, numbers };
});
const finalDrawData = Buffer.from(
  accounts.get(final.draw.toBase58()).account.data[0],
  "base64",
);
finalDrawData.writeBigUInt64LE(6n, 18);
seedAccount(final.draw, program, finalDrawData);
const noWin = fixture(
  daily - 2 * interval,
  [
    [7, 9],
    [7, 9],
    [7, 9],
  ],
  { winning: [2, 22] },
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
const oldPendingNonce = BigInt(pending.time) * 100n + 90n;
const [oldPendingAddress, oldPendingBump] = pda(
  Buffer.from("ticket"),
  owner.publicKey.toBuffer(),
  u64(oldPendingNonce),
);
const oldPendingPadding = Buffer.alloc(32);
oldPendingPadding[0] = 2;
oldPendingPadding.writeBigUInt64LE(prize, 1);
seedAccount(
  oldPendingAddress,
  program,
  Buffer.concat([
    disc("account", "Ticket"),
    owner.publicKey.toBuffer(),
    u64(oldPendingNonce),
    i64(pending.time),
    u64(cost),
    Buffer.from([0, oldPendingBump, 2, 22]),
    oldPendingPadding,
  ]),
);
pending.legacyTicket = {
  address: oldPendingAddress,
  nonce: oldPendingNonce,
  numbers: [2, 22],
};
const pendingDrawData = Buffer.from(
  accounts.get(pending.draw.toBase58()).account.data[0],
  "base64",
);
pendingDrawData.writeBigUInt64LE(4n, 18);
seedAccount(pending.draw, program, pendingDrawData);
const open = fixture(
  daily - 9 * interval,
  [
    [7, 9],
    [7, 9],
  ],
  { status: 0, fulfilled: false },
);
const tooSoon = fixture(daily - 3 * interval, [[2, 22]], {
  status: 0,
  fulfilled: false,
});
const expiredWinner = fixture(
  daily - 2_190 * interval,
  [
    [2, 22],
    [3, 4],
  ],
  { status: 2, phase: 1 },
);
const fulfilledTimeout = fixture(daily - 10 * interval, [[2, 22]]);
const badOwner = fixture(daily - 11 * interval, [[2, 22]], {
  oracleOwner: system,
});
const badRiskOwner = fixture(daily - 12 * interval, [[2, 22]], {
  riskOwner: system,
});
const badSeed = fixture(daily - 13 * interval, [[2, 22]]);
badSeed.oracleData[41] ^= 1;
seedAccount(badSeed.request, oracle, badSeed.oracleData);
const badClient = fixture(daily - 14 * interval, [[2, 22]]);
badClient.oracleData[9] ^= 1;
seedAccount(badClient.request, oracle, badClient.oracleData);
const fixtures = [
  final,
  noWin,
  pending,
  open,
  tooSoon,
  expiredWinner,
  fulfilledTimeout,
  badOwner,
  badRiskOwner,
  badSeed,
  badClient,
];
const initialReserve = fixtures.reduce(
  (sum, item) => sum + item.reserved,
  3n * prize,
);
const vaultData = Buffer.concat([
  disc("account", "Vault"),
  Buffer.from([vaultBump]),
  u64(initialReserve),
  Buffer.alloc(24),
]);
seedAccount(
  vault,
  program,
  vaultData,
  rent(41) + initialReserve + 2_000_000_000n,
);

const meta = (pubkey, isWritable = false, isSigner = false) => ({
  pubkey,
  isWritable,
  isSigner,
});
function instruction(name, keys, args = []) {
  return new TransactionInstruction({
    programId: program,
    keys,
    data: Buffer.concat([disc("global", name), ...args]),
  });
}
const finalIx = (item, request = item.request) =>
  instruction(
    "finalize_draw",
    [meta(config), meta(item.draw, true), meta(request)],
    [i64(item.time)],
  );
const reconcileIx = (item, risk = item.risk) =>
  instruction(
    "reconcile_draw_risk",
    [meta(config), meta(vault, true), meta(item.draw), meta(risk, true)],
    [i64(item.time)],
  );
const settleIx = (item, ticket, recipient = owner.publicKey, legacy = false) =>
  instruction(legacy ? "settle_ticket" : "settle_pooled_ticket", [
    meta(config),
    meta(vault, true),
    meta(ticket.address, true),
    meta(item.draw),
    ...(legacy ? [] : [meta(item.risk, true)]),
    meta(recipient, true),
    meta(system),
  ]);
const refundIx = (item, ticket, recipient = owner.publicKey, legacy = false) =>
  instruction(legacy ? "refund_ticket" : "refund_pooled_ticket", [
    meta(config),
    meta(vault, true),
    meta(ticket.address, true),
    meta(item.draw),
    ...(legacy ? [] : [meta(item.risk, true)]),
    meta(recipient, true),
    meta(item === open || item === tooSoon ? system : item.request),
    meta(system),
  ]);
const releaseIx = (item, ticket, legacy = false) =>
  instruction(
    legacy ? "release_losing_ticket" : "release_pooled_losing_ticket",
    [
      meta(config),
      meta(vault, true),
      meta(ticket.address, true),
      meta(item.draw),
      ...(legacy ? [] : [meta(item.risk, true)]),
    ],
  );

async function account(address) {
  const result = await connection.getAccountInfo(address, "confirmed");
  assert(result, `Missing ${address.toBase58()}`);
  return result;
}
async function balance(address) {
  return BigInt((await account(address)).lamports);
}
async function vaultReserved() {
  return (await account(vault)).data.readBigUInt64LE(9);
}
async function riskState(item) {
  const data = (await account(item.risk)).data;
  assert.equal(data.readUInt32LE(34), 420);
  return {
    phase: data[17],
    total: data.readBigUInt64LE(18),
    reserved: data.readBigUInt64LE(26),
    counts: Array.from({ length: 420 }, (_, index) =>
      data.readBigUInt64LE(38 + 8 * index),
    ),
  };
}

async function send(instructions, signers = []) {
  const tx = new Transaction().add(...[instructions].flat());
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (
    await connection.getLatestBlockhash("confirmed")
  ).blockhash;
  tx.sign(payer, ...signers);
  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
    maxRetries: 0,
  });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const state = (await connection.getSignatureStatuses([signature])).value[0];
    if (state?.err) throw new Error(JSON.stringify(state.err));
    if (
      state?.confirmationStatus === "confirmed" ||
      state?.confirmationStatus === "finalized"
    )
      return signature;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`Local confirmation timeout ${signature}`);
}

async function check(name, fn) {
  await fn();
  results.push({ name, passed: true });
  console.log(`PASS ${name}`);
}
async function rejects(name, ix, expected) {
  await check(name, async () => {
    const before = await balance(vault);
    const reservedBefore = await vaultReserved();
    await assert.rejects(send(ix), (error) => {
      if (expected) assert.match(String(error), expected);
      return true;
    });
    assert.equal(await balance(vault), before);
    assert.equal(await vaultReserved(), reservedBefore);
  });
}

async function stop() {
  if (!validator) return;
  const processToStop = validator;
  validator = undefined;
  await new Promise((done) => {
    if (processToStop.exitCode !== null) return done();
    processToStop.once("exit", done);
    processToStop.kill();
    setTimeout(done, 5_000).unref();
  });
}

async function start(phase) {
  if (useSvm) {
    const { LiteSvm, Account, Clock, Rent, FailedTransactionMetadata } =
      await import("litesvm/dist/internal.js");
    svm = new LiteSvm();
    svm.setRent(new Rent(6960n, 1, 50));
    assert.equal(svm.minimumBalanceForRentExemption(41n), rent(41));
    svm.setClock(new Clock(1n, BigInt(now), 0n, 0n, BigInt(now)));
    svm.addProgramFromFile(program.toBuffer(), elf);
    for (const [key, entry] of accounts) {
      svm.setAccount(
        new PublicKey(key).toBuffer(),
        new Account(
          BigInt(entry.account.lamports),
          Buffer.from(entry.account.data[0], "base64"),
          new PublicKey(entry.account.owner).toBuffer(),
          false,
          0n,
        ),
      );
    }
    svm.airdrop(payer.publicKey.toBuffer(), 100_000_000_000n);
    connection = {
      async getAccountInfo(key) {
        const state = svm.getAccount(key.toBuffer());
        return state
          ? {
              lamports: Number(state.lamports()),
              data: Buffer.from(state.data()),
              owner: new PublicKey(state.owner()),
            }
          : null;
      },
      async getLatestBlockhash() {
        svm.expireBlockhash();
        return { blockhash: svm.latestBlockhash() };
      },
      async simulateTransaction(tx) {
        const outcome = svm.simulateLegacyTransaction(tx.serialize());
        const failed = outcome instanceof FailedTransactionMetadata;
        return {
          value: {
            err: failed ? String(outcome.err()) : null,
            returnData: failed
              ? null
              : {
                  data: [
                    Buffer.from(outcome.meta().returnData().data()).toString(
                      "base64",
                    ),
                    "base64",
                  ],
                },
          },
        };
      },
      async sendRawTransaction(bytes) {
        const outcome = svm.sendLegacyTransaction(bytes);
        const failed = outcome instanceof FailedTransactionMetadata;
        const metadata = failed ? outcome.meta() : outcome;
        execution.push({
          phase,
          success: !failed,
          computeUnits: Number(metadata.computeUnitsConsumed()),
          logs: metadata.logs(),
        });
        if (failed)
          throw new Error(`${outcome.err()}\n${metadata.logs().join("\n")}`);
        return Buffer.from(metadata.signature()).toString("hex");
      },
      async getSignatureStatuses() {
        return { value: [{ confirmationStatus: "confirmed" }] };
      },
    };
    return;
  }
  const directory = resolve(scratch, phase);
  mkdirSync(directory, { recursive: true });
  const args = [
    "--ledger",
    resolve(directory, "ledger"),
    "--rpc-port",
    "18899",
    "--faucet-port",
    "19900",
    "--gossip-port",
    "19801",
    "--dynamic-port-range",
    "20000-20100",
    "--mint",
    payer.publicKey.toBase58(),
    "--bpf-program",
    program.toBase58(),
    elf,
    "--log",
  ];
  for (const [key, entry] of accounts) {
    const path = resolve(directory, `${key}.json`);
    writeFileSync(path, JSON.stringify(entry));
    args.push("--account", key, path);
  }
  const logPath = resolve(directory, "validator.log");
  const log = openSync(logPath, "a");
  validator = spawn(binary, args, {
    cwd: root,
    windowsHide: true,
    stdio: ["ignore", log, log],
  });
  closeSync(log);
  let error;
  validator.once("error", (value) => {
    error = value;
  });
  connection = new Connection("http://127.0.0.1:18899", "confirmed");
  for (let attempt = 0; attempt < 180; attempt += 1) {
    if (error || validator.exitCode !== null)
      throw (
        error ??
        new Error(
          `Validator exited ${validator.exitCode}: ${readFileSync(logPath, "utf8").slice(-4_000)}`,
        )
      );
    try {
      const response = await fetch("http://127.0.0.1:18899", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
        signal: AbortSignal.timeout(1_000),
      });
      if ((await response.json()).result === "ok") return;
    } catch (startupError) {
      if (validator.exitCode !== null) throw startupError;
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`Validator startup timeout: ${logPath}`);
}

async function snapshot() {
  for (const key of tracked) {
    const state = await connection.getAccountInfo(
      new PublicKey(key),
      "confirmed",
    );
    if (!state) {
      accounts.delete(key);
      continue;
    }
    seedAccount(
      new PublicKey(key),
      state.owner,
      state.data,
      BigInt(state.lamports),
    );
  }
}

async function run() {
  await start("pending-and-purchases");
  const future = { time: daily + interval };
  [future.draw] = pda(Buffer.from("draw"), i64(future.time));
  [future.risk] = pda(
    Buffer.from("draw-risk"),
    Buffer.from("v1"),
    i64(future.time),
  );
  tracked.add(future.draw.toBase58());
  tracked.add(future.risk.toBase58());
  let nonce = 1n;
  function purchase(
    numbers,
    legacy = false,
    risk = future.risk,
    round = future,
  ) {
    const id = nonce++;
    const [ticket] = pda(
      Buffer.from("ticket"),
      payer.publicKey.toBuffer(),
      u64(id),
    );
    tracked.add(ticket.toBase58());
    return {
      ticket,
      ix: instruction(
        legacy ? "buy_ticket" : "buy_pooled_ticket",
        [
          meta(config),
          meta(vault, true),
          meta(ticket, true),
          meta(payer.publicKey, true, true),
          meta(system),
          meta(round.draw, true),
          ...(legacy ? [] : [meta(risk, true)]),
        ],
        [u64(id), i64(round.time), Buffer.from(numbers)],
      ),
    };
  }
  await check(
    "daily pooled metadata is executable BPF return data",
    async () => {
      const tx = new Transaction().add(
        instruction("get_liability_rules", [meta(config)]),
      );
      tx.feePayer = payer.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      tx.sign(payer);
      const simulation = await connection.simulateTransaction(tx);
      assert.equal(simulation.value.err, null);
      const data = Buffer.from(simulation.value.returnData.data[0], "base64");
      assert.deepEqual([...data.subarray(0, 3)], [1, 1, 0]);
      assert.equal(data.readUInt16LE(3), 420);
      assert.equal(data.readUInt16LE(5), 3398);
    },
  );
  await check(
    "three balanced paid entries share one possible winning liability",
    async () => {
      const before = await balance(vault);
      const reservedBefore = await vaultReserved();
      for (const numbers of [
        [2, 22],
        [3, 4],
        [5, 6],
      ]) {
        const { ix, ticket } = purchase(numbers);
        await send(ix);
        const state = (await account(ticket)).data;
        assert.equal(state[68], 3);
        assert.equal(state.readBigUInt64LE(56), cost);
        assert.equal(state.readBigUInt64LE(69), prize);
      }
      assert.equal(await balance(vault), before + 3n * cost);
      assert.equal(await vaultReserved(), reservedBefore + prize + 2n * cost);
      const state = await riskState(future);
      assert.equal(state.total, 3n);
      assert.equal(state.reserved, prize + 2n * cost);
    },
  );
  await rejects(
    "same-pair overbooking is rejected atomically",
    purchase([2, 22]).ix,
    /InsufficientVaultFunds/,
  );
  await send(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: vault,
      lamports: 2_000_000_000,
    }),
  );
  await check(
    "funded same-pair entry increases only its maximum outcome backing",
    async () => {
      const before = await vaultReserved();
      const { ix } = purchase([2, 22]);
      await send(ix);
      assert.equal(await vaultReserved(), before + prize);
      assert.equal((await riskState(future)).counts[rank([2, 22])], 2n);
    },
  );
  await rejects(
    "third concentrated winner cannot exceed funded maximum",
    purchase([2, 22]).ix,
    /InsufficientVaultFunds/,
  );
  await rejects(
    "forged risk PDA cannot redirect purchase liabilities",
    purchase([7, 8], false, noWin.risk).ix,
    /ConstraintSeeds/,
  );
  await send(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: vault,
      lamports: 2_000_000_000,
    }),
  );
  await rejects(
    "old daily purchase path cannot bypass pooled daily admission",
    purchase([7, 8], true).ix,
    /InvalidDrawRisk/,
  );
  const quick = { time: future.time + 60 };
  [quick.draw] = pda(Buffer.from("draw"), i64(quick.time));
  tracked.add(quick.draw.toBase58());
  await check(
    "quick v2 and daily pooled v3 purchases retain independent reserves",
    async () => {
      const before = await vaultReserved();
      const treasury = await balance(vault);
      const riskBefore = await riskState(future);
      const { ix, ticket } = purchase([7, 8], true, future.risk, quick);
      await send(ix);
      assert.equal((await account(ticket)).data[68], 2);
      assert.equal(
        (await account(ticket)).data.readBigUInt64LE(56),
        7_200_000n,
      );
      assert.equal(
        (await account(ticket)).data.readBigUInt64LE(69),
        1_000_000_000n,
      );
      assert.equal(await vaultReserved(), before + 1_000_000_000n);
      assert.equal(await balance(vault), treasury + 7_200_000n);
      assert.deepEqual(await riskState(future), riskBefore);
    },
  );
  await rejects(
    "unfulfilled oracle prevents finalization",
    finalIx(pending),
    /RandomnessPending/,
  );
  await rejects(
    "wrong oracle owner prevents finalization",
    finalIx(badOwner),
    /InvalidOracleRequest/,
  );
  await rejects(
    "wrong oracle address prevents finalization",
    finalIx(final, noWin.request),
    /InvalidOracleRequest/,
  );
  await rejects(
    "forged oracle seed prevents finalization",
    finalIx(badSeed),
    /InvalidOracleRequest/,
  );
  await rejects(
    "forged oracle client prevents finalization",
    finalIx(badClient),
    /InvalidOracleRequest/,
  );
  await rejects(
    "wrong risk owner prevents liability reconciliation",
    reconcileIx(badRiskOwner),
    /AccountOwnedByWrongProgram/,
  );
  await rejects(
    "wrong risk PDA prevents cross-draw reconciliation",
    reconcileIx(final, noWin.risk),
    /ConstraintSeeds/,
  );
  await rejects(
    "legacy settlement rejects v3 marker without touching backing",
    settleIx(expiredWinner, expiredWinner.tickets[0], owner.publicKey, true),
    /InvalidTicketReserve/,
  );
  await rejects(
    "legacy loser release rejects v3 marker",
    releaseIx(expiredWinner, expiredWinner.tickets[1], true),
    /InvalidTicketReserve/,
  );
  await rejects(
    "wrong payout owner cannot claim pooled prize",
    settleIx(expiredWinner, expiredWinner.tickets[0], stranger.publicKey),
    /Unauthorized/,
  );
  await check(
    "accepted winning prize remains claimable after a year",
    async () => {
      const before = await balance(owner.publicKey);
      const treasury = await balance(vault);
      await send(settleIx(expiredWinner, expiredWinner.tickets[0]));
      assert.equal(await balance(owner.publicKey), before + prize);
      assert.equal(await balance(vault), treasury - prize);
    },
  );
  await rejects(
    "winning ticket cannot claim twice",
    settleIx(expiredWinner, expiredWinner.tickets[0]),
    /AlreadySettled/,
  );
  await rejects(
    "entry refund requires verified 24-hour timeout",
    refundIx(tooSoon, tooSoon.tickets[0]),
    /RefundNotAvailable/,
  );
  await rejects(
    "fulfilled proof blocks timeout refund",
    refundIx(fulfilledTimeout, fulfilledTimeout.tickets[0]),
    /RefundNotAvailable/,
  );
  await rejects(
    "refund cannot pay a substituted recipient",
    refundIx(pending, pending.tickets[0], stranger.publicKey),
    /Unauthorized/,
  );
  await rejects(
    "legacy refund rejects v3 ticket marker",
    refundIx(pending, pending.tickets[0], owner.publicKey, true),
    /InvalidTicketReserve/,
  );
  await check(
    "partial pending timeout refunds only actual entry and updates outcome counts",
    async () => {
      const before = await balance(owner.publicKey);
      const treasury = await balance(vault);
      await send(refundIx(pending, pending.tickets[0]));
      assert.equal(await balance(owner.publicKey), before + cost);
      assert.equal(await balance(vault), treasury - cost);
      const state = await riskState(pending);
      assert.equal(state.total, 2n);
      assert.equal(state.counts[rank([2, 22])], 1n);
      assert.equal(state.reserved, prize + cost);
      const ticket = (await account(pending.tickets[0].address)).data;
      assert.equal(ticket[64], 1);
      assert.equal(ticket[77], 1);
    },
  );
  await rejects(
    "refunded ticket cannot refund twice",
    refundIx(pending, pending.tickets[0]),
    /AlreadySettled/,
  );
  await check(
    "accepted historical v2 daily timeout refund preserves pooled risk",
    async () => {
      const before = await vaultReserved();
      const recipient = await balance(owner.publicKey);
      const riskBefore = await riskState(pending);
      await send(
        refundIx(pending, pending.legacyTicket, owner.publicKey, true),
      );
      assert.equal(await vaultReserved(), before - prize);
      assert.equal(await balance(owner.publicKey), recipient + cost);
      assert.deepEqual(await riskState(pending), riskBefore);
    },
  );
  await rejects(
    "historical v2 daily timeout refund remains once-only",
    refundIx(pending, pending.legacyTicket, owner.publicKey, true),
    /AlreadySettled/,
  );
  await check(
    "open-draw refunds release the final possible entry liability",
    async () => {
      await send(refundIx(open, open.tickets[0]));
      assert.equal((await riskState(open)).reserved, prize);
      await send(refundIx(open, open.tickets[1]));
      const state = await riskState(open);
      assert.equal(state.reserved, 0n);
      assert.equal(state.total, 0n);
    },
  );
  await check(
    "verified finalization and reconciliation release only losing outcome backing",
    async () => {
      const treasury = await balance(vault);
      const before = await vaultReserved();
      await send([finalIx(final), reconcileIx(final)]);
      assert.equal(await balance(vault), treasury);
      assert.equal(await vaultReserved(), before - final.reserved + prize);
      assert.equal((await riskState(final)).reserved, prize);
      assert.equal((await riskState(final)).phase, 1);
      assert.deepEqual(
        [...(await account(final.draw)).data.subarray(162, 164)],
        [2, 22],
      );
    },
  );
  await check("draw risk reconciliation is idempotent", async () => {
    const before = await vaultReserved();
    await send(reconcileIx(final));
    assert.equal(await vaultReserved(), before);
  });
  await check(
    "old v2 winning claim retains snapshot payout alongside pooled liabilities",
    async () => {
      const before = await vaultReserved();
      const recipient = await balance(owner.publicKey);
      const riskBefore = await riskState(final);
      await send(
        settleIx(final, final.legacyTickets[0], owner.publicKey, true),
      );
      assert.equal(await vaultReserved(), before - prize);
      assert.equal(await balance(owner.publicKey), recipient + prize);
      assert.deepEqual(await riskState(final), riskBefore);
    },
  );
  await rejects(
    "old v2 winning claim is also once-only",
    settleIx(final, final.legacyTickets[0], owner.publicKey, true),
    /AlreadySettled/,
  );
  await check("old v2 loser release preserves all pooled backing", async () => {
    const before = await vaultReserved();
    const treasury = await balance(vault);
    const riskBefore = await riskState(final);
    await send(releaseIx(final, final.legacyTickets[1], true));
    assert.equal(await vaultReserved(), before - prize);
    assert.equal(await balance(vault), treasury);
    assert.deepEqual(await riskState(final), riskBefore);
  });
  await rejects(
    "winning ticket cannot be discarded as a loss",
    releaseIx(final, final.tickets[0]),
    /WinningTicketCannotRelease/,
  );
  await check(
    "loser cleanup marks ticket settled without a second reserve release",
    async () => {
      const before = await vaultReserved();
      const treasury = await balance(vault);
      await send(releaseIx(final, final.tickets[1]));
      assert.equal(await vaultReserved(), before);
      assert.equal(await balance(vault), treasury);
      assert.equal((await account(final.tickets[1].address)).data[64], 1);
    },
  );
  await rejects(
    "losing ticket cleanup cannot be replayed",
    releaseIx(final, final.tickets[1]),
    /AlreadySettled/,
  );
  await check(
    "winning claim pays immutable owner exactly once while preserving other draws",
    async () => {
      const before = await vaultReserved();
      const recipient = await balance(owner.publicKey);
      await send(settleIx(final, final.tickets[0]));
      assert.equal(await vaultReserved(), before - prize);
      assert.equal(await balance(owner.publicKey), recipient + prize);
      assert.equal((await riskState(final)).reserved, 0n);
    },
  );
  await rejects(
    "finalized winning claim cannot drain with a replay",
    settleIx(final, final.tickets[0]),
    /AlreadySettled/,
  );
  await check(
    "no-win finalized draw releases all pooled backing in one reconciliation",
    async () => {
      const before = await vaultReserved();
      await send([finalIx(noWin), reconcileIx(noWin)]);
      assert.equal(await vaultReserved(), before - noWin.reserved);
      assert.equal((await riskState(noWin)).reserved, 0n);
    },
  );
  await snapshot();
  const late = Buffer.from(pending.oracleData.subarray(0, 137));
  late[8] = 1;
  late.writeUInt16LE(rank([2, 22]), 73);
  seedAccount(pending.request, oracle, late);
  await stop();
  await start("late-fulfilled-after-real-refund");
  await rejects(
    "late fulfilled proof prevents refund of remaining accepted ticket",
    refundIx(pending, pending.tickets[1]),
    /RefundNotAvailable/,
  );
  await check(
    "late proof finalizes after partial refund and preserves remaining winner",
    async () => {
      const before = await vaultReserved();
      await send([finalIx(pending), reconcileIx(pending)]);
      assert.equal(await vaultReserved(), before - cost);
      assert.equal((await riskState(pending)).reserved, prize);
    },
  );
  await rejects(
    "refunded eventual winner cannot claim its prize",
    settleIx(pending, pending.tickets[0]),
    /AlreadySettled/,
  );
  await check(
    "remaining non-refunded winner receives its full snapshot prize",
    async () => {
      const before = await balance(owner.publicKey);
      await send(settleIx(pending, pending.tickets[1]));
      assert.equal(await balance(owner.publicKey), before + prize);
      assert.equal((await riskState(pending)).reserved, 0n);
    },
  );
  await rejects(
    "late winner settlement remains once-only",
    settleIx(pending, pending.tickets[1]),
    /AlreadySettled/,
  );
  await check(
    "late losing release cannot alter unrelated live liabilities",
    async () => {
      const before = await vaultReserved();
      await send(releaseIx(pending, pending.tickets[2]));
      assert.equal(await vaultReserved(), before);
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
  await stop();
  const report = {
    timestamp: new Date().toISOString(),
    program: program.toBase58(),
    endpoint: useSvm ? null : "http://127.0.0.1:18899",
    syntheticGenesisOnly: true,
    publicOracleExecution: false,
    backend: useSvm ? "litesvm-1.6.2" : "solana-test-validator",
    elf,
    elfSha256: hash(readFileSync(elf)).toString("hex"),
    passed: results.length,
    failed: failure ? String(failure) : null,
    failureStack: failure?.stack ?? null,
    results,
    execution,
  };
  bpfReport = report;
  const path = resolve(scratch, "report.json");
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`BPF report: ${path}`);
}

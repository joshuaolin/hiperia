import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import BN from "bn.js";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import idl from "../src/idl/hiperia_vrf.json" with { type: "json" };
import { UAT_ADMIN } from "../src/lib/onchain/DodosClient.js";
import { DEVNET_GENESIS_HASH } from "../src/lib/network.js";
import { getTicketPda } from "../src/lib/onchain/pdas.js";
import {
  getUpcomingDrawTimes,
  getUatDrawTime,
} from "../src/lib/onchain/time.js";

const pause = (delay) => new Promise((resolve) => setTimeout(resolve, delay));
const report = {
  noTransactionsSent: true,
  signatureVerification: false,
  checks: [],
};
const allowed = new Set([
  "getGenesisHash",
  "getAccountInfo",
  "getMultipleAccounts",
  "getMinimumBalanceForRentExemption",
  "simulateTransaction",
]);
let queue = Promise.resolve();
let lastRequest = 0;
const connection = new Connection("https://api.devnet.solana.com", {
  commitment: "confirmed",
  disableRetryOnRateLimit: true,
  fetch(input, init) {
    const request = JSON.parse(init.body);
    assert.ok(allowed.has(request.method), `Forbidden RPC: ${request.method}`);
    const result = queue.then(async () => {
      await pause(Math.max(0, 650 - (Date.now() - lastRequest)));
      lastRequest = Date.now();
      return fetch(input, init);
    });
    queue = result.catch(() => {});
    return result;
  },
});
const admin = new PublicKey(UAT_ADMIN);
const outsider = process.env.HIPERIA_PUBLIC_TEST_WALLET
  ? new PublicKey(process.env.HIPERIA_PUBLIC_TEST_WALLET)
  : Keypair.generate().publicKey;
const program = new Program(
  idl,
  new AnchorProvider(connection, { publicKey: admin }, {}),
);
const client = {
  configAddress: PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId,
  )[0],
  vaultAddress: PublicKey.findProgramAddressSync(
    [Buffer.from("vault")],
    program.programId,
  )[0],
};
const drawAddress = (time) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("draw"), new BN(time).toArrayLike(Buffer, "le", 8)],
    program.programId,
  )[0];
const nonce = () => randomBytes(8).readBigUInt64LE().toString();
const save = () => {
  mkdirSync(".local", { recursive: true });
  writeFileSync(
    ".local/public-access-simulations.json",
    JSON.stringify(report, null, 2) + "\n",
  );
};
async function simulate(
  label,
  instructions,
  addresses = [],
  expectedCode = null,
) {
  const transaction = new VersionedTransaction(
    new TransactionMessage({
      payerKey: admin,
      recentBlockhash: SystemProgram.programId.toBase58(),
      instructions,
    }).compileToV0Message(),
  );
  assert.ok(transaction.serialize().length <= 1232);
  const { value } = await connection.simulateTransaction(transaction, {
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: "confirmed",
    accounts: {
      encoding: "base64",
      addresses: addresses.map((address) => address.toBase58()),
    },
  });
  const check = {
    label,
    error: value.err,
    expectedCode,
    unitsConsumed: value.unitsConsumed,
  };
  report.checks.push(check);
  save();
  if (expectedCode === null)
    assert.equal(value.err, null, JSON.stringify(value));
  else
    assert.equal(
      value.err?.InstructionError?.[1]?.Custom,
      expectedCode,
      JSON.stringify(value),
    );
  console.log(JSON.stringify(check));
  return value;
}
const decode = (name, account) =>
  program.coder.accounts.decode(name, Buffer.from(account.data[0], "base64"));
const fundOutsider = () =>
  SystemProgram.transfer({
    fromPubkey: admin,
    toPubkey: outsider,
    lamports: 50_000_000,
  });
async function metadata(method, type, length) {
  const instruction = await program.methods[method]()
    .accountsStrict({ config: client.configAddress })
    .instruction();
  assert.ok(instruction.keys.every((key) => !key.isSigner && !key.isWritable));
  const value = await simulate(`readonly ${method}`, [instruction]);
  assert.equal(value.returnData.programId, program.programId.toBase58());
  const data = Buffer.from(value.returnData.data[0], "base64");
  assert.equal(data.length, length);
  return program.coder.types.decode(type, data);
}
function buy(drawTime, id, numbers = [22, 2]) {
  return program.methods
    .buyTicket(new BN(id), new BN(drawTime), numbers)
    .accountsStrict({
      config: client.configAddress,
      vault: client.vaultAddress,
      ticket: getTicketPda(outsider, id, program.programId)[0],
      user: outsider,
      systemProgram: SystemProgram.programId,
      draw: drawAddress(drawTime),
    })
    .instruction();
}
async function main() {
  assert.equal(await connection.getGenesisHash(), DEVNET_GENESIS_HASH);
  const access = await metadata("getAccessRules", "accessRules", 3);
  assert.deepEqual(access, {
    revision: 1,
    publicPlay: true,
    publicResults: true,
  });
  const rules = await metadata("getRules", "uatRules", 56);
  assert.equal(rules.revision, 6);
  assert.deepEqual([...rules.winningNumbers], [0, 0]);
  const randomnessRules = await metadata(
    "getRandomnessRules",
    "randomnessRules",
    39,
  );
  assert.equal(randomnessRules.revision, 1);
  assert.equal(randomnessRules.refundAfterSeconds, 86400);
  assert.equal(randomnessRules.pendingRequestSpace, 749);
  assert.equal(
    randomnessRules.oracleProgram.toBase58(),
    "VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y",
  );
  const [adminInfo, vaultInfo] = await connection.getMultipleAccountsInfo([
    admin,
    client.vaultAddress,
  ]);
  const vault = program.coder.accounts.decode("vault", vaultInfo.data);
  const reservedBefore = Buffer.from(vault.padding).readBigUInt64LE();
  const rent = await connection.getMinimumBalanceForRentExemption(
    vaultInfo.data.length,
  );
  const free = BigInt(vaultInfo.lamports - rent) - reservedBefore;
  const quickPrize = BigInt(rules.quickPayoutLamports.toString());
  const dailyPrize = BigInt(rules.dailyPayoutLamports.toString());
  const simulatedFunding = (needed) => {
    const extra = needed > free ? needed - free : 0n;
    assert.ok(
      BigInt(adminInfo.lamports) > extra + 60_000_000n,
      "The administrator needs temporary simulation-only funding headroom.",
    );
    return extra
      ? [
          SystemProgram.transfer({
            fromPubkey: admin,
            toPubkey: client.vaultAddress,
            lamports: Number(extra),
          }),
        ]
      : [];
  };
  const funding = simulatedFunding(2n * dailyPrize);
  const quick = getUatDrawTime(Date.now(), 3600);
  const daily = getUpcomingDrawTimes()[0];
  const priorDraw = await connection.getAccountInfo(drawAddress(daily));
  const priorCount = priorDraw?.owner.equals(program.programId)
    ? program.coder.accounts
        .decode("draw", priorDraw.data)
        .ticketCount.toNumber()
    : 0;
  const ids = [nonce(), nonce()];
  const ticketAddresses = ids.map(
    (id) => getTicketPda(outsider, id, program.programId)[0],
  );
  const value = await simulate(
    "unlisted wallet buys two entries for the same daily timestamp",
    [
      ...funding,
      fundOutsider(),
      SystemProgram.transfer({
        fromPubkey: admin,
        toPubkey: drawAddress(daily),
        lamports: 1,
      }),
      await buy(daily, ids[0]),
      await buy(daily, ids[1]),
    ],
    [client.vaultAddress, ...ticketAddresses, drawAddress(daily)],
  );
  assert.equal(
    Buffer.from(decode("vault", value.accounts[0]).padding).readBigUInt64LE(),
    reservedBefore + 2n * dailyPrize,
  );
  for (const account of value.accounts.slice(1, 3)) {
    const ticket = decode("ticket", account);
    assert.equal(ticket.drawTime.toNumber(), daily);
    assert.equal(ticket.user.toBase58(), outsider.toBase58());
    assert.equal(
      ticket.paidLamports.toString(),
      rules.dailyTicketCostLamports.toString(),
    );
    assert.equal(Buffer.from(ticket.padding).readBigUInt64LE(1), dailyPrize);
  }
  const storedDraw = decode("draw", value.accounts[3]);
  assert.equal(storedDraw.drawTime.toNumber(), daily);
  assert.equal(storedDraw.ticketCount.toNumber(), priorCount + 2);
  assert.equal(storedDraw.status, 0);
  assert.deepEqual([...storedDraw.numbers], [0, 0]);
  assert.equal(
    storedDraw.ticketCostLamports.toString(),
    rules.dailyTicketCostLamports.toString(),
  );
  assert.equal(
    storedDraw.payoutLamports.toString(),
    rules.dailyPayoutLamports.toString(),
  );
  const fundedFree = free > 2n * dailyPrize ? free : 2n * dailyPrize;
  const dailyNetLiability =
    dailyPrize - BigInt(rules.dailyTicketCostLamports.toString());
  const oversellCount = Number(fundedFree / dailyNetLiability + 1n);
  assert.ok(
    oversellCount <= 6,
    "The vault is too large for the bounded overbooking simulation.",
  );
  const oversellInstructions = [];
  for (let index = 0; index < oversellCount; index += 1)
    oversellInstructions.push(await buy(daily, nonce()));
  await simulate(
    "public daily play still rejects an unbacked prize before accepting payment",
    [...funding, fundOutsider(), ...oversellInstructions],
    [],
    6014,
  );
  const quickId = nonce();
  const quickValue = await simulate(
    "unlisted wallet buys a quick entry",
    [
      ...simulatedFunding(quickPrize),
      fundOutsider(),
      await buy(quick, quickId),
    ],
    [
      client.vaultAddress,
      getTicketPda(outsider, quickId, program.programId)[0],
    ],
  );
  assert.equal(
    Buffer.from(
      decode("vault", quickValue.accounts[0]).padding,
    ).readBigUInt64LE(),
    reservedBefore + quickPrize,
  );
  assert.equal(
    decode("ticket", quickValue.accounts[1]).paidLamports.toString(),
    rules.quickTicketCostLamports.toString(),
  );
  await simulate(
    "unlisted player still cannot buy duplicate picks",
    [fundOutsider(), await buy(quick, nonce(), [2, 2])],
    [],
    6005,
  );
  await simulate(
    "unlisted player still cannot buy a past draw",
    [fundOutsider(), await buy(Math.floor(Date.now() / 1000) - 3600, nonce())],
    [],
    6010,
  );
  const futureDraw = drawAddress(quick);
  const requestNonce = randomBytes(32);
  const seed = createHash("sha256")
    .update(
      Buffer.concat([
        Buffer.from("hiperia-dodos-vrf-v1"),
        program.programId.toBuffer(),
        futureDraw.toBuffer(),
        requestNonce,
      ]),
    )
    .digest();
  const oracle = randomnessRules.oracleProgram;
  const network = PublicKey.findProgramAddressSync(
    [Buffer.from("orao-vrf-network-configuration")],
    oracle,
  )[0];
  const networkInfo = await connection.getAccountInfo(network);
  assert.equal(networkInfo.owner.toBase58(), oracle.toBase58());
  const treasury = new PublicKey(networkInfo.data.subarray(40, 72));
  const oracleRequest = PublicKey.findProgramAddressSync(
    [Buffer.from("orao-vrf-randomness-request"), seed],
    oracle,
  )[0];
  const oracleClient = PublicKey.findProgramAddressSync(
    [Buffer.from("oracle-client"), new BN(quick).toArrayLike(Buffer, "le", 8)],
    program.programId,
  )[0];
  const requestId = nonce();
  await simulate(
    "a public player cannot request VRF while bets are still open",
    [
      ...simulatedFunding(quickPrize),
      fundOutsider(),
      await buy(quick, requestId),
      await program.methods
        .requestDraw(new BN(quick), [...requestNonce], new BN(1_000_000))
        .accountsStrict({
          config: client.configAddress,
          draw: futureDraw,
          oracleClient,
          requester: outsider,
          oracleProgram: oracle,
          networkState: network,
          treasury,
          oracleRequest,
          systemProgram: SystemProgram.programId,
        })
        .instruction(),
    ],
    [],
    6008,
  );
  const refundId = nonce();
  const refundAccounts = {
    config: client.configAddress,
    vault: client.vaultAddress,
    ticket: getTicketPda(outsider, refundId, program.programId)[0],
    draw: futureDraw,
    user: outsider,
    oracleRequest: SystemProgram.programId,
    systemProgram: SystemProgram.programId,
  };
  await simulate(
    "an entry cannot be refunded before the 24-hour oracle timeout",
    [
      ...simulatedFunding(quickPrize),
      fundOutsider(),
      await buy(quick, refundId),
      await program.methods
        .refundTicket()
        .accountsStrict(refundAccounts)
        .instruction(),
    ],
    [],
    6029,
  );
  await simulate(
    "permissionless refunds cannot redirect the immutable owner's entry",
    [
      ...simulatedFunding(quickPrize),
      fundOutsider(),
      await buy(quick, refundId),
      await program.methods
        .refundTicket()
        .accountsStrict({ ...refundAccounts, user: admin })
        .instruction(),
    ],
    [],
    6003,
  );
  const after = await connection.getAccountInfo(client.vaultAddress);
  assert.equal(after.lamports, vaultInfo.lamports);
  assert.ok(after.data.equals(vaultInfo.data));
  report.completedAt = new Date().toISOString();
  report.outsider = outsider.toBase58();
  report.unchangedVault = true;
  save();
  console.log(
    JSON.stringify({
      complete: true,
      noTransactionsSent: true,
      checks: report.checks.length,
    }),
  );
}
main().catch((error) => {
  report.error = error.message;
  save();
  console.error(error.message);
  process.exitCode = 1;
});

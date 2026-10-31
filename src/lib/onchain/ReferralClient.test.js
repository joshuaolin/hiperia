import test from "node:test";
import assert from "node:assert/strict";
import BN from "bn.js";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { DodosClient } from "./DodosClient.js";
import { getReferralPda, getTicketPda } from "./pdas.js";

function fixture() {
  const owner = Keypair.fromSeed(new Uint8Array(32).fill(40));
  const parent = Keypair.fromSeed(new Uint8Array(32).fill(41)).publicKey;
  const connection = new Connection("http://127.0.0.1:8899");
  const client = new DodosClient({
    connection,
    wallet: {
      publicKey: owner.publicKey,
      signTransaction: async (tx) => tx,
      signAllTransactions: async (txs) => txs,
    },
    storage: null,
    now: () => 1_800_000_000_000,
    nonceFactory: () => "7",
  });
  const accounts = new Map();
  const sent = [];
  const state = { metadataReads: 0, ticket: null };
  const account = (key, overrides = {}) => ({
    version: 1,
    bump: getReferralPda(key, client.program.programId)[1],
    owner: key,
    referrer: SystemProgram.programId,
    sharingEnabled: false,
    benefitsEnabled: false,
    bindingLocked: false,
    qualified: false,
    firstTicket: SystemProgram.programId,
    registeredCount: new BN(0),
    qualifiedCount: new BN(0),
    ...overrides,
  });
  const save = (key, overrides) => {
    const value = account(key, overrides);
    accounts.set(
      getReferralPda(key, client.program.programId)[0].toBase58(),
      value,
    );
    return value;
  };
  client.program.account.referralProfile.fetchNullable = async (address) =>
    accounts.get(address.toBase58()) ?? null;
  client.program.account.ticket.fetchNullable = async () => state.ticket;
  client.program.provider.sendAndConfirm = async (
    transaction,
    _signers,
    options,
  ) => {
    transaction.feePayer = owner.publicKey;
    transaction.recentBlockhash = SystemProgram.programId.toBase58();
    transaction.sign(owner);
    assert.ok(transaction.serialize().length <= 1232);
    assert.equal(options.maxRetries, 0);
    sent.push(transaction);
    return `confirmed-${sent.length}`;
  };
  const referralRules = {
    revision: 5,
    campaignVersion: 1,
    normalQuickTicketCostLamports: new BN(7_200_000),
    normalDailyTicketCostLamports: new BN(6_250_000),
    referredQuickTicketCostLamports: new BN(7_100_000),
    referredDailyTicketCostLamports: new BN(6_200_000),
  };
  connection.simulateTransaction = async (transaction, options) => {
    state.metadataReads++;
    state.metadataTransaction = transaction;
    state.metadataOptions = options;
    if (state.failure) throw state.failure;
    if (state.unsupported)
      return {
        value: {
          err: { InstructionError: [0, { Custom: state.unsupported }] },
        },
      };
    const bytes = client.program.coder.types.encode(
      "referralRules",
      referralRules,
    );
    assert.equal(bytes.length, 34);
    return {
      value: {
        err: null,
        returnData: {
          programId: client.program.programId.toBase58(),
          data: [bytes.toString("base64"), "base64"],
        },
      },
    };
  };
  const config = {
    rulesRevision: 4,
    quickTicketCostLamports: referralRules.normalQuickTicketCostLamports,
    dailyTicketCostLamports: referralRules.normalDailyTicketCostLamports,
  };
  const instructionName = (instruction) =>
    client.program.coder.instruction.decode(instruction.data).name;
  return {
    client,
    referrals: client.referrals,
    connection,
    owner,
    parent,
    accounts,
    save,
    sent,
    state,
    config,
    referralRules,
    instructionName,
  };
}

test("referral fees come from verified readonly 34-byte metadata and deduplicate", async () => {
  const { referrals, state, config, client } = fixture();
  const [first, second] = await Promise.all([
    referrals.load(config),
    referrals.load(config),
  ]);
  assert.equal(first.available, true);
  assert.equal(first.profile, null);
  assert.equal(
    first.rules.referredDailyTicketCostLamports.toString(),
    "6200000",
  );
  assert.deepEqual(first, second);
  assert.equal(state.metadataReads, 1);
  assert.equal(state.metadataOptions.sigVerify, false);
  const message = state.metadataTransaction.message;
  const instruction = message.compiledInstructions[0];
  assert.equal(instruction.accountKeyIndexes.length, 1);
  assert.equal(
    client.program.coder.instruction.decode(Buffer.from(instruction.data)).name,
    "getReferralRules",
  );
  assert.ok(
    state.metadataTransaction.signatures.every((signature) =>
      signature.every((byte) => byte === 0),
    ),
  );
  assert.equal((await referrals.load({ rulesRevision: 3 })).available, false);
});

test("invalid referral prices and metadata failures never enable a discount", async () => {
  for (const change of [
    { revision: 6 },
    { campaignVersion: 2 },
    { referredDailyTicketCostLamports: new BN(0) },
    { referredQuickTicketCostLamports: new BN(7_200_000) },
    { normalQuickTicketCostLamports: new BN("9007199254740992") },
  ]) {
    const { referrals, config, referralRules } = fixture();
    Object.assign(referralRules, change);
    await assert.rejects(referrals.load(config), /rules could not be verified/);
  }
  const { referrals, config, state } = fixture();
  state.failure = Error("429 Too many requests");
  await assert.rejects(referrals.load(config), /429/);
  state.failure = null;
  await referrals.load(config);
  assert.equal(state.metadataReads, 2);
  await assert.rejects(
    referrals.load({ ...config, dailyTicketCostLamports: new BN(1) }),
    /do not match/,
  );
});

test("sharing code is null until opted in; counters preserve full u64 precision", async () => {
  const { referrals, owner, save } = fixture();
  const account = save(owner.publicKey, {
    registeredCount: new BN("18446744073709551615"),
  });
  assert.equal((await referrals.getProfile()).code, null);
  assert.equal(
    (await referrals.getProfile()).registeredCount,
    "18446744073709551615",
  );
  account.sharingEnabled = true;
  assert.equal((await referrals.getProfile()).code, owner.publicKey.toBase58());
  account.owner = SystemProgram.programId;
  await assert.rejects(referrals.getProfile(), /could not be verified/);
});

test("first referral binding is one approved transaction and never uses self or inactive codes", async () => {
  const { referrals, owner, parent, save, sent, instructionName } = fixture();
  await assert.rejects(referrals.bind(owner.publicKey), /own referral/);
  await assert.rejects(referrals.bind(parent), /not accepting/);
  save(parent, { sharingEnabled: true });
  await referrals.bind(parent);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].instructions.map(instructionName), [
    "registerReferral",
    "updateReferral",
  ]);
  assert.equal(
    sent[0].instructions[1].keys[2].pubkey.toBase58(),
    getReferralPda(parent)[0].toBase58(),
  );
});

test("locked attribution survives opt-out and cannot be replaced or cleared", async () => {
  const { referrals, owner, parent, save, sent, instructionName } = fixture();
  const firstTicket = getTicketPda(owner.publicKey, "7")[0];
  save(owner.publicKey, {
    referrer: parent,
    benefitsEnabled: true,
    bindingLocked: true,
    firstTicket,
  });
  await assert.rejects(
    referrals.update({ referrer: null, benefitsEnabled: false }),
    /permanent/,
  );
  await assert.rejects(
    referrals.bind(Keypair.fromSeed(new Uint8Array(32).fill(42)).publicKey),
    /permanent/,
  );
  await referrals.removeBenefits();
  const instruction = sent[0].instructions[0];
  assert.equal(instructionName(instruction), "updateReferral");
  const decoded = referrals.program.coder.instruction.decode(instruction.data);
  assert.equal(decoded.data.referrer.toBase58(), parent.toBase58());
  assert.equal(decoded.data.benefitsEnabled, false);
  assert.equal(sent.length, 1);
});

test("base revision four discovers referral metadata and registers a null profile atomically", async () => {
  const { client, owner, parent, save, sent, config, instructionName } =
    fixture();
  await client.buyTicket([2, 22], { config, drawTime: 1_800_000_060 });
  assert.deepEqual(sent[0].instructions.map(instructionName), [
    "registerReferral",
    "buyTicketReferred",
  ]);
  const none = sent[0].instructions[1].keys[6];
  assert.ok(none.pubkey.equals(client.program.programId));
  save(owner.publicKey, { referrer: parent, benefitsEnabled: true });
  await client.buyTicket([22, 2], {
    config,
    nonce: "8",
    drawTime: 1_800_000_060,
  });
  assert.deepEqual(sent[1].instructions.map(instructionName), [
    "buyTicketReferred",
  ]);
  assert.equal(
    sent[1].instructions[0].keys[6].pubkey.toBase58(),
    getReferralPda(parent)[0].toBase58(),
  );
});

test("legacy revision four without the new instruction keeps ordinary purchases working", async () => {
  const { referrals, client, config, state, sent } = fixture();
  state.unsupported = 101;
  assert.equal((await referrals.load(config)).available, false);
  let legacyPurchases = 0;
  client.program.methods.buyTicket = () => ({
    accountsStrict: () => ({
      rpc: async () => {
        legacyPurchases++;
        return "legacy-signature";
      },
    }),
  });
  client.program.account.referralProfile.fetchNullable = async () => {
    throw Error("A legacy program must not need referral profiles");
  };
  const receipt = await client.buyTicket([2, 22], {
    config,
    referral: { available: true },
    drawTime: 1_800_000_060,
  });
  assert.equal(receipt.signature, "legacy-signature");
  assert.equal(legacyPurchases, 1);
  assert.equal(sent.length, 0);
  assert.equal(state.metadataReads, 1);
});

test("a referral metadata RPC failure blocks an unverified purchase instead of fabricating a price", async () => {
  const { referrals, client, config, state, sent } = fixture();
  state.failure = Error("429 Too many requests");
  await assert.rejects(referrals.load(config), /429/);
  await assert.rejects(
    client.buyTicket([2, 22], {
      config,
      referral: { available: true, rules: {} },
      drawTime: 1_800_000_060,
    }),
    /429/,
  );
  assert.equal(sent.length, 0);
  assert.equal(client.getPendingPurchase(), null);
});

test("unrelated instruction failures are not treated as legacy referral absence", async () => {
  const { referrals, config, state } = fixture();
  state.unsupported = 102;
  await assert.rejects(referrals.load(config), /rules could not be verified/);
});

test("future base revision five remains compatible with verified referral metadata", async () => {
  const { referrals, config } = fixture();
  assert.equal(
    (await referrals.load({ ...config, rulesRevision: 5 })).available,
    true,
  );
});

test("qualification follows the actual first settled ticket and is an explicit transaction", async () => {
  const {
    referrals,
    owner,
    parent,
    save,
    state,
    sent,
    config,
    instructionName,
  } = fixture();
  const firstTicket = getTicketPda(owner.publicKey, "7")[0];
  const profile = save(owner.publicKey, {
    referrer: parent,
    bindingLocked: true,
    firstTicket,
  });
  await assert.rejects(referrals.qualify(), /Settle the first/);
  assert.equal(sent.length, 0);
  state.ticket = {
    settled: true,
    user: owner.publicKey,
    paidLamports: new BN(6_200_000),
    padding: [2],
  };
  assert.equal((await referrals.load(config)).profile.canQualify, true);
  assert.equal(sent.length, 0);
  await referrals.qualify();
  assert.deepEqual(sent[0].instructions.map(instructionName), [
    "qualifyReferral",
  ]);
  assert.equal(
    sent[0].instructions[0].keys[1].pubkey.toBase58(),
    firstTicket.toBase58(),
  );
  profile.qualified = true;
  assert.equal(await referrals.qualify(), null);
  assert.equal(sent.length, 1);
});

test("a bound player keeps the discount when the inviter stops sharing", async () => {
  const { referrals, owner, parent, save, config } = fixture();
  save(parent, { sharingEnabled: false });
  save(owner.publicKey, { referrer: parent, benefitsEnabled: true });
  assert.equal((await referrals.load(config)).discountEligible, true);
  await referrals.update({ sharingEnabled: true });
});

test("a landed v5 atomic purchase is recovered after timeout without resubmitting", async () => {
  const { client, owner, state, config } = fixture();
  let submissions = 0;
  client.program.provider.sendAndConfirm = async () => {
    submissions++;
    state.ticket = {
      user: owner.publicKey,
      numbers: [2, 22],
      drawTime: new BN(1_800_000_060),
      settled: false,
    };
    throw Error("Confirmation timed out");
  };
  const receipt = await client.buyTicket([2, 22], {
    config,
    drawTime: 1_800_000_060,
  });
  assert.equal(receipt.recovered, true);
  assert.equal(client.getPendingPurchase(), null);
  assert.equal(submissions, 1);
});

test("v5 purchase identities survive an unknown send outcome and no retry is automatic", async () => {
  const { client, config } = fixture();
  let submissions = 0;
  client.program.provider.sendAndConfirm = async () => {
    submissions++;
    throw Error("RPC unavailable");
  };
  await assert.rejects(
    client.buyTicket([2, 22], { config, drawTime: 1_800_000_060 }),
    /same purchase ID/,
  );
  assert.equal(client.getPendingPurchase().id, "7");
  assert.equal(submissions, 1);
});

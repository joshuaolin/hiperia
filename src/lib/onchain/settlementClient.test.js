import test from "node:test";
import assert from "node:assert/strict";
import BN from "bn.js";
import { Connection, Keypair, SystemProgram } from "@solana/web3.js";
import { DodosClient } from "./DodosClient.js";
import { getTicketPda, getResultPda, getReferralPda } from "./pdas.js";

function fixture() {
  const owner = Keypair.fromSeed(new Uint8Array(32).fill(9));
  const now = 1_800_000_000;
  const client = new DodosClient({
    connection: new Connection("http://127.0.0.1:8899"),
    wallet: {
      publicKey: owner.publicKey,
      signTransaction: async (tx) => tx,
      signAllTransactions: async (txs) => txs,
    },
    now: () => now * 1000,
  });
  const ticket = (id, overrides = {}) => ({
    id: String(id),
    address: getTicketPda(
      owner.publicKey,
      String(id),
      client.program.programId,
    )[0].toBase58(),
    user: owner.publicKey.toBase58(),
    numbers: [2, 22],
    drawTime: now - id,
    settled: false,
    result: { isPublished: true, numbers: [2, 22] },
    ...overrides,
  });
  const sent = [];
  client.program.account.referralProfile.fetchNullable = async () => null;
  let reads = 0;
  client.program.account.ticket.fetchMultiple = async (addresses) => {
    reads++;
    return addresses.map((address) => {
      const entry = client.testTickets.find(
        (entry) => entry.address === address.toBase58(),
      );
      return entry
        ? {
            user: owner.publicKey,
            nonce: new BN(entry.id),
            drawTime: new BN(entry.drawTime),
            settled: entry.settled,
          }
        : null;
    });
  };
  client.program.provider.sendAndConfirm = async (transaction) => {
    transaction.feePayer = owner.publicKey;
    transaction.recentBlockhash = SystemProgram.programId.toBase58();
    transaction.sign(owner);
    assert.ok(transaction.serialize().length <= 1232);
    assert.equal(transaction.compileMessage().header.numRequiredSignatures, 1);
    sent.push(transaction);
    return `confirmed-${sent.length}`;
  };
  client.getTickets = async () => client.testTickets;
  return { client, owner, ticket, sent, reads: () => reads };
}

test("Claim all uses fresh chain wins and real Anchor instructions within wire limits", async () => {
  const { client, owner, ticket, sent, reads } = fixture();
  client.testTickets = [
    ...Array.from({ length: 7 }, (_, index) => ticket(index + 1)),
    ticket(8, { settled: true }),
    ticket(9, { numbers: [22, 2] }),
    ticket(10, { result: null }),
    ticket(11, { drawTime: 1_800_000_100 }),
    ticket(12, {
      numbers: [1, 22],
      result: { isPublished: true, numbers: [1, 22] },
    }),
  ];
  const result = await client.claimAll();
  assert.equal(result.settled, 8);
  assert.deepEqual(
    sent.map((transaction) => transaction.instructions.length),
    [6, 2],
  );
  assert.equal(reads(), 2);
  for (const transaction of sent) {
    for (const instruction of transaction.instructions) {
      assert.equal(
        instruction.keys[4].pubkey.toBase58(),
        owner.publicKey.toBase58(),
      );
      assert.equal(instruction.keys[4].isSigner, false);
    }
  }
  const first = sent[0].instructions[0];
  assert.ok(
    first.keys[2].pubkey.equals(
      getTicketPda(owner.publicKey, "1", client.program.programId)[0],
    ),
  );
  assert.ok(
    first.keys[3].pubkey.equals(
      getResultPda(client.testTickets[0].drawTime, client.program.programId)[0],
    ),
  );
});

test("Claim all skips tickets settled after the initial read", async () => {
  const { client, ticket, sent } = fixture();
  client.testTickets = [ticket(1)];
  client.program.account.ticket.fetchMultiple = async () => [{ settled: true }];
  assert.equal((await client.claimAll()).settled, 0);
  assert.equal(sent.length, 0);
});

test("recording on revision three never attempts permissionless cleanup", async () => {
  const { client } = fixture();
  client.publishResult = async () => "published";
  client.getConfig = async () => ({ permissionlessSettlement: false });
  client.program.account.ticket.all = async () => {
    throw new Error("No scan should occur");
  };
  assert.deepEqual(await client.recordDraw(100), {
    signature: "published",
    settled: 0,
  });
});

test("revision four cleanup targets only that draw's unsettled losses and original owners", async () => {
  const { client, owner } = fixture();
  const other = Keypair.fromSeed(new Uint8Array(32).fill(22)).publicKey;
  client.publishResult = async () => null;
  client.getConfig = async () => ({ permissionlessSettlement: true });
  client.getResult = async () => ({ isPublished: true, numbers: [2, 22] });
  client.program.account.ticket.all = async () => [
    {
      publicKey: getTicketPda(other, "1", client.program.programId)[0],
      account: {
        user: other,
        nonce: new BN(1),
        drawTime: new BN(100),
        numbers: [22, 2],
        settled: false,
      },
    },
    {
      publicKey: owner.publicKey,
      account: {
        user: owner.publicKey,
        nonce: new BN(2),
        drawTime: new BN(100),
        numbers: [2, 22],
        settled: false,
      },
    },
    {
      publicKey: owner.publicKey,
      account: {
        user: owner.publicKey,
        nonce: new BN(3),
        drawTime: new BN(101),
        numbers: [3, 4],
        settled: false,
      },
    },
    {
      publicKey: owner.publicKey,
      account: {
        user: owner.publicKey,
        nonce: new BN(4),
        drawTime: new BN(100),
        numbers: [3, 4],
        settled: true,
      },
    },
  ];
  client.settleBatch = async (entries) => {
    assert.equal(entries.length, 1);
    assert.equal(entries[0].user, other.toBase58());
    assert.equal(entries[0].id, "1");
    return { settled: 1, signatures: ["cleanup"] };
  };
  assert.equal((await client.recordDraw(100)).settled, 1);
});

test("claiming the first referred ticket records qualification in the same signed packet", async () => {
  const { client, owner, ticket, sent } = fixture();
  const first = ticket(1);
  const parent = Keypair.fromSeed(new Uint8Array(32).fill(71)).publicKey;
  client.testTickets = [first, ticket(2), ticket(3), ticket(4)];
  client.program.account.referralProfile.fetchNullable = async () => ({
    version: 1,
    bump: getReferralPda(owner.publicKey)[1],
    owner: owner.publicKey,
    referrer: parent,
    firstTicket: getTicketPda(owner.publicKey, "1")[0],
    sharingEnabled: false,
    benefitsEnabled: true,
    bindingLocked: true,
    qualified: false,
    registeredCount: new BN(0),
    qualifiedCount: new BN(0),
  });
  const result = await client.claimAll();
  assert.equal(result.settled, 4);
  assert.deepEqual(
    sent.map((tx) => tx.instructions.length),
    [4, 1],
  );
  const names = sent[0].instructions.map(
    (ix) => client.program.coder.instruction.decode(ix.data).name,
  );
  assert.deepEqual(names, [
    "settleTicket",
    "qualifyReferral",
    "settleTicket",
    "settleTicket",
  ]);
  assert.equal(
    sent[0].instructions[1].keys[1].pubkey.toBase58(),
    first.address,
  );
  assert.equal(
    sent[0].instructions[1].keys[2].pubkey.toBase58(),
    getReferralPda(parent)[0].toBase58(),
  );
});

test("a referral read failure cannot prevent an otherwise valid winning claim", async () => {
  const { client, ticket, sent } = fixture();
  client.testTickets = [ticket(1)];
  client.program.account.referralProfile.fetchNullable = async () => {
    throw Error("429 Too many requests");
  };
  assert.equal((await client.claimAll()).settled, 1);
  assert.equal(sent[0].instructions.length, 1);
  const name = client.program.coder.instruction.decode(
    sent[0].instructions[0].data,
  ).name;
  assert.equal(name, "settleTicket");
});

test("qualification is omitted for unrelated tickets and already qualified profiles", async () => {
  const { client, owner, ticket, sent } = fixture();
  const profile = {
    address: getReferralPda(owner.publicKey)[0].toBase58(),
    owner: owner.publicKey.toBase58(),
    referrer: Keypair.fromSeed(
      new Uint8Array(32).fill(72),
    ).publicKey.toBase58(),
    firstTicket: ticket(9).address,
    bindingLocked: true,
    qualified: false,
  };
  client.referrals.getProfile = async () => profile;
  client.testTickets = [ticket(1)];
  await client.claimAll();
  assert.equal(sent[0].instructions.length, 1);
  profile.firstTicket = ticket(1).address;
  profile.qualified = true;
  await client.claimAll();
  assert.equal(sent[1].instructions.length, 1);
});

test("single claims place qualification after settlement in the same transaction", async () => {
  const { client, owner, ticket, sent } = fixture();
  const first = ticket(1);
  client.referrals.getProfile = async () => ({
    address: getReferralPda(owner.publicKey)[0].toBase58(),
    owner: owner.publicKey.toBase58(),
    referrer: Keypair.fromSeed(
      new Uint8Array(32).fill(73),
    ).publicKey.toBase58(),
    firstTicket: first.address,
    bindingLocked: true,
    qualified: false,
  });
  assert.equal(await client.settleTicket(first), "confirmed-1");
  assert.deepEqual(
    sent[0].instructions.map(
      (ix) => client.program.coder.instruction.decode(ix.data).name,
    ),
    ["settleTicket", "qualifyReferral"],
  );
});

test("three distinct first-ticket qualifications stay under instruction and packet limits", async () => {
  const { client, ticket, sent } = fixture();
  const parent = Keypair.fromSeed(new Uint8Array(32).fill(74)).publicKey;
  const profiles = new Map();
  const entries = Array.from({ length: 4 }, (_, index) => {
    const user = Keypair.fromSeed(
      new Uint8Array(32).fill(80 + index),
    ).publicKey;
    const address = getTicketPda(user, String(index + 1))[0].toBase58();
    const entry = ticket(index + 1, { address, user: user.toBase58() });
    profiles.set(user.toBase58(), {
      address: getReferralPda(user)[0].toBase58(),
      owner: user.toBase58(),
      referrer: parent.toBase58(),
      firstTicket: address,
      bindingLocked: true,
      qualified: false,
    });
    return entry;
  });
  client.referrals.getProfile = async (owner) => profiles.get(owner.toBase58());
  client.program.account.ticket.fetchMultiple = async (addresses) =>
    addresses.map((address) => {
      const entry = entries.find(
        (ticket) => ticket.address === address.toBase58(),
      );
      return {
        user: new client.wallet.publicKey.constructor(entry.user),
        nonce: new BN(entry.id),
        drawTime: new BN(entry.drawTime),
        settled: false,
      };
    });
  assert.equal((await client.settleBatch(entries)).settled, 4);
  assert.deepEqual(
    sent.map((tx) => tx.instructions.length),
    [6, 2],
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  Keypair,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { sendSettlementBatches } from "./settlements.js";

const payer = Keypair.fromSeed(new Uint8Array(32).fill(8));
const tickets = Array.from({ length: 15 }, (_, index) => ({
  address: Keypair.fromSeed(
    new Uint8Array(32).fill(index + 20),
  ).publicKey.toBase58(),
  id: String(index),
}));
function fixture() {
  const batches = [];
  return {
    batches,
    options: {
      tickets,
      instructionFor: async (ticket) =>
        new TransactionInstruction({
          programId: SystemProgram.programId,
          keys: [
            {
              pubkey: new payer.publicKey.constructor(ticket.address),
              isWritable: true,
              isSigner: false,
            },
          ],
          data: Buffer.alloc(8),
        }),
      send: async (transaction) => {
        transaction.feePayer = payer.publicKey;
        transaction.recentBlockhash = SystemProgram.programId.toBase58();
        transaction.sign(payer);
        assert.ok(transaction.serialize().length <= 1232);
        batches.push(transaction.instructions.length);
        return `signature-${batches.length}`;
      },
    },
  };
}

test("claim all splits tickets into bounded transactions and skips duplicates", async () => {
  const { options, batches } = fixture();
  options.tickets = [...tickets, tickets[0]];
  const result = await sendSettlementBatches(options);
  assert.equal(result.settled, 15);
  assert.deepEqual(batches, [6, 6, 3]);
  assert.equal(result.signatures.length, 3);
});

test("claim all rechecks chain state and never sends empty batches", async () => {
  const { options, batches } = fixture();
  options.pendingTickets = async (batch) =>
    batch.filter((ticket) => Number(ticket.id) % 2);
  assert.equal((await sendSettlementBatches(options)).settled, 7);
  assert.deepEqual(batches, [3, 3, 1]);
  options.tickets = [];
  assert.equal((await sendSettlementBatches(options)).settled, 0);
});

test("an uncertain batch stops later sends and reports confirmed progress", async () => {
  const { options, batches } = fixture();
  const send = options.send;
  let attempts = 0;
  options.send = async (transaction) => {
    if (++attempts === 2) throw new Error("Confirmation interrupted");
    return send(transaction);
  };
  await assert.rejects(
    sendSettlementBatches(options),
    /6 tickets were processed.*Refresh.*No replacement/s,
  );
  assert.equal(attempts, 2);
  assert.deepEqual(batches, [6]);
});

test("changing wallets before signing stops settlement", async () => {
  const { options, batches } = fixture();
  options.assertActive = () => {
    throw new Error("Wallet changed");
  };
  await assert.rejects(sendSettlementBatches(options), /Wallet changed/);
  assert.deepEqual(batches, []);
});

test("confirmed progress survives later funding reads, instruction builds and wallet changes", async () => {
  for (const stage of ["read", "instruction", "wallet"]) {
    const { options, batches } = fixture();
    options.batchSize = 1;
    const instructionFor = options.instructionFor;
    options.pendingTickets = async (batch) => {
      if (stage === "read" && batches.length === 1) throw new Error("Funding RPC unavailable");
      return batch;
    };
    options.instructionFor = async (ticket) => {
      if (stage === "instruction" && batches.length === 1) throw new Error("Account read failed");
      return instructionFor(ticket);
    };
    options.assertActive = () => {
      if (stage === "wallet" && batches.length === 1) throw new Error("Wallet changed");
    };
    await assert.rejects(sendSettlementBatches(options), (failure) => {
      assert.equal(failure.confirmedSettlements, 1);
      assert.deepEqual(failure.confirmedSignatures, ["signature-1"]);
      return true;
    });
    assert.deepEqual(batches, [1]);
  }
});

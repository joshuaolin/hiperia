import test from "node:test";
import assert from "node:assert/strict";
import BN from "bn.js";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import { DodosClient, UAT_ADMIN } from "./DodosClient.js";
import { PROGRAM_ID } from "./idl.js";
import { getTicketPda, getResultPda, u64LeBytes, i64LeBytes } from "./pdas.js";
import { getNextDrawTime } from "./time.js";

const NOW = Date.parse("2026-10-27T05:00:00Z");
const NONCE = "18446744073709551615";

function fixture({ storage = null, publicKey = SystemProgram.programId } = {}) {
  const calls = {};
  const wallet = {
    publicKey,
    signTransaction: async (tx) => tx,
    signAllTransactions: async (txs) => txs,
  };
  const program = {
    programId: new PublicKey(PROGRAM_ID),
    account: {
      config: { fetchNullable: async () => calls.config ?? null },
      ticket: {
        all: async () => calls.ticketEntries ?? [],
        fetchNullable: async () => {
          if (calls.ticketReadFailure) throw calls.ticketReadFailure;
          return calls.savedTicket ?? null;
        },
      },
      resultAccount: {
        all: async () => calls.resultEntries ?? [],
        fetchMultiple: async (addresses) => {
          calls.resultBatches ??= [];
          calls.resultBatches.push(addresses);
          return addresses.map(
            (address) => calls.results?.get(address.toBase58()) ?? null,
          );
        },
        fetchNullable: async (address) => {
          calls.resultAddress = address;
          return calls.result ?? null;
        },
      },
    },
    methods: {
      configureUat(tester) {
        calls.tester = tester;
        return {
          accountsStrict: (accounts) => {
            calls.configureAccounts = accounts;
            return { rpc: async () => "configure-signature" };
          },
        };
      },
      buyTicket(nonce, drawTime, numbers) {
        calls.arguments = { nonce, drawTime, numbers };
        return {
          accountsStrict: (accounts) => {
            calls.accounts = accounts;
            return {
              rpc: async () => {
                calls.submissions = (calls.submissions ?? 0) + 1;
                if (calls.landPurchase)
                  calls.savedTicket = {
                    user: wallet.publicKey,
                    numbers: [...numbers],
                    drawTime,
                    settled: false,
                  };
                if (calls.purchaseFailure) throw calls.purchaseFailure;
                return "signature";
              },
            };
          },
        };
      },
      publishResult(drawTime) {
        calls.publishTime = drawTime.toString();
        return {
          accountsStrict: (accounts) => {
            calls.publishAccounts = accounts;
            return { rpc: async () => "publish-signature" };
          },
        };
      },
      settleTicket() {
        return {
          accountsStrict: (accounts) => {
            calls.settleAccounts = accounts;
            return { rpc: async () => "settle-signature" };
          },
        };
      },
    },
  };
  return {
    calls,
    wallet,
    program,
    client: new DodosClient({
      program,
      wallet,
      now: () => NOW,
      nonceFactory: () => NONCE,
      storage,
    }),
  };
}

test("real Anchor 0.31 client accepts this IDL and exposes the result account", () => {
  const client = new DodosClient({
    connection: new Connection("http://127.0.0.1:8899"),
  });
  assert.equal(client.program.programId.toBase58(), PROGRAM_ID);
  assert.ok(client.program.account.resultAccount);
  assert.equal(typeof client.program.methods.buyTicket, "function");
  assert.equal(typeof client.program.methods.configureUat, "function");
});

test("fixed UAT mode is advertised only after the on-chain tester is configured", async () => {
  const { client, calls } = fixture();
  assert.equal(await client.getConfig(), null);
  calls.config = { padding: Array(32).fill(0) };
  assert.equal((await client.getConfig()).uatEnabled, false);
  const tester = new PublicKey("Ghxn7ree6MFQxC8hFTJ8Lo319xEZzqVFLcmDLKVFpPaa");
  calls.config.padding = Array.from(tester.toBytes());
  const config = await client.getConfig();
  assert.equal(config.uatEnabled, true);
  assert.equal(config.uatTester, tester.toBase58());
  assert.equal(config.uatAdmin, UAT_ADMIN);
});

test("only the UAT administrator can request a tester change", async () => {
  const tester = "Ghxn7ree6MFQxC8hFTJ8Lo319xEZzqVFLcmDLKVFpPaa";
  const unauthorized = fixture();
  await assert.rejects(
    unauthorized.client.configureUat(tester),
    /administrator/,
  );
  assert.equal(unauthorized.calls.configureAccounts, undefined);
  const { client, calls } = fixture({ publicKey: new PublicKey(UAT_ADMIN) });
  await assert.rejects(
    client.configureUat(SystemProgram.programId),
    /valid UAT/,
  );
  assert.equal(await client.configureUat(tester), "configure-signature");
  assert.equal(calls.tester.toBase58(), tester);
  assert.equal(calls.configureAccounts.admin.toBase58(), UAT_ADMIN);
});

test("ticket history retains verifiable addresses and batches shared draw outcomes", async () => {
  const { client, calls, wallet, program } = fixture();
  const drawTime = new BN(String(NOW / 1000 - 60));
  const resultAddress = getResultPda(drawTime, program.programId)[0];
  calls.results = new Map([
    [resultAddress.toBase58(), { isPublished: true, numbers: [6, 9] }],
  ]);
  calls.ticketEntries = [1, 2].map((nonce) => ({
    publicKey: getTicketPda(wallet.publicKey, nonce, program.programId)[0],
    account: {
      nonce: new BN(nonce),
      numbers: [6, 9],
      drawTime,
      settled: false,
      paidLamports: new BN(7_200_000),
    },
  }));
  const tickets = await client.getTickets();
  assert.equal(calls.resultBatches.length, 1);
  assert.equal(calls.resultBatches[0].length, 1);
  assert.equal(tickets[0].address, calls.ticketEntries[0].publicKey.toBase58());
  assert.deepEqual(tickets[0].result.numbers, [6, 9]);
  assert.equal(tickets[0].result.id, resultAddress.toBase58());
  calls.results.clear();
  assert.equal((await client.getTickets())[0].result, null);
});

test("draw history retains old recorded numbers while recent results stay limited", async () => {
  const { client, calls, program } = fixture();
  calls.resultEntries = Array.from({ length: 5 }, (_, index) => {
    const drawTime = new BN(NOW / 1000 - index * 60);
    return {
      publicKey: getResultPda(drawTime, program.programId)[0],
      account: {
        drawTime,
        numbers: index ? [5, 20] : [6, 9],
        isPublished: true,
      },
    };
  }).reverse();
  const history = await client.getResults();
  assert.equal(history.length, 5);
  assert.deepEqual(history[0].numbers, [6, 9]);
  assert.deepEqual(history[4].numbers, [5, 20]);
  assert.equal((await client.getRecentResults()).length, 3);
});

function memoryStorage() {
  const entries = new Map();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: (key) => entries.delete(key),
  };
}

test("a confirmed purchase is recovered after a timeout and reload without sending again", async () => {
  const storage = memoryStorage();
  const { client, calls, wallet, program } = fixture({ storage });
  calls.landPurchase = true;
  calls.purchaseFailure = Error("Confirmation timed out");
  calls.ticketReadFailure = Error("RPC unavailable");
  await assert.rejects(client.buyTicket([2, 22]), /same purchase ID/);
  assert.equal(client.getPendingPurchase().id, NONCE);
  calls.ticketReadFailure = null;
  const reloaded = new DodosClient({
    program,
    wallet,
    storage,
    now: () => NOW,
    nonceFactory: () => "123",
  });
  const recovered = await reloaded.buyTicket([2, 3]);
  assert.equal(recovered.recovered, true);
  assert.deepEqual(recovered.numbers, [2, 22]);
  assert.equal(calls.submissions, 1);
  assert.equal(reloaded.getPendingPurchase(), null);
});

test("retrying an unresolved purchase reuses its nonce and PDA", async () => {
  const storage = memoryStorage();
  const { client, calls, wallet, program } = fixture({ storage });
  calls.purchaseFailure = Error("RPC confirmation unavailable");
  await assert.rejects(client.buyTicket([2, 22]), /same purchase ID/);
  const firstAddress = calls.accounts.ticket.toBase58();
  calls.purchaseFailure = null;
  const reloaded = new DodosClient({
    program,
    wallet,
    storage,
    now: () => NOW,
    nonceFactory: () => "123",
  });
  const ticket = await reloaded.buyTicket([2, 3]);
  assert.equal(ticket.id, NONCE);
  assert.equal(calls.accounts.ticket.toBase58(), firstAddress);
  assert.deepEqual(ticket.numbers, [2, 3]);
  assert.equal(reloaded.getPendingPurchase(), null);
});

test("a historical pending 01 ticket can be recovered without buying it again", async () => {
  const storage = memoryStorage();
  const { client, calls, wallet, program } = fixture({ storage });
  client.rememberPurchase({
    id: NONCE,
    numbers: [1, 22],
    drawTime: NOW / 1000 - 60,
  });
  calls.savedTicket = {
    user: wallet.publicKey,
    numbers: [1, 22],
    drawTime: new BN(NOW / 1000 - 60),
    settled: false,
  };
  const reloaded = new DodosClient({
    program,
    wallet,
    storage,
    now: () => NOW,
  });
  const receipt = await reloaded.buyTicket([1, 22]);
  assert.equal(receipt.recovered, true);
  assert.deepEqual(receipt.numbers, [1, 22]);
  assert.equal(calls.submissions, undefined);
});

test("ticket prizes use snapshots and preserve the original prize for older tickets", async () => {
  const { client, calls, wallet, program } = fixture();
  calls.config = {
    payoutLamports: new BN(1_000_000_000),
    padding: Array(32).fill(0),
  };
  const snapshot = Buffer.alloc(32);
  snapshot[0] = 2;
  snapshot.writeBigUInt64LE(2_000_000_000n, 1);
  calls.ticketEntries = [
    Array(32).fill(0),
    [1, ...Array(31).fill(0)],
    Array.from(snapshot),
  ].map((padding, index) => ({
    publicKey: getTicketPda(wallet.publicKey, index + 1, program.programId)[0],
    account: {
      nonce: new BN(index + 1),
      numbers: [6, 9],
      drawTime: new BN(getNextDrawTime(NOW)),
      settled: false,
      paidLamports: new BN(7_200_000),
      padding,
    },
  }));
  assert.deepEqual(
    (await client.getTickets()).map(({ payoutLamports }) => payoutLamports),
    [1_000_000_000, 1_000_000_000, 2_000_000_000],
  );
});

test("purchase identity is persisted before requesting a transaction", async () => {
  const storage = {
    getItem: () => null,
    setItem: () => {
      throw Error("Storage unavailable");
    },
  };
  const { client, calls } = fixture({ storage });
  await assert.rejects(client.buyTicket([2, 22]), /Storage unavailable/);
  assert.equal(calls.submissions, undefined);
});

test("PDA integers distinguish unsigned ticket nonce from signed draw time", () => {
  assert.equal(u64LeBytes(NONCE).toString("hex"), "ffffffffffffffff");
  assert.equal(i64LeBytes(-1).toString("hex"), "ffffffffffffffff");
  for (const value of [-1, "18446744073709551616", Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => u64LeBytes(value), RangeError);
  assert.throws(() => i64LeBytes("9223372036854775808"), RangeError);
});

test("daily Dodos schedule advances at 14:00 and 16:00 UTC+8", () => {
  assert.equal(
    getNextDrawTime(Date.parse("2026-10-27T05:59:59Z")),
    Date.parse("2026-10-27T06:00:00Z") / 1000,
  );
  assert.equal(
    getNextDrawTime(Date.parse("2026-10-27T06:00:00Z")),
    Date.parse("2026-10-27T08:00:00Z") / 1000,
  );
  assert.equal(
    getNextDrawTime(Date.parse("2026-10-27T08:00:00Z")),
    Date.parse("2026-10-28T06:00:00Z") / 1000,
  );
});

test("purchase sends matching seeds, arguments and accounts with a full-width nonce", async () => {
  const { client, calls, wallet, program } = fixture();
  const numbers = [2, 22];
  const ticket = await client.buyTicket(numbers);
  assert.equal(calls.arguments.nonce.toString(), NONCE);
  assert.deepEqual(calls.arguments.numbers, [2, 22]);
  assert.equal(
    calls.accounts.ticket.toBase58(),
    getTicketPda(wallet.publicKey, NONCE, program.programId)[0].toBase58(),
  );
  assert.equal(
    calls.accounts.systemProgram.toBase58(),
    SystemProgram.programId.toBase58(),
  );
  numbers[0] = 3;
  assert.deepEqual(ticket.numbers, [2, 22]);
  assert.equal(JSON.parse(JSON.stringify(ticket)).id, NONCE);
});

test("invalid selections and past or distant draws never reach RPC", async () => {
  const { client, calls } = fixture();
  for (const numbers of [
    [0, 2],
    [1, 2],
    [2, 1],
    [1, 22],
    [2, 23],
    [2, 2],
    [2.5, 3],
    [2],
    ["2", 3],
  ])
    await assert.rejects(client.buyTicket(numbers), /different numbers/);
  await assert.rejects(
    client.buyTicket([2, 3], { drawTime: NOW / 1000 }),
    /future draw/,
  );
  await assert.rejects(
    client.buyTicket([2, 3], { drawTime: NOW / 1000 + 86_401 }),
    /future draw/,
  );
  assert.equal(calls.accounts, undefined);
});

test("results retain ordered matching and publish only after draw time", async () => {
  const { client, calls, program } = fixture();
  const ticket = { id: NONCE, numbers: [1, 22], drawTime: NOW / 1000 - 1 };
  assert.equal((await client.checkTicket(ticket)).status, "pending");
  calls.result = { isPublished: true, numbers: [22, 1] };
  assert.equal((await client.checkTicket(ticket)).status, "lost");
  calls.result.numbers = [1, 22];
  assert.equal((await client.checkTicket(ticket)).status, "won");
  assert.equal(await client.publishResult(ticket.drawTime), null);
  await assert.rejects(client.publishResult(NOW / 1000 + 60), /not started/);
  calls.result = null;
  assert.equal(
    await client.publishResult(ticket.drawTime),
    "publish-signature",
  );
  assert.equal(
    calls.publishAccounts.result.toBase58(),
    getResultPda(ticket.drawTime, program.programId)[0].toBase58(),
  );
  assert.equal(await client.settleTicket(ticket), "settle-signature");
  assert.equal(
    calls.settleAccounts.result.toBase58(),
    calls.publishAccounts.result.toBase58(),
  );
});

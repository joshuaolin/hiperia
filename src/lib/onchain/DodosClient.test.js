import test from "node:test";
import assert from "node:assert/strict";
import BN from "bn.js";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import { DodosClient, UAT_ADMIN } from "./DodosClient.js";
import { PROGRAM_ID } from "./idl.js";
import { getTicketPda, getResultPda, u64LeBytes, i64LeBytes } from "./pdas.js";
import { getNextDrawTime, getUatDrawTime } from "./time.js";

const NOW = Date.parse("2026-10-27T05:00:00Z");
const NONCE = "18446744073709551615";

function fixture({
  storage = null,
  publicKey = SystemProgram.programId,
  nonceFactory = () => NONCE,
} = {}) {
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
        all: async () =>
          (calls.ticketEntries ?? []).map((entry) => ({
            ...entry,
            account: { user: wallet.publicKey, ...entry.account },
          })),
        fetchNullable: async (address) => {
          if (calls.ticketReadFailure) throw calls.ticketReadFailure;
          if (calls.savedTickets)
            return calls.savedTickets.get(address.toBase58()) ?? null;
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
              rpc: async (options) => {
                calls.purchaseOptions = options;
                calls.submissions = (calls.submissions ?? 0) + 1;
                calls.purchaseAddresses ??= [];
                calls.purchaseAddresses.push(accounts.ticket.toBase58());
                if (calls.landPurchase)
                  calls.savedTicket = {
                    user: wallet.publicKey,
                    numbers: [...numbers],
                    drawTime,
                    settled: false,
                  };
                if (calls.landPurchase && calls.savedTickets)
                  calls.savedTickets.set(
                    accounts.ticket.toBase58(),
                    calls.savedTicket,
                  );
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
      nonceFactory,
      storage,
      rulesLoader: async () => {
        calls.rulesReads = (calls.rulesReads ?? 0) + 1;
        if (calls.rulesFailure) throw calls.rulesFailure;
        return (
          calls.rules ?? {
            revision: 3,
            quickTicketCostLamports: new BN(7_200_000),
            dailyTicketCostLamports: new BN(6_250_000),
            quickPayoutLamports: new BN(1_000_000_000),
            dailyPayoutLamports: new BN(2_000_000_000),
            winningNumbers: [2, 22],
            dailyHours: [2, 6, 10, 14, 18, 22],
          }
        );
      },
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
  calls.config = {
    padding: Array(32).fill(0),
    ticketCostLamports: new BN(7_200_000),
    payoutLamports: new BN(1_000_000_000),
  };
  assert.equal((await client.getConfig()).uatEnabled, false);
  assert.equal(calls.rulesReads, undefined);
  const tester = new PublicKey("Ghxn7ree6MFQxC8hFTJ8Lo319xEZzqVFLcmDLKVFpPaa");
  calls.config.padding = Array.from(tester.toBytes());
  const config = await client.getConfig();
  assert.equal(config.uatEnabled, true);
  assert.equal(config.uatTester, tester.toBase58());
  assert.equal(config.uatAdmin, UAT_ADMIN);
  assert.deepEqual(config.winningNumbers, [2, 22]);
  assert.equal(config.dailyTicketCostLamports.toString(), "6250000");
  assert.equal(config.rulesRevision, 3);
  calls.rulesFailure = Error("429 Too many requests");
  await assert.rejects(client.getConfig(), /429/);
  calls.rulesFailure = null;
  calls.config.ticketCostLamports = new BN(1);
  await assert.rejects(client.getConfig(), /prices do not match/);
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
  assert.equal(history[0].payoutLamports, null);
  assert.equal(history[0].drawType, null);
  assert.deepEqual(history[4].numbers, [5, 20]);
  assert.equal((await client.getRecentResults()).length, 3);
});

test("result history decodes only valid recorded mode and price snapshots", async () => {
  const { client, calls, program, wallet } = fixture();
  const padding = Buffer.alloc(32);
  padding[0] = 1;
  padding[1] = 1;
  padding.writeBigUInt64LE(2_000_000_000n, 2);
  padding.writeBigUInt64LE(6_250_000n, 10);
  const invalidTail = Buffer.from(padding);
  invalidTail[31] = 1;
  const invalidMode = Buffer.from(padding);
  invalidMode[1] = 2;
  const invalidAmount = Buffer.from(padding);
  invalidAmount.writeBigUInt64LE(0n, 2);
  const unsafeAmount = Buffer.from(padding);
  unsafeAmount.writeBigUInt64LE(9_007_199_254_740_992n, 2);
  calls.resultEntries = [
    padding,
    Buffer.alloc(32),
    invalidTail,
    invalidMode,
    invalidAmount,
    unsafeAmount,
  ].map((bytes, index) => {
    const drawTime = new BN(NOW / 1000 - index * 60);
    return {
      publicKey: getResultPda(drawTime, program.programId)[0],
      account: {
        drawTime,
        numbers: index ? [6, 9] : [2, 22],
        isPublished: true,
        padding: bytes,
      },
    };
  });
  const results = await client.getResults();
  assert.equal(results[0].drawType, "daily");
  assert.equal(results[0].payoutLamports, 2_000_000_000);
  assert.equal(results[0].ticketCostLamports, 6_250_000);
  assert.deepEqual(results[0].numbers, [2, 22]);
  for (const result of results.slice(1)) {
    assert.equal(result.drawType, null);
    assert.equal(result.payoutLamports, null);
    assert.equal(result.ticketCostLamports, null);
    assert.deepEqual(result.numbers, [6, 9]);
  }
  const drawTime = calls.resultEntries[0].account.drawTime;
  calls.results = new Map([[results[0].id, calls.resultEntries[0].account]]);
  calls.ticketEntries = [
    {
      publicKey: getTicketPda(wallet.publicKey, 1, program.programId)[0],
      account: {
        nonce: new BN(1),
        numbers: [2, 22],
        drawTime,
        settled: false,
        paidLamports: new BN(6_250_000),
        padding: Buffer.alloc(32),
      },
    },
  ];
  const [ticket] = await client.getTickets({
    payoutLamports: new BN(1_000_000_000),
  });
  assert.equal(ticket.result.drawType, "daily");
  assert.equal(ticket.result.payoutLamports, 2_000_000_000);
  assert.equal(ticket.result.ticketCostLamports, 6_250_000);
});

function memoryStorage() {
  const entries = new Map();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: (key) => entries.delete(key),
  };
}

for (const [mode, drawTime] of [
  ["daily", getNextDrawTime(NOW)],
  ["quick", getUatDrawTime(NOW)],
]) {
  test(`two consecutive ${mode} entries for the same draw use independent ticket identities`, async () => {
    const storage = memoryStorage();
    let nonce = 0;
    const { client, calls } = fixture({
      storage,
      nonceFactory: () => String(++nonce),
    });
    calls.landPurchase = true;
    calls.savedTickets = new Map();
    const first = await client.buyTicket([2, 3], { drawTime });
    const second = await client.buyTicket([3, 2], { drawTime });
    assert.equal(first.drawTime, second.drawTime);
    assert.notEqual(first.id, second.id);
    assert.equal(calls.submissions, 2);
    assert.equal(new Set(calls.purchaseAddresses).size, 2);
    assert.equal(calls.savedTickets.size, 2);
    assert.equal(client.getPendingPurchase(), null);
    assert.equal(storage.getItem(client.purchaseKey), null);
    assert.deepEqual(calls.purchaseOptions, { maxRetries: 0 });
  });
}

test("rapid purchase calls cannot open a second transaction while the first wallet approval is pending", async () => {
  let nonce = 0;
  const { client, calls, program } = fixture({
    nonceFactory: () => String(++nonce),
  });
  const original = program.methods.buyTicket;
  let release;
  let reached;
  const approval = new Promise((resolve) => {
    release = resolve;
  });
  const submitted = new Promise((resolve) => {
    reached = resolve;
  });
  program.methods.buyTicket = (...args) => {
    const method = original(...args);
    return {
      accountsStrict: (accounts) => {
        const builder = method.accountsStrict(accounts);
        return {
          rpc: async (options) => {
            reached();
            await approval;
            return builder.rpc(options);
          },
        };
      },
    };
  };
  const first = client.buyTicket([2, 3]);
  await submitted;
  await assert.rejects(client.buyTicket([3, 2]), /already waiting/);
  release();
  const confirmed = await first;
  const next = await client.buyTicket([3, 2]);
  assert.notEqual(confirmed.id, next.id);
  assert.equal(calls.submissions, 2);
});

test("completed mobile purchases stay cleared across reload if storage removal fails", async () => {
  const entries = memoryStorage();
  const storage = {
    ...entries,
    removeItem: () => {
      throw Error("Storage removal unavailable");
    },
  };
  const { client, calls, wallet, program } = fixture({ storage });
  calls.landPurchase = true;
  calls.savedTickets = new Map();
  const first = await client.buyTicket([2, 3]);
  assert.equal(storage.getItem(client.purchaseKey), "");
  const reloaded = new DodosClient({
    program,
    wallet,
    storage,
    now: () => NOW,
    nonceFactory: () => "123",
  });
  assert.equal(reloaded.getPendingPurchase(), null);
  const next = await reloaded.buyTicket([3, 2]);
  assert.notEqual(first.id, next.id);
  assert.equal(next.recovered, undefined);
  assert.equal(calls.submissions, 2);
});

test("pending purchase storage is scoped to the connected wallet", async () => {
  const storage = memoryStorage();
  const first = fixture({ storage });
  first.calls.purchaseFailure = Error("Confirmation unavailable");
  await assert.rejects(first.client.buyTicket([2, 3]), /same purchase ID/);
  const second = fixture({
    storage,
    publicKey: new PublicKey(UAT_ADMIN),
    nonceFactory: () => "123",
  });
  assert.equal(second.client.getPendingPurchase(), null);
  await second.client.buyTicket([3, 2]);
  assert.equal(second.calls.submissions, 1);
  const restored = fixture({ storage });
  assert.equal(restored.client.getPendingPurchase().id, NONCE);
  assert.equal(restored.calls.submissions, undefined);
});

test("a standard-fee purchase can explicitly avoid creating a referral profile", async () => {
  const { client, calls } = fixture();
  client.referrals.purchaseRules = async () => {
    throw Error("Referral metadata is unavailable");
  };
  client.referrals.preparePurchase = async () => {
    throw Error("A standard purchase must not create a referral account");
  };
  const receipt = await client.buyTicket([2, 3], {
    useReferrals: false,
    config: { rulesRevision: 4 },
  });
  assert.equal(receipt.signature, "signature");
  assert.equal(calls.submissions, 1);
  assert.equal(calls.accounts.profile, undefined);
});

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
  calls.purchaseFailure = null;
  const next = await reloaded.buyTicket([2, 3]);
  assert.equal(next.id, "123");
  assert.notEqual(next.id, recovered.id);
  assert.equal(calls.submissions, 2);
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

test("daily Dodos schedule advances every four hours in UTC+8", () => {
  assert.equal(
    getNextDrawTime(Date.parse("2026-10-27T05:59:59Z")),
    Date.parse("2026-10-27T06:00:00Z") / 1000,
  );
  assert.equal(
    getNextDrawTime(Date.parse("2026-10-27T06:00:00Z")),
    Date.parse("2026-10-27T10:00:00Z") / 1000,
  );
  assert.equal(
    getNextDrawTime(Date.parse("2026-10-27T08:00:00Z")),
    Date.parse("2026-10-27T10:00:00Z") / 1000,
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

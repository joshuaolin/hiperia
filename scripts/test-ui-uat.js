import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { BorshAccountsCoder, utils } from "@coral-xyz/anchor";
import BN from "bn.js";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { chromium, expect } from "@playwright/test";
import idl, { PROGRAM_ID } from "../src/lib/onchain/idl.js";
import {
  getConfigPda,
  getTicketPda,
  getResultPda,
  getReferralPda,
} from "../src/lib/onchain/pdas.js";
import { DEVNET_GENESIS_HASH } from "../src/lib/network.js";

const origin = process.env.UI_TEST_ORIGIN || "http://127.0.0.1:5173";
const now = Date.parse("2026-10-28T05:59:58Z");
const wallet = new PublicKey(new Uint8Array(32).fill(1));
const coder = new BorshAccountsCoder(idl);
const padding = new Array(32).fill(0);
const rulesData = Buffer.alloc(56);
const referralRulesData = Buffer.alloc(34);
referralRulesData.set([5, 1]);
for (const [offset, amount] of [
  [2, 7_200_000n],
  [10, 6_250_000n],
  [18, 7_099_991n],
  [26, 6_199_991n],
])
  referralRulesData.writeBigUInt64LE(amount, offset);
rulesData.set([4, 2, 22, 2, 2, 22]);
for (const [offset, amount] of [
  [6, 7_200_000n],
  [14, 6_250_000n],
  [22, 1_000_000_000n],
  [30, 2_000_000_000n],
])
  rulesData.writeBigUInt64LE(amount, offset);
rulesData.set([2, 6, 10, 14, 18, 22], 38);
rulesData.writeUInt32LE(14_400, 44);
rulesData.writeUInt32LE(7_200, 48);
rulesData.writeUInt32LE(86_400, 52);
const ticketData = [
  { id: "1", numbers: [6, 9], draw: "2026-10-28T06:00:00Z", settled: false },
  { id: "2", numbers: [6, 9], draw: "2026-10-28T05:50:00Z", settled: false },
  { id: "3", numbers: [6, 9], draw: "2026-10-28T05:40:00Z", settled: false },
  { id: "4", numbers: [1, 22], draw: "2026-10-28T05:40:00Z", settled: false },
  { id: "5", numbers: [6, 9], draw: "2026-10-28T05:30:00Z", settled: true },
  { id: "6", numbers: [1, 22], draw: "2026-10-28T05:20:00Z", settled: true },
].map((ticket) => ({ ...ticket, drawTime: Date.parse(ticket.draw) / 1000 }));

function rpcAccount(data) {
  return {
    data: [data.toString("base64"), "base64"],
    executable: false,
    lamports: 2_000_000,
    owner: PROGRAM_ID,
    rentEpoch: 0,
    space: data.length,
  };
}

const accounts = new Map();
const tickets = [];
const results = [];
for (const ticket of ticketData) {
  const [address, bump] = getTicketPda(wallet, ticket.id);
  ticket.address = address.toBase58();
  const account = rpcAccount(
    await coder.encode("Ticket", {
      user: wallet,
      nonce: new BN(ticket.id),
      draw_time: new BN(ticket.drawTime),
      paid_lamports: new BN(7_200_000),
      settled: ticket.settled,
      bump,
      numbers: ticket.numbers,
      padding,
    }),
  );
  accounts.set(ticket.address, account);
  tickets.push({ pubkey: ticket.address, account });
}
const resultData = [
  ...[...new Set(ticketData.slice(2).map((ticket) => ticket.drawTime))].map(
    (drawTime) => ({
      drawTime,
      numbers: [6, 9],
    }),
  ),
  { drawTime: Date.parse("2026-10-27T06:00:00Z") / 1000, numbers: [19, 3] },
  { drawTime: Date.parse("2026-10-27T08:00:00Z") / 1000, numbers: [2, 22] },
  { drawTime: Date.parse("2026-10-26T06:00:00Z") / 1000, numbers: [7, 13] },
  {
    drawTime: Date.parse("2026-10-25T08:00:00Z") / 1000,
    numbers: [2, 22],
    drawType: "quick",
  },
  {
    drawTime: Date.parse("2026-10-25T22:00:00Z") / 1000,
    numbers: [2, 22],
    drawType: "daily",
  },
];
for (const { drawTime, numbers, drawType } of resultData) {
  const [address, bump] = getResultPda(drawTime);
  const resultPadding = Buffer.alloc(32);
  if (drawType) {
    resultPadding[0] = 1;
    resultPadding[1] = drawType === "daily" ? 1 : 0;
    resultPadding.writeBigUInt64LE(
      drawType === "daily" ? 2_000_000_000n : 1_000_000_000n,
      2,
    );
    resultPadding.writeBigUInt64LE(
      drawType === "daily" ? 6_250_000n : 7_200_000n,
      10,
    );
  }
  const account = rpcAccount(
    await coder.encode("ResultAccount", {
      draw_time: new BN(drawTime),
      numbers,
      is_published: true,
      bump,
      padding: Array.from(resultPadding),
    }),
  );
  accounts.set(address.toBase58(), account);
  results.push({ pubkey: address.toBase58(), account });
}

let uatEnabled = true;
let rateLimited = false;
let rateLimitedRequests = 0;
let signingScenario = false;
const completedPurchases = [];
const methods = new Map();
const failures = [];
const context = { slot: 100, apiVersion: "2.2.0" };
async function rpcResult({ method, params = [] }) {
  methods.set(method, (methods.get(method) || 0) + 1);
  switch (method) {
    case "getGenesisHash":
      return DEVNET_GENESIS_HASH;
    case "getBalance":
      return { context, value: 2_000_000_000 };
    case "getLatestBlockhash":
      return {
        context,
        value: {
          blockhash: PublicKey.default.toBase58(),
          lastValidBlockHeight: 1000,
        },
      };
    case "getSignatureStatuses":
      assert.ok(signingScenario);
      return {
        context,
        value: params[0].map(() => ({
          slot: context.slot,
          confirmations: 1,
          err: null,
          confirmationStatus: "confirmed",
        })),
      };
    case "sendTransaction": {
      assert.ok(signingScenario, "The ordinary dummy wallet must never submit");
      assert.equal(params[1].maxRetries, 0);
      const transaction = VersionedTransaction.deserialize(
        Buffer.from(params[0], "base64"),
      );
      const message = transaction.message;
      assert.equal(message.compiledInstructions.length, 1);
      const [instruction] = message.compiledInstructions;
      assert.equal(
        message.staticAccountKeys[instruction.programIdIndex].toBase58(),
        PROGRAM_ID,
      );
      const data = Buffer.from(instruction.data);
      assert.equal(data.length, 26);
      assert.deepEqual(
        data.subarray(0, 8),
        createHash("sha256")
          .update("global:buy_ticket")
          .digest()
          .subarray(0, 8),
      );
      const nonce = data.readBigUInt64LE(8).toString();
      const drawTime = Number(data.readBigInt64LE(16));
      const numbers = Array.from(data.subarray(24, 26));
      const [address, bump] = getTicketPda(wallet, nonce);
      assert.equal(
        message.staticAccountKeys[instruction.accountKeyIndexes[2]].toBase58(),
        address.toBase58(),
      );
      assert.equal(
        message.staticAccountKeys[instruction.accountKeyIndexes[3]].toBase58(),
        wallet.toBase58(),
      );
      assert.equal(accounts.has(address.toBase58()), false);
      const daily = ((drawTime % 14_400) + 14_400) % 14_400 === 7_200;
      const paid = daily ? 6_250_000 : 7_200_000;
      const snapshot = Buffer.alloc(32);
      snapshot[0] = 2;
      snapshot.writeBigUInt64LE(daily ? 2_000_000_000n : 1_000_000_000n, 1);
      const account = rpcAccount(
        await coder.encode("Ticket", {
          user: wallet,
          nonce: new BN(nonce),
          draw_time: new BN(drawTime),
          paid_lamports: new BN(paid),
          settled: false,
          bump,
          numbers,
          padding: Array.from(snapshot),
        }),
      );
      accounts.set(address.toBase58(), account);
      tickets.push({ pubkey: address.toBase58(), account });
      completedPurchases.push({ nonce, drawTime, numbers, daily, paid });
      return utils.bytes.bs58.encode(transaction.signatures[0]);
    }
    case "simulateTransaction": {
      assert.equal(params[1].sigVerify, false);
      assert.equal(params[1].replaceRecentBlockhash, true);
      const transaction = VersionedTransaction.deserialize(
        Buffer.from(params[0], "base64"),
      );
      assert.ok(
        transaction.signatures.every((signature) =>
          signature.every((byte) => byte === 0),
        ),
      );
      const message = transaction.message;
      assert.equal(message.compiledInstructions.length, 1);
      const [instruction] = message.compiledInstructions;
      assert.equal(
        message.staticAccountKeys[instruction.programIdIndex].toBase58(),
        PROGRAM_ID,
      );
      const isReferralRules = Buffer.from(instruction.data).equals(
        createHash("sha256")
          .update("global:get_referral_rules")
          .digest()
          .subarray(0, 8),
      );
      if (!isReferralRules)
        assert.deepEqual(
          Buffer.from(instruction.data),
          createHash("sha256")
            .update("global:get_rules")
            .digest()
            .subarray(0, 8),
        );
      assert.ok(
        instruction.accountKeyIndexes.every(
          (index) =>
            !message.isAccountWritable(index) &&
            !message.isAccountSigner(index),
        ),
      );
      assert.equal(
        message.staticAccountKeys[instruction.accountKeyIndexes[0]].toBase58(),
        getConfigPda()[0].toBase58(),
      );
      const data = (isReferralRules ? referralRulesData : rulesData).toString(
        "base64",
      );
      return {
        context,
        value: {
          err: null,
          logs: [`Program return: ${PROGRAM_ID} ${data}`],
          accounts: null,
          unitsConsumed: 1000,
          returnData: { programId: PROGRAM_ID, data: [data, "base64"] },
        },
      };
    }
    case "getAccountInfo": {
      let value = accounts.get(params[0]) || null;
      if (params[0] === getConfigPda()[0].toBase58()) {
        value = rpcAccount(
          await coder.encode("Config", {
            is_initialized: true,
            bump: getConfigPda()[1],
            ticket_cost_lamports: new BN(7_200_000),
            payout_lamports: new BN(1_000_000_000),
            padding: uatEnabled ? Array.from(wallet.toBytes()) : padding,
          }),
        );
      }
      return { context, value };
    }
    case "getMultipleAccounts":
      return {
        context,
        value: params[0].map((address) => accounts.get(address) || null),
      };
    case "getProgramAccounts": {
      assert.equal(params[0], PROGRAM_ID);
      const filters = params[1].filters;
      const discriminator = filters.find(
        (filter) => filter.memcmp?.offset === 0,
      )?.memcmp.bytes;
      let value;
      if (discriminator === coder.memcmp("Ticket").bytes) {
        assert.ok(
          filters.some(
            (filter) =>
              filter.memcmp?.offset === 8 &&
              filter.memcmp.bytes === wallet.toBase58(),
          ),
        );
        value = tickets;
      } else {
        assert.equal(discriminator, coder.memcmp("ResultAccount").bytes);
        value = results;
      }
      return params[1].withContext ? { context, value } : value;
    }
    default:
      throw new Error(`Unexpected RPC method: ${method}`);
  }
}

mkdirSync("test-results", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
    isMobile: true,
    hasTouch: true,
  });
  await page.clock.install({ time: new Date(now - 60_000) });
  page.on("pageerror", (error) => failures.push(error.message));
  await page.routeWebSocket(
    (url) => url.hostname === "api.devnet.solana.com",
    (socket) => {
      socket.onMessage((data) => {
        const request = JSON.parse(String(data));
        socket.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            result: request.method.endsWith("Unsubscribe") ? true : 1,
          }),
        );
      });
    },
  );
  await page.route(
    (url) => url.hostname === "api.devnet.solana.com",
    async (route) => {
      try {
        const request = route.request().postDataJSON();
        if (rateLimited && request.method === "getAccountInfo") {
          rateLimitedRequests += 1;
          await route.fulfill({
            json: {
              jsonrpc: "2.0",
              id: request.id,
              error: {
                code: -32005,
                message:
                  "429 Too Many Requests: raw upstream detail should stay hidden",
              },
            },
          });
          return;
        }
        const result = await rpcResult(request);
        await route.fulfill({
          json: { jsonrpc: "2.0", id: request.id, result },
        });
      } catch (error) {
        failures.push(error.message);
        await route.fulfill({
          json: {
            jsonrpc: "2.0",
            id: null,
            error: { code: -32000, message: error.message },
          },
        });
      }
    },
  );
  await page.goto(`${origin}/dev/dummy-wallet.html`, {
    waitUntil: "networkidle",
  });
  await page.clock.pauseAt(new Date(now));
  await expect(
    page.getByText("UAT test mode:", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText(/draw results are fixed, not random/),
  ).toBeVisible();
  await expect(
    page.locator(".dashboard-notice").getByText(/02\s*→\s*22/),
  ).toHaveCount(0);
  const ticketDisclosure = page.locator("#your-tickets");
  const resultDisclosure = page.locator("#draw-results");
  await expect(ticketDisclosure).not.toHaveAttribute("open");
  await expect(resultDisclosure).not.toHaveAttribute("open");
  await page.getByRole("link", { name: "Your tickets", exact: true }).click();
  await expect(ticketDisclosure).toHaveAttribute("open", "");
  const panelAlignment = await page
    .locator(".dashboard-grid")
    .evaluate((element) => {
      const purchase = element
        .querySelector(".purchase-panel")
        .getBoundingClientRect();
      const tickets = element
        .querySelector(".tickets-panel")
        .getBoundingClientRect();
      return {
        top: Math.abs(purchase.top - tickets.top),
        bottom: Math.abs(purchase.bottom - tickets.bottom),
      };
    });
  assert.ok(
    panelAlignment.top <= 1 && panelAlignment.bottom <= 1,
    "Expanded purchase and ticket panels must align on desktop",
  );
  await expect(page.locator(".ticket-card")).toHaveCount(2);
  const ticketFilters = page.getByRole("group", {
    name: "Filter your tickets",
    exact: true,
  });
  const selectTicketFilter = (name) =>
    ticketFilters
      .getByRole("button", { name: new RegExp(`^${name}\\b`) })
      .click();
  await expect(
    ticketFilters.getByRole("button", { name: /^Ongoing\b/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /^Claim all\b/ })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Number 1", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".number-grid button")).toHaveCount(21);
  await page.getByRole("button", { name: "Number 2", exact: true }).click();
  await page.getByRole("button", { name: "Number 22", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Number 3", exact: true }),
  ).toBeDisabled();
  const guide = page.locator(".dodos-guide");
  await page.getByRole("link", { name: "How to play", exact: true }).click();
  await expect(
    guide.getByRole("heading", { name: "How to play Dodos", exact: true }),
  ).toBeVisible();
  await expect(
    guide.locator(".dodos-guide-facts").getByRole("row", { name: /^Numbers/ }),
  ).toHaveText(/Choose 2 different numbers, 02\s*–\s*22/);
  await expect(guide.getByText(/02\s*→\s*22/)).toHaveCount(0);
  const history = page.locator(".draw-results");
  await page.getByRole("link", { name: "Draw results", exact: true }).click();
  await expect(resultDisclosure).toHaveAttribute("open", "");
  await expect(
    history.getByRole("link", {
      name: "Dodos program on Devnet ↗",
      exact: true,
    }),
  ).toHaveAttribute(
    "href",
    `https://explorer.solana.com/address/${PROGRAM_ID}?cluster=devnet`,
  );
  await expect(history.locator("tbody tr")).toHaveCount(resultData.length);
  for (const record of resultData) {
    const address = getResultPda(record.drawTime)[0].toBase58();
    const row = history.locator("tbody tr").filter({
      has: page.locator(
        `a[href="https://explorer.solana.com/address/${address}?cluster=devnet"]`,
      ),
    });
    await expect(row.locator(".draw-result-combination")).toHaveText(
      record.numbers
        .map((number) => String(number).padStart(2, "0"))
        .join(" – "),
    );
    await expect(row.locator(".draw-results-account")).toHaveText(
      `${address.slice(0, 6)}…${address.slice(-6)}`,
    );
    await expect(row.getByText(/^Base entry /)).toHaveCount(
      record.drawType ? 1 : 0,
    );
    await expect(row.getByText(/^Prize /)).toHaveCount(record.drawType ? 1 : 0);
  }
  await expect(
    history.getByText("Prize not recorded", { exact: true }),
  ).toHaveCount(0);
  await expect(
    history.getByText("Prize 2 test SOL", { exact: true }),
  ).toBeVisible();
  await expect(
    history.getByText("Prize 1 test SOL", { exact: true }),
  ).toBeVisible();
  await expect(
    history.locator("tbody").getByText("Quick draw", { exact: true }),
  ).toBeVisible();
  await expect(
    history.getByText("Current prizes", { exact: true }),
  ).toHaveCount(0);
  await expect(
    history.locator("tbody").getByText("Type not recorded", { exact: true }),
  ).toHaveCount(6);
  assert.deepEqual(
    await history
      .getByLabel("Draw session", { exact: true })
      .locator("option")
      .evaluateAll((entries) => entries.map((entry) => entry.value)),
    ["all", "6", "quick", "unknown"],
  );
  const card = (id) =>
    page.locator(".ticket-card").filter({
      has: page.locator(
        `a[href^="https://explorer.solana.com/address/${ticketData.find((ticket) => ticket.id === id).address}"]`,
      ),
    });

  await expect(card("1").getByText("Upcoming", { exact: true })).toBeVisible();
  await expect(
    card("1").getByRole("button", { name: "Record draw result", exact: true }),
  ).toHaveCount(0);
  await expect(card("1").locator(".ticket-actions")).toHaveCount(0);
  await expect(card("1").locator(".ticket-countdown")).toContainText(
    "Starts in",
  );
  await expect(
    card("2").getByText("Awaiting result", { exact: true }),
  ).toBeVisible();
  await expect(
    card("2").getByRole("button", { name: "Record draw result", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^View result/ })).toHaveCount(
    0,
  );
  await selectTicketFilter("Win");
  await expect(page.locator(".ticket-card")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Claim all (1)", exact: true }),
  ).toBeDisabled();
  await expect(
    card("3").getByText("Prize ready", { exact: true }),
  ).toBeVisible();
  await expect(
    card("3").getByRole("button", { name: "Claim prize", exact: true }),
  ).toBeVisible();
  await expect(
    card("3").getByRole("button", { name: "Close ticket", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Claim prize", exact: true }),
  ).toBeDisabled();
  const beforeReads = methods.get("getAccountInfo");
  await expect(
    card("3").getByText("Recorded result", { exact: true }),
  ).toBeVisible();
  assert.deepEqual(
    await card("3")
      .locator(".ticket-result .number-pair > span")
      .allTextContents(),
    ["06", "09"],
  );
  await expect(page.getByRole("button", { name: /^View result/ })).toHaveCount(
    0,
  );
  assert.equal(methods.get("getAccountInfo"), beforeReads);
  await selectTicketFilter("Done");
  await expect(page.locator(".ticket-card")).toHaveCount(3);
  await expect(card("4").getByText("No match", { exact: true })).toBeVisible();
  await expect(
    card("4").getByLabel("Outcome: loss", { exact: true }),
  ).toHaveText("LOSS");
  await expect(
    card("5").getByLabel("Outcome: win", { exact: true }),
  ).toHaveText("WIN");
  await expect(
    card("6").getByLabel("Outcome: loss", { exact: true }),
  ).toHaveText("LOSS");
  for (const id of ["4", "6"])
    await expect(
      card(id).locator(".ticket-card-top .number-pair > span").first(),
    ).toHaveText("01");
  await expect(
    card("4").getByRole("button", { name: "Close ticket", exact: true }),
  ).toHaveCount(0);
  await expect(
    card("4").getByRole("button", { name: "Claim prize", exact: true }),
  ).toHaveCount(0);
  for (const id of ["4", "5", "6"])
    await expect(
      card(id).getByRole("button", { name: "Record draw result", exact: true }),
    ).toHaveCount(0);
  await expect(
    card("5").getByText("Prize claimed", { exact: true }),
  ).toBeVisible();
  await expect(card("6").getByText("Closed", { exact: true })).toBeVisible();
  for (const id of ["5", "6"])
    await expect(
      card(id).getByRole("button", { name: /^(Claim prize|Close ticket)$/ }),
    ).toHaveCount(0);
  await expect(
    card("4").getByText("Recorded result", { exact: true }),
  ).toBeVisible();
  assert.deepEqual(
    await card("4")
      .locator(".ticket-result .number-pair > span")
      .allTextContents(),
    ["06", "09"],
  );
  await expect(page.getByRole("button", { name: /^View result/ })).toHaveCount(
    0,
  );
  await expect(page.locator(".ticket-actions")).toHaveCount(0);
  assert.equal(methods.has("sendTransaction"), false);
  assert.ok(methods.get("simulateTransaction") >= 1);
  await expect(page.locator(".ticket-card")).toHaveCount(3);

  const links = await history
    .locator("a.history-link")
    .evaluateAll((entries) => entries.map((entry) => entry.href));
  for (const filter of ["Ongoing", "Win", "Done"]) {
    await selectTicketFilter(filter);
    links.push(
      ...(await page
        .locator(".tickets-panel a.history-link")
        .evaluateAll((entries) => entries.map((entry) => entry.href))),
    );
  }
  const publishedTimes = new Set(resultData.map((result) => result.drawTime));
  const ticketsWithResults = ticketData.filter((ticket) =>
    publishedTimes.has(ticket.drawTime),
  ).length;
  assert.equal(
    links.length,
    tickets.length + ticketsWithResults + Math.min(10, resultData.length),
  );
  const knownAddresses = new Set(
    [...tickets, ...results].map((entry) => entry.pubkey),
  );
  for (const href of links) {
    const url = new URL(href);
    assert.equal(url.origin, "https://explorer.solana.com");
    assert.equal(url.searchParams.get("cluster"), "devnet");
    assert.ok(knownAddresses.has(url.pathname.split("/").at(-1)));
  }
  const beforeSearch = {
    programs: methods.get("getProgramAccounts"),
    multiple: methods.get("getMultipleAccounts"),
  };
  await history.getByLabel("From date", { exact: true }).fill("2026-10-27");
  await history.getByLabel("To date", { exact: true }).fill("2026-10-27");
  await history.getByRole("button", { name: "Search", exact: true }).click();
  await expect(history.locator("tbody tr")).toHaveCount(2);
  await history
    .getByLabel("Draw session", { exact: true })
    .selectOption("unknown");
  await history.getByRole("button", { name: "Search", exact: true }).click();
  await expect(history.locator("tbody tr")).toHaveCount(2);
  await expect(history.getByText("19 – 03", { exact: true })).toBeVisible();
  await expect(
    history.locator("tbody").getByText("Type not recorded", { exact: true }),
  ).toHaveCount(2);
  await expect(history.getByText("02 – 22", { exact: true })).toBeVisible();
  await expect(
    history
      .locator("tbody")
      .getByText("4 PM (previous schedule)", { exact: true }),
  ).toHaveCount(0);
  await history
    .getByLabel("Draw session", { exact: true })
    .selectOption("quick");
  await history.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    history.getByText("No draws match these filters", { exact: true }),
  ).toBeVisible();
  await history.getByLabel("From date", { exact: true }).fill("2026-10-28");
  await history.getByLabel("To date", { exact: true }).fill("2026-10-28");
  await history
    .getByLabel("Draw session", { exact: true })
    .selectOption("unknown");
  await history.getByRole("button", { name: "Search", exact: true }).click();
  await expect(history.locator("tbody tr")).toHaveCount(3);
  await history.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(history.locator("tbody tr")).toHaveCount(resultData.length);
  await history.getByLabel("From date", { exact: true }).fill("2026-10-28");
  await history.getByLabel("To date", { exact: true }).fill("2026-10-27");
  await history.getByRole("button", { name: "Search", exact: true }).click();
  await expect(history.getByRole("alert")).toHaveText(
    "From date must be on or before To date.",
  );
  await history.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(history.getByRole("alert")).toHaveCount(0);
  await expect(history.locator("tbody tr")).toHaveCount(resultData.length);
  await history.getByLabel("Draw session", { exact: true }).selectOption("6");
  await history.getByRole("button", { name: "Search", exact: true }).click();
  await expect(history.locator("tbody tr")).toHaveCount(1);
  await expect(
    history.locator("tbody").getByText("6 AM daily draw", { exact: true }),
  ).toBeVisible();
  await expect(
    history.getByText("Prize 2 test SOL", { exact: true }),
  ).toBeVisible();
  await history
    .getByLabel("Draw session", { exact: true })
    .selectOption("quick");
  await history.getByRole("button", { name: "Search", exact: true }).click();
  await expect(history.locator("tbody tr")).toHaveCount(1);
  await expect(
    history.locator("tbody").getByText("Quick draw", { exact: true }),
  ).toBeVisible();
  await expect(
    history
      .locator("tbody")
      .getByText("4 PM (previous schedule)", { exact: true }),
  ).toHaveCount(0);
  await history.getByRole("button", { name: "Clear", exact: true }).click();
  assert.deepEqual(
    {
      programs: methods.get("getProgramAccounts"),
      multiple: methods.get("getMultipleAccounts"),
    },
    beforeSearch,
    "Local history searches must not request on-chain account scans",
  );
  const selectedDraw = await page.locator("#draw-mode").inputValue();
  await page.clock.fastForward(4_000);
  await expect(page.locator("#draw-mode")).toHaveValue(selectedDraw);
  await expect(
    page.getByText(
      "This draw has started. Choose an upcoming draw; your selection will not move automatically.",
      { exact: true },
    ),
  ).toBeVisible();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1100 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
      `Populated tickets overflow at ${width}px`,
    );
    const dates = history.locator('input[type="date"]');
    for (const date of await dates.all()) {
      const bounds = await date.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
      if (width <= 620)
        assert.equal(
          await date.evaluate((input) => getComputedStyle(input).fontSize),
          "16px",
        );
    }
    await history.getByLabel("From date", { exact: true }).tap();
    await page.keyboard.press("Escape");
    await history.getByLabel("From date", { exact: true }).fill("2026-10-27");
    await history.getByLabel("To date", { exact: true }).fill("2026-10-27");
    await expect(
      history.getByLabel("From date", { exact: true }),
    ).toHaveAttribute("max", "2026-10-27");
    await expect(
      history.getByLabel("To date", { exact: true }),
    ).toHaveAttribute("min", "2026-10-27");
    await history.getByRole("button", { name: "Search", exact: true }).tap();
    await expect(history.locator("tbody tr")).toHaveCount(2);
    await history.getByRole("button", { name: "Clear", exact: true }).tap();
    await expect(history.locator("tbody tr")).toHaveCount(resultData.length);
  }
  await page.screenshot({
    path: "test-results/uat-tickets.png",
    fullPage: true,
  });
  assert.deepEqual(
    {
      programs: methods.get("getProgramAccounts"),
      multiple: methods.get("getMultipleAccounts"),
    },
    beforeSearch,
    "Mobile date searches must remain local",
  );
  await page.clock.fastForward(9000);
  rateLimited = true;
  const refreshButton = page.getByRole("button", {
    name: "Refresh tickets and results",
  });
  await refreshButton.click();
  await expect(
    page.getByText(
      /Temporarily rate-limited\. Showing last loaded data\. Try again in \d+s\./,
    ),
  ).toBeVisible();
  await expect(page.locator(".ticket-card")).toHaveCount(3);
  await expect(history.locator("tbody tr")).toHaveCount(resultData.length);
  await expect(
    history.getByText(
      "Showing last loaded results. Use Refresh to check the blockchain again.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByText("raw upstream detail should stay hidden", { exact: false }),
  ).toHaveCount(0);
  await expect(refreshButton).toBeDisabled();
  await refreshButton.evaluate((button) => {
    for (let i = 0; i < 20; i += 1) button.click();
  });
  assert.equal(rateLimitedRequests, 1);
  rateLimited = false;
  await page.clock.fastForward(9000);
  await refreshButton.click();
  await expect(
    page.getByText("Temporarily rate-limited.", { exact: false }),
  ).toHaveCount(0);
  await expect(page.locator(".ticket-card")).toHaveCount(3);
  await page.clock.fastForward(9000);
  uatEnabled = false;
  await page
    .getByRole("button", { name: "Refresh tickets and results" })
    .click();
  await expect(
    page.getByText("The on-chain game setup is awaiting verification.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByText("UAT test mode:", { exact: false })).toHaveCount(
    0,
  );
  await expect(page.locator("#draw-mode option[value='quick']")).toHaveCount(0);
  rateLimited = true;
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("link", { name: "Your tickets", exact: true }).click();
  await expect(
    page.getByText(/Temporarily rate-limited\. Showing last loaded data\./),
  ).toBeVisible();
  await expect(page.locator(".ticket-card")).toHaveCount(2);
  await expect(
    page
      .locator(".tickets-panel")
      .getByText("Tickets unavailable", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Draw results", exact: true }).click();
  await expect(history.locator("tbody tr")).toHaveCount(resultData.length);
  await selectTicketFilter("Win");
  await expect(
    page.getByRole("button", { name: "Claim all (1)", exact: true }),
  ).toBeDisabled();
  await selectTicketFilter("Ongoing");
  rateLimited = false;
  await page.clock.fastForward(9000);
  await refreshButton.click();
  await expect(page.locator(".ticket-card")).toHaveCount(2);
  await expect(
    page.getByText("Dodos has not loaded yet.", { exact: false }),
  ).toHaveCount(0);
  assert.deepEqual(failures, []);
  uatEnabled = true;
  rulesData[0] = 4;
  const referralPanel = page.locator("#referrals");
  const inviter = new PublicKey(new Uint8Array(32).fill(3));
  await page.goto(
    `${origin}/dev/dummy-wallet.html?ref=${inviter.toBase58()}#referrals`,
    { waitUntil: "networkidle" },
  );
  await expect(
    referralPanel.getByText("Not enabled", { exact: true }),
  ).toBeVisible();
  await expect(referralPanel.locator(".referral-counts dd")).toHaveText([
    "—",
    "—",
    "—",
  ]);
  await expect(
    referralPanel.getByLabel("Use a referral code", { exact: true }),
  ).toHaveValue(inviter.toBase58());
  await expect(
    referralPanel.getByRole("button", {
      name: "Review in wallet & accept",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    referralPanel.getByText(/Nothing is recorded until you approve/),
  ).toBeVisible();
  const [profileAddress, profileBump] = getReferralPda(wallet);
  async function setReferralProfile({ sharing = true, benefits = true } = {}) {
    accounts.set(
      profileAddress.toBase58(),
      rpcAccount(
        await coder.encode("ReferralProfile", {
          version: 1,
          bump: profileBump,
          owner: wallet,
          referrer: inviter,
          sharing_enabled: sharing,
          benefits_enabled: benefits,
          binding_locked: true,
          qualified: false,
          first_ticket: new PublicKey(ticketData[4].address),
          registered_count: new BN(17),
          qualified_count: new BN(9),
        }),
      ),
    );
  }
  await setReferralProfile();
  await page.reload({ waitUntil: "networkidle" });
  await expect(referralPanel.locator(".referral-code-block code")).toHaveText(
    wallet.toBase58(),
  );
  await expect(referralPanel.locator(".referral-counts dd")).toHaveText([
    "17",
    "9",
    "1",
  ]);
  await expect(referralPanel.locator(".referral-attribution code")).toHaveText(
    inviter.toBase58(),
  );
  await expect(referralPanel.locator("#referral-code-input")).toHaveCount(0);
  await expect(
    referralPanel.getByRole("button", {
      name: "Remove my referral benefits",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(page.locator(".ticket-total")).toHaveText(
    /Ticket total · referral price0\.006199991 SOL/,
  );
  await page.locator("#draw-mode").selectOption("quick");
  await expect(page.locator(".ticket-total")).toHaveText(/0\.007099991 SOL/);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await referralPanel
    .getByRole("button", { name: "Copy code", exact: true })
    .click();
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    wallet.toBase58(),
  );
  await referralPanel
    .getByRole("button", { name: "Copy link", exact: true })
    .click();
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    `${origin}/?ref=${wallet.toBase58()}#referrals`,
  );
  await setReferralProfile({ sharing: false, benefits: false });
  await page.reload({ waitUntil: "networkidle" });
  await expect(referralPanel.locator(".referral-code-block code")).toHaveText(
    "Not enabled",
  );
  await expect(referralPanel.locator(".referral-counts dd")).toHaveText([
    "17",
    "9",
    "1",
  ]);
  await expect(
    referralPanel.getByRole("button", {
      name: "Restore my referral benefits",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(page.locator(".ticket-total")).toHaveText(
    /Ticket total0\.00625 SOL/,
  );
  assert.equal(methods.get("sendTransaction") ?? 0, 0);
  assert.deepEqual(failures, []);
  await page.route(
    (url) => url.pathname === "/dev/dummy-wallet.jsx",
    async (route) => {
      const response = await route.fetch();
      let source = await response.text();
      assert.ok(source.includes("signTransaction: void 0"));
      assert.ok(source.includes("signAllTransactions: void 0"));
      source = source
        .replace("import { PublicKey }", "import { PublicKey, Connection }")
        .replace(
          "const publicKey =",
          `Connection.prototype.confirmTransaction = function(strategy, commitment) { return pollTransaction(this, strategy, commitment); };
Connection.prototype.usesHttpPolling = true;
let simulatedApprovals = 0;
async function simulatedSign(transaction) {
  transaction.addSignature(publicKey, new Uint8Array(64).fill(++simulatedApprovals));
  const serialize = transaction.serialize.bind(transaction);
  transaction.serialize = (options) => serialize({ ...options, verifySignatures: false });
  return transaction;
}
const publicKey =`,
        )
        .replace("signTransaction: void 0", "signTransaction: simulatedSign")
        .replace(
          "signAllTransactions: void 0",
          "signAllTransactions: async (transactions) => Promise.all(transactions.map(simulatedSign))",
        );
      await route.fulfill({
        response,
        body: `import { pollTransaction } from "/src/lib/uatConnection.js";\n${source}`,
      });
    },
  );
  signingScenario = true;
  rulesData[0] = 3;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.setSystemTime(new Date(now - 60_000));
  await page.goto(`${origin}/dev/dummy-wallet.html?test-purchase=1`, {
    waitUntil: "networkidle",
  });
  await expect(
    page
      .locator(".dashboard-notice")
      .getByText(/Only approved test wallets can play/),
  ).toBeVisible();
  const initialDaily = await page.locator("#draw-mode").inputValue();
  const buyButton = page.getByRole("button", { name: /^Buy ticket/ });
  async function buyAnotherPair(first, second, expectedCount) {
    await page
      .getByRole("button", { name: `Number ${first}`, exact: true })
      .tap();
    await page
      .getByRole("button", { name: `Number ${second}`, exact: true })
      .tap();
    await expect(buyButton).toBeEnabled();
    await buyButton.tap();
    await expect.poll(() => completedPurchases.length).toBe(expectedCount);
    await expect(page.getByText(/^Ticket confirmed for/)).toBeVisible();
    await expect(
      page.locator(".selection-summary .number-pair > span"),
    ).toHaveText(["—", "—"]);
    await expect(page.locator(".purchase-button")).toHaveText(/Buy ticket/);
    await expect(page.locator("#your-tickets .count-badge")).toHaveText(
      String(ticketData.length + expectedCount),
    );
  }
  await buyAnotherPair(3, 4, 1);
  await expect(page.locator("#draw-mode")).toHaveValue(initialDaily);
  await buyAnotherPair(4, 3, 2);
  await expect(page.locator("#draw-mode")).toHaveValue(initialDaily);
  await page.locator("#draw-mode").selectOption("quick");
  await buyAnotherPair(5, 6, 3);
  await buyAnotherPair(6, 5, 4);
  assert.equal(
    new Set(completedPurchases.map((ticket) => ticket.nonce)).size,
    4,
  );
  assert.deepEqual(
    completedPurchases.map((ticket) => ticket.daily),
    [true, true, false, false],
  );
  assert.equal(completedPurchases[0].drawTime, completedPurchases[1].drawTime);
  assert.equal(completedPurchases[2].drawTime, completedPurchases[3].drawTime);
  assert.deepEqual(
    completedPurchases.map((ticket) => ticket.paid),
    [6_250_000, 6_250_000, 7_200_000, 7_200_000],
  );
  assert.equal(
    await page.evaluate(() =>
      Object.keys(localStorage).some((key) =>
        key.startsWith("hiperia:purchase:"),
      ),
    ),
    false,
  );
  await page.getByRole("link", { name: "Your tickets", exact: true }).tap();
  await expect(page.locator(".ticket-card")).toHaveCount(6);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
    false,
  );
  assert.equal(methods.get("sendTransaction"), 4);
  assert.deepEqual(failures, []);
  console.log(
    JSON.stringify({
      populatedTickets: 6,
      referralStates: [
        "no-profile",
        "sharing-and-benefits-on",
        "sharing-and-benefits-off",
      ],
      referralPricesReadFromMetadata: true,
      fixedPairAnnouncementsHidden: true,
      recordedResultsPreserved: true,
      mobileCompletedPurchases: completedPurchases.length,
      repeatedDailyAndQuickEntries: true,
      simulatedTransactionsOnly: true,
      referralsNeverAutoSubmit: true,
      ticketStateFilters: ["ongoing", "win", "done"],
      claimAllDisabledWithoutEligibleSigner: true,
      manualCloseRemoved: true,
      resultLabels: true,
      inlineRecordedResults: true,
      redundantViewResultRemoved: true,
      futureTicketsHaveCountdownOnly: true,
      legacyTicketOnePreserved: true,
      newTicketRange: "02-22",
      resultsDateAndSessionFilters: true,
      mobileDateTouchAndRange: true,
      resultSearchAvoidsRpc: true,
      allPublishedResultsVisible: resultData.length,
      recordedPrizeSnapshots: true,
      quickSessionMetadata: true,
      explorerLinks: links.length,
      selectedDrawPreserved: true,
      uatMarkerChecked: true,
      refreshSpamBlocked: true,
      lastGoodDataPreserved: true,
      initialFailureRecoverable: true,
      pageErrors: failures,
      rpcMethods: Object.fromEntries(methods),
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      fixtureFailures: failures,
      rpcMethods: Object.fromEntries(methods),
    }),
  );
  throw error;
} finally {
  await browser.close();
}

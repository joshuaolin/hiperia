import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { chromium, expect } from "@playwright/test";
import idl, { PROGRAM_ID } from "../src/lib/onchain/idl.js";
import {
  getConfigPda,
  getTicketPda,
  getResultPda,
} from "../src/lib/onchain/pdas.js";
import { DEVNET_GENESIS_HASH } from "../src/lib/network.js";

const origin = process.env.UI_TEST_ORIGIN || "http://127.0.0.1:5173";
const now = Date.parse("2026-10-28T05:59:58Z");
const wallet = new PublicKey(new Uint8Array(32).fill(1));
const coder = new BorshAccountsCoder(idl);
const padding = new Array(32).fill(0);
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
];
for (const { drawTime, numbers } of resultData) {
  const [address, bump] = getResultPda(drawTime);
  const account = rpcAccount(
    await coder.encode("ResultAccount", {
      draw_time: new BN(drawTime),
      numbers,
      is_published: true,
      bump,
      padding,
    }),
  );
  accounts.set(address.toBase58(), account);
  results.push({ pubkey: address.toBase58(), account });
}

let uatEnabled = true;
let rateLimited = false;
let rateLimitedRequests = 0;
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
  });
  await page.clock.install({ time: new Date(now) });
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
  await expect(
    page.getByText("UAT test mode:", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText(/live program records 06 → 09/),
  ).toBeVisible();
  await expect(page.locator(".ticket-card")).toHaveCount(6);
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
  await expect(
    guide.getByRole("heading", { name: "How to play Dodos", exact: true }),
  ).toBeVisible();
  await expect(
    guide.locator(".dodos-guide-facts").getByRole("row", { name: /^Numbers/ }),
  ).toHaveText(/Choose 2 different numbers, 02\s*–\s*22/);
  const history = page.locator(".draw-results");
  await expect(history.locator("tbody tr")).toHaveCount(resultData.length);
  const card = (id) =>
    page.locator(".ticket-card").filter({
      has: page.locator(
        `a[href^="https://explorer.solana.com/address/${ticketData.find((ticket) => ticket.id === id).address}"]`,
      ),
    });

  await expect(card("1").getByText("Upcoming", { exact: true })).toBeVisible();
  await expect(
    card("1").getByRole("button", { name: "Record draw result", exact: true }),
  ).toBeDisabled();
  await expect(
    card("2").getByText("Awaiting result", { exact: true }),
  ).toBeVisible();
  await expect(
    card("2").getByRole("button", { name: "Record draw result", exact: true }),
  ).toBeVisible();
  await expect(
    card("3").getByText("Prize ready", { exact: true }),
  ).toBeVisible();
  await expect(
    card("3").getByRole("button", { name: "Claim prize", exact: true }),
  ).toBeVisible();
  await expect(
    card("3").getByRole("button", { name: "Close ticket", exact: true }),
  ).toHaveCount(0);
  await expect(card("4").getByText("No match", { exact: true })).toBeVisible();
  for (const id of ["4", "6"])
    await expect(
      card(id).locator(".ticket-card-top .number-pair > span").first(),
    ).toHaveText("01");
  await expect(
    card("4").getByRole("button", { name: "Close ticket", exact: true }),
  ).toBeVisible();
  await expect(
    card("4").getByRole("button", { name: "Claim prize", exact: true }),
  ).toHaveCount(0);
  for (const id of ["3", "4", "5", "6"])
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
    page.getByRole("button", { name: "Claim prize", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Close ticket", exact: true }),
  ).toBeDisabled();

  const beforeReads = methods.get("getAccountInfo");
  await card("3")
    .getByRole("button", { name: "View result · free", exact: true })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Both numbers match in order. Claim prize sends" }),
  ).toBeVisible();
  assert.ok(methods.get("getAccountInfo") > beforeReads);
  await card("4")
    .getByRole("button", { name: "View result · free", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "No match. Recorded result:" }),
  ).toBeVisible();
  assert.equal(methods.has("sendTransaction"), false);
  assert.equal(methods.has("simulateTransaction"), false);
  await expect(page.locator(".ticket-card")).toHaveCount(6);

  const links = await page
    .locator("a.history-link")
    .evaluateAll((entries) => entries.map((entry) => entry.href));
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
  await history.getByLabel("Draw session", { exact: true }).selectOption("14");
  await history.getByRole("button", { name: "Search", exact: true }).click();
  await expect(history.locator("tbody tr")).toHaveCount(1);
  await expect(history.getByText("19 – 03", { exact: true })).toBeVisible();
  await expect(history.getByText("2 PM draw", { exact: true })).toBeVisible();
  await history.getByLabel("Draw session", { exact: true }).selectOption("16");
  await history.getByRole("button", { name: "Search", exact: true }).click();
  await expect(history.locator("tbody tr")).toHaveCount(1);
  await expect(history.getByText("02 – 22", { exact: true })).toBeVisible();
  await expect(history.getByText("4 PM draw", { exact: true })).toBeVisible();
  await history
    .getByLabel("Draw session", { exact: true })
    .selectOption("test");
  await history.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    history.getByText("No draws match these filters", { exact: true }),
  ).toBeVisible();
  await history.getByLabel("From date", { exact: true }).fill("2026-10-28");
  await history.getByLabel("To date", { exact: true }).fill("2026-10-28");
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
  }
  await page.screenshot({
    path: "test-results/uat-tickets.png",
    fullPage: true,
  });
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
  await expect(page.locator(".ticket-card")).toHaveCount(6);
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
  await expect(page.locator(".ticket-card")).toHaveCount(6);
  await page.clock.fastForward(9000);
  uatEnabled = false;
  await page
    .getByRole("button", { name: "Refresh tickets and results" })
    .click();
  await expect(
    page.getByText(
      "The fixed-result UAT update is awaiting on-chain configuration.",
      { exact: false },
    ),
  ).toBeVisible();
  await expect(page.getByText("UAT test mode:", { exact: false })).toHaveCount(
    0,
  );
  await expect(page.locator("#draw-mode option[value='quick']")).toHaveCount(0);
  rateLimited = true;
  await page.reload({ waitUntil: "networkidle" });
  await expect(
    page.getByText(/Temporarily rate-limited\. Dodos has not loaded yet\./),
  ).toBeVisible();
  await expect(page.locator(".ticket-card")).toHaveCount(0);
  await expect(
    page
      .locator(".tickets-panel")
      .getByText("Tickets unavailable", { exact: true }),
  ).toBeVisible();
  rateLimited = false;
  await page.clock.fastForward(9000);
  await refreshButton.click();
  await expect(page.locator(".ticket-card")).toHaveCount(6);
  await expect(
    page.getByText("Dodos has not loaded yet.", { exact: false }),
  ).toHaveCount(0);
  assert.deepEqual(failures, []);
  console.log(
    JSON.stringify({
      populatedTickets: 6,
      resultLabels: true,
      readOnlyResultCheck: true,
      legacyTicketOnePreserved: true,
      newTicketRange: "02-22",
      resultsDateAndSessionFilters: true,
      resultSearchAvoidsRpc: true,
      allPublishedResultsVisible: resultData.length,
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
} finally {
  await browser.close();
}

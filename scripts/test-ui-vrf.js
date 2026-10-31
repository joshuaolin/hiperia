import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
import { chromium, expect } from "@playwright/test";
import { DEVNET_GENESIS_HASH } from "../src/lib/network.js";
import { PROGRAM_ID as LEGACY_PROGRAM_ID } from "../src/lib/onchain/idl.js";

const origin = process.env.UI_TEST_ORIGIN || "http://127.0.0.1:5173";
const program = "6SWK5s22L7HDzvNdFbMhTjtMQNPfUmMzM4D8S3ZRRgRy";
const address = (value) =>
  new PublicKey(new Uint8Array(32).fill(value)).toBase58();
const now = Date.parse("2026-10-30T01:00:00Z");
const network = {
  allowed: true,
  label: "Devnet",
  cluster: "devnet",
  genesisHash: DEVNET_GENESIS_HASH,
};
const oracleProgram = address(40);
const tickets = Array.from({ length: 7 }, (_, index) => {
  const id = String(index + 1);
  const drawTime = now / 1000 - 60 - index;
  return {
    id,
    address: address(50 + index),
    numbers: [7, 13],
    drawTime,
    settled: false,
    refunded: false,
    refundEligible: false,
    legacy: false,
    sourceProgram: program,
    paidLamports: 7_200_017,
    payoutLamports: 1_000_000_037,
    result: null,
    draw: {
      address: address(70 + index),
      status: [
        "pending",
        "fulfilled",
        "open",
        "pending",
        "final",
        "pending",
        "final",
      ][index],
      oracleRequest: index === 2 ? null : address(90 + index),
      requestedAt: drawTime,
      requestedBy: address(1),
      seed: Array(32).fill(index + 1),
    },
  };
});
tickets[3].refundEligible = true;
tickets[3].drawTime = now / 1000 - 86_401;
tickets[3].draw.status = "open";
tickets[3].draw.oracleRequest = null;
tickets[4].legacy = true;
tickets[4].sourceProgram = LEGACY_PROGRAM_ID;
tickets[4].draw = null;
tickets[4].numbers = [6, 9];
tickets[4].result = {
  id: address(104),
  drawTime: tickets[4].drawTime,
  isPublished: true,
  numbers: [6, 9],
  drawType: "quick",
  payoutLamports: 1_000_000_000,
  ticketCostLamports: 7_200_000,
  sourceProgram: LEGACY_PROGRAM_ID,
  legacy: true,
  randomnessMode: "legacy-fixed",
};
tickets[5].refunded = true;
tickets[5].settled = true;
tickets[6].settled = true;
tickets[6].result = {
  id: tickets[6].draw.address,
  drawTime: tickets[6].drawTime,
  isPublished: true,
  numbers: [7, 13],
  drawType: "quick",
  payoutLamports: 1_000_000_037,
  ticketCostLamports: 7_200_017,
  sourceProgram: program,
  legacy: false,
  randomnessMode: "orao-vrf",
  oracleRequest: tickets[6].draw.oracleRequest,
  oracleProgram,
};
const fixture = {
  now,
  tickets,
  network,
  programIds: [program, LEGACY_PROGRAM_ID],
  results: [tickets[4].result, tickets[6].result],
  config: {
    rulesRevision: 6,
    randomnessMode: "orao-vrf",
    randomnessVerified: true,
    publicPlayEnabled: true,
    publicResultsEnabled: true,
    quickTicketCostLamports: "7200017",
    dailyTicketCostLamports: "6250011",
    quickPayoutLamports: "1000000037",
    dailyPayoutLamports: "2000000074",
    minNumber: 2,
    maxNumber: 22,
    pickCount: 2,
    dailyHours: [2, 6, 10, 14, 18, 22],
    scheduleIntervalSeconds: 14_400,
    randomnessRules: {
      oracleProgram,
      refundAfterSeconds: 86_400,
      pendingRequestSpace: 749,
    },
    capacity: {
      freeLamports: 3_000_000_047,
      reservedLamports: 4_000_000_148,
      vaultLamports: 7_000_890_195,
    },
  },
};
const quote = {
  feeLamports: 1_200_013,
  pendingRentLamports: 6_100_019,
  clientRentLamports: 890_880,
  totalLamports: 8_190_912,
  treasury: address(41),
  networkAddress: address(42),
  oracleProgram,
};

mkdirSync("test-results", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
const requests = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
    isMobile: true,
    hasTouch: true,
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(
    (url) => url.hostname === "api.devnet.solana.com",
    async (route) => {
      const request = route.request().postDataJSON();
      requests.push(request.method);
      assert.ok(
        ["getGenesisHash", "getBalance"].includes(request.method),
        "This render fixture must never send a blockchain transaction",
      );
      await route.fulfill({
        json: {
          jsonrpc: "2.0",
          id: request.id,
          result:
            request.method === "getGenesisHash"
              ? DEVNET_GENESIS_HASH
              : { context: { slot: 100 }, value: 2_000_000_000 },
        },
      });
    },
  );
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
    (url) => url.pathname === "/src/games/dodos/useDodosGame.js",
    async (route) => {
      const original = await (await route.fetch()).text();
      const reactUrl = original.match(
        /from\s+["']([^"']*\/react\.js\?[^"']*)["']/,
      )?.[1];
      assert.ok(
        reactUrl,
        "The fixture must use the app's existing React module",
      );
      const source = `import React from ${JSON.stringify(reactUrl)};
const { useState } = React;
const initial = ${JSON.stringify(fixture)};
const costs = ${JSON.stringify(quote)};
window.__oracleUiActions = [];
export function useDodosGame() {
  const [tickets, setTickets] = useState(initial.tickets);
  const [oracleQuote, setQuote] = useState(null);
  const [selectedNumbers, setNumbers] = useState([]);
  const [drawChoice, setDraw] = useState(String(initial.now / 1000 + 18000));
  const [capacity, setCapacity] = useState(initial.config.capacity);
  const [randomnessVerified, setVerified] = useState(true);
  const [metadataAvailable, setMetadataAvailable] = useState(true);
  const action = (type, ticket) => window.__oracleUiActions.push(type + (ticket ? ':' + ticket.id : ''));
  window.__setTestCapacity = setCapacity;
  window.__setTestVerification = setVerified;
  window.__setTestMetadataAvailable = setMetadataAvailable;
  return { ...initial, tickets, config: metadataAvailable ? { ...initial.config, capacity, randomnessVerified } : null, oracleQuote,
    connected: true, publicGame: true, canSign: true, authorized: metadataAvailable, uatReady: metadataAvailable, networkAllowed: true, historyLoaded: true,
    isLoading: false, loadFailed: false, refreshWarning: false, refreshCooldown: 0,
    pending: false, selectedNumbers, drawChoice, quickDraw: drawChoice === 'quick', drawExpired: false,
    dailyDraws: [initial.now / 1000 + 18000], setDrawChoice: setDraw,
    select(number) { setNumbers((values) => values.includes(number) ? values.filter((n) => n !== number) : [...values, number]); },
    clearSelection() { setNumbers([]); }, randomize() { setNumbers([3, 4]); }, purchase() { action('purchase'); },
    reviewReveal(ticket) { action('quote', ticket); setQuote({ drawTime: ticket.drawTime, ...costs }); },
    publish(ticket) { action(ticket.draw.status === 'fulfilled' ? 'complete' : 'reveal', ticket);
      setTickets((values) => values.map((entry) => entry.id !== ticket.id ? entry : ticket.draw.status === 'fulfilled'
        ? { ...entry, draw: { ...entry.draw, status: 'final' }, result: { id: entry.draw.address, isPublished: true, numbers: [7, 13] } }
        : { ...entry, draw: { ...entry.draw, status: 'pending', oracleRequest: ${JSON.stringify(address(120))} } })); },
    refresh() { action('refresh'); setTickets((values) => values.map((entry) => entry.id === '3' ? { ...entry, draw: { ...entry.draw, status: 'fulfilled' } } : entry)); },
    refund(ticket) { action('refund', ticket); setTickets((values) => values.map((entry) => entry.id === ticket.id ? { ...entry, refunded: true, settled: true } : entry)); },
    settle(ticket) { action('claim', ticket); }, claimAll() { action('claimAll'); },
  };
}`;
      await route.fulfill({
        contentType: "application/javascript",
        body: source,
      });
    },
  );
  await page.goto(`${origin}/dev/dummy-wallet.html`, {
    waitUntil: "networkidle",
  });
  await expect(
    page.getByText(/^Public Devnet · Verifiable randomness\./),
  ).toBeVisible();
  await expect(
    page.getByText(/draw results are fixed, not random/),
  ).toHaveCount(0);
  await expect(page.locator("#referrals")).toHaveCount(0);
  assert.deepEqual(await page.evaluate(() => window.__oracleUiActions), []);
  await expect(page.locator(".draw-stats")).toContainText(
    "0.006250011 SOL entry",
  );
  await expect(page.locator(".draw-stats")).toContainText(
    "0.007200017 SOL entry",
  );
  await page.getByRole("link", { name: "Your tickets", exact: true }).click();
  const card = (id) =>
    page.locator(".ticket-card").filter({
      has: page.locator(
        `a[href^="https://explorer.solana.com/address/${tickets[Number(id) - 1].address}"]`,
      ),
    });
  await expect(
    card("1").getByText("Oracle pending", { exact: true }),
  ).toBeVisible();
  await expect(
    card("1").getByRole("button", { name: "Reveal result", exact: true }),
  ).toHaveCount(0);
  await expect(
    card("2").getByRole("button", { name: "Complete draw", exact: true }),
  ).toBeEnabled();
  await expect(
    card("4").getByRole("button", { name: "Refund entry", exact: true }),
  ).toBeEnabled();
  await expect(
    card("4").getByRole("button", {
      name: "Review reveal costs",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    card("1").getByRole("button", { name: "Refund entry", exact: true }),
  ).toHaveCount(0);
  await card("3")
    .getByRole("button", { name: "Review reveal costs", exact: true })
    .click();
  await expect(card("3").locator(".oracle-cost-quote")).toContainText(
    "0.008190912 SOL",
  );
  assert.deepEqual(await page.evaluate(() => window.__oracleUiActions), [
    "quote:3",
  ]);
  await card("3")
    .getByRole("button", { name: "Reveal result", exact: true })
    .click();
  await expect(
    card("3").getByText("Oracle pending", { exact: true }),
  ).toBeVisible();
  await card("3")
    .getByRole("button", { name: "Check oracle status", exact: true })
    .click();
  await expect(
    card("3").getByRole("button", { name: "Complete draw", exact: true }),
  ).toBeVisible();
  await card("3")
    .getByRole("button", { name: "Complete draw", exact: true })
    .click();
  await card("4")
    .getByRole("button", { name: "Refund entry", exact: true })
    .click();
  const filters = page.getByRole("group", {
    name: "Filter your tickets",
    exact: true,
  });
  await filters.getByRole("button", { name: /^Win\b/ }).click();
  await expect(
    card("3").getByText("Prize ready", { exact: true }),
  ).toBeVisible();
  await expect(
    card("5").getByText("Legacy ticket", { exact: true }),
  ).toBeVisible();
  await expect(
    card("5").getByRole("button", { name: "Claim prize", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => window.__setTestMetadataAvailable(false));
  await expect(page.locator("#referrals")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Referrals", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("#your-tickets .count-badge")).toHaveText("7");
  await expect(page.locator("#draw-results .count-badge")).toHaveText("2");
  await expect(
    card("3").getByRole("button", { name: "Claim prize", exact: true }),
  ).toBeEnabled();
  await expect(
    card("5").getByRole("button", { name: "Claim prize", exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole("button", { name: /^Claim all/ })).toBeEnabled();
  await page.evaluate(() => window.__setTestMetadataAvailable(true));
  await filters.getByRole("button", { name: /^Done\b/ }).click();
  await expect(
    card("4").getByLabel("Outcome: refunded", { exact: true }),
  ).toHaveText("REFUNDED");
  await expect(
    card("6").getByLabel("Outcome: refunded", { exact: true }),
  ).toHaveText("REFUNDED");
  await expect(
    card("6").getByLabel("Outcome: loss", { exact: true }),
  ).toHaveCount(0);
  await expect(
    card("7").getByLabel("Outcome: win", { exact: true }),
  ).toHaveText("WIN");
  await page.getByRole("link", { name: "Draw results", exact: true }).click();
  const history = page.locator("#draw-results");
  await expect(history.locator("tbody tr")).toHaveCount(2);
  await expect(
    history.getByText("Legacy result", { exact: true }),
  ).toBeVisible();
  await expect(history.getByText("ORAO VRF", { exact: true })).toBeVisible();
  await expect(
    history.getByRole("link", { name: "Oracle request", exact: true }),
  ).toHaveAttribute(
    "href",
    `https://explorer.solana.com/address/${tickets[6].result.oracleRequest}?cluster=devnet`,
  );
  await expect(
    history.getByText("Prize 1.000000037 test SOL", { exact: true }),
  ).toBeVisible();
  await expect(
    history.getByText("Base entry 0.007200017 test SOL", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "How to play", exact: true }).click();
  const guide = page.locator("#dodos-guide");
  await expect(
    guide.getByRole("heading", {
      name: "Reveal and complete the draw",
      exact: true,
    }),
  ).toBeVisible();
  await expect(guide.getByText(/Results are fixed, not random/)).toHaveCount(0);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1100 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
      `VRF UI overflow at ${width}px`,
    );
  }
  await page.evaluate(() =>
    window.__setTestCapacity({
      freeLamports: 0,
      reservedLamports: 4_000_000_148,
      vaultLamports: 4_000_890_148,
    }),
  );
  await expect(
    page.getByRole("button", { name: /Prize reserves full/ }),
  ).toBeDisabled();
  await expect(
    page.getByText(
      /Multiple tickets per draw are allowed; this pause protects every accepted prize/,
    ),
  ).toBeVisible();
  assert.deepEqual(await page.evaluate(() => window.__oracleUiActions), [
    "quote:3",
    "reveal:3",
    "refresh",
    "complete:3",
    "refund:4",
  ]);
  assert.deepEqual(errors, []);
  assert.equal(requests.includes("sendTransaction"), false);
  await page.evaluate(() => window.__setTestVerification(false));
  await expect(
    page.getByText(/^Public Devnet · Verifiable randomness\./),
  ).toHaveCount(0);
  await expect(
    page.getByText(
      /The on-chain randomness configuration could not be verified/,
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Randomness verification required/ }),
  ).toBeDisabled();
  await expect(page.getByText(/Results are fixed, not random/)).toHaveCount(0);
  await page.evaluate(() => window.__setTestVerification(true));
  await page.screenshot({ path: "test-results/vrf-ui.png", fullPage: true });
  console.log(
    JSON.stringify({
      simulatedRenderOnly: true,
      oracleStateActions: true,
      explicitQuoteBeforeReveal: true,
      verifiedMetadataGate: true,
      refundedNotLoss: true,
      legacyClaimRetained: true,
      verifiedClaimsSurviveMetadataFailure: true,
      actualProofLinks: true,
      liveMetadataPrices: true,
      reserveCapacityExplained: true,
      widths: [320, 390, 768, 1440],
      pageErrors: errors,
    }),
  );
} finally {
  await browser.close();
}

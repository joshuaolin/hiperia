import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import { PublicKey } from "@solana/web3.js";
import { DEVNET_GENESIS_HASH } from "../src/lib/network.js";

const origin = process.env.UI_TEST_ORIGIN || "http://127.0.0.1:5173";
const address = (byte) =>
  new PublicKey(new Uint8Array(32).fill(byte)).toBase58();
const now = Date.parse("2026-11-15T00:00:00Z");
const future = now / 1000 + 10800;
const program = address(37);
const wallet = address(1);
const network = {
  allowed: true,
  label: "Devnet",
  cluster: "devnet",
  genesisHash: DEVNET_GENESIS_HASH,
};
const result = (index, numbers) => ({
  id: address(100 + index),
  drawTime: now / 1000 - 120 - index,
  numbers,
  isPublished: true,
  oracleRequest: address(120 + index),
  sourceProgram: program,
  quickDraw: true,
});
const tickets = Array.from({ length: 7 }, (_, index) => ({
  id: address(50 + index),
  address: address(50 + index),
  numbers: [1, 2, 3],
  drawTime: now / 1000 - 120 - index,
  settled: false,
  refunded: false,
  refundEligible: false,
  paidLamports: 6_250_013,
  payoutLamports: 2_500_000_037,
  quickDraw: true,
  sourceProgram: program,
  draw: {
    address: address(100 + index),
    status: ["open", "pending", "fulfilled", "final", "final", "final", "open"][
      index
    ],
    oracleRequest: index === 0 ? null : address(120 + index),
  },
  result:
    index >= 3 && index <= 5
      ? result(
          index,
          index === 5 ? [0, 2, 4] : index === 3 ? [0, 0, 0] : [1, 2, 3],
        )
      : null,
}));
tickets[3].numbers = [0, 0, 0];
tickets[3].drawTime = Date.parse("2026-11-14T18:00:00Z") / 1000;
tickets[3].draw.drawType = "daily";
tickets[3].result.drawType = "daily";
tickets[3].result.drawTime = tickets[3].drawTime;
tickets[3].payoutLamports = 4_750_000_037;
tickets[3].claimFunded = false;
tickets[3].claimFundingVerified = true;
tickets[4].settled = true;
tickets[6].refundEligible = true;
tickets[6].drawTime = now / 1000 - 86_401;
tickets[0].quickDraw = false;
tickets.push({
  ...tickets[0],
  id: address(57),
  address: address(57),
});
const fixture = {
  now,
  network,
  walletAddress: wallet,
  tickets,
  drawResults: [
    tickets[3].result,
    tickets[4].result,
    tickets[5].result,
    { ...result(8, [0, 0, 0]), isPublished: false, status: "open" },
  ],
  config: {
    verified: true,
    revision: 1,
    outcomes: 1000,
    entryLamports: 6_250_013,
    prizeLamports: 4_750_000_037,
    quickEntryLamports: 7_200_019,
    quickPrizeLamports: 2_500_000_037,
    dailyHours: [3, 7, 11, 15, 19, 23],
    programId: program,
    vaultAddress: address(40),
  },
};
const costs = {
  feeLamports: 1_000_013,
  rentLamports: 6_000_019,
  totalLamports: 7_000_032,
};
mkdirSync("test-results", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(
    (url) => url.hostname === "api.devnet.solana.com",
    async (route) => {
      const request = route.request().postDataJSON();
      assert.ok(
        ["getGenesisHash", "getBalance"].includes(request.method),
        "Lemon render fixtures must not send transactions or read game accounts",
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
    (socket) =>
      socket.onMessage((data) => {
        const request = JSON.parse(String(data));
        socket.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            result: request.method.endsWith("Unsubscribe") ? true : 1,
          }),
        );
      }),
  );
  await page.route(
    (url) => url.pathname === "/src/games/lemon/useLemonGame.js",
    async (route) => {
      const original = await (await route.fetch()).text();
      const reactUrl = original.match(
        /from\s+["']([^"']*\/react\.js\?[^"']*)["']/,
      )?.[1];
      assert.ok(reactUrl, "Use the app's existing React module");
      await route.fulfill({
        contentType: "application/javascript",
        body: `import React from ${JSON.stringify(reactUrl)};
const {useState}=React;
const initial=${JSON.stringify(fixture)};
const costs=${JSON.stringify(costs)};
window.__lemonActions=[];
export function useLemonGame(){
 const [numbers,setNumbers]=useState([]),[quick,setQuick]=useState(false),[drawTime,setDraw]=useState(${future}),[quote,setQuote]=useState(null),[tickets,setTickets]=useState(initial.tickets),[rules,setRules]=useState(true),[clock,setClock]=useState(initial.now),[revealQuote,setRevealQuote]=useState(null),[results,setResults]=useState(initial.drawResults);
 const action=(name,ticket)=>window.__lemonActions.push(name+(ticket?':'+ticket.id:''));
 window.__setLemonQuote=setQuote;window.__setLemonClock=setClock;window.__setLemonRules=setRules;window.__setLemonResults=setResults;
 window.__setLemonFunding=(funded,verified=true)=>setTickets(values=>values.map(ticket=>ticket.id===initial.tickets[3].id?{...ticket,claimFunded:funded,claimFundingVerified:verified}:ticket));
 return {...initial,now:clock,config:rules?initial.config:null,tickets,drawResults:results,canSign:true,networkAllowed:true,isLoading:false,pending:false,actionStatus:'idle',selectedNumbers:numbers,quickDraw:quick,selectedDrawTime:drawTime,drawOptions:[{timestamp:${future},label:'Nov 15, 11 AM UTC+8'},{timestamp:${future + 14400},label:'Nov 15, 3 PM UTC+8'}],purchaseQuote:quote,revealQuote,
  setNumber(index,digit){setNumbers(values=>{const next=[...values];next[index]=digit;return next;});},setQuickDraw(value){setQuick(value);setDraw(value?initial.now/1000+60:${future});},setSelectedDrawTime:setDraw,
  buyTicket(){action('buy');},refreshPurchaseQuote(){action('quote');},refresh(){action('refresh');},
  reviewReveal(ticket){action('review',ticket);setRevealQuote({...costs,requiresPayment:true,ticketId:ticket.id,drawTime:ticket.drawTime,walletAddress:initial.walletAddress,sourceProgram:initial.config.programId,validUntil:clock+30000});},
  confirmReveal(){if(!revealQuote)return;action('reveal');setTickets(values=>values.map(ticket=>ticket.sourceProgram===revealQuote.sourceProgram&&ticket.drawTime===revealQuote.drawTime?{...ticket,draw:{...ticket.draw,status:'pending'}}:ticket));setRevealQuote(null);},cancelReveal(){setRevealQuote(null);},
  revealDraw(ticket){action('complete',ticket);setTickets(values=>values.map(entry=>entry.id===ticket.id?{...entry,draw:{...entry.draw,status:'final'},result:{numbers:[1,2,3],isPublished:true}}:entry));},
  claimTicket(ticket){action('claim',ticket);if(window.__lemonConfirmClaim)setTickets(values=>values.map(entry=>entry.id===ticket.id?{...entry,settled:true}:entry));},
  refundTicket(ticket){action('refund',ticket);setTickets(values=>values.map(entry=>entry.id===ticket.id?{...entry,refunded:true,settled:true}:entry));}
 };
}`,
      });
    },
  );
  await page.goto(`${origin}/dev/dummy-wallet.html#lemon`, {
    waitUntil: "networkidle",
  });
  await expect(
    page.getByRole("heading", { name: "Lemon.", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Alice in Wonderland, coming soon" }),
  ).toBeDisabled();
  await expect(page.locator(".lemon-banner")).toContainText("4.750000037 SOL");
  await expect(page.locator(".lemon-banner")).toContainText("2.500000037 SOL");
  await expect(page.locator(".lemon-message")).toHaveCount(0);
  assert.deepEqual(await page.evaluate(() => window.__lemonActions), []);
  await expect(page.locator("#lemon-tickets")).not.toHaveAttribute("open");
  await expect(page.locator("#lemon-results")).not.toHaveAttribute("open");
  await expect(page.locator("#lemon-guide")).not.toHaveAttribute("open");
  await expect(page.locator(".lemon-dashboard .page-description")).toHaveText(
    "Pick your fruit and match all three in order.",
  );
  await expect(page.locator(".lemon-chain-badge")).toHaveText("On-chain");
  await expect(
    page.getByText("A fresh kind of lotto", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Simple picks. Public results." }),
  ).toHaveCount(0);
  await expect(
    page.locator(".lemon-slot em, .lemon-fruit-option em, .lemon-fruit small"),
  ).toHaveCount(0);
  await expect(page.locator(".lemon-buy [aria-label*='digit']")).toHaveCount(0);
  await page
    .getByRole("button", {
      name: "Lemon, for position 1",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", {
      name: "Cherry, for position 2",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", {
      name: "Lemon, for position 3",
      exact: true,
    })
    .click();
  const purchase = page.locator(".lemon-buy-button.button-primary");
  await expect(purchase).toBeDisabled();
  const quote = {
    isReady: true,
    numbers: [0, 1, 0],
    drawTime: future,
    quick: false,
    walletAddress: wallet,
    sourceProgram: program,
    validUntil: now + 30000,
    entryLamports: fixture.config.entryLamports,
    prizeLamports: fixture.config.prizeLamports,
    accountRentLamports: 1_000_021,
    totalLamports: fixture.config.entryLamports + 1_000_021,
  };
  await page.evaluate((value) => window.__setLemonQuote(value), quote);
  await expect(purchase).toBeEnabled();
  await expect(page.locator(".lemon-checkout-total").first()).toContainText(
    "0.007250034 SOL",
  );
  for (const invalid of [
    { ...quote, numbers: [1, 0, 0] },
    { ...quote, walletAddress: address(2) },
    { ...quote, sourceProgram: address(3) },
    { ...quote, quick: true },
    { ...quote, drawTime: future + 14400 },
    { ...quote, validUntil: now - 1 },
  ]) {
    await page.evaluate((value) => window.__setLemonQuote(value), invalid);
    await expect(purchase).toBeDisabled();
  }
  await page.evaluate((value) => window.__setLemonQuote(value), quote);
  await page.evaluate((value) => window.__setLemonClock(value), now + 30001);
  await expect(purchase).toBeDisabled();
  await page.evaluate((value) => window.__setLemonClock(value), now);
  await expect(purchase).toBeEnabled();
  await page
    .locator(".lemon-buy")
    .getByRole("button", { name: "Quick draw", exact: false })
    .click();
  await expect(purchase).toBeDisabled();
  await expect(page.locator(".lemon-buy")).toContainText(
    "Quick entries with the same draw time share a result",
  );
  await page
    .locator(".lemon-buy")
    .getByRole("button", { name: "Daily draw", exact: false })
    .click();
  await page
    .locator(".lemon-page-links")
    .getByRole("link", { name: "Your tickets" })
    .click();
  const ticketPanel = page.locator("#lemon-tickets");
  await expect(ticketPanel).toHaveAttribute("open", "");
  await ticketPanel.getByRole("button", { name: /Win\s*1/ }).click();
  await expect(
    ticketPanel.locator(".lemon-ticket-heading").first(),
  ).toContainText("Daily draw");
  await expect(ticketPanel.locator(".lemon-ticket-prize").first()).toHaveText(
    "Prize 4.750000037 SOL",
  );
  await expect(ticketPanel).toContainText("Waiting for treasury funding");
  await expect(
    ticketPanel.getByRole("button", {
      name: "Waiting for treasury",
      exact: true,
    }),
  ).toBeDisabled();
  const claimsBeforeUnknownFunding = await page.evaluate(
    () =>
      window.__lemonActions.filter((action) => action.startsWith("claim:"))
        .length,
  );
  await page.evaluate(() => window.__setLemonFunding(false, false));
  await expect(
    ticketPanel.getByRole("button", { name: /Win\s*1/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(ticketPanel.locator(".lemon-funding-wait")).toHaveCount(0);
  await expect(
    ticketPanel.getByRole("button", { name: "Claim prize", exact: true }),
  ).toBeEnabled();
  assert.equal(
    await page.evaluate(
      () =>
        window.__lemonActions.filter((action) => action.startsWith("claim:"))
          .length,
    ),
    claimsBeforeUnknownFunding,
    "A failed liquidity read must not automatically submit a claim",
  );
  await ticketPanel
    .getByRole("button", { name: "Claim prize", exact: true })
    .click();
  assert.equal(
    await page.evaluate(
      () =>
        window.__lemonActions.filter((action) => action.startsWith("claim:"))
          .length,
    ),
    claimsBeforeUnknownFunding + 1,
    "Unknown funding must allow a fresh explicit claim and its client-side liquidity check",
  );
  await expect(
    ticketPanel.getByRole("button", { name: /Win\s*1/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    ticketPanel.getByRole("button", { name: "Claim prize", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => window.__setLemonFunding(false, true));
  await expect(
    ticketPanel.getByRole("button", {
      name: "Waiting for treasury",
      exact: true,
    }),
  ).toBeDisabled();
  await page.evaluate(() => window.__setLemonFunding(true));
  await expect(
    ticketPanel.getByRole("button", { name: "Claim prize", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => window.__setLemonRules(false));
  await expect(purchase).toBeDisabled();
  await expect(
    ticketPanel.getByRole("button", { name: "Claim prize", exact: true }),
  ).toBeEnabled();
  await ticketPanel
    .getByRole("button", { name: "Claim prize", exact: true })
    .click();
  await expect(
    ticketPanel.getByRole("button", { name: "Claim prize", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    window.__setLemonRules(true);
    window.__lemonConfirmClaim = true;
  });
  await ticketPanel
    .getByRole("button", { name: "Claim prize", exact: true })
    .click();
  await expect(
    ticketPanel.getByRole("button", { name: "Claim prize", exact: true }),
  ).toHaveCount(0);
  await ticketPanel.getByRole("button", { name: /Done\s*3/ }).click();
  await expect(ticketPanel).toContainText("Win · Paid");
  await expect(ticketPanel).toContainText("Loss");
  await ticketPanel.getByRole("button", { name: /Ongoing\s*5/ }).click();
  const openTicket = ticketPanel.locator(".lemon-ticket").first();
  await openTicket
    .getByRole("button", { name: "Review reveal costs", exact: true })
    .click();
  const reveal = page.locator(".lemon-reveal-review");
  await expect(openTicket.locator(".lemon-reveal-review")).toHaveCount(1);
  await expect(
    page.locator(".lemon-dashboard > .lemon-reveal-review"),
  ).toHaveCount(0);
  await expect(reveal).toContainText("0.007000032 SOL");
  await expect(ticketPanel).toContainText(
    "Shared draw · One reveal covers these tickets",
  );
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1100 });
    await reveal.scrollIntoViewIfNeeded();
    const ticketBounds = await openTicket.boundingBox();
    const revealBounds = await reveal.boundingBox();
    assert.ok(
      revealBounds.x >= ticketBounds.x &&
        revealBounds.x + revealBounds.width <=
          ticketBounds.x + ticketBounds.width + 1,
      `${width}px reveal review stays inside the relevant ticket`,
    );
    assert.ok(
      (await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      )) <= 1,
      `${width}px inline reveal must not cause page overflow`,
    );
    await page.screenshot({
      path: `test-results/lemon-reveal-${width}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  assert.ok(
    !(await page.evaluate(() => window.__lemonActions)).includes("reveal"),
  );
  await page.evaluate((value) => window.__setLemonClock(value), now + 30001);
  await expect(
    reveal.getByRole("button", { name: "Approve reveal costs" }),
  ).toBeDisabled();
  await page.evaluate((value) => window.__setLemonClock(value), now);
  await reveal.getByRole("button", { name: "Approve reveal costs" }).click();
  assert.equal(
    (await page.evaluate(() => window.__lemonActions)).filter(
      (action) => action === "reveal",
    ).length,
    1,
  );
  await expect(reveal).toHaveCount(0);
  await expect(
    ticketPanel.getByText("Waiting for oracle · Refresh to check", {
      exact: true,
    }),
  ).toHaveCount(3);
  await expect(
    openTicket.getByRole("button", {
      name: "Review reveal costs",
      exact: true,
    }),
  ).toHaveCount(0);
  await ticketPanel
    .getByRole("button", { name: "Complete draw", exact: true })
    .click();
  await expect(
    ticketPanel.getByRole("button", { name: "Complete draw", exact: true }),
  ).toHaveCount(0);
  await page
    .locator(".lemon-page-links")
    .getByRole("link", { name: "Draw results" })
    .click();
  const resultPanel = page.locator("#lemon-results");
  await expect(resultPanel).toHaveAttribute("open", "");
  await expect(resultPanel.locator("tbody tr")).toHaveCount(3);
  await expect(
    resultPanel.locator("tbody tr").first().locator("td").first(),
  ).toHaveText("Daily draw");
  await expect(
    resultPanel.locator("tbody tr").first().locator(".lemon-triple"),
  ).toHaveAttribute("aria-label", "Lemon; Lemon; Lemon");
  await expect(
    resultPanel.locator(".lemon-fruit small, [aria-label*='digit']"),
  ).toHaveCount(0);
  await page
    .locator(".lemon-page-links")
    .getByRole("link", { name: "Game guide" })
    .click();
  const guide = page.locator("#lemon-guide");
  await expect(guide).toHaveAttribute("open", "");
  assert.deepEqual(
    await guide.locator(".lemon-fruit-map dd").allTextContents(),
    ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
  );
  await expect(guide).toContainText(
    "03:00 / 07:00 / 11:00 / 15:00 / 19:00 / 23:00 UTC+8",
  );
  await expect(page.locator(".lemon-fruit-map")).toHaveCount(1);
  await guide.locator("summary").click();
  for (const link of await resultPanel.locator(".history-link").all()) {
    await expect(link).toHaveAttribute(
      "href",
      /https:\/\/explorer\.solana\.com\/address\/.*\?cluster=devnet/,
    );
    await expect(link.locator("svg")).toHaveCount(1);
    assert.equal(
      await link.evaluate(
        (element) => getComputedStyle(element).textDecorationLine,
      ),
      "none",
    );
  }
  await page.locator("#lemon-result-date").fill("2026-11-14");
  await expect(resultPanel.locator("tbody tr")).toHaveCount(0);
  await resultPanel.getByRole("button", { name: "Clear filters" }).click();
  await expect(resultPanel.locator("tbody tr")).toHaveCount(3);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.locator("#lemon-buy").scrollIntoViewIfNeeded();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    assert.ok(
      overflow <= 1,
      `${width}px must not cause page overflow (${overflow}px)`,
    );
    for (const control of await page.locator(".lemon-fruit-option").all()) {
      const size = await control.boundingBox();
      assert.ok(
        size.width >= 40 && size.height >= 44,
        `${width}px fruit controls need usable touch targets`,
      );
    }
    await page.evaluate(() => {
      document.activeElement?.blur();
      window.scrollTo({ top: 0, behavior: "instant" });
    });
    await page.waitForFunction(() => window.scrollY === 0);
    await page.screenshot({
      path: `test-results/lemon-${width}.png`,
      fullPage: true,
    });
  }
  await page.evaluate(() => window.__setLemonResults([]));
  await expect(resultPanel.locator("tbody tr")).toHaveCount(0);
  await expect(resultPanel).toContainText(
    "No finalized on-chain results match this selection",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Lemon UI: fruit-only picks/results, guide mapping, preserved historical daily labels/prizes, current schedule, quote checks, inline once-per-draw oracle review, funding-wait claims, finalized-only results, explorer links and four responsive widths passed. Fixtures never sign or send blockchain transactions.",
  );
} finally {
  await browser.close();
}

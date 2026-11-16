import { chromium, expect } from "@playwright/test";
import { PublicKey } from "@solana/web3.js";
import { mkdirSync, writeFileSync } from "node:fs";

const origin = new URL(process.env.UI_TEST_ORIGIN || "http://127.0.0.1:5173")
  .origin;
const hookResponse = await fetch(`${origin}/src/games/lemon/useLemonGame.js`, {
  signal: AbortSignal.timeout(10_000),
});
if (!hookResponse.ok)
  throw new Error(
    `The Vite development server did not return the Lemon hook: HTTP ${hookResponse.status}.`,
  );
const transformed = await hookResponse.text();
const version = transformed.match(/react\.js\?v=([^"\s]+)/)?.[1];
if (!version)
  throw new Error(
    "Start the Vite development server before running the Lemon hook checks. UI_TEST_ORIGIN must point to that server.",
  );
mkdirSync("test-results", { recursive: true });
const program = "7ZDTrz498pQuMyV4frPv2cZu5vR1ZrpfzFWAPGpVGcYr";
const devnet = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const walletA = "Ghxn7ree6MFQxC8hFTJ8Lo319xEZzqVFLcmDLKVFpPaa";
const walletB = "2txjN4S6WEiDDT8R3QvGFgwZrchQ8k5kBXRhbYFX1eSz";
const fixtureAddresses = Object.fromEntries(
  [
    "draw",
    "reviewDraw",
    "ticket",
    "secondTicket",
    "oracleRequest",
    "oracleClient",
    "newWalletTicket",
    "newWalletSecondTicket",
  ].map((name, index) => [
    name,
    new PublicKey(new Uint8Array(32).fill(index + 1)).toBase58(),
  ]),
);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const checks = [];
const mockClient = `
export class LemonClient {
  constructor({connection,wallet}) { this.connection=connection; this.wallet=wallet; }
  async getConfig() {
    const h=window.h; window.h.counts.config++;
    if(window.h.configFailure) throw new Error("Metadata unavailable");
    if(window.h.holdRefresh) await new Promise(resolve=>{window.h.refreshResolve=resolve});
    return {...h.config};
  }
  async getResults() { const h=window.h;window.h.counts.results++;if(window.h.historyFailure)throw new Error("429 Too many requests");return h.chainResults.map(result=>structuredClone(result)); }
  async getTickets() { const h=window.h;window.h.counts.tickets++;if(window.h.historyFailure)throw new Error("429 Too many requests");return h.revealScenario?h.tickets.map(ticket=>structuredClone(ticket)):[{...h.ticket}]; }
  async getPurchaseQuote(numbers,{drawTime}) {
    const h=window.h;window.h.counts.quote++;
    const walletAddress=this.wallet.publicKey.toBase58();
    if(window.h.holdQuoteFor===walletAddress) await new Promise(resolve=>{window.h.quoteResolve=resolve});
    return {numbers:[...numbers],drawTime,quick:false,entryLamports:6250000,prizeLamports:2000000000,accountRentLamports:1000,totalLamports:6251000,issuedAt:Date.now(),validUntil:Date.now()+30000,walletAddress,sourceProgram:${JSON.stringify(program)},canPurchase:true,isReady:true};
  }
  async buyTicket(numbers,{drawTime,quote,assertActive}) {
    const h=window.h;window.h.counts.buy++;
    if(window.h.holdBuy) await new Promise(resolve=>{window.h.buyResolve=resolve});
    assertActive();await this.wallet.signTransaction({});
    window.h.counts.buyEffects++;window.h.lastApproved=quote;
    if(window.h.uncertainBuy) throw new Error("Purchase confirmation was not confirmed. Refresh to check recorded status; no replacement transaction was sent.");
    return {...h.ticket,numbers,drawTime};
  }
  async quoteOracleRequest(drawTime) {
    const h=window.h;window.h.counts.oracleQuote++;
    const needsPayment=h.revealScenario?h.draws[drawTime].status==="open":h.oracleNeedsPayment;
    return {feeLamports:needsPayment?100:0,pendingRentLamports:needsPayment?20:0,clientRentLamports:needsPayment?30:0,totalLamports:needsPayment?150:0,drawTime,draw:h.revealScenario?structuredClone(h.draws[drawTime]):structuredClone(h.ticket.draw),drawStatus:h.revealScenario?h.draws[drawTime].status:needsPayment?"open":"pending",requiresPayment:needsPayment,walletAddress:this.wallet.publicKey.toBase58(),sourceProgram:${JSON.stringify(program)},validUntil:Date.now()+30000};
  }
  async recordDraw(drawTime,{quote,assertActive,onProgress}) {
    const h=window.h;window.h.counts.record++;
    if(h.revealScenario){
      assertActive();
      if(h.holdRecord)await new Promise(resolve=>{h.recordResolve=resolve});
      assertActive();await this.wallet.signTransaction({});
      const draw=h.draws[drawTime];
      if(draw.status==="open"){
        if(!quote?.requiresPayment)throw new Error("A new oracle request requires a reviewed fee quote");
        h.counts.requests++;draw.status="pending";draw.oracleRequest=h.addresses.oracleRequest;
        onProgress?.({phase:"pending",oracleRequest:draw.oracleRequest});
      }
      if(h.finishRecord){draw.status="final";draw.numbers=[0,0,0];}
      h.tickets=h.tickets.map(ticket=>ticket.drawTime===drawTime?{...ticket,draw:structuredClone(draw),result:draw.status==="final"?{...structuredClone(draw),id:draw.address,isPublished:true,sourceProgram:${JSON.stringify(program)},randomnessMode:"orao-vrf"}:null}:ticket);
      if(draw.status==="final")h.chainResults=[{...structuredClone(draw),id:draw.address,isPublished:true,sourceProgram:${JSON.stringify(program)},randomnessMode:"orao-vrf"}];
      return {signature:"confirmed-reveal-"+h.counts.record,draw:structuredClone(draw),pending:draw.status!=="final",phase:draw.status==="final"?"final":"pending",settled:0};
    }
    assertActive();await this.wallet.signTransaction({});
    onProgress?.({phase:"pending"});
    const draw={...h.ticket.draw,drawTime,status:h.oracleNeedsPayment?"pending":"final",numbers:h.oracleNeedsPayment?null:[1,2,3],oracleRequest:h.addresses.oracleRequest};
    h.ticket={...h.ticket,draw,result:h.oracleNeedsPayment?null:{...draw,id:draw.address,isPublished:true,sourceProgram:${JSON.stringify(program)}}};
    return {pending:h.oracleNeedsPayment,draw,phase:h.oracleNeedsPayment?"pending":"final",drawTime,quote};
  }
  async settleTicket(ticket,{assertActive}) { const h=window.h;window.h.counts.claim++;assertActive();if(window.h.claimFailure){const e=new Error(window.h.claimFailure===6028?"custom program error: 0x178c":"Error Number: 6014. Invalid draw.");e.error={errorCode:{number:window.h.claimFailure}};throw e;}await this.wallet.signTransaction({});return "confirmed-claim"; }
  async refundTicket(ticket,{assertActive}) { const h=window.h;window.h.counts.refund++;assertActive();await this.wallet.signTransaction({});return "confirmed-refund"; }
}`;
const harness = `
import React from "/node_modules/.vite/deps/react.js?v=${version}";
import ReactDOM from "/node_modules/.vite/deps/react-dom_client.js?v=${version}";
import {useLemonGame} from "/src/games/lemon/useLemonGame.js";
const {useState}=React;
const h=window.h={counts:{config:0,results:0,tickets:0,quote:0,buy:0,buyEffects:0,oracleQuote:0,record:0,requests:0,claim:0,refund:0,sign:0,network:0},genesis:${JSON.stringify(devnet)},oracleNeedsPayment:true,chainResults:[],revealScenario:new URL(location.href).searchParams.get("scenario")==="reveal"};
h.addresses=${JSON.stringify(fixtureAddresses)};
const sign=async()=>{window.h.counts.sign++;return {}};
window.h.changeWallet=(address)=>{window.h.wallet={publicKey:{toBase58:()=>address},signTransaction:sign,signAllTransactions:sign};window.h.render?.()};
window.h.changeWallet(${JSON.stringify(walletA)});
window.h.connection={rpcEndpoint:"https://mock.invalid",getGenesisHash:async()=>{window.h.counts.network++;return window.h.genesis}};
window.h.config={verified:true,randomnessVerified:true,uatEnabled:true,publicPlayEnabled:true,sourceProgram:${JSON.stringify(program)},programId:${JSON.stringify(program)},outcomes:1000,dailyHours:[3,7,11,15,19,23]};
const drawTime=Math.floor(Date.now()/1000)-120;
const initialDraw={address:h.addresses.draw,drawTime,status:"final",numbers:[1,2,3],drawType:"quick",oracleRequest:h.addresses.oracleRequest,oracleClient:h.addresses.oracleClient,requestedBy:${JSON.stringify(walletA)},requestedAt:drawTime,ticketCount:"1",ticketCostLamports:7200000,payoutLamports:1000000000};
window.h.ticket={id:"1001",address:h.addresses.ticket,user:${JSON.stringify(walletA)},numbers:[1,2,3],drawTime,settled:false,refunded:false,bankroll:true,reserveVersion:4,paidLamports:7200000,payoutLamports:1000000000,sourceProgram:${JSON.stringify(program)},legacy:false,result:{...initialDraw,id:initialDraw.address,isPublished:true,sourceProgram:${JSON.stringify(program)},randomnessMode:"orao-vrf"},draw:initialDraw};
if(h.revealScenario){
  const drawTime=h.ticket.drawTime;
  h.draws={[drawTime]:{...initialDraw,status:"open",numbers:null,oracleRequest:null,oracleClient:null,requestedBy:null,requestedAt:0,ticketCount:"2"}};
  h.tickets=[{...h.ticket,numbers:[0,0,0],result:null,draw:structuredClone(h.draws[drawTime])},{...h.ticket,id:"1002",address:h.addresses.secondTicket,numbers:[9,8,7],result:null,draw:structuredClone(h.draws[drawTime])}];
}
function Harness(){const [,rerender]=useState(0);window.h.render=()=>rerender(n=>n+1);window.h.game=useLemonGame();return React.createElement("div",null,window.h.game.walletAddress)}
ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(Harness));
`;

await page.route("**/*", (route) => {
  const request = route.request();
  return new URL(request.url()).origin === origin && request.method() === "GET"
    ? route.continue()
    : route.abort("blockedbyclient");
});
await page.route(
  "**/node_modules/.vite/deps/@solana_wallet-adapter-react.js*",
  (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: "export const useConnection=()=>({connection:window.h.connection});export const useWallet=()=>window.h.wallet;",
    }),
);
await page.route("**/src/lib/onchain/LemonClient.js*", (route) =>
  route.fulfill({ contentType: "text/javascript", body: mockClient }),
);
await page.route("**/__lemon-hook-check*", (route) =>
  route.fulfill({
    contentType: "text/html",
    body: '<div id="root"></div><script type="module" src="/__lemon-hook-harness.js"></script>',
  }),
);
await page.route("**/__lemon-hook-harness.js", (route) =>
  route.fulfill({ contentType: "text/javascript", body: harness }),
);
await page.clock.install({ time: new Date("2026-11-15T05:00:00Z") });

async function poll(code, value = true) {
  await expect
    .poll(() => page.evaluate(code), { timeout: 10000 })
    .toEqual(value);
}
async function tick(ms) {
  await page.clock.fastForward(ms);
  await page.waitForTimeout(50);
}

try {
  await page.goto(`${origin}/__lemon-hook-check`, {
    waitUntil: "domcontentloaded",
  });
  await poll(() => Boolean(window.h?.game?.ready && !window.h.game.isLoading));
  await page.evaluate(() => {
    window.h.game.setNumber(0, 0);
    window.h.game.setNumber(1, 0);
    window.h.game.setNumber(2, 0);
  });
  await tick(600);
  await poll(() => window.h.game.purchaseQuote?.numbers.join(",") === "0,0,0");
  checks.push("Repeated three-fruit selection gets actual-hook quote");

  await page.evaluate(() => {
    window.h.holdQuoteFor = window.h.game.walletAddress;
    window.h.game.setNumber(2, 1);
  });
  await tick(600);
  await poll(() => typeof window.h.quoteResolve === "function");
  await page.evaluate((address) => window.h.changeWallet(address), walletB);
  await poll(
    () =>
      window.h.game.walletAddress === window.h.wallet.publicKey.toBase58() &&
      window.h.game.ready,
  );
  await tick(600);
  await poll(
    () =>
      window.h.game.purchaseQuote?.walletAddress ===
      window.h.game.walletAddress,
  );
  await page.evaluate(() => {
    window.h.holdQuoteFor = null;
    window.h.quoteResolve();
  });
  await tick(100);
  await poll(
    () =>
      window.h.game.purchaseQuote?.walletAddress ===
      window.h.game.walletAddress,
  );
  checks.push("Late quote from previous wallet ignored");

  await page.evaluate(() => {
    window.h.holdBuy = true;
    void window.h.game.buyTicket();
  });
  await poll(() => typeof window.h.buyResolve === "function");
  await page.evaluate((address) => window.h.changeWallet(address), walletA);
  await poll(
    () =>
      window.h.game.walletAddress === window.h.wallet.publicKey.toBase58() &&
      window.h.game.actionStatus === "idle",
  );
  await page.evaluate(() => {
    window.h.holdBuy = false;
    window.h.buyResolve();
  });
  await tick(100);
  await poll(
    () => window.h.counts.sign === 0 && window.h.counts.buyEffects === 0,
  );
  checks.push(
    "Wallet switch before signing blocks old purchase and releases new-wallet UI",
  );

  await tick(600);
  await poll(() => Boolean(window.h.game.purchaseQuote));
  await tick(31_000);
  await poll(() => window.h.game.purchaseQuote === null);
  const buyBefore = await page.evaluate(() => window.h.counts.buy);
  await page.evaluate(() => window.h.game.buyTicket());
  await poll(() => window.h.counts.sign === 0);
  if ((await page.evaluate(() => window.h.counts.buy)) !== buyBefore)
    throw new Error("Expired quote reached client buy");
  checks.push("Expired purchase quote blocks sending; no automatic purchase");

  await page.evaluate(() => {
    window.h.configFailure = true;
    window.h.historyFailure = true;
  });
  await tick(8100);
  await page.evaluate(() => window.h.game.refresh());
  await poll(
    () =>
      !window.h.game.isLoading &&
      !window.h.game.ready &&
      window.h.game.tickets.length === 1,
  );
  await page.evaluate(() =>
    window.h.game.claimTicket(window.h.game.tickets[0]),
  );
  await poll(
    () =>
      window.h.counts.claim === 1 &&
      window.h.counts.sign === 1 &&
      !window.h.game.pending,
  );
  await poll(() => window.h.game.tickets.length === 1);
  checks.push(
    "Metadata/history outage preserves same-wallet ticket and permits explicit valid claim",
  );

  await tick(65_000);
  await page.evaluate(() => {
    window.h.configFailure = false;
    window.h.historyFailure = false;
    window.h.holdRefresh = true;
    window.h.beforeRefresh = { ...window.h.counts };
    void window.h.game.refresh();
    void window.h.game.refresh();
    void window.h.game.refresh();
  });
  await poll(() => typeof window.h.refreshResolve === "function");
  await page.evaluate(() => {
    if (
      window.h.counts.config - window.h.beforeRefresh.config !== 1 ||
      window.h.counts.tickets - window.h.beforeRefresh.tickets !== 1
    )
      throw new Error("Refresh calls not deduplicated");
    window.h.holdRefresh = false;
    window.h.refreshResolve();
  });
  await poll(() => window.h.game.ready && !window.h.game.isLoading);
  checks.push("Concurrent refreshes deduplicate their chain reads");

  await tick(8100);
  await page.evaluate(() => {
    window.h.ticket = {
      ...window.h.ticket,
      id: "1003",
      drawTime: window.h.ticket.drawTime + 1,
      result: null,
      draw: {
        ...window.h.ticket.draw,
        address: window.h.addresses.reviewDraw,
        drawTime: window.h.ticket.drawTime + 1,
        status: "open",
        numbers: null,
        oracleRequest: null,
        oracleClient: null,
        requestedBy: null,
        requestedAt: 0,
      },
    };
    return window.h.game.refresh();
  });
  await poll(() => window.h.game.tickets[0]?.draw.status === "open");
  const signsBeforeReview = await page.evaluate(() => window.h.counts.sign);
  await page.evaluate(() =>
    window.h.game.reviewReveal(window.h.game.tickets[0]),
  );
  await poll(
    () =>
      window.h.game.revealQuote?.feeLamports === 100 && !window.h.game.pending,
  );
  if (
    (await page.evaluate(() => window.h.counts.sign)) !== signsBeforeReview ||
    (await page.evaluate(() => window.h.counts.record)) !== 0
  )
    throw new Error("Readonly reveal review signed or sent");
  checks.push("Reveal review only reads oracle fees and rents");
  await page.evaluate(() => window.h.game.confirmReveal());
  await poll(
    () =>
      window.h.counts.record === 1 &&
      window.h.game.revealQuote === null &&
      !window.h.game.pending,
  );
  await tick(65_000);
  await poll(() => window.h.counts.record === 1);
  checks.push(
    "One explicit reveal confirmation sends once; timers never resubmit",
  );

  await page.evaluate(() => window.h.game.revealDraw(window.h.game.tickets[0]));
  await poll(() => !window.h.game.pending);
  await poll(() => window.h.counts.record === 1);
  await page.evaluate(() => {
    window.h.oracleNeedsPayment = false;
  });
  await page.evaluate(() => window.h.game.revealDraw(window.h.game.tickets[0]));
  await poll(() => window.h.counts.record === 2 && !window.h.game.pending);
  checks.push(
    "Completion action refuses unreviewed new request and allows existing oracle request completion",
  );

  const signedBeforeFundingFailure = await page.evaluate(
    () => window.h.counts.sign,
  );
  await page.evaluate(() => {
    window.h.claimFailure = 6028;
  });
  await page.evaluate(() =>
    window.h.game.claimTicket(window.h.game.tickets[0]),
  );
  await poll(
    () =>
      window.h.game.error.startsWith("Waiting for treasury funding.") &&
      !window.h.game.pending &&
      !window.h.game.tickets[0].settled,
  );
  if (
    (await page.evaluate(() => window.h.counts.sign)) !==
    signedBeforeFundingFailure
  )
    throw new Error("Unfunded claim signed unexpectedly");
  checks.push(
    "Lemon6028 funding wait preserves unpaid winning ticket without signing or marking paid",
  );
  await page.evaluate(() => {
    window.h.claimFailure = 6014;
  });
  await page.evaluate(() =>
    window.h.game.claimTicket(window.h.game.tickets[0]),
  );
  await poll(() => window.h.game.error === "Error Number: 6014. Invalid draw.");
  checks.push(
    "Lemon6014 retains Invalid draw message instead of legacy reserve explanation",
  );
  await page.evaluate(() => {
    window.h.claimFailure = null;
    window.h.uncertainBuy = true;
    window.h.game.refreshPurchaseQuote();
  });
  await tick(600);
  await poll(() => Boolean(window.h.game.purchaseQuote));
  await page.evaluate(() => window.h.game.buyTicket());
  await poll(
    () =>
      window.h.counts.buyEffects === 1 &&
      !window.h.game.pending &&
      window.h.game.error.includes("confirmation was not confirmed"),
  );
  const buyAfterUncertain = await page.evaluate(() => window.h.counts.buy);
  await tick(65_000);
  if ((await page.evaluate(() => window.h.counts.buy)) !== buyAfterUncertain)
    throw new Error("Uncertain buy was automatically resubmitted");
  checks.push(
    "Uncertain purchase confirmation refreshes reads and never automatically resubmits",
  );

  const signedBeforeMainnet = await page.evaluate(() => window.h.counts.sign);
  const claimsBeforeMainnet = await page.evaluate(() => window.h.counts.claim);
  await page.evaluate(() => {
    window.h.genesis = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
  });
  await page.evaluate(() =>
    window.h.game.claimTicket(window.h.game.tickets[0]),
  );
  await poll(() => !window.h.game.pending);
  if (
    (await page.evaluate(() => window.h.counts.sign)) !== signedBeforeMainnet ||
    (await page.evaluate(() => window.h.counts.claim)) !== claimsBeforeMainnet
  )
    throw new Error("Fresh network gate permitted Mainnet");
  checks.push(
    "Fresh genesis verification blocks Mainnet even with stale Devnet UI status",
  );

  await page.goto(`${origin}/__lemon-hook-check?scenario=reveal`, {
    waitUntil: "domcontentloaded",
  });
  await poll(() => window.h?.game?.ready && !window.h.game.isLoading);
  await poll(() => window.h.game.tickets.length === 2);
  await page.evaluate(() => {
    window.h.finishRecord = true;
    window.h.holdRecord = true;
    window.h.historyFailure = true;
  });
  await page.evaluate(() =>
    window.h.game.reviewReveal(window.h.game.tickets[0]),
  );
  await poll(() => window.h.game.revealQuote?.requiresPayment === true);
  await page.evaluate(() => {
    window.h.savedConfirm = window.h.game.confirmReveal;
    window.h.firstReveal = window.h.savedConfirm();
    window.h.secondReveal = window.h.savedConfirm();
  });
  await poll(() => typeof window.h.recordResolve === "function");
  if ((await page.evaluate(() => window.h.counts.record)) !== 1)
    throw new Error("Concurrent confirmations submitted multiple reveals");
  await page.evaluate(() => {
    window.h.holdRecord = false;
    window.h.recordResolve();
  });
  await page.evaluate(() =>
    Promise.all([window.h.firstReveal, window.h.secondReveal]),
  );
  await poll(() => !window.h.game.pending);
  if (
    (await page.evaluate(() => window.h.counts.requests)) !== 1 ||
    (await page.evaluate(() => window.h.counts.sign)) !== 1
  )
    throw new Error("One reveal approval requested or signed more than once");
  checks.push(
    "Concurrent reveal approvals produce one request and one signature",
  );

  await page.evaluate(() => window.h.savedConfirm());
  await poll(() => !window.h.game.pending);
  if ((await page.evaluate(() => window.h.counts.record)) !== 1)
    throw new Error(
      "A consumed reveal quote was reused by an old render handler",
    );
  checks.push(
    "Captured approval handler cannot reuse its consumed quote after completion and failed history refresh",
  );

  await poll(
    () =>
      window.h.game.tickets.every(
        (ticket) =>
          ticket.draw.status === "final" &&
          ticket.result?.isPublished === true &&
          ticket.result.numbers.join(",") === "0,0,0" &&
          !ticket.settled &&
          !ticket.refunded,
      ) &&
      window.h.game.results.length === 1 &&
      window.h.game.results[0].numbers.join(",") === "0,0,0",
  );
  checks.push(
    "Confirmed zero-fruit result updates both same-draw tickets and result history through RPC outage without marking paid",
  );
  await page.evaluate(() => window.h.game.revealDraw(window.h.game.tickets[1]));
  await poll(() => !window.h.game.pending);
  if ((await page.evaluate(() => window.h.counts.record)) !== 1)
    throw new Error("A shared completed draw was submitted a second time");
  checks.push("Completed shared-draw ticket cannot start another reveal");

  await tick(65_000);
  await page.evaluate(() => {
    window.h.historyFailure = false;
    window.h.chainResults = [];
    window.h.tickets = window.h.tickets.map((ticket) => ({
      ...ticket,
      draw: { ...ticket.draw, status: "open", numbers: null },
      result: null,
    }));
    return window.h.game.refresh();
  });
  await poll(
    () =>
      !window.h.game.isLoading &&
      window.h.game.tickets.every(
        (ticket) =>
          ticket.draw.status === "final" &&
          ticket.result?.numbers.join(",") === "0,0,0" &&
          !ticket.settled,
      ) &&
      window.h.game.results.length === 1,
  );
  checks.push(
    "Later stale RPC snapshots cannot reopen an already confirmed final draw",
  );

  await page.goto(`${origin}/__lemon-hook-check?scenario=reveal`, {
    waitUntil: "domcontentloaded",
  });
  await poll(() => window.h?.game?.ready && !window.h.game.isLoading);
  await page.evaluate(() => {
    window.h.historyFailure = true;
  });
  await page.evaluate(() =>
    window.h.game.reviewReveal(window.h.game.tickets[0]),
  );
  await poll(() => window.h.game.revealQuote?.requiresPayment === true);
  await page.evaluate(() => {
    window.h.savedConfirm = window.h.game.confirmReveal;
    return window.h.savedConfirm();
  });
  await poll(
    () =>
      !window.h.game.pending &&
      window.h.game.revealQuote === null &&
      window.h.game.tickets.every(
        (ticket) => ticket.draw.status === "pending" && !ticket.result,
      ),
  );
  await page.evaluate(() => window.h.savedConfirm());
  await poll(() => !window.h.game.pending);
  if ((await page.evaluate(() => window.h.counts.record)) !== 1)
    throw new Error("Pending request accepted the same approval a second time");
  checks.push(
    "Confirmed pending request clears reviewed fees for every shared-draw ticket and blocks stale approval replay",
  );
  await page.evaluate(() =>
    window.h.game.reviewReveal(window.h.game.tickets[1]),
  );
  await poll(
    () => !window.h.game.pending && window.h.game.revealQuote === null,
  );
  if ((await page.evaluate(() => window.h.counts.requests)) !== 1)
    throw new Error("Reviewing the same pending draw paid another oracle fee");
  await page.evaluate(() => {
    window.h.game.cancelReveal();
    window.h.finishRecord = true;
  });
  await page.evaluate(() => window.h.game.revealDraw(window.h.game.tickets[1]));
  await poll(
    () =>
      !window.h.game.pending &&
      window.h.game.tickets.every((ticket) => ticket.draw.status === "final"),
  );
  if (
    (await page.evaluate(() => window.h.counts.record)) !== 2 ||
    (await page.evaluate(() => window.h.counts.requests)) !== 1 ||
    (await page.evaluate(() => window.h.counts.sign)) !== 2
  )
    throw new Error("Explicit completion charged or requested new randomness");
  checks.push(
    "Explicit shared-draw completion uses existing request with zero fresh oracle fee",
  );

  await page.goto(`${origin}/__lemon-hook-check?scenario=reveal`, {
    waitUntil: "domcontentloaded",
  });
  await poll(() => window.h?.game?.ready && !window.h.game.isLoading);
  await tick(8100);
  await page.evaluate(() => {
    const draw = {
      ...window.h.tickets[0].draw,
      status: "final",
      numbers: [0, 0, 0],
      oracleRequest: window.h.addresses.oracleRequest,
      oracleClient: window.h.addresses.oracleClient,
    };
    const result = {
      ...draw,
      id: draw.address,
      isPublished: true,
      sourceProgram: window.h.config.sourceProgram,
      randomnessMode: "orao-vrf",
    };
    window.h.chainResults = [result];
    window.h.tickets = window.h.tickets.map((ticket) => ({
      ...ticket,
      draw: structuredClone(draw),
      result: structuredClone(result),
    }));
    return window.h.game.refresh();
  });
  await poll(
    () =>
      window.h.game.tickets.every((ticket) => ticket.draw.status === "final") &&
      window.h.game.results.length === 1,
  );
  await tick(8100);
  await page.evaluate(() => {
    window.h.chainResults = [];
    window.h.tickets = window.h.tickets.map((ticket) => ({
      ...ticket,
      draw: { ...ticket.draw, status: "open", numbers: null },
      result: null,
    }));
    return window.h.game.refresh();
  });
  await poll(
    () =>
      !window.h.game.isLoading &&
      window.h.game.tickets.every(
        (ticket) =>
          ticket.draw.status === "final" &&
          ticket.result.numbers.join(",") === "0,0,0" &&
          !ticket.settled &&
          !ticket.refunded,
      ) &&
      window.h.game.results.length === 1 &&
      window.h.counts.record === 0 &&
      window.h.counts.sign === 0,
  );
  checks.push(
    "A finalized draw learned through ordinary refresh survives later stale snapshots without any transaction",
  );

  await page.goto(`${origin}/__lemon-hook-check?scenario=reveal`, {
    waitUntil: "domcontentloaded",
  });
  await poll(() => window.h?.game?.ready && !window.h.game.isLoading);
  await page.evaluate(() =>
    window.h.game.reviewReveal(window.h.game.tickets[0]),
  );
  await poll(() => Boolean(window.h.game.revealQuote));
  await page.evaluate(() => {
    window.h.oldWalletConfirm = window.h.game.confirmReveal;
  });
  await page.evaluate((address) => {
    window.h.tickets = window.h.tickets.map((ticket, index) => ({
      ...ticket,
      id: String(2001 + index),
      address:
        index === 0
          ? window.h.addresses.newWalletTicket
          : window.h.addresses.newWalletSecondTicket,
      user: address,
    }));
    window.h.changeWallet(address);
  }, walletB);
  await poll(
    () =>
      window.h.game.walletAddress === window.h.wallet.publicKey.toBase58() &&
      window.h.game.ready,
  );
  await page.evaluate(() => window.h.oldWalletConfirm());
  if ((await page.evaluate(() => window.h.counts.record)) !== 0)
    throw new Error("An old wallet's review could submit after wallet switch");
  await page.evaluate(() => {
    window.h.finishRecord = true;
    return window.h.game.reviewReveal(window.h.game.tickets[0]);
  });
  await poll(
    () =>
      window.h.game.revealQuote?.walletAddress === window.h.game.walletAddress,
  );
  await page.evaluate(() => window.h.game.confirmReveal());
  await poll(() => !window.h.game.pending);
  if (
    (await page.evaluate(() => window.h.counts.record)) !== 1 ||
    (await page.evaluate(() => window.h.counts.sign)) !== 1
  )
    throw new Error("New wallet could not approve its own fresh reveal quote");
  checks.push(
    "Wallet change invalidates old approvals while allowing the new wallet's explicit reviewed reveal",
  );

  if (errors.length) throw new Error(errors.join("\n"));
  const report = {
    checks,
    counts: await page.evaluate(() => window.h.counts),
    runtimeErrors: errors,
  };
  writeFileSync(
    "test-results/lemon-hook.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} catch (error) {
  console.log(
    JSON.stringify({
      errors,
      debug: await page.evaluate(() => ({
        h: window.h && {
          counts: window.h.counts,
          wallet: window.h.game?.walletAddress,
          ready: window.h.game?.ready,
          error: window.h.game?.error,
          isLoading: window.h.game?.isLoading,
          config: window.h.game?.config,
          revealQuote: window.h.game?.revealQuote,
          tickets: window.h.game?.tickets,
          results: window.h.game?.results,
        },
      })),
    }),
  );
  throw error;
} finally {
  await browser.close();
}

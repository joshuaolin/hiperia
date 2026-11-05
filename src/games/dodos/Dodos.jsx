import DonationCard from "../../components/DonationCard";
import { useEffect, useRef } from "react";
import DodosTickets from "../../components/DodosTickets.jsx";
import DrawResults from "../../components/DrawResults.jsx";
import DodosGuide from "../../components/DodosGuide";
import PrizeVaultBalance from "../../components/PrizeVaultBalance.jsx";
import ReferralDashboard from "../../components/ReferralDashboard.jsx";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useDodosGame } from "./useDodosGame.js";
import {
  formatDrawTime,
  formatCountdown,
  getNextDrawTime,
} from "../../lib/onchain/time.js";
import { NUMBER_OPTIONS } from "../../lib/onchain/rules.js";
import { isPublicVrfBuild } from "../../lib/buildProfile.js";
import { matchesPurchaseQuote } from "./purchaseQuote.js";
import "./dodos.css";

function NumberPair({ numbers, placeholder = false }) {
  return (
    <span
      className={`number-pair ${placeholder ? "number-pair-placeholder" : ""}`}
    >
      {[0, 1].map((index) => (
        <span key={index}>
          {numbers[index] === undefined
            ? "—"
            : String(numbers[index]).padStart(2, "0")}
        </span>
      ))}
    </span>
  );
}

function solFromLamports(value) {
  if (value == null) return null;
  const amount = Number(value.toString()) / 1e9;
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function hasPrizeBacking(capacity, entry, prize) {
  if (capacity?.freeLamports == null || entry == null || prize == null)
    return null;
  try {
    return (
      BigInt(capacity.freeLamports.toString()) + BigInt(entry.toString()) >=
      BigInt(prize.toString())
    );
  } catch {
    return null;
  }
}

export default function Dodos() {
  const game = useDodosGame();
  const { setVisible } = useWalletModal();
  const guideDisclosure = useRef(null);
  const publicPlayEnabled = game.config?.publicPlayEnabled === true;
  const verifiedRandomness =
    game.config?.randomnessMode === "orao-vrf" &&
    game.config?.randomnessVerified === true;
  const awaitingRandomness =
    game.config?.rulesRevision === 6 && !verifiedRandomness;
  const publicBuild = isPublicVrfBuild();
  const referralsVisible =
    !publicBuild &&
    game.publicGame !== true &&
    !publicPlayEnabled &&
    !verifiedRandomness;

  useEffect(() => {
    const openLinkedGuide = () => {
      if (
        ["#game-guide", "#dodos-guide"].includes(window.location.hash) &&
        guideDisclosure.current
      ) {
        guideDisclosure.current.open = true;
        guideDisclosure.current.scrollIntoView({ block: "start" });
      }
    };
    openLinkedGuide();
    window.addEventListener("hashchange", openLinkedGuide);
    return () => window.removeEventListener("hashchange", openLinkedGuide);
  }, []);
  const standardQuickCost = solFromLamports(
    game.config?.quickTicketCostLamports,
  );
  const standardDailyCost = solFromLamports(
    game.config?.dailyTicketCostLamports,
  );
  const referralDiscount =
    referralsVisible && game.referral?.discountEligible === true;
  const quickCost = referralDiscount
    ? solFromLamports(game.referral?.rules?.referredQuickTicketCostLamports)
    : standardQuickCost;
  const dailyCost = referralDiscount
    ? solFromLamports(game.referral?.rules?.referredDailyTicketCostLamports)
    : standardDailyCost;
  const quickPayout = solFromLamports(game.config?.quickPayoutLamports);
  const dailyPayout = solFromLamports(game.config?.dailyPayoutLamports);
  const cost = game.quickDraw ? quickCost : dailyCost;
  const payout = game.quickDraw ? quickPayout : dailyPayout;
  const capacity = game.config?.capacity;
  const selectedEntryLamports = referralDiscount
    ? game.quickDraw
      ? game.referral?.rules?.referredQuickTicketCostLamports
      : game.referral?.rules?.referredDailyTicketCostLamports
    : game.quickDraw
      ? game.config?.quickTicketCostLamports
      : game.config?.dailyTicketCostLamports;
  const pooledDaily = game.publicGame === true && !game.quickDraw;
  const pooledMetadata = game.config?.liabilityRules?.dailyPooled === true;
  const purchaseQuote =
    pooledDaily &&
    matchesPurchaseQuote(
      game.purchaseQuote,
      game.selectedNumbers,
      Number(game.drawChoice),
      game.config,
    )
      ? game.purchaseQuote
      : null;
  const prizeBacked = pooledDaily
    ? (purchaseQuote?.canPurchase ?? null)
    : hasPrizeBacking(
        capacity,
        selectedEntryLamports,
        game.quickDraw
          ? game.config?.quickPayoutLamports
          : game.config?.dailyPayoutLamports,
      );
  const reserveFull = prizeBacked === false;
  const currentSeconds = Math.floor(game.now / 1000);
  const nextDaily = getNextDrawTime(game.now);
  const scheduleIntervalHours = game.config?.scheduleIntervalSeconds
    ? game.config.scheduleIntervalSeconds / 3600
    : null;
  const scheduleInterval = scheduleIntervalHours
    ? `every ${scheduleIntervalHours} hours`
    : "Awaiting schedule";
  const dailySchedule = Array.isArray(game.config?.dailyHours)
    ? game.config.dailyHours
        .map((hour) => `${hour % 12 || 12} ${hour < 12 ? "AM" : "PM"}`)
        .join(" / ")
    : null;
  const available =
    game.uatReady &&
    game.authorized &&
    !game.isLoading &&
    game.canSign &&
    game.networkAllowed &&
    !reserveFull &&
    (!pooledDaily || Boolean(purchaseQuote)) &&
    (game.config?.rulesRevision !== 6 || verifiedRandomness) &&
    cost !== null &&
    payout !== null;

  return (
    <div className="dodos-dashboard" id="dodos">
      <div className="page-heading">
        <div>
          <p className="eyebrow">PICK. MATCH. CLAIM.</p>
          <h1 id="dodos-heading" tabIndex={-1}>
            Dodos<span>.</span>
          </h1>
          <p className="page-description">
            Pick two numbers in order. One ticket enters one chosen draw.
          </p>
        </div>
        <span className="test-build-label">Test SOL only</span>
      </div>

      <nav className="dodos-page-links" aria-label="Dodos sections">
        <a href="#buy-ticket">Buy a ticket</a>
        <a href="#your-tickets">Your tickets</a>
        <a href="#draw-results">Draw results</a>
        {referralsVisible && <a href="#referrals">Referrals</a>}
        <a
          href="#game-guide"
          onClick={() => {
            if (guideDisclosure.current) guideDisclosure.current.open = true;
          }}
        >
          How to play
        </a>
      </nav>

      <div className="draw-stats" aria-label="Draw details">
        <div className="draw-stat">
          <span>Daily draw prize</span>
          <strong>
            {dailyPayout === null ? "—" : dailyPayout}
            <small>SOL</small>
          </strong>
          <span>
            {dailyCost === null
              ? "Awaiting contract"
              : `${dailyCost} SOL entry`}{" "}
            · {scheduleInterval}
          </span>
        </div>
        <div className="draw-stat">
          <span>Quick draw prize</span>
          <strong>
            {quickPayout === null ? "—" : quickPayout}
            <small>SOL</small>
          </strong>
          <span>
            {quickCost === null
              ? "Awaiting contract"
              : `${quickCost} SOL entry`}{" "}
            · about 60 seconds
          </span>
        </div>
        <div className="draw-stat">
          <span>Next daily draw · UTC+8</span>
          <strong className="draw-stat-time">
            {dailySchedule ? formatDrawTime(nextDaily) : "Awaiting contract"}
          </strong>
          <span>
            {dailySchedule
              ? `In ${formatCountdown(nextDaily - currentSeconds)} · ${scheduleInterval}`
              : "Loading on-chain schedule"}
          </span>
        </div>
      </div>

      <div
        className="status-note status-note-warning dashboard-notice"
        role="note"
      >
        {awaitingRandomness
          ? "The on-chain randomness configuration could not be verified. Purchases are paused; existing tickets and blockchain history remain available."
          : game.uatReady && verifiedRandomness
            ? "Public Devnet · Verifiable randomness. ORAO supplies each new draw's randomness, recorded with its oracle request. All amounts are test SOL. Legacy tickets and their original results stay separate."
            : game.uatReady
              ? `UAT test mode: draw results are fixed, not random. ${publicPlayEnabled ? "All signing wallets can play on Devnet" : "Only approved test wallets can play"}; all amounts are test SOL. Published results and older records remain visible in blockchain history.`
              : game.isLoading
                ? "Loading the on-chain UAT configuration. Purchases are paused until test mode is verified."
                : game.loadFailed
                  ? "UAT mode could not be verified. Purchases are paused until the on-chain configuration loads."
                  : "The on-chain game setup is awaiting verification. Purchases are paused until the contract and randomness configuration are verified."}
      </div>
      {game.uatReady && game.connected && !game.authorized && (
        <div
          className="status-note status-note-warning dashboard-notice"
          role="note"
        >
          Connect your approved UAT wallet to buy, record results, or claim. You
          can still view blockchain history.
        </div>
      )}
      {game.error && (
        <div
          className={`status-note ${game.refreshWarning || (!game.config && !game.loadFailed) ? "status-note-warning" : "status-note-error"} dashboard-notice`}
          role="alert"
        >
          {game.error}
        </div>
      )}
      {game.message && (
        <div className="status-note dashboard-notice" role="status">
          {game.message}
        </div>
      )}

      <div className="dashboard-grid">
        <div className="dashboard-primary">
          <section
            id="buy-ticket"
            className="panel purchase-panel"
            aria-labelledby="purchase-title"
          >
            <div className="panel-heading">
              <h2 id="purchase-title">Buy a ticket</h2>
              <span className="onchain-tag">On-chain</span>
            </div>
            <div className="selection-heading">
              <span className="field-label">Choose 2 different numbers</span>
              <button
                className="button button-ghost"
                disabled={game.pending}
                onClick={game.randomize}
              >
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path
                    d="M3 5h3l8 10h3M14 12l3 3-3 3M3 15h3l3-4m2-2 3-4h3M14 2l3 3-3 3"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Quick pick
              </button>
            </div>
            <div
              className="number-grid"
              role="group"
              aria-label="Numbers 2 to 22, selected in order"
            >
              {NUMBER_OPTIONS.map((number) => {
                const selectedIndex = game.selectedNumbers.indexOf(number);
                return (
                  <button
                    key={number}
                    className={`number-button ${selectedIndex >= 0 ? "is-selected" : ""}`}
                    disabled={
                      game.pending ||
                      (game.selectedNumbers.length === 2 && selectedIndex < 0)
                    }
                    onClick={() => game.select(number)}
                    aria-label={`Number ${number}${selectedIndex >= 0 ? `, pick ${selectedIndex + 1}` : ""}`}
                    aria-pressed={selectedIndex >= 0}
                  >
                    {String(number).padStart(2, "0")}
                    {selectedIndex >= 0 && (
                      <span className="pick-order">{selectedIndex + 1}</span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="selection-summary">
              <div>
                <span className="field-label">
                  Your selection{" "}
                  <span className="selection-order-label">· order matters</span>
                </span>
                <NumberPair
                  numbers={game.selectedNumbers}
                  placeholder={!game.selectedNumbers.length}
                />
              </div>
              <button
                className="button button-ghost"
                onClick={game.clearSelection}
                disabled={game.pending || !game.selectedNumbers.length}
              >
                Clear
              </button>
            </div>
            <label className="field-label" htmlFor="draw-mode">
              Choose one draw · UTC+8
            </label>
            <select
              id="draw-mode"
              value={game.drawChoice}
              disabled={game.pending}
              onChange={(event) => game.setDrawChoice(event.target.value)}
            >
              {game.dailyDraws.map((drawTime) => (
                <option key={drawTime} value={String(drawTime)}>
                  {formatDrawTime(drawTime)}
                  {drawTime <= currentSeconds
                    ? " · Started — choose another"
                    : ` · Daily · ${dailyCost ?? "—"} SOL entry`}
                </option>
              ))}
              {game.uatReady && (
                <option value="quick">
                  Quick draw · about 60 seconds · {quickCost ?? "—"} SOL entry
                </option>
              )}
            </select>
            <p className="draw-rules">
              {game.quickDraw
                ? `The quick draw starts about 60 seconds after you press Buy; approve before it starts. An exact match pays ${quickPayout ?? "—"} SOL. Daily draws have their own entry price and prize.`
                : `This ticket covers only the selected date and time. ${dailySchedule ? `Daily draws: ${dailySchedule}, UTC+8.` : "Awaiting the on-chain daily schedule."} ${pooledDaily ? "Tickets in the same daily draw share backing across different ordered pairs. Repeating a pair increases its possible payout and may need more backing." : "Multiple tickets for the same draw are allowed while enough prize reserves are available."} Buy before the selected draw starts.`}
            </p>
            <PrizeVaultBalance capacity={capacity} />
            {pooledDaily && (
              <div
                className="purchase-pool-quote"
                aria-label="Daily entry backing quote"
              >
                <p className="draw-rules">
                  {purchaseQuote
                    ? `Backing checked for ${game.selectedNumbers.map((number) => String(number).padStart(2, "0")).join(" → ")}, ${formatDrawTime(purchaseQuote.drawTime)} UTC+8.`
                    : !pooledMetadata
                      ? "Daily backing metadata is unavailable. Daily purchases are paused until the on-chain rules can be verified."
                      : game.purchaseQuoteError
                        ? game.purchaseQuoteError
                        : game.selectedNumbers.length !== 2
                          ? "Choose two numbers to check this combination's backing and wallet account rent."
                          : "Checking this combination's backing and account rent from Devnet…"}
                </p>
                {purchaseQuote && (
                  <>
                    <dl>
                      <div>
                        <dt>Additional vault backing</dt>
                        <dd>
                          {solFromLamports(
                            purchaseQuote.requiredBackingLamports,
                          )}{" "}
                          SOL
                        </dd>
                      </div>
                      <div>
                        <dt>Wallet account rent</dt>
                        <dd>
                          {solFromLamports(purchaseQuote.accountRentLamports)}{" "}
                          SOL
                        </dd>
                      </div>
                    </dl>
                    <p className="draw-rules">
                      {purchaseQuote.riskRentLamports > 0
                        ? `This draw's first pooled entry creates its shared combination account: ${solFromLamports(purchaseQuote.riskRentLamports)} SOL rent, included above. `
                        : "The shared combination account already exists; no new shared-account rent is charged. "}
                      Your wallet pays the entry, quoted account rent and
                      network fee. Additional backing stays inside the vault; no
                      prize is paid at purchase. The contract rechecks capacity
                      before accepting the ticket.
                    </p>
                  </>
                )}
                {pooledMetadata && game.selectedNumbers.length === 2 && (
                  <button
                    className="button button-ghost"
                    onClick={game.refreshPurchaseQuote}
                    disabled={
                      game.pending ||
                      game.isLoading ||
                      game.purchaseQuoteLoading ||
                      game.purchaseQuoteCooldown > 0 ||
                      typeof game.refreshPurchaseQuote !== "function"
                    }
                  >
                    {game.purchaseQuoteCooldown > 0
                      ? `Refresh quote in ${game.purchaseQuoteCooldown}s`
                      : "Refresh backing quote"}
                  </button>
                )}
              </div>
            )}
            {reserveFull && (
              <p className="draw-expired" role="status">
                {pooledDaily
                  ? "This combination needs more backing for another possible winning payout. Different pairs in this daily draw can share backing. Existing prizes stay protected; no reward has left the vault."
                  : "Prize reserves are full for this entry. Multiple tickets per draw are allowed; this pause protects every accepted prize. Refresh after reserves are released or funded."}
              </p>
            )}
            {game.drawExpired && (
              <p className="draw-expired" role="status">
                This draw has started. Choose an upcoming draw; your selection
                will not move automatically.
              </p>
            )}
            <div className="ticket-total">
              <span>
                Ticket total{referralDiscount ? " · referral price" : ""}
              </span>
              <strong>
                {cost === null ? "Awaiting contract" : `${cost} SOL`}
                <small> + fees & rent</small>
              </strong>
            </div>
            {referralsVisible &&
              game.referral?.available &&
              !game.referral.profile?.bindingLocked && (
                <p className="draw-rules referral-purchase-note">
                  {game.referral.profile?.referrer ? (
                    "This first campaign ticket will permanently lock your selected inviter."
                  ) : (
                    <>
                      No inviter selected. Your first campaign ticket
                      permanently locks this choice.{" "}
                      <a href="#referrals">Add a referral code before buying</a>{" "}
                      if you want referral entry prices.
                    </>
                  )}
                  {!game.referral.profile &&
                    " This purchase also creates your referral profile once; account rent applies. Sharing stays off unless you enable it."}
                </p>
              )}
            <button
              className="button button-primary purchase-button"
              onClick={game.connected ? game.purchase : () => setVisible(true)}
              disabled={
                game.pending ||
                (game.connected &&
                  (!available ||
                    game.drawExpired ||
                    game.selectedNumbers.length !== 2))
              }
            >
              {game.pending
                ? "Waiting for transaction…"
                : !game.connected
                  ? "Connect wallet to buy a ticket"
                  : game.networkChecking
                    ? "Checking network…"
                    : !game.networkAllowed
                      ? "Test network required"
                      : !game.canSign
                        ? "A signing wallet is required"
                        : !game.uatReady
                          ? "UAT setup pending"
                          : awaitingRandomness
                            ? "Randomness verification required"
                            : !game.authorized
                              ? "Approved UAT wallet required"
                              : pooledDaily && !pooledMetadata
                                ? "Daily backing unavailable"
                                : reserveFull
                                  ? pooledDaily
                                    ? "Combination backing full"
                                    : "Prize reserves full"
                                  : game.drawExpired
                                    ? "Choose an upcoming draw"
                                    : cost === null || payout === null
                                      ? "Awaiting draw pricing"
                                      : pooledDaily && !purchaseQuote
                                        ? game.selectedNumbers.length !== 2
                                          ? "Choose two numbers"
                                          : game.purchaseQuoteError
                                            ? "Refresh daily backing"
                                            : "Checking daily backing…"
                                        : game.pendingPurchase
                                          ? "Check / retry purchase"
                                          : "Buy ticket"}
              <span aria-hidden="true">↗</span>
            </button>
            <p className="purchase-caption">
              {game.pendingPurchase
                ? "Retries reuse the same ticket ID so only one purchase can succeed. Use Refresh to check its status without sending."
                : !game.networkAllowed && !game.networkChecking
                  ? game.publicGame
                    ? "Connect to Solana Devnet to use Dodos."
                    : "Connect to Devnet, Testnet, or a local validator to use Dodos."
                  : game.isLoading
                    ? "Loading contract details…"
                    : !game.config
                      ? "Ticket purchases will be available when this network is initialized."
                      : "Approve before the draw starts. A late transaction is rejected; no ticket price is collected. Failed transactions can still incur a network fee."}
            </p>
          </section>
        </div>

        <div className="dashboard-secondary">
          <DodosTickets game={game} />
        </div>
      </div>
      <DrawResults
        results={game.results}
        network={game.network}
        isLoading={game.isLoading}
        loadFailed={game.loadFailed}
        refreshWarning={game.refreshWarning}
        loaded={
          game.historyLoaded === true ||
          (game.historyLoaded === undefined &&
            Boolean(game.config) &&
            !game.loadFailed)
        }
        programIds={game.programIds}
      />
      {referralsVisible && <ReferralDashboard game={game} />}
      <details
        ref={guideDisclosure}
        id="game-guide"
        className="panel guide-disclosure"
      >
        <summary>
          <span>
            <strong>How to play Dodos</strong>
            <span>Rules, prizes and claiming your wins</span>
          </span>
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path
              d="m5 8 5 5 5-5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </summary>
        <DodosGuide
          quickPriceSol={quickCost}
          dailyPriceSol={dailyCost}
          quickPayoutSol={quickPayout}
          dailyPayoutSol={dailyPayout}
          uatReady={game.uatReady && !awaitingRandomness}
          publicPlayEnabled={publicPlayEnabled}
          randomnessVerified={verifiedRandomness}
          publicGame={game.publicGame}
          rules={game.config}
          referralRules={referralsVisible ? game.referral?.rules : null}
          referralDiscount={referralDiscount}
        />
      </details>
      <div className="support-section">
        <DonationCard network={game.network} />
      </div>
    </div>
  );
}

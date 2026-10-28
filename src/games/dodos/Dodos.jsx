import DonationCard from "../../components/DonationCard";
import TicketList from "../../components/TicketList";
import DrawResults from "../../components/DrawResults.jsx";
import DodosGuide from "../../components/DodosGuide";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useDodosGame } from "./useDodosGame.js";
import {
  formatDrawTime,
  formatCountdown,
  getNextDrawTime,
} from "../../lib/onchain/time.js";
import { explorerAccountUrl } from "../../lib/explorer.js";
import {
  NUMBER_OPTIONS,
  DAILY_PAYOUT_MULTIPLIER,
} from "../../lib/onchain/rules.js";
import "./dodos.css";

function RefreshIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M16 8a6.3 6.3 0 1 0-.5 5M16 3v5h-5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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

function HistoryLink({ address, network, children }) {
  const href = explorerAccountUrl(address, network);
  return href ? (
    <a
      className="history-link"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children} <span aria-hidden="true">↗</span>
    </a>
  ) : null;
}

export default function Dodos() {
  const game = useDodosGame();
  const { setVisible } = useWalletModal();
  const cost = game.config
    ? Number(game.config.ticketCostLamports.toString()) / 1e9
    : null;
  const quickPayout = game.config
    ? Number(game.config.payoutLamports.toString()) / 1e9
    : null;
  const dailyPayout =
    quickPayout === null ? null : quickPayout * DAILY_PAYOUT_MULTIPLIER;
  const payout = game.quickDraw ? quickPayout : dailyPayout;
  const currentSeconds = Math.floor(game.now / 1000);
  const nextDaily = getNextDrawTime(game.now);
  const available =
    game.uatReady &&
    game.authorized &&
    !game.isLoading &&
    game.canSign &&
    game.networkAllowed;

  return (
    <div className="dodos-dashboard" id="dodos">
      <div className="page-heading">
        <div>
          <p className="eyebrow">PICK. MATCH. CLAIM.</p>
          <h1>
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
        <a href="#draw-results">Draw results</a>
        <a href="#dodos-guide">How to play</a>
      </nav>

      <div className="draw-stats" aria-label="Draw details">
        <div className="draw-stat">
          <span>Ticket price</span>
          <strong>
            {cost === null ? "—" : cost}
            <small>SOL</small>
          </strong>
          <span>+ network fees & account rent</span>
        </div>
        <div className="draw-stat">
          <span>
            {game.quickDraw ? "Quick draw prize" : "Daily draw prize"}
          </span>
          <strong>
            {payout === null ? "—" : payout}
            <small>SOL</small>
          </strong>
          <span>
            {game.quickDraw
              ? "Faster test draw · exact order"
              : "Double the quick draw prize · exact order"}
          </span>
        </div>
        <div className="draw-stat">
          <span>Next daily draw · UTC+8</span>
          <strong className="draw-stat-time">
            {formatDrawTime(nextDaily)}
          </strong>
          <span>
            In {formatCountdown(nextDaily - currentSeconds)} · 2 PM and 4 PM
            daily
          </span>
        </div>
      </div>

      <div
        className="status-note status-note-warning dashboard-notice"
        role="note"
      >
        {game.uatReady
          ? "UAT test mode: the live program records 06 → 09. The frontend target is 06 → 07, pending an on-chain upgrade. Results are fixed, not random. Only approved test wallets can play; all amounts are test SOL. Older records keep their original results."
          : game.isLoading
            ? "Loading the on-chain UAT configuration. Purchases are paused until test mode is verified."
            : game.loadFailed
              ? "UAT mode could not be verified. Purchases are paused until the on-chain configuration loads."
              : "The fixed-result UAT update is awaiting on-chain configuration. Purchases are paused until the contract confirms test mode."}
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
                    : " · Daily draw"}
                </option>
              ))}
              {game.uatReady && (
                <option value="quick">
                  UAT quick draw · about 60 seconds · {quickPayout ?? "—"} SOL
                </option>
              )}
            </select>
            <p className="draw-rules">
              {game.quickDraw
                ? "A faster UAT test with the quick prize shown above. The timer starts when you press Buy; approve within about one minute. Daily draws offer double the prize with the same matching rules."
                : "This ticket is valid only for the date and time selected. The 2 PM and 4 PM draws need separate tickets. You can enter until the selected draw starts."}
            </p>
            {game.drawExpired && (
              <p className="draw-expired" role="status">
                This draw has started. Choose an upcoming draw; your selection
                will not move automatically.
              </p>
            )}
            <div className="ticket-total">
              <span>Ticket total</span>
              <strong>
                {cost === null ? "Awaiting contract" : `${cost} SOL`}
                <small> + fees & rent</small>
              </strong>
            </div>
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
                          : !game.authorized
                            ? "Approved UAT wallet required"
                            : game.drawExpired
                              ? "Choose an upcoming draw"
                              : game.pendingPurchase
                                ? "Check / retry purchase"
                                : "Buy ticket"}
              <span aria-hidden="true">↗</span>
            </button>
            <p className="purchase-caption">
              {game.pendingPurchase
                ? "Retries reuse the same ticket ID so only one purchase can succeed. Use Refresh to check its status without sending."
                : !game.networkAllowed && !game.networkChecking
                  ? "Connect to Devnet, Testnet, or a local validator to use Dodos."
                  : game.isLoading
                    ? "Loading contract details…"
                    : !game.config
                      ? "Ticket purchases will be available when this network is initialized."
                      : "Approve before the draw starts. A late transaction is rejected; no ticket price is collected. Failed transactions can still incur a network fee."}
            </p>
          </section>

          <section
            className="panel tickets-panel"
            aria-labelledby="tickets-title"
          >
            <div className="panel-heading">
              <div className="tickets-title">
                <h2 id="tickets-title">Your tickets</h2>
                {game.connected && game.config && !game.loadFailed && (
                  <span className="count-badge">{game.tickets.length}</span>
                )}
              </div>
              <button
                className="button button-ghost"
                disabled={
                  game.pending || game.isLoading || game.refreshCooldown > 0
                }
                onClick={game.refresh}
                aria-label="Refresh tickets and results"
              >
                <RefreshIcon />
                {game.refreshCooldown > 0
                  ? `Refresh in ${game.refreshCooldown}s`
                  : "Refresh"}
              </button>
            </div>
            {game.isLoading ? (
              <div className="empty-state" role="status">
                Loading on-chain tickets…
              </div>
            ) : !game.connected ? (
              <div className="empty-state">
                <svg viewBox="0 0 28 28" fill="none" aria-hidden="true">
                  <rect
                    x="4"
                    y="6"
                    width="20"
                    height="16"
                    rx="3"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M18 12h6v5h-6a2.5 2.5 0 0 1 0-5Z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                </svg>
                <strong>Your tickets live here</strong>Connect a wallet to view
                your on-chain tickets.
              </div>
            ) : game.tickets.length === 0 ? (
              <div className="empty-state">
                <strong>
                  {game.loadFailed ? "Tickets unavailable" : "No tickets yet"}
                </strong>
                {game.loadFailed
                  ? "Refresh after the connection is available."
                  : "Choose your numbers above to enter a draw."}
              </div>
            ) : (
              <TicketList
                newestFirst
                tickets={game.tickets}
                renderTicket={(ticket) => {
                  const due = currentSeconds >= ticket.drawTime;
                  const published = Boolean(ticket.result?.isPublished);
                  const won =
                    published &&
                    ticket.numbers.every(
                      (number, index) =>
                        number === ticket.result.numbers[index],
                    );
                  const status = ticket.settled
                    ? won
                      ? "Prize claimed"
                      : "Closed"
                    : !due
                      ? "Upcoming"
                      : !published
                        ? "Awaiting result"
                        : won
                          ? "Prize ready"
                          : "No match";
                  return (
                    <article className="ticket-card">
                      <div className="ticket-card-top">
                        <NumberPair numbers={ticket.numbers} />
                        <span
                          className={`ticket-status ${won && !ticket.settled ? "ticket-status-ready" : ""}`}
                        >
                          {status}
                        </span>
                      </div>
                      <p className="ticket-draw-time">
                        {formatDrawTime(ticket.drawTime)} · UTC+8
                      </p>
                      {ticket.payoutLamports !== null &&
                        ticket.payoutLamports !== undefined && (
                          <p className="ticket-prize">
                            This ticket's match prize:{" "}
                            {ticket.payoutLamports / 1e9} SOL
                          </p>
                        )}
                      <p className="ticket-countdown">
                        {ticket.settled
                          ? won
                            ? "Prize transfer recorded on-chain"
                            : "Closed without a prize"
                          : !due
                            ? `Starts in ${formatCountdown(ticket.drawTime - currentSeconds)}`
                            : !published
                              ? "Draw is due. Record the result to check this ticket."
                              : won
                                ? "Both numbers match in order. UAT prizes have no claim deadline."
                                : "No prize. You can close this ticket to release reserved prize capacity."}
                      </p>
                      {published && (
                        <div className="ticket-result">
                          <span>Recorded result</span>
                          <NumberPair numbers={ticket.result.numbers} />
                        </div>
                      )}
                      <div className="ticket-history">
                        <HistoryLink
                          address={ticket.address}
                          network={game.network}
                        >
                          Ticket history
                        </HistoryLink>
                        {published && (
                          <HistoryLink
                            address={ticket.result.id}
                            network={game.network}
                          >
                            Draw history
                          </HistoryLink>
                        )}
                      </div>
                      <div className="ticket-actions">
                        <button
                          className="button button-secondary"
                          disabled={game.pending}
                          onClick={() => game.check(ticket)}
                        >
                          View result · free
                        </button>
                        {!published && (
                          <button
                            className="button button-secondary"
                            disabled={
                              game.pending ||
                              !game.canSign ||
                              !game.networkAllowed ||
                              !game.authorized ||
                              !due ||
                              ticket.settled
                            }
                            onClick={() => game.publish(ticket)}
                          >
                            Record draw result
                          </button>
                        )}
                        {published && !ticket.settled && (
                          <button
                            className="button button-primary"
                            disabled={
                              game.pending ||
                              !game.canSign ||
                              !game.networkAllowed ||
                              !game.authorized ||
                              !due ||
                              ticket.settled
                            }
                            onClick={() => game.settle(ticket)}
                          >
                            {won ? "Claim prize" : "Close ticket"}
                          </button>
                        )}
                      </div>
                      {!ticket.settled && (
                        <p className="ticket-action-note">
                          {!published
                            ? "Record draw result saves the contract's result; you cannot choose the numbers. This wallet pays the network fee and result account rent once per draw."
                            : won
                              ? "Claim prize transfers the payout to your wallet. A network fee applies."
                              : "Closing is optional. A network fee applies; no prize is paid."}
                        </p>
                      )}
                    </article>
                  );
                }}
              />
            )}
          </section>
        </div>

        <div className="dashboard-secondary">
          <DodosGuide
            priceSol={cost}
            quickPayoutSol={quickPayout}
            dailyPayoutSol={dailyPayout}
            uatReady={game.uatReady}
          />
          <DonationCard />
        </div>
      </div>
      <DrawResults
        results={game.results}
        network={game.network}
        quickPayout={quickPayout}
        dailyPayout={dailyPayout}
        isLoading={game.isLoading}
        loadFailed={game.loadFailed}
        refreshWarning={game.refreshWarning}
      />
    </div>
  );
}

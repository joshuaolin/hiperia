import { useState } from "react";
import TicketList from "./TicketList.jsx";
import useLinkedDisclosure from "./useLinkedDisclosure.js";
import { explorerAccountUrl } from "../lib/explorer.js";
import { formatCountdown, formatDrawTime } from "../lib/onchain/time.js";
import { isDailyDrawTime } from "../lib/onchain/time.js";
import { VRF_PROGRAM_ID } from "../lib/onchain/vrfProtocol.js";
import {
  getRevealDraws,
  revealDrawKey,
  revealCostTotal,
  reviewedQuoteFor,
} from "../games/dodos/revealDraws.js";
import {
  getClaimableTickets,
  getTicketState,
  groupTicketsByState,
  TICKET_FILTERS,
} from "./ticketStates.js";

function NumberPair({ numbers }) {
  return (
    <span className="number-pair">
      {numbers.map((number, index) => (
        <span key={index}>{String(number).padStart(2, "0")}</span>
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
      {children}
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path
          d="M11 4h5v5M16 4l-8 8M8 4H4v12h12v-4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </a>
  ) : null;
}

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

function amount(value) {
  if (value == null) return null;
  const lamports = Number(value.toString());
  return Number.isSafeInteger(lamports) && lamports >= 0
    ? `${lamports / 1e9} SOL`
    : null;
}

function OracleQuote({ quote }) {
  const total = amount(quote?.totalLamports);
  if (!total) return null;
  return (
    <div className="oracle-cost-quote">
      <strong>Reveal costs: {total}</strong>
      <dl>
        {[
          ["Oracle fee", quote.feeLamports],
          ["Oracle account rent", quote.pendingRentLamports],
          ["Request account rent", quote.clientRentLamports],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{amount(value) ?? "Unavailable"}</dd>
          </div>
        ))}
      </dl>
      <p>
        Read from Devnet. Your wallet pays these costs and network fees; the
        prize pool is separate. Completion may request a second approval. Any
        reclaimed request funding returns only to the original requester. That
        completion approval may also release losing tickets' prize reserves.
      </p>
    </div>
  );
}

function DrawActions({ draw, game, canTransact, quote }) {
  const { ticket, status } = draw;
  const canUse = canTransact && game.uatReady && game.authorized;
  return (
    <li className="bulk-reveal-draw" data-draw-key={draw.key}>
      <div className="bulk-reveal-header">
        <div>
          <strong>
            {isDailyDrawTime(ticket.drawTime) ? "Daily draw" : "Quick draw"}
          </strong>
          <span>{formatDrawTime(ticket.drawTime)} · UTC+8</span>
        </div>
        <span className="count-badge">
          {draw.tickets.length} ticket{draw.tickets.length === 1 ? "" : "s"}
        </span>
      </div>
      <p className="ticket-action-note">
        {status === "pending"
          ? "Oracle requested. All tickets in this draw will share its recorded result; no additional request is needed."
          : status === "fulfilled"
            ? "Oracle ready. One completion records the result for every ticket in this draw."
            : "One reveal request covers every ticket in this draw. Oracle funding is charged once per draw."}
      </p>
      {status === "open" && quote && <OracleQuote quote={quote} />}
      <div className="bulk-reveal-actions">
        {status === "open" && !quote && (
          <button
            className="button button-secondary"
            disabled={!canUse || typeof game.reviewReveal !== "function"}
            onClick={() => game.reviewReveal(ticket)}
          >
            Review reveal costs
          </button>
        )}
        {((status === "open" && quote) || status === "fulfilled") && (
          <button
            className="button button-secondary"
            disabled={!canUse}
            onClick={() => game.publish(ticket)}
          >
            {status === "fulfilled" ? "Complete draw" : "Reveal result"}
          </button>
        )}
        {status === "pending" && (
          <button
            className="button button-secondary"
            disabled={
              game.pending || game.isLoading || game.refreshCooldown > 0
            }
            onClick={game.refresh}
          >
            Check oracle status
          </button>
        )}
      </div>
    </li>
  );
}

function RevealAll({ draws, game, canTransact }) {
  if (!draws.length) return null;
  const quotes = game.oracleQuotes ?? {};
  const total = revealCostTotal(draws, quotes);
  const openCount = draws.filter((draw) => draw.status === "open").length;
  const ticketCount = draws.reduce(
    (count, draw) => count + draw.tickets.length,
    0,
  );
  const canUse = canTransact && game.uatReady && game.authorized;
  return (
    <section className="bulk-reveal-panel" aria-label="Draw reveal actions">
      <div className="bulk-reveal-header">
        <div>
          <h3>Reveal your draws</h3>
          <p>
            {ticketCount} ticket{ticketCount === 1 ? "" : "s"} · {draws.length}{" "}
            unique draw{draws.length === 1 ? "" : "s"}
          </p>
        </div>
        <button
          className="button button-secondary"
          disabled={
            !canUse ||
            openCount === 0 ||
            typeof game.reviewAllReveals !== "function"
          }
          onClick={game.reviewAllReveals}
        >
          Review all reveal costs
        </button>
      </div>
      <p className="bulk-reveal-totals" role="status">
        {total === null
          ? `Review costs for ${openCount} new reveal${openCount === 1 ? "" : "s"} before continuing.`
          : `New reveal funding: ${amount(total)} across ${openCount} draw${openCount === 1 ? "" : "s"}. Network fees are separate.`}
      </p>
      <div className="bulk-reveal-actions">
        <button
          className="button button-primary"
          disabled={
            !canUse || total === null || typeof game.publishAll !== "function"
          }
          onClick={game.publishAll}
        >
          Reveal / complete all ({draws.length} draw
          {draws.length === 1 ? "" : "s"})
        </button>
      </div>
      <p className="ticket-action-note">
        Each draw uses separate wallet approvals, in order. A new reveal can
        require another approval after the oracle responds. Cancelling stops the
        remaining draws; confirmed requests and results stay recorded. Shared
        daily tickets need only one draw action.
      </p>
      <ul className="bulk-reveal-list">
        {draws.map((draw) => (
          <DrawActions
            key={draw.key}
            draw={draw}
            game={game}
            canTransact={canTransact}
            quote={reviewedQuoteFor(quotes, draw.ticket)}
          />
        ))}
      </ul>
    </section>
  );
}

function TicketCard({
  ticket,
  game,
  currentSeconds,
  canTransact,
  groupedDraw,
}) {
  const state = getTicketState(ticket, currentSeconds);
  const { due, published, won, settled, refunded } = state;
  const oracleDraw = ticket.legacy !== true && Boolean(ticket.draw);
  const oracleStatus = oracleDraw ? ticket.draw.status : null;
  const requestExpired =
    oracleStatus === "open" && ticket.refundEligible === true;
  const canUseTicket =
    canTransact &&
    (ticket.legacy === true || (game.uatReady && game.authorized));
  const canClaimTicket =
    canTransact &&
    (ticket.legacy === true ||
      ticket.sourceProgram === VRF_PROGRAM_ID ||
      (game.publicGame !== true && game.uatReady && game.authorized));
  const status = refunded
    ? "Entry refunded"
    : settled
      ? won
        ? "Prize claimed"
        : published
          ? "Closed"
          : "Settled"
      : !due
        ? "Upcoming"
        : !published
          ? oracleStatus === "pending"
            ? "Oracle pending"
            : oracleStatus === "fulfilled"
              ? "Ready to complete"
              : "Awaiting result"
          : won
            ? state.awaitingFunding ? "Waiting for treasury funding" : state.fundingUnknown ? "Checking claim funding" : "Prize ready"
            : "No match";
  return (
    <article className="ticket-card">
      {ticket.legacy === true && (
        <p className="ticket-source-label">Legacy ticket</p>
      )}
      <div className="ticket-card-top">
        <NumberPair numbers={ticket.numbers} />
        <span
          className={`ticket-status ${state.claimable ? "ticket-status-ready" : ""}`}
        >
          {status}
        </span>
      </div>
      {state.group === "done" && (
        <span
          className={`ticket-outcome ${refunded ? "ticket-outcome-refunded" : published ? (won ? "ticket-outcome-win" : "ticket-outcome-loss") : ""}`}
          aria-label={
            refunded
              ? "Outcome: refunded"
              : published
                ? won
                  ? "Outcome: win"
                  : "Outcome: loss"
                : "Outcome not recorded"
          }
        >
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
            {refunded ? (
              <path
                d="M4 8a6 6 0 1 1 1 7M4 3v5h5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : published && won ? (
              <>
                <path
                  d="M6 3h8v4a4 4 0 0 1-8 0V3ZM10 11v5M7 17h6M6 4H3v2a4 4 0 0 0 4 4M14 4h3v2a4 4 0 0 1-4 4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </>
            ) : published ? (
              <path
                d="m6 6 8 8M14 6l-8 8"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            ) : (
              <path
                d="M6 10h8"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            )}
          </svg>
          {refunded
            ? "REFUNDED"
            : published
              ? won
                ? "WIN"
                : "LOSS"
              : "OUTCOME NOT RECORDED"}
        </span>
      )}
      <p className="ticket-draw-time">
        {formatDrawTime(ticket.drawTime)} · UTC+8
      </p>
      {Number.isSafeInteger(ticket.paidLamports) && ticket.paidLamports > 0 && (
        <p className="ticket-prize">
          Entry paid: {ticket.paidLamports / 1e9} SOL
        </p>
      )}
      {ticket.payoutLamports !== null &&
        ticket.payoutLamports !== undefined && (
          <p className="ticket-prize">
            {refunded ? "Original match prize" : "This ticket's match prize"}:{" "}
            {ticket.payoutLamports / 1e9} SOL
          </p>
        )}
      <p className="ticket-countdown">
        {refunded
          ? "Entry payment refunded on-chain. Network fees and account rent are separate."
          : settled
            ? won
              ? "Prize transfer recorded on-chain"
              : published
                ? "Closed without a prize"
                : "Settlement recorded on-chain"
            : !due
              ? `Starts in ${formatCountdown(ticket.drawTime - currentSeconds)}`
              : !published
                ? oracleStatus === "pending"
                  ? "The oracle request is recorded. Refresh to check for fulfillment; no new request is needed."
                  : oracleStatus === "fulfilled"
                    ? "Oracle randomness is available. Complete the draw to record its numbers."
                    : requestExpired
                      ? "The oracle request window has ended. This ticket's entry can be refunded."
                      : oracleDraw
                        ? "The draw is due. Review reveal costs to request verifiable randomness."
                        : "Draw is due. Record the result to check this ticket."
                : won
                  ? state.awaitingFunding
                    ? "Both numbers match. Your prize remains unpaid until the operator refills the prize vault. Refresh after funding; the ticket does not expire."
                    : state.fundingUnknown
                      ? "Both numbers match. Refresh to verify current prize vault funding before claiming; this unpaid win does not expire."
                      : "Both numbers match in order. Prizes have no claim deadline."
                  : "The recorded numbers do not match. No prize is due."}
      </p>
      {published && (
        <div className="ticket-result">
          <span>Recorded result</span>
          <NumberPair numbers={ticket.result.numbers} />
        </div>
      )}
      <div className="ticket-history">
        <HistoryLink address={ticket.address} network={game.network}>
          Ticket history
        </HistoryLink>
        {published && (
          <HistoryLink address={ticket.result.id} network={game.network}>
            Draw history
          </HistoryLink>
        )}
        {oracleDraw && ticket.draw.oracleRequest && (
          <HistoryLink
            address={ticket.draw.oracleRequest}
            network={game.network}
          >
            Oracle request
          </HistoryLink>
        )}
      </div>
      {!settled && !refunded && due && !published && oracleDraw && (
        <>
          {groupedDraw && (
            <p className="ticket-draw-group-note">
              Reveal controls are grouped above. One recorded result covers all
              tickets in this draw.
            </p>
          )}
          {ticket.draw.oracleReadError && (
            <p className="ticket-action-note" role="status">
              Oracle status is temporarily unavailable. Refresh before
              completing this draw or requesting a refund.
            </p>
          )}
          <div className="ticket-actions">
            {ticket.refundEligible === true && (
              <button
                className="button button-secondary"
                disabled={!canClaimTicket || typeof game.refund !== "function"}
                onClick={() => game.refund(ticket)}
              >
                Refund entry
              </button>
            )}
          </div>
          <p className="ticket-action-note">
            {ticket.refundEligible === true
              ? "The contract currently permits a refund because the oracle deadline passed without a completed result. Only this ticket's actual entry payment is returned."
              : "Reveal requests are recorded on-chain. The oracle supplies randomness; completing the draw records its numbers and may release protected entry payments or older losing reserves in the same approval. New match prizes are paid only when claimed and can wait for treasury funding. Wallet approvals and network fees apply."}
          </p>
        </>
      )}
      {!settled && !refunded && ((!oracleDraw && due && !published) || won) && (
        <div className="ticket-actions">
          {!published && due && (
            <button
              className="button button-secondary"
              disabled={!canUseTicket || !due}
              onClick={() => game.publish(ticket)}
            >
              Record draw result
            </button>
          )}
          {won && (
            <button
              className="button button-primary"
              disabled={!canClaimTicket || !state.claimable}
              onClick={() => game.settle(ticket)}
            >
              {state.awaitingFunding ? "Waiting for funding" : state.fundingUnknown ? "Refresh funding status" : "Claim prize"}
            </button>
          )}
        </div>
      )}
      {!settled && !refunded && ((!oracleDraw && due && !published) || won) && (
        <p className="ticket-action-note">
          {!published
            ? "Record draw result saves the contract's result; you cannot choose the numbers. This wallet pays the network fee and result account rent once per draw."
            : "Claim prize transfers this ticket's recorded payout once to its owner. Funding is checked again before wallet approval. A network fee applies; an unfunded or failed claim stays unpaid."}
        </p>
      )}
      {state.awaitingFunding && game.config?.capacity?.vaultAddress && (
        <div className="ticket-history">
          <HistoryLink address={game.config.capacity.vaultAddress} network={game.network}>
            Prize vault funding history
          </HistoryLink>
        </div>
      )}
    </article>
  );
}

export default function DodosTickets({ game }) {
  const disclosure = useLinkedDisclosure("#your-tickets");
  const [filter, setFilter] = useState("ongoing");
  const currentSeconds = Math.floor(game.now / 1000);
  const groups = groupTicketsByState(game.tickets, currentSeconds);
  const visibleTickets = groups[filter];
  const claimable = getClaimableTickets(game.tickets, currentSeconds);
  const revealDraws = getRevealDraws(groups.ongoing, currentSeconds);
  const revealKeys = new Set(revealDraws.map((draw) => draw.key));
  const hasLoaded =
    game.connected &&
    (game.historyLoaded === true ||
      (game.historyLoaded === undefined &&
        Boolean(game.config) &&
        !game.loadFailed));
  const canTransact =
    game.connected &&
    game.canSign &&
    game.networkAllowed &&
    !game.pending &&
    !game.isLoading;
  const canClaimAll =
    canTransact &&
    ((game.uatReady && game.authorized) ||
      claimable.some(
        (ticket) =>
          ticket.legacy === true || ticket.sourceProgram === VRF_PROGRAM_ID,
      ));

  return (
    <details
      ref={disclosure}
      id="your-tickets"
      className="panel tickets-panel data-disclosure"
      aria-labelledby="tickets-title"
    >
      <summary className="data-disclosure-summary">
        <span>
          <span className="tickets-title">
            <h2 id="tickets-title">Your tickets</h2>
            {hasLoaded && (
              <span className="count-badge">{game.tickets.length}</span>
            )}
          </span>
          <span className="disclosure-description">
            {hasLoaded
              ? `${groups.ongoing.length} ongoing · ${claimable.length} ready to claim`
              : game.connected
                ? "Load your on-chain entries and prizes"
                : "Connect a wallet to view your entries"}
          </span>
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
      <div className="tickets-content">
        <div className="tickets-refresh">
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
        <div className="ticket-toolbar">
          <div
            className="ticket-filters"
            role="group"
            aria-label="Filter your tickets"
          >
            {TICKET_FILTERS.map(({ id, label }) => (
              <button
                key={id}
                className={`ticket-filter ${filter === id ? "is-active" : ""}`}
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
              >
                {label}
                <span>{hasLoaded ? groups[id].length : "—"}</span>
              </button>
            ))}
          </div>
          {filter === "win" && (
            <button
              className="button button-primary claim-all-button"
              disabled={
                !canClaimAll ||
                claimable.length === 0 ||
                typeof game.claimAll !== "function"
              }
              onClick={game.claimAll}
            >
              Claim all{claimable.length ? ` (${claimable.length})` : ""}
            </button>
          )}
        </div>
        {filter === "win" && claimable.length > 0 && (
          <p className="ticket-filter-note">
            Claims use each ticket&apos;s recorded prize. Funding is checked
            before each new prize; unfunded wins stay unpaid in Win. Your wallet
            may request several approvals; network fees apply.
          </p>
        )}
        {filter === "ongoing" && hasLoaded && !game.isLoading && (
          <RevealAll
            draws={revealDraws}
            game={game}
            canTransact={canTransact}
          />
        )}
        {game.isLoading ? (
          <div className="empty-state" role="status">
            Loading on-chain tickets…
          </div>
        ) : !game.connected ? (
          <div className="empty-state">
            <strong>Your tickets live here</strong>
            Connect a wallet to view your on-chain tickets.
          </div>
        ) : game.tickets.length === 0 ? (
          <div className="empty-state">
            <strong>
              {game.loadFailed || !hasLoaded
                ? "Tickets unavailable"
                : "No tickets yet"}
            </strong>
            {game.loadFailed || !hasLoaded
              ? "Refresh after the connection is available."
              : "Choose your numbers above to enter a draw."}
          </div>
        ) : visibleTickets.length === 0 ? (
          <div className="empty-state" role="status">
            <strong>
              {filter === "win"
                ? "No prizes to claim"
                : filter === "done"
                  ? "No completed tickets"
                  : "No ongoing tickets"}
            </strong>
            {filter === "win"
              ? "Unclaimed winning tickets appear here after their result is recorded."
              : filter === "done"
                ? "Claimed prizes, refunded entries and tickets with no match appear here."
                : "Upcoming draws and tickets awaiting a recorded result appear here."}
          </div>
        ) : (
          <TicketList
            key={filter}
            newestFirst
            tickets={visibleTickets}
            renderTicket={(ticket) => (
              <TicketCard
                ticket={ticket}
                game={game}
                currentSeconds={currentSeconds}
                canTransact={canTransact}
                groupedDraw={revealKeys.has(revealDrawKey(ticket))}
              />
            )}
          />
        )}
      </div>
    </details>
  );
}

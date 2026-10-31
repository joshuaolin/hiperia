import { useState } from "react";
import TicketList from "./TicketList.jsx";
import useLinkedDisclosure from "./useLinkedDisclosure.js";
import { explorerAccountUrl } from "../lib/explorer.js";
import { formatCountdown, formatDrawTime } from "../lib/onchain/time.js";
import { VRF_PROGRAM_ID } from "../lib/onchain/vrfProtocol.js";
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
      {children} <span aria-hidden="true">↗</span>
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

function TicketCard({ ticket, game, currentSeconds, canTransact }) {
  const state = getTicketState(ticket, currentSeconds);
  const { due, published, won, settled, refunded } = state;
  const oracleDraw = ticket.legacy !== true && Boolean(ticket.draw);
  const oracleStatus = oracleDraw ? ticket.draw.status : null;
  const requestExpired =
    oracleStatus === "open" && ticket.refundEligible === true;
  const quote =
    game.oracleQuote?.drawTime === ticket.drawTime ? game.oracleQuote : null;
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
            ? "Prize ready"
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
                  ? "Both numbers match in order. UAT prizes have no claim deadline."
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
          {oracleStatus === "open" && !requestExpired && quote && (
            <OracleQuote quote={quote} />
          )}
          {ticket.draw.oracleReadError && (
            <p className="ticket-action-note" role="status">
              Oracle status is temporarily unavailable. Refresh before
              completing this draw or requesting a refund.
            </p>
          )}
          <div className="ticket-actions">
            {oracleStatus === "open" && !requestExpired && !quote && (
              <button
                className="button button-secondary"
                disabled={
                  !canUseTicket || typeof game.reviewReveal !== "function"
                }
                onClick={() => game.reviewReveal(ticket)}
              >
                Review reveal costs
              </button>
            )}
            {((oracleStatus === "open" && !requestExpired && quote) ||
              oracleStatus === "fulfilled") && (
              <button
                className="button button-secondary"
                disabled={!canUseTicket}
                onClick={() => game.publish(ticket)}
              >
                {oracleStatus === "fulfilled"
                  ? "Complete draw"
                  : "Reveal result"}
              </button>
            )}
            {oracleStatus === "pending" && (
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
              : "Reveal requests are recorded on-chain. The oracle supplies randomness; completing the draw records its numbers and may release losing reserves in the same approval. Winning prizes keep their full backing. Wallet approvals and network fees apply."}
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
              Claim prize
            </button>
          )}
        </div>
      )}
      {!settled && !refunded && ((!oracleDraw && due && !published) || won) && (
        <p className="ticket-action-note">
          {!published
            ? "Record draw result saves the contract's result; you cannot choose the numbers. This wallet pays the network fee and result account rent once per draw."
            : "Claim prize transfers this ticket's payout to your wallet. A network fee applies."}
        </p>
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
            Claims use each ticket&apos;s recorded prize. Your wallet may
            request several approvals for a large batch; network fees apply.
          </p>
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
              />
            )}
          />
        )}
      </div>
    </details>
  );
}

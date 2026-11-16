import { useState } from "react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import HistoryLink from "../../components/HistoryLink.jsx";
import useLinkedDisclosure from "../../components/useLinkedDisclosure.js";
import { formatCountdown, formatDrawTime } from "../../lib/onchain/time.js";
import { useLemonGame } from "./useLemonGame.js";
import "./lemon.css";

const FRUITS = [
  { name: "Lemon", symbol: "🍋" },
  { name: "Cherry", symbol: "🍒" },
  { name: "Orange", symbol: "🍊" },
  { name: "Grape", symbol: "🍇" },
  { name: "Watermelon", symbol: "🍉" },
  { name: "Strawberry", symbol: "🍓" },
  { name: "Pineapple", symbol: "🍍" },
  { name: "Apple", symbol: "🍎" },
  { name: "Peach", symbol: "🍑" },
  { name: "Kiwi", symbol: "🥝" },
];

function sol(value) {
  if (value == null) return "Unavailable";
  try {
    const amount = BigInt(value.toString());
    if (amount < 0n) return "Unavailable";
    const fraction = String(amount % 1_000_000_000n)
      .padStart(9, "0")
      .replace(/0+$/, "");
    return `${amount / 1_000_000_000n}${fraction ? `.${fraction}` : ""} SOL`;
  } catch {
    return "Unavailable";
  }
}

function validTriple(numbers) {
  return (
    Array.isArray(numbers) &&
    numbers.length === 3 &&
    numbers.every(
      (number) => Number.isInteger(number) && number >= 0 && number <= 9,
    )
  );
}

function ExternalLink({ address, network, children }) {
  return (
    <HistoryLink
      className="lemon-chain-link"
      address={address}
      network={network}
    >
      {children}
    </HistoryLink>
  );
}

function FruitTriple({ numbers, small = false }) {
  if (!validTriple(numbers))
    return <span className="text-muted">Awaiting verified result</span>;
  return (
    <span
      className={`lemon-triple${small ? " lemon-triple-small" : ""}`}
      role="img"
      aria-label={numbers.map((number) => FRUITS[number].name).join("; ")}
    >
      {numbers.map((number, index) => (
        <span className="lemon-fruit" key={index} aria-hidden="true">
          {FRUITS[number].symbol}
        </span>
      ))}
    </span>
  );
}

function ticketState(ticket, now) {
  const published =
    validTriple(ticket.result?.numbers) &&
    (ticket.result?.isPublished === true || ticket.draw?.status === "final");
  const won =
    published &&
    validTriple(ticket.numbers) &&
    ticket.numbers.every(
      (number, index) => number === ticket.result.numbers[index],
    );
  const done =
    ticket.settled === true || ticket.refunded === true || (published && !won);
  return {
    published,
    won,
    due: Number.isSafeInteger(ticket.drawTime) && ticket.drawTime <= now,
    group: done ? "done" : won ? "win" : "ongoing",
    label: ticket.refunded
      ? "Refunded"
      : ticket.settled
        ? won
          ? "Win · Paid"
          : "Done"
        : published
          ? won
            ? "Win"
            : "Loss"
          : "Ongoing",
  };
}

function drawKind(record) {
  const type =
    record.drawType ?? record.draw?.drawType ?? record.result?.drawType;
  if (type === "daily") return "Daily draw";
  if (type === "quick") return "Quick draw";
  if (typeof record.quickDraw === "boolean")
    return record.quickDraw ? "Quick draw" : "Daily draw";
  return "Recorded draw";
}

function dateLabel(timestamp) {
  return Number.isSafeInteger(timestamp) && timestamp > 0
    ? `${formatDrawTime(timestamp)} · UTC+8`
    : "Time unavailable";
}

function displayMessage(value) {
  return typeof value === "string" ? value : (value?.message ?? "");
}

function drawKey(ticket) {
  return `${ticket.sourceProgram ?? ""}:${ticket.drawTime}`;
}

function RevealCostReview({ quote, ready, canTransact, busy, game }) {
  return (
    <section className="lemon-reveal-review" aria-label="Review reveal costs">
      <h3>Review reveal costs</h3>
      <p>
        One oracle request covers this draw. Your wallet pays these costs
        separately from the prize pool.
      </p>
      <dl className="lemon-checkout">
        <div>
          <dt>Oracle fee</dt>
          <dd>{sol(quote.feeLamports)}</dd>
        </div>
        <div>
          <dt>Oracle and request account rents</dt>
          <dd>{sol(quote.rentLamports)}</dd>
        </div>
        <div className="lemon-checkout-total">
          <dt>Total before network fee</dt>
          <dd>{sol(quote.totalLamports)}</dd>
        </div>
      </dl>
      <p>
        Completion may need another wallet approval after the oracle responds.
        No replacement request is sent automatically.
      </p>
      {!ready && (
        <p role="status">
          This quote is no longer current. Cancel and review fresh reveal costs
          before approving.
        </p>
      )}
      <div className="lemon-ticket-actions">
        <button
          type="button"
          className="button button-primary"
          disabled={
            !canTransact || !ready || typeof game.confirmReveal !== "function"
          }
          onClick={() => game.confirmReveal?.()}
        >
          Approve reveal costs
        </button>
        <button
          type="button"
          className="button button-secondary"
          disabled={busy}
          onClick={() => game.cancelReveal?.()}
        >
          Cancel
        </button>
      </div>
    </section>
  );
}

export default function Lemon() {
  const game = useLemonGame();
  const { setVisible } = useWalletModal();
  const ticketDisclosure = useLinkedDisclosure("#lemon-tickets");
  const resultDisclosure = useLinkedDisclosure("#lemon-results");
  const guideDisclosure = useLinkedDisclosure("#lemon-guide");
  const [selectedSlot, setSelectedSlot] = useState(0);
  const [ticketFilter, setTicketFilter] = useState("ongoing");
  const [ticketPage, setTicketPage] = useState(1);
  const [resultFilter, setResultFilter] = useState("all");
  const [resultDate, setResultDate] = useState("");
  const [resultPage, setResultPage] = useState(1);
  const config = game.config;
  const now = Math.floor((game.now ?? Date.now()) / 1000);
  const busy = Boolean(
    game.pending ||
      game.actionStatus === "pending" ||
      game.actionStatus?.pending,
  );
  const verified = config?.verified === true && config?.outcomes === 1_000;
  const canTransact = Boolean(game.canSign && game.networkAllowed && !busy);
  const numbers = game.selectedNumbers ?? [];
  const quote = game.purchaseQuote;
  const quoteMatches = Boolean(
    quote?.isReady &&
      quote.walletAddress === game.walletAddress &&
      quote.sourceProgram === config?.programId &&
      Number.isFinite(quote.validUntil) &&
      quote.validUntil > (game.now ?? Date.now()) &&
      validTriple(quote.numbers) &&
      validTriple(numbers) &&
      quote.numbers.every((number, index) => number === numbers[index]) &&
      quote.drawTime === game.selectedDrawTime &&
      quote.quick === game.quickDraw &&
      game.selectedDrawTime > now,
  );
  const canBuy =
    verified &&
    canTransact &&
    !game.isLoading &&
    quoteMatches &&
    typeof game.buyTicket === "function";
  const tickets = Array.isArray(game.tickets) ? game.tickets : [];
  const groups = { ongoing: [], win: [], done: [] };
  for (const ticket of tickets)
    groups[ticketState(ticket, now).group].push(ticket);
  const visibleTickets = groups[ticketFilter].slice(
    (ticketPage - 1) * 6,
    ticketPage * 6,
  );
  const drawActionTickets = new Map();
  for (const ticket of visibleTickets) {
    const state = ticketState(ticket, now);
    if (
      state.group === "ongoing" &&
      state.due &&
      !drawActionTickets.has(drawKey(ticket))
    )
      drawActionTickets.set(drawKey(ticket), ticket.id ?? ticket.address);
  }
  const results = (
    Array.isArray(game.drawResults) ? game.drawResults : []
  ).filter(
    (result) =>
      validTriple(result.numbers) &&
      (result.isPublished === true || result.status === "final"),
  );
  const filteredResults = results.filter((result) => {
    if (resultFilter !== "all" && drawKind(result) !== resultFilter)
      return false;
    if (!resultDate) return true;
    if (!Number.isSafeInteger(result.drawTime)) return false;
    return (
      new Date((result.drawTime + 28_800) * 1_000)
        .toISOString()
        .slice(0, 10) === resultDate
    );
  });
  const visibleResults = filteredResults.slice(
    (resultPage - 1) * 8,
    resultPage * 8,
  );
  const selectedEntry = game.quickDraw
    ? config?.quickEntryLamports
    : config?.entryLamports;
  const selectedPrize = game.quickDraw
    ? config?.quickPrizeLamports
    : config?.prizeLamports;
  const error = displayMessage(game.error);
  const status =
    displayMessage(game.status) || displayMessage(game.actionStatus?.message);
  const revealQuote = game.revealQuote;
  const revealQuoteReady = Boolean(
    revealQuote &&
      revealQuote.walletAddress === game.walletAddress &&
      revealQuote.sourceProgram === config?.programId &&
      Number.isFinite(revealQuote.validUntil) &&
      revealQuote.validUntil > (game.now ?? Date.now()) &&
      revealQuote.feeLamports != null &&
      revealQuote.rentLamports != null &&
      revealQuote.totalLamports != null,
  );
  const schedule = Array.isArray(config?.dailyHours)
    ? config.dailyHours
        .map((hour) => `${String(hour).padStart(2, "0")}:00`)
        .join(" / ")
    : null;

  function chooseFruit(value) {
    if (typeof game.setNumber !== "function") return;
    game.setNumber(selectedSlot, value);
    setSelectedSlot((selectedSlot + 1) % 3);
  }

  return (
    <div className="lemon-dashboard" id="lemon">
      <div className="page-heading">
        <div>
          <p className="eyebrow">THREE FRUITS. ONE EXACT MATCH.</p>
          <h1 id="lemon-heading" tabIndex={-1}>
            Lemon<span>.</span>
          </h1>
          <p className="page-description">
            Pick your fruit and match all three in order.
          </p>
        </div>
        <span className="test-build-label">Test SOL only</span>
      </div>

      <nav className="lemon-page-links" aria-label="Lemon sections">
        <a href="#lemon-buy">Buy a ticket</a>
        <a href="#lemon-tickets">Your tickets</a>
        <a href="#lemon-results">Draw results</a>
        <a href="#lemon-guide">Game guide</a>
      </nav>

      <div className="lemon-banner">
        <span className="lemon-banner-fruit" aria-hidden="true">
          🍋
        </span>
        <div className="lemon-banner-title">
          <strong>Pick it. Match it. Lemon.</strong>
        </div>
        <div className="lemon-banner-prize">
          <span>Daily prize</span>
          <strong>
            {verified ? sol(config.prizeLamports) : "Loading rules"}
          </strong>
        </div>
        <div className="lemon-banner-prize">
          <span>Quick prize</span>
          <strong>
            {verified ? sol(config.quickPrizeLamports) : "Loading rules"}
          </strong>
        </div>
      </div>

      {(error || status) && (
        <div
          className={`lemon-message${error ? " lemon-message-error" : ""}`}
          role={error ? "alert" : "status"}
        >
          {error || status}
        </div>
      )}
      {!game.networkAllowed && !game.isLoading && (
        <p className="lemon-message">
          Connect on Solana Devnet to play with faucet SOL.
        </p>
      )}
      {!verified && (
        <p className="lemon-message" role="status">
          {game.isLoading
            ? "Loading Lemon’s on-chain rules…"
            : "Lemon purchases are paused until its deployed rules and oracle configuration are verified. Existing ticket actions remain available."}
        </p>
      )}

      <div className="lemon-columns">
        <section
          className="lemon-panel lemon-buy"
          id="lemon-buy"
          aria-labelledby="lemon-buy-title"
        >
          <div className="lemon-panel-heading">
            <div>
              <p className="eyebrow">YOUR NEXT TRIO</p>
              <h2 id="lemon-buy-title">Buy a ticket</h2>
            </div>
            <span className="lemon-chain-badge">
              {verified ? "On-chain" : "Rules pending"}
            </span>
          </div>
          <p className="lemon-subtitle">
            Choose a position, then pick a fruit. Repeats are welcome.
          </p>
          <div
            className="lemon-slots"
            role="group"
            aria-label="Your three fruit positions"
          >
            {[0, 1, 2].map((index) => {
              const fruit = FRUITS[numbers[index]];
              return (
                <button
                  key={index}
                  type="button"
                  className={`lemon-slot${selectedSlot === index ? " lemon-slot-active" : ""}`}
                  aria-pressed={selectedSlot === index}
                  aria-label={`Position ${index + 1}: ${fruit?.name ?? "not selected"}. Choose this position.`}
                  onClick={() => setSelectedSlot(index)}
                >
                  <small>POSITION {index + 1}</small>
                  <span aria-hidden="true">{fruit?.symbol ?? "+"}</span>
                  <strong>{fruit?.name ?? "Pick a fruit"}</strong>
                </button>
              );
            })}
          </div>
          <fieldset className="lemon-fruit-picker">
            <legend>Pick fruit for position {selectedSlot + 1}</legend>
            <div className="lemon-fruit-grid">
              {FRUITS.map((fruit, digit) => (
                <button
                  key={fruit.name}
                  type="button"
                  className={`lemon-fruit-option${numbers[selectedSlot] === digit ? " lemon-fruit-option-selected" : ""}`}
                  aria-label={`${fruit.name}, for position ${selectedSlot + 1}`}
                  aria-pressed={numbers[selectedSlot] === digit}
                  onClick={() => chooseFruit(digit)}
                >
                  <span aria-hidden="true">{fruit.symbol}</span>
                  <small>{fruit.name}</small>
                </button>
              ))}
            </div>
          </fieldset>
          <div
            className="lemon-mode-picker"
            role="group"
            aria-label="Draw type"
          >
            <button
              type="button"
              className={!game.quickDraw ? "lemon-mode-active" : ""}
              aria-pressed={!game.quickDraw}
              onClick={() => game.setQuickDraw?.(false)}
            >
              <strong>Daily draw</strong>
              <span>Shared scheduled result</span>
            </button>
            <button
              type="button"
              className={game.quickDraw ? "lemon-mode-active" : ""}
              aria-pressed={Boolean(game.quickDraw)}
              onClick={() => game.setQuickDraw?.(true)}
            >
              <strong>Quick draw</strong>
              <span>A sooner upcoming draw</span>
            </button>
          </div>
          {!game.quickDraw && (
            <label className="lemon-draw-label" htmlFor="lemon-draw-time">
              Choose one draw
              <select
                id="lemon-draw-time"
                value={game.selectedDrawTime ?? ""}
                onChange={(event) =>
                  game.setSelectedDrawTime?.(Number(event.target.value))
                }
                disabled={!game.drawOptions?.length}
              >
                {!game.drawOptions?.length && (
                  <option value="">Awaiting verified schedule</option>
                )}
                {(game.drawOptions ?? []).map((draw) => (
                  <option key={draw.timestamp} value={draw.timestamp}>
                    {draw.label ?? dateLabel(draw.timestamp)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {game.quickDraw && (
            <p className="lemon-subtitle">
              Sales close before fresh oracle randomness is requested. Quick
              entries with the same draw time share a result.
            </p>
          )}
          {game.walletAddress &&
            verified &&
            !quoteMatches &&
            typeof game.refreshPurchaseQuote === "function" && (
              <button
                type="button"
                className="button button-secondary lemon-buy-button"
                disabled={busy || game.purchaseQuoteLoading}
                onClick={() => game.refreshPurchaseQuote()}
              >
                {game.purchaseQuoteLoading
                  ? "Checking current costs…"
                  : "Refresh entry quote"}
              </button>
            )}
          {game.purchaseQuoteError && (
            <p className="lemon-subtitle" role="status">
              {displayMessage(game.purchaseQuoteError)}
            </p>
          )}
          {game.selectedDrawTime > now && (
            <p className="lemon-draw-countdown">
              {game.quickDraw ? "Your draw opens in" : "Selected draw in"}{" "}
              <strong>{formatCountdown(game.selectedDrawTime - now)}</strong>
            </p>
          )}
          <dl className="lemon-checkout">
            <div>
              <dt>Entry</dt>
              <dd>{verified ? sol(selectedEntry) : "Awaiting rules"}</dd>
            </div>
            <div>
              <dt>Exact-match prize</dt>
              <dd>{verified ? sol(selectedPrize) : "Awaiting rules"}</dd>
            </div>
            <div>
              <dt>Account rent · paid separately</dt>
              <dd>
                {quoteMatches
                  ? sol(quote.accountRentLamports)
                  : "Awaiting fresh quote"}
              </dd>
            </div>
            <div className="lemon-checkout-total">
              <dt>Purchase total before network fee</dt>
              <dd>
                {quoteMatches
                  ? sol(quote.totalLamports)
                  : "Awaiting fresh quote"}
              </dd>
            </div>
          </dl>
          <div className="lemon-purchase-note">
            <strong>Before you buy</strong>
            <p>
              One ticket enters one draw. Only an exact ordered match wins.
              Oracle fees and oracle account rent are paid separately by the
              wallet that reveals the draw, after reviewing the actual costs.
            </p>
            <p>
              A winning claim may wait for treasury funding. Unpaid winning
              prizes do not expire; refresh after a refill and explicitly claim
              again. Each purchase and claim needs your wallet approval.
            </p>
          </div>
          {game.walletAddress ? (
            <button
              type="button"
              className="button button-primary lemon-buy-button"
              disabled={!canBuy}
              onClick={() => game.buyTicket?.()}
            >
              {busy
                ? "Check your wallet…"
                : !verified
                  ? "Awaiting verified game"
                  : !quoteMatches
                    ? "Awaiting fresh quote"
                    : `Buy ticket · ${sol(quote.entryLamports)}`}
            </button>
          ) : (
            <button
              type="button"
              className="button button-primary lemon-buy-button"
              onClick={() => setVisible(true)}
            >
              Connect wallet to play
            </button>
          )}
        </section>

        <div className="lemon-side-column">
          <details
            ref={ticketDisclosure}
            className="lemon-panel lemon-disclosure"
            id="lemon-tickets"
          >
            <summary>
              <span>
                <span className="eyebrow">ON-CHAIN ENTRIES</span>
                <strong>Your tickets</strong>
              </span>
              <span className="lemon-disclosure-end">
                <span>{tickets.length}</span>
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path
                    d="m6 8 4 4 4-4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </summary>
            <div className="lemon-disclosure-content">
              <div className="lemon-ticket-toolbar">
                <div
                  className="lemon-tabs"
                  role="group"
                  aria-label="Filter your Lemon tickets"
                >
                  {["ongoing", "win", "done"].map((filter) => (
                    <button
                      key={filter}
                      type="button"
                      className={
                        ticketFilter === filter ? "lemon-tab-active" : ""
                      }
                      aria-pressed={ticketFilter === filter}
                      onClick={() => {
                        setTicketFilter(filter);
                        setTicketPage(1);
                      }}
                    >
                      {filter === "ongoing"
                        ? "Ongoing"
                        : filter === "win"
                          ? "Win"
                          : "Done"}
                      <span>{groups[filter].length}</span>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="button button-ghost"
                  disabled={busy || game.isLoading}
                  onClick={() => game.refresh?.()}
                >
                  Refresh
                </button>
              </div>
              {!game.walletAddress ? (
                <p className="lemon-empty">
                  Connect your wallet to load its actual Lemon tickets.
                </p>
              ) : game.isLoading && !tickets.length ? (
                <p className="lemon-empty" role="status">
                  Loading your on-chain entries…
                </p>
              ) : !visibleTickets.length ? (
                <p className="lemon-empty">
                  No {ticketFilter === "win" ? "unpaid winning" : ticketFilter}{" "}
                  Lemon tickets loaded.
                </p>
              ) : (
                <ul className="lemon-ticket-list">
                  {visibleTickets.map((ticket) => {
                    const state = ticketState(ticket, now);
                    const awaitingFunding =
                      state.won &&
                      !ticket.settled &&
                      ticket.claimFundingVerified === true &&
                      ticket.claimFunded === false;
                    const drawStatus = ticket.draw?.status;
                    const ticketId = ticket.id ?? ticket.address;
                    const ownsDrawAction =
                      drawActionTickets.get(drawKey(ticket)) === ticketId;
                    const reviewingDraw = Boolean(
                      state.group === "ongoing" &&
                        state.due &&
                        !state.published &&
                        drawStatus === "open" &&
                        ownsDrawAction &&
                        revealQuote?.requiresPayment === true &&
                        revealQuote?.drawTime === ticket.drawTime &&
                        revealQuote?.sourceProgram === ticket.sourceProgram,
                    );
                    return (
                      <li
                        className="lemon-ticket"
                        key={ticket.id ?? ticket.address}
                      >
                        <div className="lemon-ticket-heading">
                          <div>
                            <strong>{drawKind(ticket)}</strong>
                            <span>{dateLabel(ticket.drawTime)}</span>
                          </div>
                          <span
                            className={`lemon-ticket-state lemon-ticket-state-${state.won ? "win" : state.published ? "loss" : state.group}`}
                          >
                            {state.won ? "✓ " : state.published ? "× " : ""}
                            {state.label}
                          </span>
                        </div>
                        <FruitTriple numbers={ticket.numbers} small />
                        <p className="lemon-ticket-prize">
                          Prize {sol(ticket.payoutLamports)}
                        </p>
                        {state.published && (
                          <p className="lemon-recorded-result">
                            Recorded result{" "}
                            <FruitTriple
                              numbers={ticket.result.numbers}
                              small
                            />
                          </p>
                        )}
                        {awaitingFunding && (
                          <p className="lemon-funding-wait" role="status">
                            Waiting for treasury funding. This prize remains
                            unpaid and does not expire.
                          </p>
                        )}
                        <div className="lemon-ticket-actions">
                          {state.group === "win" && (
                            <button
                              type="button"
                              className="button button-primary"
                              disabled={
                                !canTransact ||
                                awaitingFunding ||
                                typeof game.claimTicket !== "function"
                              }
                              onClick={() => game.claimTicket?.(ticket)}
                            >
                              {awaitingFunding
                                ? "Waiting for treasury"
                                : "Claim prize"}
                            </button>
                          )}
                          {state.group === "ongoing" &&
                            state.due &&
                            !state.published &&
                            ownsDrawAction &&
                            !reviewingDraw &&
                            drawStatus !== "pending" &&
                            drawStatus !== "final" && (
                              <button
                                type="button"
                                className="button button-secondary"
                                disabled={
                                  !canTransact ||
                                  (typeof game.reviewReveal !== "function" &&
                                    typeof game.revealDraw !== "function")
                                }
                                onClick={() =>
                                  drawStatus === "fulfilled"
                                    ? game.revealDraw?.(ticket)
                                    : game.reviewReveal
                                      ? game.reviewReveal(ticket)
                                      : game.revealDraw?.(ticket)
                                }
                              >
                                {drawStatus === "fulfilled"
                                  ? "Complete draw"
                                  : "Review reveal costs"}
                              </button>
                            )}
                          {state.group === "ongoing" &&
                            drawStatus === "pending" && (
                              <span className="lemon-pending-oracle">
                                Waiting for oracle · Refresh to check
                              </span>
                            )}
                          {state.group === "ongoing" &&
                            state.due &&
                            !ownsDrawAction &&
                            drawStatus !== "pending" && (
                              <span className="lemon-pending-oracle">
                                Shared draw · One reveal covers these tickets
                              </span>
                            )}
                          {ticket.refundEligible === true &&
                            !ticket.settled &&
                            !ticket.refunded && (
                              <button
                                type="button"
                                className="button button-secondary"
                                disabled={
                                  !canTransact ||
                                  typeof game.refundTicket !== "function"
                                }
                                onClick={() => game.refundTicket?.(ticket)}
                              >
                                Refund paid entry
                              </button>
                            )}
                        </div>
                        {reviewingDraw && (
                          <RevealCostReview
                            quote={revealQuote}
                            ready={revealQuoteReady}
                            canTransact={canTransact}
                            busy={busy}
                            game={game}
                          />
                        )}
                        <div className="lemon-ticket-history">
                          <ExternalLink
                            address={ticket.address ?? ticket.id}
                            network={game.network}
                          >
                            Ticket history
                          </ExternalLink>
                          <ExternalLink
                            address={ticket.draw?.address ?? ticket.result?.id}
                            network={game.network}
                          >
                            Draw history
                          </ExternalLink>
                          <ExternalLink
                            address={
                              ticket.draw?.oracleRequest ??
                              ticket.result?.oracleRequest
                            }
                            network={game.network}
                          >
                            Oracle proof
                          </ExternalLink>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              {groups[ticketFilter].length > 6 && (
                <div className="lemon-pagination">
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={ticketPage <= 1}
                    onClick={() => setTicketPage(ticketPage - 1)}
                  >
                    Previous
                  </button>
                  <span>
                    Page {ticketPage} of{" "}
                    {Math.ceil(groups[ticketFilter].length / 6)}
                  </span>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={ticketPage * 6 >= groups[ticketFilter].length}
                    onClick={() => setTicketPage(ticketPage + 1)}
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          </details>

          <details
            ref={guideDisclosure}
            className="lemon-panel lemon-disclosure"
            id="lemon-guide"
          >
            <summary>
              <span>
                <span className="eyebrow">A QUICK READ BEFORE YOU PLAY</span>
                <strong>Game guide</strong>
              </span>
              <span className="lemon-disclosure-end">
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path
                    d="m6 8 4 4 4-4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </summary>
            <div className="lemon-disclosure-content lemon-guide-content">
              <div>
                <h3>Choose your three fruits</h3>
                <p>
                  Choose one fruit for each position. The same fruit can appear
                  more than once. All three positions must match the verified
                  result in the exact order. There are{" "}
                  {verified
                    ? "1,000 equally likely ordered outcomes, so the chance of an exact match is 1 in 1,000"
                    : "no verified odds available until the on-chain rules load"}
                  .
                </p>
                <p>
                  Lemon is the signature fruit. Three lemons use the same
                  exact-match rule and prize as any other trio.
                </p>
                <h3 className="lemon-mapping-title">
                  Fruit values on the blockchain
                </h3>
                <p>
                  The program records each fruit as a digit. This mapping stays
                  the same for every ticket and result.
                </p>
                <dl className="lemon-fruit-map">
                  {FRUITS.map((fruit, digit) => (
                    <div key={fruit.name}>
                      <dt>
                        <span aria-hidden="true">{fruit.symbol}</span>
                        {fruit.name}
                      </dt>
                      <dd>{digit}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div>
                <h3>Pick one draw per ticket</h3>
                <p>
                  Daily draw times:{" "}
                  {schedule
                    ? `${schedule} UTC+8`
                    : "awaiting the verified on-chain schedule"}
                  . Each ticket belongs to the selected draw only. You can enter
                  multiple tickets. Quick entries with the same upcoming draw
                  time share one recorded result.
                </p>
              </div>
              <div>
                <h3>Reveal, verify, claim</h3>
                <p>
                  After sales close, a player reviews and funds one fresh ORAO
                  request for the draw. Pending requests are checked, never
                  rerolled. After fulfillment, complete the draw and view its
                  immutable result and proof through blockchain history. A
                  winning claim transfers only to the ticket’s recorded owner
                  and can be paid once.
                </p>
                <ExternalLink
                  address={config?.programId}
                  network={game.network}
                >
                  Lemon program
                </ExternalLink>
              </div>
              <div>
                <h3>Costs and funding</h3>
                <p>
                  Entry prices, fixed prizes and account rents come from
                  verified chain data. Buying pays entry and account rent plus
                  network fees; revealing pays the reviewed oracle costs
                  separately. A prize may wait for a treasury refill and does
                  not expire while unpaid. A verified timeout refund returns the
                  paid entry only; network and account costs are separate.
                </p>
                <ExternalLink
                  address={config?.vaultAddress}
                  network={game.network}
                >
                  Actual Lemon prize vault
                </ExternalLink>
              </div>
            </div>
          </details>
        </div>
      </div>

      <details
        ref={resultDisclosure}
        className="lemon-panel lemon-disclosure"
        id="lemon-results"
      >
        <summary>
          <span>
            <span className="eyebrow">RECORDED ON SOLANA</span>
            <strong>Draw results</strong>
          </span>
          <span className="lemon-disclosure-end">
            <span>{results.length}</span>
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path
                d="m6 8 4 4 4-4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </summary>
        <div className="lemon-disclosure-content">
          <p className="lemon-subtitle">
            Only finalized on-chain Lemon results appear here. Every fruit has
            the same chance; Lemon is the game’s signature fruit, with no hidden
            bonus.
          </p>
          <div className="lemon-result-filters">
            <label htmlFor="lemon-result-type">
              Draw type
              <select
                id="lemon-result-type"
                value={resultFilter}
                onChange={(event) => {
                  setResultFilter(event.target.value);
                  setResultPage(1);
                }}
              >
                <option value="all">All draws</option>
                <option value="Daily draw">Daily draw</option>
                <option value="Quick draw">Quick draw</option>
              </select>
            </label>
            <label htmlFor="lemon-result-date">
              Draw date · UTC+8
              <input
                type="date"
                id="lemon-result-date"
                value={resultDate}
                onChange={(event) => {
                  setResultDate(event.target.value);
                  setResultPage(1);
                }}
              />
            </label>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => {
                setResultFilter("all");
                setResultDate("");
                setResultPage(1);
              }}
            >
              Clear filters
            </button>
          </div>
          {!visibleResults.length ? (
            <p className="lemon-empty">
              {game.isLoading
                ? "Loading recorded results…"
                : error && !results.length
                  ? "Results could not be loaded. Refresh to try again."
                  : "No finalized on-chain results match this selection."}
            </p>
          ) : (
            <div className="lemon-results-table-wrap">
              <table className="lemon-results-table">
                <caption className="sr-only">
                  Finalized Lemon draws read from Solana
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Draw</th>
                    <th scope="col">Winning fruits</th>
                    <th scope="col">Date · UTC+8</th>
                    <th scope="col">Blockchain history</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleResults.map((result) => (
                    <tr key={result.id ?? result.address}>
                      <td>{drawKind(result)}</td>
                      <td>
                        <FruitTriple numbers={result.numbers} small />
                      </td>
                      <td>{dateLabel(result.drawTime)}</td>
                      <td>
                        <div className="lemon-result-links">
                          <ExternalLink
                            address={result.address ?? result.id}
                            network={game.network}
                          >
                            Draw history
                          </ExternalLink>
                          <ExternalLink
                            address={result.oracleRequest}
                            network={game.network}
                          >
                            Oracle proof
                          </ExternalLink>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {filteredResults.length > 8 && (
            <div className="lemon-pagination">
              <button
                type="button"
                className="button button-secondary"
                disabled={resultPage <= 1}
                onClick={() => setResultPage(resultPage - 1)}
              >
                Previous
              </button>
              <span>
                Page {resultPage} of {Math.ceil(filteredResults.length / 8)}
              </span>
              <button
                type="button"
                className="button button-secondary"
                disabled={resultPage * 8 >= filteredResults.length}
                onClick={() => setResultPage(resultPage + 1)}
              >
                Next
              </button>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

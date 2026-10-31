import { useId, useMemo, useState } from "react";
import useLinkedDisclosure from "./useLinkedDisclosure.js";
import { explorerAccountUrl } from "../lib/explorer.js";
import { PROGRAM_ID } from "../lib/onchain/idl.js";
import {
  DrawHistory,
  drawSessionLabel,
  formatCombination,
  formatResultDate,
  formatResultTime,
  getDrawSession,
} from "./drawResults.js";
import "../styles/draw-results.css";

const defaultFilters = { from: "", to: "", session: "all" };

export default function DrawResults({
  results = null,
  network,
  isLoading = false,
  loadFailed = false,
  refreshWarning = false,
  loaded = results !== null && !isLoading && !loadFailed,
  programIds = null,
}) {
  const disclosure = useLinkedDisclosure("#draw-results");
  const id = useId();
  const [draft, setDraft] = useState(defaultFilters);
  const [filters, setFilters] = useState(defaultFilters);
  const [page, setPage] = useState(1);
  const [filterError, setFilterError] = useState(null);
  const history = useMemo(() => new DrawHistory(results), [results]);
  const view = history.query({ ...filters, page });
  const hasRecords = view.loaded > 0;
  const sourcePrograms = [
    ...new Set(
      Array.isArray(programIds) && programIds.length
        ? programIds
        : [
            PROGRAM_ID,
            ...history.records
              .map((record) => record.sourceProgram)
              .filter(Boolean),
          ],
    ),
  ]
    .map((address) => ({ address, href: explorerAccountUrl(address, network) }))
    .filter((entry) => entry.href);
  const recordedSessions = [...new Set(history.records.map(getDrawSession))]
    .filter((session) => session !== null)
    .sort((first, second) => {
      const order = (value) =>
        value === "daily"
          ? 24
          : value === "quick"
            ? 25
            : value === "unknown"
              ? 26
              : Number(value);
      return order(first) - order(second);
    });

  function changeFilter(field, value) {
    setDraft((previous) => ({ ...previous, [field]: value }));
    setFilterError(null);
  }

  function search(event) {
    event.preventDefault();
    try {
      history.query(draft);
      setFilters({ ...draft });
      setPage(1);
      setFilterError(null);
    } catch (error) {
      setFilterError({ message: error.message, field: error.field });
    }
  }

  function clear() {
    setDraft(defaultFilters);
    setFilters(defaultFilters);
    setPage(1);
    setFilterError(null);
  }

  function invalid(field) {
    return Boolean(
      filterError &&
        (filterError.field === field ||
          (filterError.field === "range" && ["from", "to"].includes(field))),
    );
  }

  return (
    <details
      ref={disclosure}
      id="draw-results"
      className="panel draw-results data-disclosure"
      aria-labelledby={`${id}-title`}
      aria-busy={isLoading}
    >
      <summary className="data-disclosure-summary">
        <span>
          <span className="tickets-title">
            <h2 id={`${id}-title`}>Draw results</h2>
            {(loaded || hasRecords) && (
              <span className="count-badge">{view.loaded}</span>
            )}
          </span>
          <span className="disclosure-description">
            Published records from Solana · UTC+8
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
      <div className="draw-results-content">
        <div className="draw-results-heading">
          <div>
            <p className="eyebrow">On-chain records</p>
            <p className="draw-results-description">
              Published results from Solana. Search by date and draw time in
              UTC+8.
            </p>
            <p className="draw-results-source">
              {sourcePrograms.length ? (
                <>
                  Read from{" "}
                  {sourcePrograms.map(({ address, href }, index) => (
                    <span key={address}>
                      {index > 0 && " · "}
                      <a href={href} target="_blank" rel="noopener noreferrer">
                        {sourcePrograms.length === 1
                          ? "Dodos program"
                          : `Program ${address.slice(0, 6)}…${address.slice(-6)}`}{" "}
                        on {network.label ?? network.cluster} ↗
                      </a>
                    </span>
                  ))}
                  .
                </>
              ) : (
                "Waiting for a verified blockchain connection."
              )}
            </p>
          </div>
        </div>
        <form
          className="draw-results-filters"
          onSubmit={search}
          noValidate
          aria-label="Search draw results"
        >
          <div>
            <label className="field-label" htmlFor={`${id}-from`}>
              From date
            </label>
            <input
              id={`${id}-from`}
              type="date"
              max={draft.to || undefined}
              value={draft.from}
              onChange={(event) => changeFilter("from", event.target.value)}
              aria-invalid={invalid("from")}
              aria-describedby={`${id}-date-help${filterError ? ` ${id}-error` : ""}`}
            />
          </div>
          <div>
            <label className="field-label" htmlFor={`${id}-to`}>
              To date
            </label>
            <input
              id={`${id}-to`}
              type="date"
              min={draft.from || undefined}
              value={draft.to}
              onChange={(event) => changeFilter("to", event.target.value)}
              aria-invalid={invalid("to")}
              aria-describedby={`${id}-date-help${filterError ? ` ${id}-error` : ""}`}
            />
          </div>
          <div>
            <label className="field-label" htmlFor={`${id}-session`}>
              Draw session
            </label>
            <select
              id={`${id}-session`}
              value={draft.session}
              onChange={(event) => changeFilter("session", event.target.value)}
              aria-invalid={invalid("session")}
              aria-describedby={filterError ? `${id}-error` : undefined}
            >
              <option value="all">All draws</option>
              {recordedSessions.map((session) => (
                <option key={session} value={session}>
                  {drawSessionLabel(
                    history.records.find(
                      (record) => getDrawSession(record) === session,
                    ),
                  )}
                </option>
              ))}
            </select>
          </div>
          <div className="draw-results-filter-actions">
            <button className="button button-primary" type="submit">
              Search
            </button>
            <button
              className="button button-secondary"
              type="button"
              onClick={clear}
            >
              Clear
            </button>
          </div>
          <p className="draw-results-date-help" id={`${id}-date-help`}>
            Choose either date or both. Each date includes the full day in
            UTC+8.
          </p>
        </form>
        {filterError && (
          <p className="draw-results-error" id={`${id}-error`} role="alert">
            {filterError.message}
          </p>
        )}
        {hasRecords && (isLoading || refreshWarning || loadFailed) && (
          <p
            className={`draw-results-status${refreshWarning || loadFailed ? " draw-results-status-warning" : ""}`}
            role="status"
          >
            {isLoading
              ? "Refreshing history. Your last loaded results remain visible."
              : "Showing last loaded results. Use Refresh to check the blockchain again."}
          </p>
        )}
        <p className="draw-results-scroll-hint">
          Swipe the table to view blockchain links.
        </p>
        <div
          className="draw-results-table-wrap"
          role="region"
          aria-label="Recorded draw results table"
          tabIndex={0}
        >
          <table className="draw-results-table">
            <caption>
              Published draw records, newest first. Combinations keep their
              recorded order.
            </caption>
            <thead>
              <tr>
                <th scope="col">Recorded draw type</th>
                <th scope="col">Combination</th>
                <th scope="col">Draw date · UTC+8</th>
                <th scope="col">Blockchain history</th>
              </tr>
            </thead>
            <tbody>
              {view.records.map((result) => {
                const href = explorerAccountUrl(result.id, network);
                const oracleHref = explorerAccountUrl(
                  result.oracleRequest,
                  network,
                );
                const oracleProgramHref = explorerAccountUrl(
                  result.oracleProgram,
                  network,
                );
                return (
                  <tr key={result.id ?? result.drawTime}>
                    <th scope="row">
                      <span className="draw-results-type">
                        {drawSessionLabel(result)}
                      </span>
                      {result.legacy === true && (
                        <span className="draw-results-clock">
                          Legacy result
                        </span>
                      )}
                      {result.randomnessMode === "orao-vrf" && oracleHref && (
                        <span className="draw-results-clock">ORAO VRF</span>
                      )}
                    </th>
                    <td>
                      <span className="draw-result-combination">
                        {formatCombination(result.numbers)}
                      </span>
                      {Number.isSafeInteger(result.payoutLamports) &&
                        result.payoutLamports > 0 && (
                          <span className="draw-results-clock">
                            Prize {result.payoutLamports / 1e9} test SOL
                          </span>
                        )}
                      {Number.isSafeInteger(result.ticketCostLamports) &&
                        result.ticketCostLamports > 0 && (
                          <span className="draw-results-clock">
                            Base entry {result.ticketCostLamports / 1e9} test
                            SOL
                          </span>
                        )}
                    </td>
                    <td>
                      <time
                        dateTime={new Date(
                          result.drawTime * 1000,
                        ).toISOString()}
                      >
                        <span>{formatResultDate(result.drawTime)}</span>
                        <span className="draw-results-clock">
                          {formatResultTime(result.drawTime)}
                        </span>
                      </time>
                    </td>
                    <td>
                      {href ? (
                        <a
                          className="history-link draw-results-history"
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Draw history for ${formatResultDate(result.drawTime)} ${formatResultTime(result.drawTime)} on ${network.label ?? network.cluster}`}
                        >
                          Draw history <span aria-hidden="true">↗</span>
                        </a>
                      ) : (
                        <span className="text-muted">Network unavailable</span>
                      )}
                      <span className="draw-results-account" title={result.id}>
                        {result.id
                          ? `${result.id.slice(0, 6)}…${result.id.slice(-6)}`
                          : ""}
                      </span>
                      {oracleHref && (
                        <a
                          className="history-link draw-results-proof"
                          href={oracleHref}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Oracle request <span aria-hidden="true">↗</span>
                        </a>
                      )}
                      {oracleProgramHref && (
                        <a
                          className="history-link draw-results-proof"
                          href={oracleProgramHref}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Oracle program <span aria-hidden="true">↗</span>
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
              {view.records.length === 0 && (
                <tr>
                  <td colSpan={4}>
                    <div
                      className="empty-state"
                      role={
                        isLoading
                          ? "status"
                          : loadFailed && !hasRecords
                            ? "alert"
                            : undefined
                      }
                    >
                      <strong>
                        {isLoading && !hasRecords
                          ? "Loading draw history…"
                          : loadFailed && !hasRecords
                            ? "Results unavailable"
                            : hasRecords
                              ? "No draws match these filters"
                              : loaded
                                ? "No recorded draws yet"
                                : "History not loaded"}
                      </strong>
                      {isLoading && !hasRecords
                        ? "Reading published results from the blockchain."
                        : loadFailed && !hasRecords
                          ? "Use Refresh when the network is available."
                          : hasRecords
                            ? "Choose another date or session, or clear the filters."
                            : loaded
                              ? "A result appears after its on-chain record is created."
                              : "Refresh to read published records from the blockchain."}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="draw-results-footer">
          <p role="status" aria-live="polite">
            {view.total
              ? `${view.first}–${view.last} of ${view.total} draws`
              : loaded || hasRecords
                ? "0 draws"
                : "History not loaded"}
          </p>
          {(loaded || hasRecords) && (
            <nav className="draw-results-pagination" aria-label="Result pages">
              <button
                className="button button-secondary"
                type="button"
                onClick={() => setPage(view.page - 1)}
                disabled={view.page <= 1}
                aria-label="Previous results page"
              >
                Previous
              </button>
              <span>
                Page {view.page} of {view.pages}
              </span>
              <button
                className="button button-secondary"
                type="button"
                onClick={() => setPage(view.page + 1)}
                disabled={view.page >= view.pages}
                aria-label="Next results page"
              >
                Next
              </button>
            </nav>
          )}
        </div>
        <p className="draw-results-note">
          Only published blockchain records appear here. Older combinations stay
          as recorded when UAT settings change. Draw types and prizes appear
          only when stored with that result. Base entry is the recorded draw
          price; your ticket shows its actual entry payment. Use Refresh to load
          new results; Search only filters this history. Legacy results retain
          their original test program. Random draws link their recorded oracle
          request so you can inspect its fulfillment on-chain.
        </p>
      </div>
    </details>
  );
}

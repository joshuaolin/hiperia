import { useId, useMemo, useState } from "react";
import { explorerAccountUrl } from "../lib/explorer.js";
import {
  DrawHistory,
  drawSessionLabel,
  formatCombination,
  formatResultDate,
  formatResultTime,
} from "./drawResults.js";
import "../styles/draw-results.css";

const defaultFilters = { from: "", to: "", session: "all" };

export default function DrawResults({
  results = [],
  network,
  quickPayout = null,
  dailyPayout = null,
  isLoading = false,
  loadFailed = false,
  refreshWarning = false,
}) {
  const id = useId();
  const [draft, setDraft] = useState(defaultFilters);
  const [filters, setFilters] = useState(defaultFilters);
  const [page, setPage] = useState(1);
  const [filterError, setFilterError] = useState(null);
  const history = useMemo(() => new DrawHistory(results), [results]);
  const view = history.query({ ...filters, page });
  const hasRecords = view.loaded > 0;

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
    <section
      id="draw-results"
      className="panel draw-results"
      aria-labelledby={`${id}-title`}
      aria-busy={isLoading}
    >
      <div className="draw-results-heading">
        <div>
          <p className="eyebrow">On-chain records</p>
          <h2 id={`${id}-title`}>Draw results</h2>
          <p className="draw-results-description">
            Find a recorded draw by date and session. All times are UTC+8.
          </p>
        </div>
        <div className="draw-results-prize">
          <span>Current prizes</span>
          <strong>
            {Number.isFinite(dailyPayout)
              ? `Daily ${dailyPayout} test SOL`
              : "Awaiting contract"}
          </strong>
          {Number.isFinite(quickPayout) && (
            <span>Quick {quickPayout} test SOL</span>
          )}
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
            value={draft.from}
            onChange={(event) => changeFilter("from", event.target.value)}
            aria-invalid={invalid("from")}
            aria-describedby={filterError ? `${id}-error` : undefined}
          />
        </div>
        <div>
          <label className="field-label" htmlFor={`${id}-to`}>
            To date
          </label>
          <input
            id={`${id}-to`}
            type="date"
            value={draft.to}
            onChange={(event) => changeFilter("to", event.target.value)}
            aria-invalid={invalid("to")}
            aria-describedby={filterError ? `${id}-error` : undefined}
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
            <option value="14">2 PM</option>
            <option value="16">4 PM</option>
            <option value="test">UAT test</option>
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
              <th scope="col">Game</th>
              <th scope="col">Combination</th>
              <th scope="col">Draw date · UTC+8</th>
              <th scope="col">Blockchain history</th>
            </tr>
          </thead>
          <tbody>
            {view.records.map((result) => {
              const href = explorerAccountUrl(result.id, network);
              return (
                <tr key={result.id ?? result.drawTime}>
                  <th scope="row">
                    <span className="draw-results-game">Dodos</span>
                    <span className="draw-results-session">
                      {drawSessionLabel(result.drawTime)}
                    </span>
                  </th>
                  <td>
                    <span className="draw-result-combination">
                      {formatCombination(result.numbers)}
                    </span>
                  </td>
                  <td>
                    <time
                      dateTime={new Date(result.drawTime * 1000).toISOString()}
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
                            : "No recorded draws yet"}
                    </strong>
                    {isLoading && !hasRecords
                      ? "Reading published results from the blockchain."
                      : loadFailed && !hasRecords
                        ? "Use Refresh when the network is available."
                        : hasRecords
                          ? "Choose another date or session, or clear the filters."
                          : "A result appears after its on-chain record is created."}
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
            : "0 draws"}
        </p>
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
      </div>
      <p className="draw-results-note">
        Search this history. Use Refresh to check for new on-chain records. The
        prize shown above is the current setting, not a historical jackpot.
      </p>
    </section>
  );
}

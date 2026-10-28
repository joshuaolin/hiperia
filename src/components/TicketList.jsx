import { useEffect, useState } from "react";

const PAGE_SIZE = 20;

export default function TicketList({
  tickets,
  renderTicket,
  newestFirst = false,
}) {
  const [page, setPage] = useState(0);
  const lastPage = Math.max(0, Math.ceil(tickets.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);

  useEffect(() => {
    setPage(newestFirst ? 0 : lastPage);
  }, [lastPage, newestFirst]);

  return (
    <div>
      <div className="tickets-grid">
        {tickets
          .slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
          .map((ticket) => (
            <div key={ticket.id}>{renderTicket(ticket)}</div>
          ))}
      </div>
      {lastPage > 0 && (
        <nav className="ticket-pagination" aria-label="Ticket pages">
          <button
            className="button button-secondary"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            Previous
          </button>
          <span aria-live="polite">
            {currentPage + 1} / {lastPage + 1}
          </span>
          <button
            className="button button-secondary"
            disabled={currentPage === lastPage}
            onClick={() => setPage(currentPage + 1)}
          >
            Next
          </button>
        </nav>
      )}
    </div>
  );
}

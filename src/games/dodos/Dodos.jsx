import React, { useState, useEffect, useCallback, Suspense } from "react";
import { debounce } from "lodash";
import { FixedSizeList } from "react-window";
import { useWallet } from "@solana/wallet-adapter-react";
import "./dodos.css";

const TicketCard = React.memo(({ ticket, onCheckResults }) => (
  <div className="ticket-card">
    <p className="ticket-numbers">{ticket.numbers.join(" - ")}</p>
    <p className="ticket-time">Purchased: {ticket.purchaseTime}</p>
    <button
      className="matrix-button check-results-btn"
      onClick={() => onCheckResults(ticket)}
      aria-label={`Check results for ticket ${ticket.id}`}
    >
      <span className="button-text">CHECK RESULTS</span>
    </button>
  </div>
));

const TicketList = ({ tickets, onCheckResults }) => (
  <FixedSizeList
    height={200}
    width="100%"
    itemCount={tickets.length}
    itemSize={100}
    className="tickets-grid"
  >
    {({ index, style }) => (
      <div style={style}>
        <TicketCard ticket={tickets[index]} onCheckResults={onCheckResults} />
      </div>
    )}
  </FixedSizeList>
);

export default function Dodos({ onBack }) {
  const { publicKey, connected } = useWallet();
  const [selectedNumbers, setSelectedNumbers] = useState([]);
  const [ticketCost] = useState(0.005);
  const [tickets, setTickets] = useState([]);
  const [lastResults, setLastResults] = useState([]);
  const [nextDraw, setNextDraw] = useState("");
  const [transactionPending, setTransactionPending] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");

  const calculateNextDraw = useCallback(() => {
    const now = new Date();
    const asiaTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
    const drawTimes = [14, 15, 16];
    let nextDrawTime = null;

    for (const hour of drawTimes) {
      const drawTime = new Date(asiaTime);
      drawTime.setHours(hour, 0, 0, 0);
      if (drawTime > asiaTime) {
        nextDrawTime = drawTime;
        break;
      }
    }

    if (!nextDrawTime) {
      nextDrawTime = new Date(asiaTime);
      nextDrawTime.setDate(asiaTime.getDate() + 1);
      nextDrawTime.setHours(drawTimes[0], 0, 0, 0);
    }

    return nextDrawTime.toLocaleString("en-US", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      minute: "2-digit",
      month: "short",
      day: "numeric",
    });
  }, []);

  useEffect(() => {
    setLastResults([
      { time: "2:00 PM", numbers: [12, 25], winners: 3 },
      { time: "3:00 PM", numbers: [7, 19], winners: 1 },
      { time: "4:00 PM", numbers: [31, 5], winners: 0 },
    ]);
    const updateNextDraw = () => setNextDraw(calculateNextDraw());
    updateNextDraw();
    const interval = setInterval(updateNextDraw, 60 * 1000);
    return () => clearInterval(interval);
  }, [calculateNextDraw]);

  const handleNumberSelect = useCallback(
    debounce((number) => {
      setSelectedNumbers((prev) => {
        if (prev.includes(number)) {
          return prev.filter((n) => n !== number);
        }
        if (prev.length < 2) {
          return [...prev, number];
        }
        return prev;
      });
    }, 100),
    []
  );

  const purchaseTicket = async () => {
    if (!connected || selectedNumbers.length !== 2) {
      return;
    }
    try {
      setTransactionPending(true);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const newTicket = {
        id: Date.now(),
        numbers: [...selectedNumbers].sort((a, b) => a - b),
        purchaseTime: new Date().toLocaleTimeString(),
        draws: [
          { time: "2:00 PM", matched: false, prize: 0 },
          { time: "3:00 PM", matched: false, prize: 0 },
          { time: "4:00 PM", matched: false, prize: 0 },
        ],
      };
      setTickets((prev) => [...prev, newTicket]);
      setSelectedNumbers([]);
      setSuccessMessage(`Successfully purchased ticket for ${selectedNumbers.join(" and ")}!`);
      setTimeout(() => setSuccessMessage(""), 5000);
    } catch (error) {
      console.error("Transaction failed:", error);
      alert("Transaction failed. Please try again.");
    } finally {
      setTransactionPending(false);
    }
  };

  const checkResults = useCallback((ticket) => {
    const updatedTicket = { ...ticket };
    let totalWon = 0;

    updatedTicket.draws.forEach((draw) => {
      const rand = Math.random();
      if (rand < 0.05) {
        draw.matched = "both";
        draw.prize = 1.2;
        totalWon += 1.2;
      } else if (rand < 0.25) {
        draw.matched = "one";
        draw.prize = 0.01;
        totalWon += 0.01;
      }
    });

    alert(
      totalWon > 0
        ? `Congratulations! You won ${totalWon} SOL from this ticket!`
        : "No wins for this ticket yet. Better luck next time!"
    );
  }, []);

  return (
    <Suspense fallback={<div className="loading-spinner">Loading...</div>}>
      <div className="dodos-container">
        <div className="wallet-btn back-button-container">
          <button
            className="start-game-button wallet-adapter-button matrix-button back-btn"
            onClick={onBack}
            type="button"
            aria-label="Back to Game Carousel"
          >
            <span className="button-text">BACK TO GAMES</span>
          </button>
        </div>

        <div className="game-area">
          <h2 className="game-title">DODOS</h2>
          <div className="game-sections">
            <div className="game-section number-selection-section">
              <h3>SELECT YOUR NUMBERS</h3>
              <div className="number-grid">
                {Array.from({ length: 31 }, (_, i) => i + 1).map((number) => (
                  <button
                    key={number}
                    className={`number-btn ${selectedNumbers.includes(number) ? "selected" : ""}`}
                    onClick={() => handleNumberSelect(number)}
                    disabled={selectedNumbers.length === 2 && !selectedNumbers.includes(number)}
                    aria-label={`Select number ${number}`}
                  >
                    {number}
                  </button>
                ))}
              </div>

              <div className="selection-display">
                {selectedNumbers.length > 0 ? (
                  <p className="selected-numbers-text">Selected: {selectedNumbers.join(", ")}</p>
                ) : (
                  <p className="select-numbers-prompt">Select 2 numbers (1-31)</p>
                )}

                <button
                  className="matrix-button purchase-btn"
                  onClick={purchaseTicket}
                  disabled={selectedNumbers.length !== 2 || transactionPending || !connected}
                  aria-label={`Purchase ticket for ${ticketCost} SOL`}
                >
                  <span className="button-text">
                    {transactionPending ? "PROCESSING..." : `PURCHASE (${ticketCost} SOL)`}
                  </span>
                </button>

                {transactionPending && (
                  <div className="loading-spinner">Processing Transaction...</div>
                )}
                {successMessage && <p className="success-message">{successMessage}</p>}
                {!connected && (
                  <div className="wallet-notice">
                    <p>Please connect your wallet to play.</p>
                    <button
                      className="matrix-button"
                      onClick={() => alert("Connect wallet via Solana adapter")}
                      aria-label="Connect wallet"
                    >
                      Connect Wallet
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="game-section results-section">
              <h3>RECENT RESULTS</h3>
              <div className="results-grid">
                {lastResults.map((result, index) => (
                  <div key={index} className="result-card">
                    <p className="result-time">{result.time}</p>
                    <p className="result-numbers">{result.numbers.join(" - ")}</p>
                    <p className="result-winners">
                      {result.winners} winner{result.winners !== 1 ? "s" : ""}
                    </p>
                  </div>
                ))}
              </div>

              <h3>NEXT DRAW</h3>
              <p className="next-draw">{nextDraw} (UTC+8)</p>
            </div>
          </div>

          {tickets.length > 0 && (
            <div className="game-section tickets-section">
              <h3>YOUR TICKETS</h3>
              <TicketList tickets={tickets} onCheckResults={checkResults} />
            </div>
          )}
        </div>

      </div>
    </Suspense>
  );
}
import React, { useState, useEffect, useCallback } from "react";
import { FixedSizeList } from "react-window";
import { useWallet } from "@solana/wallet-adapter-react";
import "./fruit-game.css";

const fruits = ["🍑", "🥭", "🍎", "🍌", "🍒", "🍍", "🍇", "🍓", "🍋"];

const Ticket = React.memo(({ ticket, onCheckResults }) => (
  <div className="ticket-card">
    <p className="ticket-numbers">{ticket.fruits.join(" - ")}</p>
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
    itemSize={110}
    className="tickets-grid"
  >
    {({ index, style }) => (
      <div style={style}>
        <Ticket ticket={tickets[index]} onCheckResults={onCheckResults} />
      </div>
    )}
  </FixedSizeList>
);

export default function FruitGame({ onBack }) {
  const { connected, connect } = useWallet();
  const [selectedFruits, setSelectedFruits] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [nextDraw, setNextDraw] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [transactionPending, setTransactionPending] = useState(false);
  const [lastResults, setLastResults] = useState([]);
  const ticketCost = 0.005;

  useEffect(() => {
    const savedTickets = localStorage.getItem("fruitGameTickets");
    if (savedTickets) {
      setTickets(JSON.parse(savedTickets));
    }
    setLastResults([
      { time: "3:00 PM", fruits: ["🍑", "🥭", "🍎"], winners: 1 },
    ]);
  }, []);

  const calculateNextDrawTime = useCallback(() => {
    const now = new Date();
    const asiaTime = new Date(
      now.toLocaleString("en-US", { timeZone: "Asia/Shanghai" })
    );
    const drawHour = 15;
    let drawTime = new Date(asiaTime);
    drawTime.setHours(drawHour, 0, 0, 0);

    if (drawTime <= asiaTime) {
      drawTime.setDate(drawTime.getDate() + 1);
    }

    return drawTime.toLocaleString("en-US", {
      timeZone: "Asia/Shanghai",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).replace(",", "");
  }, []);

  const calculateNextDrawCountdown = useCallback(() => {
    const now = new Date();
    const asiaTime = new Date(
      now.toLocaleString("en-US", { timeZone: "Asia/Shanghai" })
    );
    const drawHour = 15;
    let drawTime = new Date(asiaTime);
    drawTime.setHours(drawHour, 0, 0, 0);

    if (drawTime <= asiaTime) {
      drawTime.setDate(drawTime.getDate() + 1);
    }

    const diff = drawTime - now;
    if (diff <= 0) {
      return "Drawing in progress...";
    }

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);
    return `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }, []);

  useEffect(() => {
    const updateNextDraw = () => setNextDraw(calculateNextDrawCountdown());
    updateNextDraw();
    const interval = setInterval(updateNextDraw, 1000);
    return () => clearInterval(interval);
  }, [calculateNextDrawCountdown]);

  const handleFruitSelect = useCallback((fruit) => {
    setSelectedFruits((prev) => {
      // If less than 3 fruits, add the clicked fruit (allows duplicates)
      if (prev.length < 3) {
        return [...prev, fruit];
      }
      // If already 3 fruits, replace the last one with the clicked fruit
      const newSelection = [...prev];
      newSelection.pop(); // Remove last fruit
      newSelection.push(fruit); // Add new fruit
      return newSelection;
    });
  }, []);

  const clearSelection = () => {
    setSelectedFruits([]);
  };

  const generateRandomSelection = () => {
    clearSelection();
    const newSelection = [];
    for (let i = 0; i < 3; i++) {
      const randomIndex = Math.floor(Math.random() * fruits.length);
      newSelection.push(fruits[randomIndex]); // Allow duplicates
    }
    setSelectedFruits(newSelection);
  };

  const purchaseTicket = async () => {
    if (!connected || selectedFruits.length !== 3) {
      return;
    }
    try {
      setTransactionPending(true);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const newTicket = {
        id: Date.now(),
        fruits: [...selectedFruits],
        purchaseTime: new Date().toLocaleTimeString(),
        drawTime: calculateNextDrawTime(),
      };
      setTickets((prev) => {
        const updated = [...prev, newTicket];
        localStorage.setItem("fruitGameTickets", JSON.stringify(updated));
        return updated;
      });
      setSelectedFruits([]);
      setSuccessMessage(
        `Successfully purchased ticket for ${newTicket.fruits.join(" - ")}!`
      );
      setTimeout(() => setSuccessMessage(""), 5000);
    } catch (error) {
      console.error(error);
      alert("Transaction failed. Please try again.");
    } finally {
      setTransactionPending(false);
    }
  };

  const handleConnectWallet = async () => {
    try {
      await connect();
      setSuccessMessage("Wallet connected successfully!");
      setTimeout(() => setSuccessMessage(""), 5000);
    } catch (error) {
      console.error(error);
      alert("Wallet connection failed. Please try again.");
    }
  };

  const checkResults = useCallback(
    (ticket) => {
      const winning = lastResults[0]?.fruits || [];
      let prize = 0;

      if (
        ticket.fruits[0] === winning[0] &&
        ticket.fruits[1] === winning[1] &&
        ticket.fruits[2] === winning[2]
      ) {
        prize = 2.5;
      } else if (
        ticket.fruits[1] === winning[1] &&
        ticket.fruits[2] === winning[2]
      ) {
        prize = 0.25;
      } else if (ticket.fruits[0] === winning[0]) {
        prize = 0.05;
      }

      alert(
        prize > 0
          ? `Congratulations! You won ${prize} SOL from this ticket!`
          : "No wins for this ticket yet. Better luck next time!"
      );
    },
    [lastResults]
  );

  return (
    <div className="fruit-game-container">
      <div className="wallet-btn back-button-container">
        <button
          className="matrix-button back-btn"
          onClick={onBack}
          aria-label="Back to Game Carousel"
        >
          <span className="button-text">BACK TO GAMES</span>
        </button>
      </div>

      <div className="game-area">
        <div className="game-sections">
          <div className="game-section number-selection-section">
            <h3>SELECT YOUR FRUITS</h3>
            <div className="number-grid">
              {fruits.map((fruit) => (
                <button
                  key={fruit}
                  className={`number-btn ${
                    selectedFruits.includes(fruit) ? "selected" : ""
                  }`}
                  onClick={() => handleFruitSelect(fruit)}
                  disabled={selectedFruits.length >= 3 && !selectedFruits.includes(fruit)}
                  aria-label={`Select ${fruit}`}
                >
                  {fruit}
                </button>
              ))}
            </div>

            <div className="selection-display">
              {selectedFruits.length > 0 ? (
                <p className="selected-numbers-text">
                  Selected: {selectedFruits.join(", ")}
                </p>
              ) : (
                <p className="select-numbers-prompt">Select 3 fruits</p>
              )}

              <div className="action-buttons">
                <button className="matrix-button" onClick={clearSelection}>
                  CLEAR
                </button>
                <button
                  className="matrix-button"
                  onClick={generateRandomSelection}
                >
                  RANDOM
                </button>
              </div>

              <div className="info-box">
                <div className="info-row">
                  <span>Ticket Cost:</span>
                  <span>{ticketCost} SOL</span>
                </div>
              </div>

              <button
                className="matrix-button purchase-btn"
                onClick={purchaseTicket}
                disabled={
                  selectedFruits.length !== 3 ||
                  transactionPending ||
                  !connected
                }
                aria-label={`Purchase ticket for ${ticketCost} SOL`}
              >
                <span className="button-text">
                  {transactionPending
                    ? "PROCESSING..."
                    : `PURCHASE (${ticketCost} SOL)`}
                </span>
              </button>

              {transactionPending && (
                <div className="loading-spinner">Processing Transaction...</div>
              )}
              {successMessage && (
                <p className="success-message">{successMessage}</p>
              )}
              {!connected && (
                <div className="wallet-notice">
                  <p>Please connect your wallet to play.</p>
                  <button
                    className="matrix-button"
                    onClick={handleConnectWallet}
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
                  <p className="result-numbers">{result.fruits.join(" - ")}</p>
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
  );
}
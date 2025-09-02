import React, { useState, useEffect, useCallback, useMemo } from "react";
import { debounce } from "lodash";
import { FixedSizeList } from "react-window";
import { useWallet } from "@solana/wallet-adapter-react";

// ON-CHAIN HELPERS (commit your IDL at src/idl/hiperia_program.json)
import {
  getProvider,
  publishResult,
  settleTicket as settleTicketOnchain,
  ensureInitialized,
  buyTicketWithLogs,
} from "../../lib/onchain/dodos";
import { nextDrawTimeUtcSeconds } from "../../lib/onchain/time";

import "./dodos.css";

/* ---------- small helpers ---------- */

// pretty print a UTC seconds value as Asia/Shanghai wall time (UTC+8)
function formatDrawTimeLabel(unixSeconds) {
  if (!unixSeconds) return "";
  const d = new Date(unixSeconds * 1000);
  // render as UTC+8 label
  const asTz = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
  return asTz
    .toLocaleString("en-US", {
      timeZone: "Asia/Shanghai",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(",", "");
}

/* ---------- tickets ui ---------- */

const TicketCard = React.memo(({ ticket, onCheckResults }) => (
  <div className="ticket-card">
    <p className="ticket-numbers">{ticket.numbers.join(" - ")}</p>
    <p className="ticket-time">Purchased: {ticket.purchaseTime}</p>
    <p className="ticket-time">Draw: {ticket.drawTimeLabel} (UTC+8)</p>
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
    itemSize={120}
    className="tickets-grid"
  >
    {({ index, style }) => (
      <div style={style}>
        <TicketCard ticket={tickets[index]} onCheckResults={onCheckResults} />
      </div>
    )}
  </FixedSizeList>
);

/* ---------- main component ---------- */

export default function Dodos({ onBack }) {
  const wallet = useWallet();
  const { connected, connect } = wallet;

  const [selectedNumbers, setSelectedNumbers] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [nextDrawCountdown, setNextDrawCountdown] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [transactionPending, setTransactionPending] = useState(false);

  // display price only; on-chain price lives in program config
  const ticketCost = 0.0072;

  // anchor provider (lazy)
  const provider = useMemo(() => {
    if (!wallet?.publicKey) return null;
    return getProvider({
      wallet,
      rpcUrl: import.meta.env.VITE_SOLANA_RPC || "https://api.devnet.solana.com",
    });
  }, [wallet]);

  // load saved tickets
  useEffect(() => {
    const saved = localStorage.getItem("dodosTickets");
    if (saved) setTickets(JSON.parse(saved));
  }, []);

  // draw countdown (matches your original logic)
  const calcNextDrawCountdown = useCallback(() => {
    const now = new Date();
    const asiaTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
    const drawTimes = [14, 16];
    let nextDrawTime = new Date(asiaTime);

    for (const hour of drawTimes) {
      const drawD = new Date(asiaTime);
      drawD.setHours(hour, 0, 0, 0);
      if (drawD > asiaTime) {
        nextDrawTime = drawD;
        break;
      }
    }
    if (nextDrawTime <= asiaTime) {
      nextDrawTime = new Date(asiaTime);
      nextDrawTime.setDate(asiaTime.getDate() + 1);
      nextDrawTime.setHours(drawTimes[0], 0, 0, 0);
    }

    const diff = nextDrawTime - now;
    if (diff <= 0) return "Drawing in progress...";

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);
    return `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }, []);

  useEffect(() => {
    const tick = () => setNextDrawCountdown(calcNextDrawCountdown());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [calcNextDrawCountdown]);

  // number selection
  const handleNumberSelect = useCallback(
    debounce((number) => {
      setSelectedNumbers((prev) => {
        if (prev.includes(number)) return prev.filter((n) => n !== number);
        if (prev.length < 2 && !prev.includes(number)) return [...prev, number];
        return prev;
      });
    }, 100),
    []
  );

  const clearSelection = () => setSelectedNumbers([]);

  const generateRandomSelection = () => {
    clearSelection();
    const pick = [];
    for (let i = 0; i < 2; i++) {
      let n;
      do n = Math.floor(Math.random() * 22) + 1;
      while (pick.includes(n));
      pick.push(n);
    }
    setSelectedNumbers(pick);
  };

  // on-chain purchase
  const purchaseTicket = async () => {
  if (!connected || selectedNumbers.length !== 2 || !provider) return;

  // client-side guard (program will also validate)
  const [a, b] = selectedNumbers;
  if (a < 1 || a > 22 || b < 1 || b > 22 || a === b) {
    alert("pick two distinct numbers from 1–22");
    return;
  }

  try {
    setTransactionPending(true);

    // 1) ensure program is initialized once on this cluster
    const initRes = await ensureInitialized(provider, {
      ticketCostLamports: 7_200_000,     // 0.0072 SOL
      payoutLamports:     1_000_000_000, // 1 SOL
    });
    if (initRes.didInit) {
      console.log("program initialized (config + vault created)");
    }

    // 2) compute draw & attempt buy with simulate logs
    const drawTimeSec = nextDrawTimeUtcSeconds();
    const res = await buyTicketWithLogs(provider, [a, b], drawTimeSec);

    const newTicket = {
      id: Number(res.nonce),
      nonce: res.nonce,
      numbers: [...selectedNumbers],
      purchaseTime: new Date().toLocaleTimeString(),
      drawTime: res.drawTime,
      drawTimeLabel: formatDrawTimeLabel(res.drawTime),
      sig: res.signature,
    };

    setTickets((prev) => {
      const updated = [...prev, newTicket];
      localStorage.setItem("dodosTickets", JSON.stringify(updated));
      return updated;
    });

    setSelectedNumbers([]);
    setSuccessMessage(`successfully purchased ticket for ${a} - ${b}!`);
    setTimeout(() => setSuccessMessage(""), 5000);
  } catch (e) {
    console.error("buy error:", e);
    // anchor often includes logs in the error object
    const msg = (e?.logs && e.logs.join("\n")) || e?.message || "transaction failed";
    alert(msg);
  } finally {
    setTransactionPending(false);
  }
};


  // connect wallet
  const handleConnectWallet = async () => {
    try {
      await connect();
      setSuccessMessage("wallet connected successfully!");
      setTimeout(() => setSuccessMessage(""), 5000);
    } catch (e) {
      console.error(e);
      alert("wallet connection failed. please try again.");
    }
  };

  // check results (publish + settle)
  const onCheckResults = useCallback(
    async (ticket) => {
      if (!provider) {
        alert("connect your wallet first.");
        return;
      }
      try {
        // ensure result exists (only valid after draw time)
        await publishResult(provider, ticket.drawTime);

        // settle will payout if winner; returns outcome for ui
        const res = await settleTicketOnchain(provider, ticket.nonce, ticket.drawTime);

        if (res.isWinner) {
          alert(`congrats! you won! winning numbers: ${res.resultNumbers.join(" - ")}`);
        } else {
          alert(`no win. winning numbers were ${res.resultNumbers.join(" - ")}`);
        }
      } catch (e) {
        console.error(e);
        alert("couldn't check/settle right now. try again later.");
      }
    },
    [provider]
  );

  return (
    <div className="dodos-container">
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
            <h3>SELECT YOUR NUMBERS</h3>
            <div className="number-grid">
              {Array.from({ length: 22 }, (_, i) => i + 1).map((number) => (
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
                <p className="select-numbers-prompt">Select 2 numbers (1-22)</p>
              )}

              <div className="action-buttons">
                <button className="matrix-button" onClick={clearSelection}>
                  CLEAR
                </button>
                <button className="matrix-button" onClick={generateRandomSelection}>
                  RANDOM
                </button>
              </div>

              <div className="info-box">
                <div className="info-row">
                  <span>Ticket Cost:</span>
                  <span>{ticketCost} SOL</span>
                </div>
                <div className="info-row">
                  <span>Next Draw In:</span>
                  <span>{nextDrawCountdown}</span>
                </div>
              </div>

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
                    onClick={handleConnectWallet}
                    aria-label="Connect wallet"
                  >
                    Connect Wallet
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* you can keep this section as a static teaser or replace with real chain history */}
          <div className="game-section results-section">
            <h3>NEXT DRAW</h3>
            <p className="next-draw">
              {formatDrawTimeLabel(nextDrawTimeUtcSeconds())} (UTC+8)
            </p>
          </div>
        </div>

        {tickets.length > 0 && (
          <div className="game-section tickets-section">
            <h3>YOUR TICKETS</h3>
            <TicketList tickets={tickets} onCheckResults={onCheckResults} />
          </div>
        )}
      </div>
    </div>
  );
}

import React, { useState, useEffect, useCallback } from "react";
import { debounce } from "lodash";
import { FixedSizeList } from "react-window";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { Program, AnchorProvider, web3, BN } from "@coral-xyz/anchor";
import idl from "../../idl/hiperia_program.json";
import "./dodos.css";

// Use your Devnet PROGRAM_ID
const PROGRAM_ID = new web3.PublicKey("4BqH8D4WRxthkMBKjyFHoWVBbrogaCWJf8oC2tV2HGnR");

const TicketCard = React.memo(({ ticket, onCheckResults }) => (
  <div className="ticket-card">
    <p className="ticket-numbers">{ticket.numbers.join(" - ")}</p>
    <p className="ticket-time">Purchased: {new Date(ticket.purchaseTime * 1000).toLocaleString()}</p>
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
        <TicketCard ticket={tickets[index]} onCheckResults={onCheckResults} />
      </div>
    )}
  </FixedSizeList>
);

export default function Dodos({ onBack }) {
  const { connection } = useConnection();
  const { publicKey, connect, signTransaction } = useWallet();
  const [selectedNumbers, setSelectedNumbers] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [nextDraw, setNextDraw] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [transactionPending, setTransactionPending] = useState(false);
  const [lastResults, setLastResults] = useState([]);
  const [ticketCost, setTicketCost] = useState(0.0072);
  const [program, setProgram] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    console.log("Initializing program:", { publicKey, signTransaction, connection });
    if (!publicKey || !signTransaction) {
      console.log("Missing publicKey or signTransaction, skipping initialization");
      setIsLoading(true);
      return;
    }

    const provider = new AnchorProvider(
      connection,
      { publicKey, signTransaction },
      { commitment: "confirmed", preflightCommitment: "confirmed" }
    );
    console.log("Provider created:", provider);

    console.log("IDL loaded:", JSON.stringify(idl, null, 2));

    try {
      const newProgram = new Program(idl, PROGRAM_ID, provider);
      console.log("Program constructed:", newProgram);
      // Test config account existence
      const [configPda] = web3.PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
      newProgram.account.config.fetch(configPda).then(
        () => {
          console.log("Config account found!");
          setProgram(newProgram);
        },
        (err) => {
          console.error("Config fetch failed, program may need initialization:", err.message);
          setProgram(newProgram); // Set anyway to allow manual testing
          setErrorMessage("Program may need initialization. Check console.");
          setTimeout(() => setErrorMessage(""), 5000);
        }
      );
      setIsLoading(false);
    } catch (error) {
      console.error("Failed to initialize program:", error.message, error.stack);
      setErrorMessage(`Error initializing program: ${error.message}. Check console.`);
      setTimeout(() => setErrorMessage(""), 5000);
      setIsLoading(false);
    }
  }, [connection, publicKey, signTransaction]);

  useEffect(() => {
    const savedTickets = localStorage.getItem("dodosTickets");
    if (savedTickets) setTickets(JSON.parse(savedTickets));

    const fetchConfig = async () => {
      if (!program) {
        console.log("Program not available, skipping config fetch. IDL:", JSON.stringify(idl, null, 2));
        return;
      }
      try {
        const [configPda] = web3.PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
        const config = await program.account.config.fetch(configPda);
        setTicketCost(config.ticketCostLamports.toNumber() / 1e9);
        console.log("Fetched ticket cost:", ticketCost);
      } catch (error) {
        console.error("Failed to fetch config:", error.message);
        setErrorMessage("Failed to fetch config. Ensure program is initialized on Devnet.");
        setTimeout(() => setErrorMessage(""), 5000);
      }
    };
    fetchConfig();
  }, [program]);

  const calculateNextDrawTime = useCallback(() => {
    const now = new Date();
    const asiaTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
    const drawTimes = [14, 16];
    let nextDrawTime = new Date(asiaTime);

    for (const hour of drawTimes) {
      const drawTime = new Date(asiaTime);
      drawTime.setHours(hour, 0, 0, 0);
      if (drawTime > asiaTime) {
        nextDrawTime = drawTime;
        break;
      }
    }

    if (nextDrawTime <= asiaTime) {
      nextDrawTime.setDate(asiaTime.getDate() + 1);
      nextDrawTime.setHours(drawTimes[0], 0, 0, 0);
    }

    return {
      display: nextDrawTime.toLocaleString("en-US", {
        timeZone: "Asia/Shanghai",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).replace(",", ""),
      unix: Math.floor(nextDrawTime.getTime() / 1000),
    };
  }, []);

  const calculateNextDrawCountdown = useCallback(() => {
    const now = new Date();
    const nextDrawTime = new Date(calculateNextDrawTime().unix * 1000);
    const diff = nextDrawTime - now;

    if (diff <= 0) return "Drawing in progress...";

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }, [calculateNextDrawTime]);

  useEffect(() => {
    const debouncedUpdateNextDraw = debounce(() => setNextDraw(calculateNextDrawCountdown()), 1000);
    debouncedUpdateNextDraw();
    const interval = setInterval(debouncedUpdateNextDraw, 1000);
    return () => {
      debouncedUpdateNextDraw.cancel();
      clearInterval(interval);
    };
  }, [calculateNextDrawCountdown]);

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
    const newSelection = [];
    for (let i = 0; i < 2; i++) {
      let randomNumber;
      do {
        randomNumber = Math.floor(Math.random() * 22) + 1;
      } while (newSelection.includes(randomNumber));
      newSelection.push(randomNumber);
    }
    setSelectedNumbers(newSelection);
  };

  const purchaseTicket = async () => {
    if (!publicKey || selectedNumbers.length !== 2 || !program) {
      console.log("Purchase check failed:", { publicKey, selectedNumbersLength: selectedNumbers.length, program });
      setErrorMessage("Please connect wallet, select 2 numbers, and ensure program is initialized.");
      setTimeout(() => setErrorMessage(""), 5000);
      return;
    }

    try {
      setTransactionPending(true);
      setErrorMessage("");

      console.log("Starting purchase with:", { selectedNumbers, publicKey });

      const [configPda] = web3.PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
      const [vaultPda] = web3.PublicKey.findProgramAddressSync([Buffer.from("vault")], PROGRAM_ID);
      const ticketNonce = new BN(Math.floor(Math.random() * 1e9));
      const [ticketPda] = web3.PublicKey.findProgramAddressSync(
        [Buffer.from("ticket"), publicKey.toBuffer(), ticketNonce.toArrayLike(Buffer, "le", 8)],
        PROGRAM_ID
      );

      const drawTime = calculateNextDrawTime().unix;
      console.log("Transaction accounts:", { configPda, vaultPda, ticketPda, user: publicKey });

      const tx = await program.methods
        .buyTicket(ticketNonce, new BN(drawTime), selectedNumbers)
        .accounts({
          config: configPda,
          vault: vaultPda,
          ticket: ticketPda,
          user: publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .rpc();

      console.log("Transaction successful:", tx);

      const newTicket = {
        id: ticketNonce.toString(),
        numbers: [...selectedNumbers],
        purchaseTime: Math.floor(Date.now() / 1000),
        drawTime,
      };

      setTickets((prev) => {
        const updated = [...prev, newTicket];
        localStorage.setItem("dodosTickets", JSON.stringify(updated));
        return updated;
      });

      setSelectedNumbers([]);
      setSuccessMessage(`Ticket purchased for ${selectedNumbers.join(" - ")}! Tx: ${tx}`);
      setTimeout(() => setSuccessMessage(""), 5000);
    } catch (error) {
      console.error("Purchase failed:", error.message, error.stack);
      setErrorMessage(`Transaction failed: ${error.message || "Unknown error"}. Check console.`);
      setTimeout(() => setErrorMessage(""), 5000);
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
      console.error("Wallet connection failed:", error);
      setErrorMessage("Wallet connection failed. Please try again.");
      setTimeout(() => setErrorMessage(""), 5000);
    }
  };

  const checkResults = useCallback(
    async (ticket) => {
      if (!program) return;
      try {
        const [resultPda] = web3.PublicKey.findProgramAddressSync(
          [Buffer.from("result"), new BN(ticket.drawTime).toArrayLike(Buffer, "le", 8)],
          PROGRAM_ID
        );
        const result = await program.account.result.fetch(resultPda);
        if (result.isPublished && result.numbers.every((num, i) => num === ticket.numbers[i])) {
          alert(`Congratulations! You won 1 SOL from this ticket!`);
        } else {
          alert("No wins for this ticket. Better luck next time!");
        }
      } catch (error) {
        console.error("Check results failed:", error);
        setErrorMessage("No results available for this draw yet.");
        setTimeout(() => setErrorMessage(""), 5000);
      }
    },
    [program]
  );

  if (isLoading) return <div className="loading-spinner">Loading game...</div>;

  return (
    <div className="dodos-container">
      <div className="wallet-btn back-button-container">
        <button className="matrix-button back-btn" onClick={onBack} aria-label="Back to Game Carousel">
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
              </div>

              <button
                className="matrix-button purchase-btn"
                onClick={purchaseTicket}
                disabled={selectedNumbers.length !== 2 || transactionPending || !publicKey}
                aria-label={`Purchase ticket for ${ticketCost} SOL`}
              >
                <span className="button-text">
                  {transactionPending ? "PROCESSING..." : `PURCHASE (${ticketCost} SOL)`}
                </span>
              </button>

              {transactionPending && <div className="loading-spinner">Processing Transaction...</div>}
              {successMessage && <p className="success-message">{successMessage}</p>}
              {errorMessage && <p className="error-message">{errorMessage}</p>}
              {!publicKey && (
                <div className="wallet-notice">
                  <p>Please connect your wallet to play.</p>
                  <button className="matrix-button" onClick={handleConnectWallet} aria-label="Connect wallet">
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
  );
}
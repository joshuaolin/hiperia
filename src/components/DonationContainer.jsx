import React, { useState, useMemo } from "react";
import "../styles/donation-container.css";

const leaderboardData = [
  { address: "0x123...abc", tickets: 50, wins: 3, donation: 5 },
  { address: "0x456...def", tickets: 45, wins: 2, donation: 2 },
  { address: "0x789...ghi", tickets: 40, wins: 1, donation: 1 },
  { address: "0xabc...jkl", tickets: 35, wins: 0, donation: 0.5 },
  { address: "0xdef...mno", tickets: 30, wins: 0, donation: 0.2 },
];

export default function DonationContainer() {
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");

  const handleDonate = () => {
    const donationAmount = parseFloat(amount);
    if (!amount || donationAmount <= 0) {
      setError("Please enter a valid donation amount (greater than 0 SOL).");
      return;
    }
    setError("");
    alert(`✅ You donated ${amount} SOL! 🚀`); // Replace with toast in production
    setAmount("");
  };

  const { topDonator, recentDonator } = useMemo(() => ({
    topDonator: leaderboardData.reduce((prev, curr) =>
      prev.donation > curr.donation ? prev : curr
    ),
    recentDonator: leaderboardData[1] || leaderboardData[0],
  }), []);

  return (
    <div className="donation-container game-card">
      <div className="donation-section donation-form-wrapper">
        <h2>💰 MAKE A DONATION</h2>
        <div className="donation-form">
          <input
            type="number"
            placeholder="ENTER AMOUNT (SOL)"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setError("");
            }}
            className="donation-input"
            min="0"
            step="0.01"
            aria-label="Donation amount in SOL"
          />
          <div className="wallet-btn">
            <button
              onClick={handleDonate}
              className="matrix-button donate-btn"
              type="button"
              aria-label="Donate SOL"
            >
              DONATE
            </button>
          </div>
        </div>
        {error && <p className="error-message">{error}</p>}
      </div>

      <div className="donation-section">
        <h2>🏆 TOP DONATOR</h2>
        <p className="top-donator">
          <a
            href={`https://solscan.io/account/${topDonator.address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="address-link"
          >
            {topDonator.address}
          </a>{" "}
          <span className="donation-amount">({topDonator.donation} SOL)</span>
        </p>
      </div>

      <div className="donation-section">
        <h2>✨ RECENT DONATOR</h2>
        <p className="recent-donator">
          <a
            href={`https://solscan.io/account/${recentDonator.address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="address-link"
          >
            {recentDonator.address}
          </a>
        </p>
      </div>

      <div className="donation-section">
        <h2>📊 LEADERBOARDS</h2>
        <div className="leaderboard">
          <table>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Player</th>
                <th>Tickets</th>
                <th>Wins</th>
              </tr>
            </thead>
            <tbody>
              {leaderboardData.map((entry, index) => (
                <tr key={entry.address}>
                  <td>{index + 1}</td>
                  <td className={index === 0 ? "leaderboard-rank1" : ""}>
                    <a
                      href={`https://solscan.io/account/${entry.address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="address-link"
                    >
                      {entry.address}
                    </a>
                  </td>
                  <td>{entry.tickets}</td>
                  <td>{entry.wins}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
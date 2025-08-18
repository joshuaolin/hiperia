import React, { useState, useEffect } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import "../index.css";

const PROGRAM_ID = new PublicKey("Hiperia11111111111111111111111111111111111");

export default function DonationContainer() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [topDonator, setTopDonator] = useState({ address: "", amount: 0 });
  const [recentDonator, setRecentDonator] = useState("");
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      if (!publicKey) return;
      setLoading(true);
      try {
        // Fetch donation accounts
        const donationAccounts = await connection.getProgramAccounts(PROGRAM_ID, {
          filters: [{ memcmp: { offset: 8, bytes: bs58.encode(Buffer.from("donation")) } }],
        });

        let topDonation = { address: "", amount: 0, timestamp: 0 };
        let recentDonation = { address: "", timestamp: 0 };

        for (const account of donationAccounts) {
          const data = account.account.data;
          const donator = new PublicKey(data.slice(8, 40)).toBase58();
          const amount = data.readBigUInt64LE(40);
          const timestamp = data.readBigInt64LE(48);

          if (Number(amount) > topDonation.amount) {
            topDonation = { address: donator, amount: Number(amount), timestamp };
          }
          if (timestamp > recentDonation.timestamp) {
            recentDonation = { address: donator, timestamp };
          }
        }

        // Fetch leaderboard accounts
        const leaderboardAccounts = await connection.getProgramAccounts(PROGRAM_ID, {
          filters: [{ memcmp: { offset: 8, bytes: bs58.encode(Buffer.from("leaderboard")) } }],
        });

        const leaderboardData = leaderboardAccounts
          .map((account) => {
            const data = account.account.data;
            return {
              address: new PublicKey(data.slice(8, 40)).toBase58(),
              tickets: Number(data.readBigUInt64LE(40)),
              wins: Number(data.readBigUInt64LE(48)),
            };
          })
          .sort((a, b) => b.tickets - a.tickets)
          .slice(0, 5);

        setTopDonator(topDonation);
        setRecentDonator(recentDonation.address);
        setLeaderboard(leaderboardData);
        setError(null);
      } catch (err) {
        setError("Failed to fetch donation data");
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [publicKey, connection]);

  if (loading) {
    return <div className="donation-container">Loading...</div>;
  }

  if (error) {
    return <div className="donation-container error">{error}</div>;
  }

  return (
    <div className="donation-container">
      <div className="donation-section">
        <h2>Top Donator</h2>
        <p className="top-donator">
          {topDonator.address ? (
            <>
              <a
                href={`https://explorer.solana.com/address/${topDonator.address}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="address-link"
                aria-label={`View wallet ${topDonator.address} who donated ${(topDonator.amount / 1_000_000_000).toFixed(2)} SOL on Solana Explorer`}
              >
                {topDonator.address}
              </a>{" "}
              ({(topDonator.amount / 1_000_000_000).toFixed(2)} SOL)
            </>
          ) : (
            "No donations yet"
          )}
        </p>
      </div>
      <div className="donation-section">
        <h2>Recent Donator</h2>
        <p className="recent-donator">
          {recentDonator ? (
            <span>
              <a
                href={`https://explorer.solana.com/address/${recentDonator}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="address-link"
                aria-label={`View wallet ${recentDonator} on Solana Explorer`}
              >
                {recentDonator}
              </a>
            </span>
          ) : (
            "No recent donations"
          )}
        </p>
      </div>
      <div className="donation-section">
        <h2>Leaderboards</h2>
        <div className="leaderboard" aria-label="Top players leaderboard">
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
              {leaderboard.length > 0 ? (
                leaderboard.map((entry, index) => (
                  <tr key={entry.address}>
                    <td>{index + 1}</td>
                    <td className={index === 0 ? "leaderboard-rank1" : ""}>
                      <a
                        href={`https://explorer.solana.com/address/${entry.address}?cluster=devnet`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="address-link"
                        aria-label={`View wallet ${entry.address} on Solana Explorer`}
                      >
                        {entry.address}
                      </a>
                    </td>
                    <td>{entry.tickets}</td>
                    <td>{entry.wins}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="4">No leaderboard data</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
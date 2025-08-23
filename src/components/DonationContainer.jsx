// src/components/DonationContainer.jsx
import React, { useState, useMemo, useEffect } from "react";
import PropTypes from "prop-types";
import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";

import idl from "../idl/donation_program.json";
import "../styles/donation-container.css";

const programID = new PublicKey(idl.address);
const network = "https://api.devnet.solana.com";
const opts = { commitment: "processed" };

function DonatorCard({ title, donator, className }) {
  return (
    <div className={`donation-section ${className} animate-section`}>
      <h2 className={className === "top-donator-card" ? "cosmic-shimmer" : "cosmic-glitch"}>
        {title}
      </h2>
      <p className={`${className}-text`}>
        <a
          href={`https://solscan.io/account/${donator.address}`}
          target="_blank"
          rel="noopener noreferrer"
          className="address-link"
        >
          {donator.address}
        </a>
        <span className="donation-amount cosmic-glitch"> ({donator.donation} SOL)</span>
        {className === "top-donator-card" && (
          <span className="top-donator-badge" title="Top Donator">👑</span>
        )}
      </p>
    </div>
  );
}

DonatorCard.propTypes = {
  title: PropTypes.string.isRequired,
  donator: PropTypes.shape({
    address: PropTypes.string.isRequired,
    donation: PropTypes.number.isRequired,
  }).isRequired,
  className: PropTypes.string.isRequired,
};

function DonationForm({ onDonate, error, amount, setAmount }) {
  return (
    <div className="donation-section animate-section">
      <h2 className="cosmic-glitch">💸 MAKE A DONATION</h2>
      <div className="donation-form">
        <input
          type="number"
          className="donation-input"
          placeholder="Enter SOL amount..."
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          min="0.01"
          step="0.01"
          max="1000"
        />
        <button className="donation-btn" onClick={onDonate}>DONATE</button>
      </div>
      {error && <p className="error-message cosmic-glitch">{error}</p>}
    </div>
  );
}

DonationForm.propTypes = {
  onDonate: PropTypes.func.isRequired,
  error: PropTypes.string,
  amount: PropTypes.string.isRequired,
  setAmount: PropTypes.func.isRequired,
};

function Leaderboard({ data }) {
  return (
    <div className="donation-section leaderboard animate-section">
      <h2 className="cosmic-glitch">📊 LEADERBOARD</h2>
      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Address</th>
            <th>Donation (SOL)</th>
          </tr>
        </thead>
        <tbody>
          {data.map((user, index) => (
            <tr key={user.address} className={index === 0 ? "leaderboard-rank1" : ""}>
              <td>#{index + 1}</td>
              <td>
                <a
                  href={`https://solscan.io/account/${user.address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="address-link"
                >
                  {user.address}
                </a>
              </td>
              <td>{user.donation}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

Leaderboard.propTypes = {
  data: PropTypes.arrayOf(
    PropTypes.shape({
      address: PropTypes.string.isRequired,
      donation: PropTypes.number.isRequired,
    })
  ).isRequired,
};

export default function DonationContainer() {
  const wallet = useWallet();
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [leaderboard, setLeaderboard] = useState([]);

  const fetchLeaderboard = async () => {
    // TODO: fetch from chain (for now, mock data)
    setLeaderboard([
      { address: "mock1", donation: 2 },
      { address: "mock2", donation: 1.5 },
    ]);
  };

  const handleDonate = async () => {
    try {
      if (!wallet.publicKey) {
        setError("⚠️ Please connect your wallet.");
        return;
      }

      const connection = new Connection(network, opts.commitment);

      const provider = new anchor.AnchorProvider(
        connection,
        {
          publicKey: wallet.publicKey,
          signTransaction: wallet.signTransaction,
          signAllTransactions: wallet.signAllTransactions,
        },
        opts
      );

      // debug logs para makita kung ano laman ng IDL
      console.log("programID:", programID.toBase58());
      console.log("idl keys:", Object.keys(idl));
      console.log("idl.accounts:", idl.accounts);

      const program = new anchor.Program(idl, programID, provider);
      console.log("program instantiated:", program);

      const lamports = parseFloat(amount) * anchor.web3.LAMPORTS_PER_SOL;
      if (!lamports || lamports <= 0) {
        setError("⚠️ Invalid donation amount.");
        return;
      }
      setError("");

      const [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from("vault")], programID);
      const [leaderboardPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("leaderboard"), wallet.publicKey.toBuffer()],
        programID
      );
      const [donationPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("donation"), wallet.publicKey.toBuffer()],
        programID
      );

      await program.methods
        .donate(new anchor.BN(lamports))
        .accounts({
          payer: wallet.publicKey,
          vault: vaultPda,
          donation: donationPda,
          leaderboard: leaderboardPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      fetchLeaderboard();
      setAmount("");
    } catch (e) {
      console.error("donation error:", e);
      setError("⚠️ Donation failed. Check console.");
    }
  };

  useEffect(() => {
    fetchLeaderboard();
  }, []);

  const { topDonator, recentDonator } = useMemo(() => {
    const sorted = [...leaderboard].sort((a, b) => b.donation - a.donation);
    return {
      topDonator: sorted[0] || { address: "N/A", donation: 0 },
      recentDonator: leaderboard[leaderboard.length - 1] || { address: "N/A", donation: 0 },
    };
  }, [leaderboard]);

  if (!wallet.connected) {
    return (
      <div className="donation-container">
        <p className="error-message">⚠️ Connect wallet to view donations.</p>
      </div>
    );
  }

  return (
    <div className="donation-container game-card matrix-bg">
      <DonatorCard title="🏆 TOP DONATOR" donator={topDonator} className="top-donator-card" />
      <DonatorCard title="✨ RECENT DONATOR" donator={recentDonator} className="recent-donator" />
      <DonationForm onDonate={handleDonate} error={error} amount={amount} setAmount={setAmount} />
      <Leaderboard data={leaderboard} />
    </div>
  );
}

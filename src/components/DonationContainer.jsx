import React, { useState, useEffect } from "react";
import PropTypes from "prop-types";
import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import idl from "../idl/hiperia_program.json";
import "../styles/donation-container.css";

const programID = new PublicKey(idl.address);
const network = "https://api.devnet.solana.com";
const opts = { commitment: "processed" };

const DONATION_WALLET = new PublicKey(
  "Ghxn7ree6MFQxC8hFTJ8Lo319xEZzqVFLcmDLKVFpPaa"
);

function DonatorCard({ title, donator, className }) {
  return (
    <div className={`donation-section ${className} animate-section`}>
      <h2
        className={
          className === "latest-donation-card" ? "cosmic-shimmer" : "cosmic-glitch"
        }
      >
        {title}
      </h2>
      <div className={`${className}-text`}>
        <a
          href={`https://solscan.io/account/${donator.address}?cluster=devnet`}
          target="_blank"
          rel="noopener noreferrer"
          className="address-link"
        >
          {donator.address}
        </a>
        <span className="donation-amount cosmic-glitch">
          {" "}({donator.donation} SOL)
        </span>
      </div>
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
        <button className="donation-btn" onClick={onDonate}>
          DONATE
        </button>
      </div>
      {error && <p className="error-message cosmic-glitch">{error}</p>}
    </div>
  );
}

DonationForm.propTypes = {
  onDonate: PropTypes.func.isRequired,
  error: PropTypes.string,
  amount: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  setAmount: PropTypes.func.isRequired,
};

export default function DonationContainer() {
  const wallet = useWallet();
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [latestDonation, setLatestDonation] = useState({ address: "N/A", donation: 0 });

  const fetchDonation = async () => {
    if (!wallet.connected || !wallet.publicKey) return;

    try {
      const connection = new Connection(network, opts.commitment);
      const provider = new anchor.AnchorProvider(connection, wallet, opts);
      const program = new anchor.Program(idl, programID, provider);

      const [donationPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("donation"), wallet.publicKey.toBuffer()],
        programID
      );

      // ✅ use correct casing (DonationAccount) as per your IDL
      const donationAccount = await program.account.DonationAccount.fetch(donationPda);

      setLatestDonation({
        address: donationAccount.donator.toBase58(),
        donation: Number(donationAccount.amount) / anchor.web3.LAMPORTS_PER_SOL,
      });
    } catch (err) {
      console.error("Fetch donation error:", err);
      setError(`⚠️ Failed to fetch donation: ${err.message}`);
      setLatestDonation({ address: "N/A", donation: 0 });
    }
  };

  const handleDonate = async () => {
    try {
      if (!wallet.publicKey) {
        setError("⚠️ Please connect your wallet.");
        return;
      }

      const connection = new Connection(network, opts.commitment);
      const provider = new anchor.AnchorProvider(connection, wallet, opts);
      const program = new anchor.Program(idl, programID, provider);

      const amountInSol = parseFloat(amount);
      if (isNaN(amountInSol) || amountInSol <= 0 || amountInSol > 1000) {
        setError("⚠️ Invalid donation amount. Must be between 0.01 and 1000 SOL.");
        return;
      }
      const lamports = Math.floor(amountInSol * anchor.web3.LAMPORTS_PER_SOL);
      setError("");

      const [donationPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("donation"), wallet.publicKey.toBuffer()],
        programID
      );

      await program.methods
        .donate(new anchor.BN(lamports))
        .accounts({
          payer: wallet.publicKey,
          donation_wallet: DONATION_WALLET,
          donation: donationPda,
          system_program: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      await fetchDonation();
      setAmount("");
    } catch (e) {
      console.error("Donation error:", e);
      setError(`⚠️ Donation failed: ${e.message}`);
    }
  };

  useEffect(() => {
    fetchDonation();
  }, [wallet.connected, wallet.publicKey]);

  if (!wallet.connected) {
    return (
      <div className="donation-container">
        <p className="error-message">⚠️ Connect wallet to view donations.</p>
      </div>
    );
  }

  return (
    <div className="donation-container game-card matrix-bg">
      <DonatorCard
        title="💰 LATEST DONATION"
        donator={latestDonation}
        className="latest-donation-card"
      />
      <DonationForm
        onDonate={handleDonate}
        error={error}
        amount={amount}
        setAmount={setAmount}
      />
    </div>
  );
}

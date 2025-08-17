import React, { useEffect, useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";

export default function WalletBalance() {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Network label for UI (change to "Mainnet" if using Mainnet RPC)
  const network = "Devnet";

  // Exponential backoff retry
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const fetchBalance = async (retryCount = 2, delay = 2000) => {
    if (!publicKey || !connection) {
      console.log("No publicKey or connection available");
      setBalance(null);
      setError("Wallet not connected or connection unavailable");
      return;
    }

    try {
      setLoading(true);
      setError(null);
      console.log("Fetching balance for:", publicKey.toBase58());

      // Try primary connection
      let bal = await connection.getBalance(publicKey, "confirmed");
      console.log(`Raw balance (lamports) from ${network} RPC:`, bal);
      let solBalance = bal / LAMPORTS_PER_SOL;
      console.log(`Balance in SOL (${network}):`, solBalance);
      setBalance(solBalance);
      setError(null);
    } catch (err) {
      console.error("Primary RPC failed:", err.message);

      // Retry with backoff
      if (retryCount > 0) {
        console.log(`Retrying... (${retryCount} attempts left)`);
        await sleep(delay);
        return fetchBalance(retryCount - 1, delay * 2);
      }

      // All attempts failed
      setError(
        err.message.includes("403")
          ? "RPC rate limit exceeded. Please try again later."
          : `Failed to fetch balance: ${err.message}`
      );
      setBalance(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (publicKey && connection) {
      fetchBalance();
      const interval = setInterval(() => fetchBalance(2, 2000), 120000); // Poll every 120 seconds
      return () => clearInterval(interval);
    } else {
      setBalance(null);
      setError(null);
    }
  }, [publicKey, connection]);

  if (!publicKey) {
    return (
      <div className="text-green-300 text-lg font-mono drop-shadow">
        Please connect your wallet
      </div>
    );
  }

  return (
    <div className="text-green-300 text-lg font-mono drop-shadow flex flex-col items-center gap-2">
      {loading ? (
        <span>Loading balance...</span>
      ) : error ? (
        <span>Error: {error}</span>
      ) : balance !== null ? (
        <span>Balance ({network}): {balance.toFixed(2)} SOL</span>
      ) : (
        <span>Unable to fetch balance</span>
      )}
      <button
        onClick={() => fetchBalance(2, 2000)}
        className="bg-green-500 hover:bg-green-400 text-black px-3 py-1 rounded-lg text-sm font-semibold"
        disabled={loading}
      >
        {loading ? "Refreshing..." : "Refresh Balance"}
      </button>
    </div>
  );
}
import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import useNetworkStatus from "./useNetworkStatus";
import "../styles/header.css";

export default function Header({ activeSection = "dodos" }) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const { network, isLoading, error } = useNetworkStatus();
  const [balance, setBalance] = useState(null);
  const address = publicKey?.toBase58();

  useEffect(() => {
    if (!publicKey) return;

    let active = true;
    let subscription;
    let balanceTimer;
    const updateBalance = (lamports) => {
      if (active) setBalance({ connection, address, lamports });
    };

    const refreshBalance = () =>
      connection
        .getBalance(publicKey, "confirmed")
        .then(updateBalance)
        .catch(() => {
          if (active) setBalance({ connection, address, lamports: null });
        });
    refreshBalance();

    if (connection.usesHttpPolling) {
      balanceTimer = setInterval(refreshBalance, 10_000);
    } else {
      try {
        subscription = connection.onAccountChange(
          publicKey,
          (account) => updateBalance(account.lamports),
          "confirmed",
        );
      } catch {
        subscription = undefined;
      }
    }

    return () => {
      active = false;
      clearInterval(balanceTimer);
      if (subscription !== undefined) {
        connection.removeAccountChangeListener(subscription).catch(() => {});
      }
    };
  }, [connection, publicKey, address]);

  const lamports =
    balance?.connection === connection && balance?.address === address
      ? balance.lamports
      : null;
  const statusLabel = isLoading
    ? "Checking network"
    : error
      ? "Network unavailable"
      : network?.allowed
        ? network.label
        : "Unsupported network";
  const statusClass = isLoading
    ? "status-dot-warning"
    : error || !network?.allowed
      ? "status-dot-error"
      : "";
  const networkTitle = isLoading
    ? "Verifying the connected Solana network."
    : error
      ? "The connected Solana network could not be verified."
      : network?.allowed
        ? `Verified by genesis hash: ${network.genesisHash}`
        : "Choose Devnet, Testnet, or a supported local validator.";

  return (
    <header className="header">
      <div className="header-breadcrumb" aria-label="Current page">
        <span>{activeSection === "support" ? "Support Hiperia" : "Dodos"}</span>
        <span className="header-breadcrumb-separator" aria-hidden="true">
          /
        </span>
        <span className="text-muted">Overview</span>
      </div>
      <div className="header-actions">
        {import.meta.env.VITE_APP_ENV === "uat" && (
          <span className="environment-badge" aria-label="UAT environment">
            UAT
          </span>
        )}
        <div className="network-badge" role="status" title={networkTitle}>
          <span className={`status-dot ${statusClass}`} aria-hidden="true" />
          {statusLabel}
        </div>
        {publicKey && lamports !== null && (
          <span className="header-balance" aria-label="Wallet SOL balance">
            {new Intl.NumberFormat("en-US", {
              maximumFractionDigits: 4,
            }).format(lamports / LAMPORTS_PER_SOL)}
            <span>SOL</span>
          </span>
        )}
        <div className="wallet-btn">
          <WalletMultiButton />
        </div>
      </div>
    </header>
  );
}

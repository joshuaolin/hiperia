import { getNetworkStatus } from "../lib/network.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import {
  DONATION_ADDRESS,
  DonationClient,
  canSignDonation,
  explorerTransactionUrl,
  formatSol,
  parseSolAmount,
} from "./donation.js";
import "../styles/donation.css";

export default function DonationCard({ network }) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const walletRef = useRef(wallet);
  const inFlight = useRef(false);
  const submissionConnection = useRef(null);
  const [amount, setAmount] = useState("0.01");
  const [touched, setTouched] = useState(false);
  const [balance, setBalance] = useState(null);
  const [ownNetwork, setOwnNetwork] = useState(null);
  const [status, setStatus] = useState({ stage: "idle" });
  const [error, setError] = useState("");
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [copyStatus, setCopyStatus] = useState("idle");
  const client = useMemo(
    () => new DonationClient({ connection, wallet: () => walletRef.current }),
    [connection],
  );
  const activeNetwork = network ?? ownNetwork;
  const publicKey = wallet.publicKey?.toBase58();
  const pending = ["checking", "signing", "confirming"].includes(status.stage);
  const uncertain = status.stage === "uncertain";
  const confirmedSignature =
    status.stage === "confirmed" ? status.signature : null;
  let amountError = "";
  try {
    parseSolAmount(amount);
  } catch (validationError) {
    amountError = validationError.message;
  }

  useEffect(() => {
    walletRef.current = wallet;
  }, [wallet]);

  useEffect(() => {
    if (network) return;
    let active = true;
    setOwnNetwork(null);
    getNetworkStatus(connection).then(
      (result) => {
        if (active) setOwnNetwork(result);
      },
      () => {
        if (active)
          setOwnNetwork({ allowed: false, label: "Network unavailable" });
      },
    );
    return () => {
      active = false;
    };
  }, [connection, network]);

  useEffect(() => {
    let active = true;
    setBalance(null);
    if (publicKey && activeNetwork?.allowed) {
      connection.getBalance(wallet.publicKey, "confirmed").then(
        (value) => {
          if (active && Number.isSafeInteger(value)) setBalance(value);
        },
        () => {},
      );
    }
    return () => {
      active = false;
    };
  }, [
    connection,
    publicKey,
    wallet.publicKey,
    activeNetwork?.allowed,
    confirmedSignature,
  ]);

  async function copyAddress() {
    setCopyStatus("copying");
    try {
      await navigator.clipboard.writeText(DONATION_ADDRESS);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (inFlight.current || uncertain) return;
    setTouched(true);
    if (amountError) return;
    inFlight.current = true;
    submissionConnection.current = connection;
    setError("");
    try {
      await client.donate(amount, { onStatus: setStatus });
    } catch (transactionError) {
      setError(transactionError.message || "The donation could not be sent.");
      setStatus({
        stage: transactionError.confirmationUncertain ? "uncertain" : "failed",
        signature: transactionError.signature,
        network: transactionError.network,
      });
    } finally {
      inFlight.current = false;
    }
  }

  async function checkConfirmation() {
    if (!status.signature || checkingStatus) return;
    setCheckingStatus(true);
    try {
      const result = await (
        submissionConnection.current ?? connection
      ).getSignatureStatuses([status.signature], {
        searchTransactionHistory: true,
      });
      const confirmation = result.value[0];
      if (confirmation?.err) {
        setStatus((previous) => ({ ...previous, stage: "failed" }));
        setError("The transaction failed on chain. No donation was confirmed.");
      } else if (
        ["confirmed", "finalized"].includes(confirmation?.confirmationStatus)
      ) {
        setStatus((previous) => ({ ...previous, stage: "confirmed" }));
        setError("");
      } else {
        setError(
          "Confirmation is still pending. Check the explorer before sending another donation.",
        );
      }
    } catch {
      setError(
        "Confirmation is unavailable. Check the explorer before sending another donation.",
      );
    } finally {
      setCheckingStatus(false);
    }
  }

  const explorerUrl = explorerTransactionUrl(status.signature, status.network);
  const canSign = canSignDonation(wallet);
  const buttonLabel =
    {
      checking: "Checking transfer…",
      signing: "Approve in your wallet…",
      confirming: "Confirming transfer…",
      uncertain: "Confirmation pending",
    }[status.stage] ?? "Send test SOL";

  return (
    <section
      id="support"
      className="panel donation-card"
      aria-labelledby="donation-heading"
    >
      <div className="panel-heading donation-heading">
        <div>
          <p className="eyebrow">Optional donation</p>
          <h2 id="donation-heading">Support Hiperia</h2>
        </div>
        <span className="donation-network">
          {activeNetwork?.label ?? "Checking network"}
        </span>
      </div>
      <p className="text-muted donation-description">
        Send test SOL directly to the Hiperia support wallet.
      </p>
      <div className="donation-recipient">
        <div className="donation-recipient-heading">
          <span className="field-label">Recipient</span>
          <button
            className="donation-copy"
            type="button"
            onClick={copyAddress}
            disabled={copyStatus === "copying"}
            aria-label="Copy support wallet address"
          >
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <rect x="7" y="7" width="9" height="10" rx="1.5" />
              <path d="M12 7V4.5A1.5 1.5 0 0 0 10.5 3h-6A1.5 1.5 0 0 0 3 4.5v7A1.5 1.5 0 0 0 4.5 13H7" />
            </svg>
            {copyStatus === "copied" ? "Copied" : "Copy address"}
          </button>
        </div>
        <code>{DONATION_ADDRESS}</code>
        <span
          className={`donation-copy-status${copyStatus === "failed" ? " donation-error" : ""}`}
          role="status"
          aria-live="polite"
        >
          {copyStatus === "copied" && "Wallet address copied."}
          {copyStatus === "failed" &&
            "Copy failed. Select and copy the wallet address above."}
        </span>
      </div>
      <form onSubmit={submit}>
        <div className="donation-amount-label">
          <label className="field-label" htmlFor="donation-amount">
            Amount
          </label>
          <span className="text-muted">
            Balance: {balance === null ? "—" : `${formatSol(balance)} SOL`}
          </span>
        </div>
        <div
          className={`donation-input${touched && amountError ? " donation-input-invalid" : ""}`}
        >
          <input
            id="donation-amount"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            placeholder="0.00"
            maxLength={24}
            disabled={pending || uncertain}
            onBlur={() => setTouched(true)}
            onChange={(event) => setAmount(event.target.value)}
            aria-invalid={Boolean(touched && amountError)}
            aria-describedby="donation-amount-help donation-note"
          />
          <span>SOL</span>
        </div>
        <div className="donation-presets" aria-label="Choose an amount">
          {["0.01", "0.05", "0.1"].map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={amount === value}
              disabled={pending || uncertain}
              onClick={() => {
                setAmount(value);
                setTouched(true);
              }}
            >
              {value} SOL
            </button>
          ))}
        </div>
        <p
          id="donation-amount-help"
          className={`donation-help${touched && amountError ? " donation-error" : " text-muted"}`}
        >
          {touched && amountError
            ? amountError
            : status.fee !== undefined
              ? `Estimated network fee: ${formatSol(status.fee)} SOL`
              : "A small network fee is added to your transfer."}
        </p>
        {!wallet.connected ? (
          <WalletMultiButton className="button button-primary donation-submit">
            Connect wallet
          </WalletMultiButton>
        ) : (
          <button
            className="button button-primary donation-submit"
            type="submit"
            disabled={
              pending ||
              uncertain ||
              !canSign ||
              !activeNetwork?.allowed ||
              Boolean(amountError)
            }
          >
            {buttonLabel}
            {!pending && !uncertain && <span aria-hidden="true">↗</span>}
          </button>
        )}
      </form>
      {wallet.connected && !canSign && (
        <p className="status-note donation-error">
          This wallet is read-only. Connect a wallet that can sign transactions.
        </p>
      )}
      {activeNetwork && !activeNetwork.allowed && (
        <p className="status-note donation-error">
          Switch to Devnet, Testnet, or a local validator to donate.
        </p>
      )}
      <div className="donation-status" aria-live="polite" aria-atomic="true">
        {status.stage === "confirmed" && (
          <p className="status-note donation-success">
            Donation confirmed. Thank you for supporting Hiperia.
          </p>
        )}
        {error && (
          <p className="status-note donation-error" role="alert">
            {error}
          </p>
        )}
        {explorerUrl && (
          <a
            className="donation-transaction"
            href={explorerUrl}
            target="_blank"
            rel="noreferrer"
          >
            View transaction <span aria-hidden="true">↗</span>
          </a>
        )}
        {uncertain && status.signature && (
          <button
            className="button button-secondary donation-check"
            type="button"
            onClick={checkConfirmation}
            disabled={checkingStatus}
          >
            {checkingStatus ? "Checking…" : "Check confirmation"}
          </button>
        )}
      </div>
      <p id="donation-note" className="text-muted donation-note">
        Test networks only. Every transfer needs your wallet approval.
      </p>
    </section>
  );
}

import { inspectNetwork } from "../lib/network.js";
export {
  inspectNetwork,
  explorerTransactionUrl,
  DEVNET_GENESIS_HASH,
  TESTNET_GENESIS_HASH,
  MAINNET_GENESIS_HASH,
} from "../lib/network.js";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
export const DONATION_ADDRESS = "Ghxn7ree6MFQxC8hFTJ8Lo319xEZzqVFLcmDLKVFpPaa";
export function parseSolAmount(value) {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,9})?$/.test(value.trim())) {
    throw new Error("Enter a SOL amount with up to 9 decimal places.");
  }
  const [whole, fraction = ""] = value.trim().split(".");
  const lamports =
    BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, "0"));
  if (lamports <= 0n) throw new Error("Enter an amount greater than zero.");
  if (lamports > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("This amount is too large.");
  }
  return Number(lamports);
}
export function formatSol(lamports) {
  const value = BigInt(lamports);
  const fraction = (value % 1_000_000_000n)
    .toString()
    .padStart(9, "0")
    .replace(/0+$/, "");
  return `${value / 1_000_000_000n}${fraction ? `.${fraction}` : ""}`;
}
export function canSignDonation(wallet) {
  const adapter = wallet?.wallet?.adapter;
  return Boolean(
    wallet?.connected &&
      wallet.publicKey &&
      typeof wallet.sendTransaction === "function" &&
      (adapter
        ? typeof adapter.sendTransaction === "function"
        : typeof wallet.signTransaction === "function"),
  );
}
export class DonationClient {
  constructor({ connection, wallet }) {
    this.connection = connection;
    this.wallet = typeof wallet === "function" ? wallet : () => wallet;
    this.pending = false;
  }
  async donate(amount, { onStatus = () => {} } = {}) {
    if (this.pending) throw new Error("A donation is already in progress.");
    this.pending = true;
    let signature;
    let network;
    let submitted = false;
    try {
      const lamports = parseSolAmount(amount);
      const wallet = this.wallet();
      if (!wallet?.connected || !wallet.publicKey)
        throw new Error("Connect your wallet first.");
      if (!canSignDonation(wallet))
        throw new Error("This wallet cannot sign transactions.");
      const payer = wallet.publicKey;
      onStatus({
        stage: "checking",
      });
      network = await inspectNetwork(this.connection);
      if (!network.allowed) {
        throw new Error(
          "Donations require Devnet, Testnet, or a local validator. Mainnet is disabled.",
        );
      }
      const blockhash = await this.connection.getLatestBlockhash("confirmed");
      const transaction = new Transaction({
        feePayer: payer,
        ...blockhash,
      }).add(
        SystemProgram.transfer({
          fromPubkey: payer,
          toPubkey: new PublicKey(DONATION_ADDRESS),
          lamports,
        }),
      );
      const [balance, feeResult] = await Promise.all([
        this.connection.getBalance(payer, "confirmed"),
        this.connection.getFeeForMessage(
          transaction.compileMessage(),
          "confirmed",
        ),
      ]);
      const fee = feeResult?.value;
      if (!Number.isSafeInteger(fee) || fee < 0)
        throw new Error("The network fee is unavailable. Try again.");
      if (!Number.isSafeInteger(balance) || balance < 0)
        throw new Error("The wallet balance is unavailable.");
      if (BigInt(balance) < BigInt(lamports) + BigInt(fee)) {
        throw new Error(
          `You need ${formatSol(lamports)} SOL plus ${formatSol(fee)} SOL for the network fee.`,
        );
      }
      const currentWallet = this.wallet();
      if (
        !canSignDonation(currentWallet) ||
        !currentWallet.publicKey.equals(payer)
      ) {
        throw new Error(
          "The connected wallet changed. Review your donation and try again.",
        );
      }
      onStatus({
        stage: "signing",
        network,
        fee,
        lamports,
        balance,
      });
      signature = await currentWallet.sendTransaction(
        transaction,
        this.connection,
        {
          preflightCommitment: "confirmed",
          skipPreflight: false,
          maxRetries: 0,
        },
      );
      submitted = true;
      if (!signature)
        throw new Error("The wallet did not return a transaction signature.");
      onStatus({
        stage: "confirming",
        signature,
        network,
        fee,
        lamports,
        balance,
      });
      const confirmation = await this.connection.confirmTransaction(
        {
          signature,
          ...blockhash,
        },
        "confirmed",
      );
      if (confirmation?.value?.err) {
        throw Object.assign(
          new Error(
            "The transaction failed on chain. No donation was confirmed.",
          ),
          {
            confirmedFailure: true,
          },
        );
      }
      if (!confirmation?.value || confirmation.value.err !== null) {
        throw new Error("Confirmation is unavailable.");
      }
      const result = {
        stage: "confirmed",
        signature,
        network,
        fee,
        lamports,
        balance,
      };
      onStatus(result);
      return result;
    } catch (reason) {
      const error =
        reason instanceof Error
          ? reason
          : new Error(
              typeof reason === "string"
                ? reason
                : "The donation could not be sent.",
            );
      if (submitted) {
        error.signature = signature;
        error.network = network;
        error.confirmationUncertain = !error.confirmedFailure;
        if (error.confirmationUncertain) {
          error.message =
            "Transaction submitted. Check its status before sending another donation.";
        }
      }
      throw error;
    } finally {
      this.pending = false;
    }
  }
}

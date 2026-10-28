import {
  Connection,
  TransactionExpiredBlockheightExceededError,
  TransactionExpiredTimeoutError,
} from "@solana/web3.js";

export async function pollTransaction(
  connection,
  strategy,
  commitment = "confirmed",
  {
    now = Date.now,
    delay = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    timeout = 60_000,
  } = {},
) {
  const signature =
    typeof strategy === "string" ? strategy : strategy.signature;
  if (
    typeof signature !== "string" ||
    !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)
  )
    throw new TypeError("Invalid transaction signature.");
  if (typeof strategy !== "string" && "nonceAccountPubkey" in strategy)
    throw new TypeError("Durable nonce confirmation is not supported by UAT.");
  const start = now();
  while (now() - start < timeout) {
    if (strategy.abortSignal?.aborted)
      throw strategy.abortSignal.reason ?? new Error("Confirmation aborted.");
    const statuses = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const status = statuses.value[0];
    const confirmed =
      commitment === "processed" ||
      status?.confirmationStatus === "finalized" ||
      (commitment !== "finalized" &&
        status?.confirmationStatus === "confirmed");
    if (status && confirmed)
      return { context: statuses.context, value: { err: status.err } };
    if (
      typeof strategy !== "string" &&
      Number.isSafeInteger(strategy.lastValidBlockHeight)
    ) {
      const height = await connection.getBlockHeight(commitment);
      if (height > strategy.lastValidBlockHeight)
        throw new TransactionExpiredBlockheightExceededError(signature);
    }
    await delay(1500);
  }
  throw new TransactionExpiredTimeoutError(signature, timeout / 1000);
}

export class UatConnection extends Connection {
  constructor(endpoint) {
    super(endpoint, {
      commitment: "confirmed",
      disableRetryOnRateLimit: true,
      wsEndpoint: "wss://api.devnet.solana.com/",
      fetchMiddleware: (_url, init, next) => next("/api/solana", init),
    });
    this.usesHttpPolling = true;
  }

  confirmTransaction(strategy, commitment) {
    return pollTransaction(this, strategy, commitment ?? this.commitment);
  }
}

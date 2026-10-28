import { AnchorProvider, Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import idl from "./idl.js";
import {
  getConfigPda,
  getVaultPda,
  getTicketPda,
  getResultPda,
  u64LeBytes,
  i64LeBytes,
} from "./pdas.js";
import { getNextDrawTime } from "./time.js";
import { MIN_NUMBER, MAX_NUMBER, PICK_COUNT } from "./rules.js";

export const UAT_ADMIN = "2txjN4S6WEiDDT8R3QvGFgwZrchQ8k5kBXRhbYFX1eSz";

function validateNumbers(numbers, minimum = MIN_NUMBER) {
  if (
    !Array.isArray(numbers) ||
    numbers.length !== PICK_COUNT ||
    numbers.some(
      (number) =>
        !Number.isInteger(number) || number < minimum || number > MAX_NUMBER,
    ) ||
    numbers[0] === numbers[1]
  )
    throw new TypeError(
      `Choose two different numbers from ${minimum} to ${MAX_NUMBER}.`,
    );
}

function createNonce() {
  const words = new Uint32Array(2);
  globalThis.crypto.getRandomValues(words);
  return ((BigInt(words[0]) << 32n) | BigInt(words[1])).toString();
}

function purchaseStorage() {
  if (typeof window === "undefined") return null;
  return {
    getItem(key) {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      window.localStorage.setItem(key, value);
    },
    removeItem(key) {
      window.localStorage.removeItem(key);
    },
  };
}

export class DodosClient {
  constructor({
    connection,
    wallet = null,
    program,
    now = Date.now,
    nonceFactory = createNonce,
    storage = purchaseStorage(),
  } = {}) {
    if (!program && !connection)
      throw new TypeError("A Solana connection is required.");
    this.wallet = wallet;
    this.now = now;
    this.nonceFactory = nonceFactory;
    this.storage = storage;
    this.pendingPurchase = null;
    const canSign =
      wallet?.publicKey && wallet.signTransaction && wallet.signAllTransactions;
    this.program =
      program ??
      new Program(
        idl,
        canSign
          ? new AnchorProvider(connection, wallet, {
              commitment: "confirmed",
              preflightCommitment: "confirmed",
            })
          : { connection },
      );
    this.purchaseKey = wallet?.publicKey
      ? `hiperia:purchase:${this.program.programId.toBase58()}:${wallet.publicKey.toBase58()}:${connection?.rpcEndpoint ?? "local"}`
      : null;
    if (this.purchaseKey && storage) {
      const saved = storage.getItem(this.purchaseKey);
      if (saved) {
        const pending = JSON.parse(saved);
        validateNumbers(pending.numbers, 1);
        u64LeBytes(pending.id);
        i64LeBytes(pending.drawTime);
        this.pendingPurchase = pending;
      }
    }
  }

  getPendingPurchase() {
    return this.pendingPurchase
      ? { ...this.pendingPurchase, numbers: [...this.pendingPurchase.numbers] }
      : null;
  }

  rememberPurchase(ticket) {
    if (this.purchaseKey && this.storage)
      this.storage.setItem(this.purchaseKey, JSON.stringify(ticket));
    this.pendingPurchase = ticket;
  }

  completePurchase() {
    this.pendingPurchase = null;
    if (this.purchaseKey && this.storage) {
      try {
        this.storage.removeItem(this.purchaseKey);
      } catch {
        return;
      }
    }
  }

  async recoverPendingPurchase() {
    const pending = this.pendingPurchase;
    if (!pending) return null;
    const account = await this.getTicket(pending.id);
    if (!account) return null;
    const receipt = {
      id: pending.id,
      numbers: Array.from(account.numbers),
      drawTime: Number(account.drawTime.toString()),
      settled: account.settled,
      signature: null,
      recovered: true,
    };
    this.completePurchase();
    return receipt;
  }

  get configAddress() {
    return getConfigPda(this.program.programId)[0];
  }
  get vaultAddress() {
    return getVaultPda(this.program.programId)[0];
  }

  async getConfig() {
    const config = await this.program.account.config.fetchNullable(
      this.configAddress,
    );
    if (!config) return null;
    const uatEnabled = Boolean(config.padding?.some((byte) => byte !== 0));
    return {
      ...config,
      uatEnabled,
      uatTester: uatEnabled ? new PublicKey(config.padding).toBase58() : null,
      uatAdmin: UAT_ADMIN,
    };
  }

  async getTicket(nonce) {
    return this.program.account.ticket.fetchNullable(
      getTicketPda(this.wallet.publicKey, nonce, this.program.programId)[0],
    );
  }

  async getResult(drawTime) {
    return this.program.account.resultAccount.fetchNullable(
      getResultPda(drawTime, this.program.programId)[0],
    );
  }

  async getTickets(config) {
    if (!this.wallet?.publicKey) return [];
    const activeConfig = config ?? (await this.getConfig());
    const entries = await this.program.account.ticket.all([
      { memcmp: { offset: 8, bytes: this.wallet.publicKey.toBase58() } },
    ]);
    const draws = [
      ...new Set(entries.map(({ account }) => account.drawTime.toString())),
    ];
    const outcomes = new Map();
    for (let offset = 0; offset < draws.length; offset += 20) {
      const batch = draws.slice(offset, offset + 20);
      const addresses = batch.map(
        (time) => getResultPda(time, this.program.programId)[0],
      );
      const results =
        await this.program.account.resultAccount.fetchMultiple(addresses);
      results.forEach((result, index) => {
        if (result?.isPublished)
          outcomes.set(batch[index], {
            id: addresses[index].toBase58(),
            numbers: Array.from(result.numbers),
            isPublished: true,
          });
      });
    }
    return entries
      .map(({ publicKey, account }) => ({
        id: account.nonce.toString(),
        address: publicKey.toBase58(),
        numbers: Array.from(account.numbers),
        drawTime: Number(account.drawTime.toString()),
        settled: account.settled,
        paidLamports: Number(account.paidLamports.toString()),
        payoutLamports:
          account.padding?.[0] === 2
            ? Number(
                new BN(
                  Array.from(account.padding).slice(1, 9),
                  "le",
                ).toString(),
              )
            : activeConfig?.payoutLamports
              ? Number(activeConfig.payoutLamports.toString())
              : null,
        result: outcomes.get(account.drawTime.toString()) ?? null,
      }))
      .sort((first, second) => second.drawTime - first.drawTime);
  }

  async getResults() {
    const entries = await this.program.account.resultAccount.all();
    return entries
      .filter(({ account }) => account.isPublished)
      .map(({ publicKey, account }) => ({
        id: publicKey.toBase58(),
        drawTime: Number(account.drawTime.toString()),
        numbers: Array.from(account.numbers),
      }))
      .sort((first, second) => second.drawTime - first.drawTime);
  }

  async getRecentResults(limit = 3) {
    return (await this.getResults()).slice(0, limit);
  }

  requireSigner() {
    if (
      !this.wallet?.publicKey ||
      !this.wallet.signTransaction ||
      !this.wallet.signAllTransactions
    ) {
      throw new Error("Connect a wallet that can sign transactions.");
    }
  }

  async initialize(
    ticketCostLamports = 7_200_000,
    payoutLamports = 1_000_000_000,
  ) {
    this.requireSigner();
    if (await this.getConfig()) return null;
    return this.program.methods
      .initialize(new BN(ticketCostLamports), new BN(payoutLamports))
      .accountsStrict({
        config: this.configAddress,
        vault: this.vaultAddress,
        payer: this.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  async configureUat(tester) {
    this.requireSigner();
    if (this.wallet.publicKey.toBase58() !== UAT_ADMIN)
      throw new Error("Only the UAT administrator can change the test wallet.");
    const testerKey = new PublicKey(tester);
    if (testerKey.equals(SystemProgram.programId))
      throw new Error("Choose a valid UAT test wallet.");
    return this.program.methods
      .configureUat(testerKey)
      .accountsStrict({
        config: this.configAddress,
        admin: this.wallet.publicKey,
      })
      .rpc();
  }

  async buyTicket(numbers, options = {}) {
    this.requireSigner();
    const recovered = await this.recoverPendingPurchase();
    if (recovered) return recovered;
    validateNumbers(numbers);
    const selection = [...numbers];
    const now = this.now();
    const drawTime = options.drawTime ?? getNextDrawTime(now);
    const nonce =
      this.pendingPurchase?.id ?? options.nonce ?? this.nonceFactory();
    u64LeBytes(nonce);
    i64LeBytes(drawTime);
    if (
      !Number.isSafeInteger(Number(drawTime)) ||
      Number(drawTime) <= Math.floor(now / 1000) ||
      Number(drawTime) > Math.floor(now / 1000) + 86_400
    )
      throw new RangeError("Choose a future draw within 24 hours.");
    const user = this.wallet.publicKey;
    this.rememberPurchase({
      id: String(nonce),
      numbers: selection,
      drawTime: Number(drawTime),
    });
    let signature;
    try {
      signature = await this.program.methods
        .buyTicket(new BN(String(nonce)), new BN(String(drawTime)), selection)
        .accountsStrict({
          config: this.configAddress,
          vault: this.vaultAddress,
          ticket: getTicketPda(user, nonce, this.program.programId)[0],
          user,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch (failure) {
      let receipt = null;
      try {
        receipt = await this.recoverPendingPurchase();
      } catch {
        receipt = null;
      }
      if (receipt) return receipt;
      throw new Error(
        `${failure.message || "Purchase confirmation unavailable."} Refresh to check the ticket. A retry will reuse the same purchase ID.`,
        { cause: failure },
      );
    }
    this.completePurchase();
    return {
      id: String(nonce),
      numbers: selection,
      drawTime: Number(drawTime),
      signature,
      settled: false,
    };
  }

  async publishResult(drawTime) {
    this.requireSigner();
    if (Number(drawTime) > Math.floor(this.now() / 1000))
      throw new Error("The draw has not started yet.");
    const existing = await this.getResult(drawTime);
    if (existing?.isPublished) return null;
    return this.program.methods
      .publishResult(new BN(String(drawTime)))
      .accountsStrict({
        config: this.configAddress,
        vault: this.vaultAddress,
        result: getResultPda(drawTime, this.program.programId)[0],
        payer: this.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  async checkTicket(ticket) {
    validateNumbers(ticket.numbers, 1);
    const result = await this.getResult(ticket.drawTime);
    if (!result?.isPublished) return { status: "pending", numbers: null };
    const numbers = Array.from(result.numbers);
    return {
      status: ticket.numbers.every((number, index) => number === numbers[index])
        ? "won"
        : "lost",
      numbers,
    };
  }

  async settleTicket(ticket) {
    this.requireSigner();
    const user = this.wallet.publicKey;
    return this.program.methods
      .settleTicket()
      .accountsStrict({
        config: this.configAddress,
        vault: this.vaultAddress,
        ticket: getTicketPda(user, ticket.id, this.program.programId)[0],
        result: getResultPda(ticket.drawTime, this.program.programId)[0],
        user,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }
}

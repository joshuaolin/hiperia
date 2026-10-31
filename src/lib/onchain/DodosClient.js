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
import { loadAccessRules, loadChainRules } from "./chainRules.js";
import { sendSettlementBatches } from "./settlements.js";
import { ReferralClient } from "./ReferralClient.js";

export const UAT_ADMIN = "2txjN4S6WEiDDT8R3QvGFgwZrchQ8k5kBXRhbYFX1eSz";

function resultMetadata(padding) {
  const unknown = {
    drawType: null,
    payoutLamports: null,
    ticketCostLamports: null,
  };
  if (
    padding?.length !== 32 ||
    padding[0] !== 1 ||
    ![0, 1].includes(padding[1]) ||
    Array.from(padding)
      .slice(18)
      .some((byte) => byte !== 0)
  )
    return unknown;
  const payout = new BN(Array.from(padding).slice(2, 10), "le");
  const cost = new BN(Array.from(padding).slice(10, 18), "le");
  const maximum = new BN(String(Number.MAX_SAFE_INTEGER));
  if (
    payout.lte(new BN(0)) ||
    cost.lte(new BN(0)) ||
    payout.gt(maximum) ||
    cost.gt(maximum)
  )
    return unknown;
  return {
    drawType: padding[1] === 1 ? "daily" : "quick",
    payoutLamports: payout.toNumber(),
    ticketCostLamports: cost.toNumber(),
  };
}

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
    rulesLoader = loadChainRules,
    accessRulesLoader = loadAccessRules,
    referralRulesLoader,
  } = {}) {
    if (!program && !connection)
      throw new TypeError("A Solana connection is required.");
    this.wallet = wallet;
    this.now = now;
    this.nonceFactory = nonceFactory;
    this.storage = storage;
    this.connection = connection ?? program?.provider?.connection;
    this.rulesLoader = rulesLoader;
    this.accessRulesLoader = accessRulesLoader;
    this.pendingPurchase = null;
    this.purchaseInFlight = false;
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
    this.referrals = new ReferralClient({
      program: this.program,
      wallet,
      connection: this.connection,
      payer: new PublicKey(UAT_ADMIN),
      now,
      rulesLoader: referralRulesLoader,
    });
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
        try {
          this.storage.setItem(this.purchaseKey, "");
        } catch {
          return;
        }
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
    const configured = Boolean(config.padding?.some((byte) => byte !== 0));
    const [rules, accessRules] = configured
      ? await Promise.all([this.getRules(), this.getAccessRules()])
      : [null, null];
    if (
      rules &&
      (!config.ticketCostLamports?.eq(rules.quickTicketCostLamports) ||
        !config.payoutLamports?.eq(rules.quickPayoutLamports))
    )
      throw new Error(
        "The on-chain UAT prices do not match the configured contract. Purchases are paused until the configuration is verified.",
      );
    return {
      ...config,
      ...(rules ?? {}),
      rulesRevision: rules?.revision ?? null,
      permissionlessSettlement: [4, 5].includes(rules?.revision),
      accessRulesRevision: accessRules?.revision ?? null,
      publicPlayEnabled: accessRules?.publicPlayEnabled === true,
      publicResultsEnabled: accessRules?.publicResultsEnabled === true,
      uatEnabled: Boolean(configured && rules),
      uatTester: configured ? new PublicKey(config.padding).toBase58() : null,
      uatAdmin: UAT_ADMIN,
    };
  }

  async getRules({ fresh = false } = {}) {
    return this.rulesLoader({
      connection: this.connection,
      program: this.program,
      configAddress: this.configAddress,
      payer: new PublicKey(UAT_ADMIN),
      now: this.now,
      fresh,
    });
  }

  async getAccessRules({ fresh = false } = {}) {
    return this.accessRulesLoader({
      connection: this.connection,
      program: this.program,
      configAddress: this.configAddress,
      payer: new PublicKey(UAT_ADMIN),
      now: this.now,
      fresh,
    });
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
            ...resultMetadata(result.padding),
          });
      });
    }
    return entries
      .map(({ publicKey, account }) => ({
        id: account.nonce.toString(),
        address: publicKey.toBase58(),
        user: account.user.toBase58(),
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
        ...resultMetadata(account.padding),
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
    if (this.purchaseInFlight)
      throw new Error(
        "A purchase is already waiting for your wallet or confirmation. Wait before buying another ticket.",
      );
    this.purchaseInFlight = true;
    try {
      return await this.submitPurchase(numbers, options);
    } finally {
      this.purchaseInFlight = false;
    }
  }

  async submitPurchase(numbers, options) {
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
    const config = options.config ?? (await this.getConfig());
    const referral =
      options.useReferrals !== false &&
      (await this.referrals.purchaseRules(config))
        ? await this.referrals.preparePurchase()
        : null;
    this.rememberPurchase({
      id: String(nonce),
      numbers: selection,
      drawTime: Number(drawTime),
    });
    let signature;
    try {
      const method = referral ? "buyTicketReferred" : "buyTicket";
      const builder = this.program.methods[method](
        new BN(String(nonce)),
        new BN(String(drawTime)),
        selection,
      ).accountsStrict({
        config: this.configAddress,
        vault: this.vaultAddress,
        ticket: getTicketPda(user, nonce, this.program.programId)[0],
        user,
        systemProgram: SystemProgram.programId,
        ...(referral
          ? {
              profile: referral.profile,
              referrerProfile: referral.referrerProfile,
            }
          : {}),
      });
      signature = referral
        ? await this.referrals.send([
            ...referral.instructions,
            await builder.instruction(),
          ])
        : await builder.rpc({ maxRetries: 0 });
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
    const user = ticket.user
      ? new PublicKey(ticket.user)
      : this.wallet.publicKey;
    const qualifications = await this.settlementQualifications([
      { ...ticket, user: user.toBase58() },
    ]);
    const qualifier = qualifications.values().next().value;
    if (qualifier)
      return this.referrals.send([
        await this.settleInstruction({ ...ticket, user: user.toBase58() }),
        qualifier,
      ]);
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

  async settleInstruction(ticket) {
    const user = new PublicKey(ticket.user);
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
      .instruction();
  }

  async settleBatch(tickets, { assertActive } = {}) {
    this.requireSigner();
    const qualifications = await this.settlementQualifications(tickets);
    return sendSettlementBatches({
      tickets,
      assertActive,
      batchSize: qualifications.size ? 3 : undefined,
      pendingTickets: async (batch) => {
        const accounts = await this.program.account.ticket.fetchMultiple(
          batch.map((ticket) => new PublicKey(ticket.address)),
        );
        return batch.filter((ticket, index) => {
          const account = accounts[index];
          return (
            account &&
            !account.settled &&
            account.user.toBase58() === ticket.user &&
            account.nonce.toString() === ticket.id &&
            Number(account.drawTime.toString()) === ticket.drawTime
          );
        });
      },
      instructionFor: async (ticket) => {
        const settlement = await this.settleInstruction(ticket);
        const qualifier = qualifications.get(ticket.address);
        return qualifier ? [settlement, qualifier] : [settlement];
      },
      send: (transaction) =>
        this.program.provider.sendAndConfirm(transaction, [], {
          commitment: "confirmed",
          preflightCommitment: "confirmed",
          maxRetries: 0,
        }),
    });
  }

  async settlementQualifications(tickets) {
    const instructions = new Map();
    if (
      !this.program.account.referralProfile ||
      !this.program.methods.qualifyReferral
    )
      return instructions;
    for (const owner of new Set(tickets.map((ticket) => ticket.user))) {
      if (!owner) continue;
      try {
        const profile = await this.referrals.getProfile(new PublicKey(owner));
        if (!profile?.firstTicket || profile.qualified || !profile.referrer)
          continue;
        const ticket = tickets.find(
          (entry) =>
            entry.user === owner &&
            (entry.address ??
              getTicketPda(
                owner,
                entry.id,
                this.program.programId,
              )[0].toBase58()) === profile.firstTicket,
        );
        if (!ticket) continue;
        const qualifier = await this.referrals.settlementQualification(
          ticket,
          profile,
        );
        if (qualifier) instructions.set(profile.firstTicket, qualifier);
      } catch {
        continue;
      }
    }
    return instructions;
  }

  async claimAll(options = {}) {
    this.requireSigner();
    const tickets = await this.getTickets();
    const due = Math.floor(this.now() / 1000);
    const wins = tickets.filter(
      (ticket) =>
        !ticket.settled &&
        ticket.drawTime <= due &&
        ticket.result?.isPublished &&
        ticket.numbers.every(
          (number, index) => number === ticket.result.numbers[index],
        ),
    );
    return this.settleBatch(wins, options);
  }

  async recordDraw(drawTime, options = {}) {
    this.requireSigner();
    const signature = await this.publishResult(drawTime);
    const config = await this.getConfig();
    if (!config?.permissionlessSettlement) return { signature, settled: 0 };
    const result = await this.getResult(drawTime);
    if (!result?.isPublished)
      throw new Error(
        "The draw record is not confirmed. Refresh before trying again.",
      );
    const entries = await this.program.account.ticket.all();
    const losses = entries
      .filter(
        ({ account }) =>
          !account.settled &&
          account.drawTime.toString() === String(drawTime) &&
          !Array.from(account.numbers).every(
            (number, index) => number === result.numbers[index],
          ),
      )
      .map(({ publicKey, account }) => ({
        address: publicKey.toBase58(),
        user: account.user.toBase58(),
        id: account.nonce.toString(),
        drawTime: Number(account.drawTime.toString()),
      }));
    const processed = await this.settleBatch(losses, options);
    return { signature, ...processed };
  }
}

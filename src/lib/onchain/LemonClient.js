import { AnchorProvider, Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import { Buffer } from "buffer";
import {
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import idl from "../../idl/hiperia_lemon.json" with { type: "json" };
import { VrfDodosClient } from "./VrfDodosClient.js";
import { UAT_ADMIN } from "./DodosClient.js";
import { ORAO_PROGRAM_ID } from "./vrfProtocol.js";
import {
  LEMON_PROGRAM_ID,
  LEMON_ACCOUNT_SIZES,
  LEMON_RULES_BYTES,
  validFruitNumbers,
  lemonNumbersFromRandomness,
  deriveLemonOracleSeed,
} from "./lemonProtocol.js";
import {
  isLemonDailyDrawTime,
  nextLemonDrawTime,
} from "../../games/lemon/lemonSchedule.js";

function amount(value) {
  const result = Number(value?.toString());
  if (!Number.isSafeInteger(result) || result < 0)
    throw new Error("The Lemon on-chain amount could not be verified.");
  return result;
}

function check(condition) {
  if (!condition)
    throw new Error(
      "The Lemon on-chain rules could not be verified. New purchases are paused.",
    );
}

export class LemonClient extends VrfDodosClient {
  constructor(options = {}) {
    const { connection, wallet } = options;
    const canSign =
      wallet?.publicKey && wallet.signTransaction && wallet.signAllTransactions;
    const program =
      options.program ??
      new Program(
        idl,
        canSign
          ? new AnchorProvider(connection, wallet, {
              commitment: "confirmed",
              preflightCommitment: "confirmed",
            })
          : { connection },
      );
    super({ ...options, program, accountSizes: LEMON_ACCOUNT_SIZES });
    check(program.programId.toBase58() === LEMON_PROGRAM_ID);
    this.metadata = new Map();
    this.drawRisk = { read: async () => null };
  }

  get expectedRulesRevision() {
    return 1;
  }

  isDailyDrawTime(timestamp) {
    return isLemonDailyDrawTime(timestamp);
  }
  validNumbers(numbers) {
    return validFruitNumbers(numbers);
  }
  validateSelection(numbers) {
    if (!validFruitNumbers(numbers))
      throw new TypeError(
        "Choose three fruit symbols in order. Repeats are allowed.",
      );
  }
  deriveOracleSeed(programId, drawAddress, nonce) {
    return deriveLemonOracleSeed(programId, drawAddress, nonce);
  }
  winningNumbersFromRandomness(randomness) {
    return lemonNumbersFromRandomness(randomness);
  }
  async getLiabilityRules() {
    return null;
  }

  async readMetadata(method, type, size, { fresh = false } = {}) {
    const previous = this.metadata.get(method);
    if (previous?.promise) return previous.promise;
    if (!fresh && previous?.until > this.now()) return previous.value;
    const entry = {};
    entry.promise = (async () => {
      const instruction = await this.program.methods[method]()
        .accountsStrict({ config: this.configAddress })
        .instruction();
      const transaction = new VersionedTransaction(
        new TransactionMessage({
          payerKey: new PublicKey(UAT_ADMIN),
          recentBlockhash: SystemProgram.programId.toBase58(),
          instructions: [instruction],
        }).compileToV0Message(),
      );
      const { value } = await this.connection.simulateTransaction(transaction, {
        sigVerify: false,
        replaceRecentBlockhash: true,
        commitment: "confirmed",
      });
      const data = value?.returnData?.data;
      check(
        value?.err === null &&
          value.returnData?.programId === LEMON_PROGRAM_ID &&
          Array.isArray(data) &&
          data.length === 2 &&
          data[1] === "base64",
      );
      const bytes = Buffer.from(data[0], "base64");
      check(bytes.length === size && bytes.toString("base64") === data[0]);
      return { decoded: this.program.coder.types.decode(type, bytes), bytes };
    })();
    this.metadata.set(method, entry);
    try {
      entry.value = await entry.promise;
      entry.until = this.now() + 30_000;
      return entry.value;
    } catch (error) {
      this.metadata.delete(method);
      throw error;
    } finally {
      entry.promise = null;
    }
  }

  async getRules(options) {
    const { decoded: rules, bytes } = await this.readMetadata(
      "getRules",
      "lemonRules",
      LEMON_RULES_BYTES,
      options,
    );
    check(
      rules.revision === 1 &&
        rules.minNumber === 0 &&
        rules.maxNumber === 9 &&
        rules.pickCount === 3 &&
        rules.repeatsAllowed === true &&
        rules.ordered === true &&
        bytes[4] === 1 &&
        bytes[5] === 1 &&
        rules.outcomeCount === 1000,
    );
    check(
      Array.from(rules.dailyHours).join(",") === "3,7,11,15,19,23" &&
        rules.scheduleIntervalSeconds === 14_400 &&
        rules.scheduleOffsetSeconds === 10800 &&
        rules.buyAheadSeconds === 86_400,
    );
    for (const key of [
      "quickTicketCostLamports",
      "dailyTicketCostLamports",
      "quickPayoutLamports",
      "dailyPayoutLamports",
    ])
      check(BN.isBN(rules[key]) && amount(rules[key]) > 0);
    return rules;
  }

  async getRandomnessRules(options) {
    const { decoded: rules } = await this.readMetadata(
      "getRandomnessRules",
      "randomnessRules",
      39,
      options,
    );
    check(
      rules.revision === 1 &&
        rules.oracleProgram.toBase58() === ORAO_PROGRAM_ID &&
        rules.refundAfterSeconds === 86_400 &&
        rules.pendingRequestSpace === 749,
    );
    return { ...rules, oracleProgram: ORAO_PROGRAM_ID };
  }

  async getBankrollRules(options) {
    const { decoded: rules, bytes } = await this.readMetadata(
      "getBankrollRules",
      "bankrollRules",
      9,
      options,
    );
    check(
      rules.revision === 1 &&
        [1, 2, 3, 5].every((index) => bytes[index] === 1) &&
        bytes[4] === 0 &&
        rules.ticketVersion === 4 &&
        rules.ledgerAccountSpace === 50,
    );
    return rules;
  }

  async getConfig() {
    const account = await this.program.account.config.fetchNullable(
      this.configAddress,
    );
    if (!account?.isInitialized) return null;
    const [rules, randomnessRules, bankrollRules, access] = await Promise.all([
      this.getRules(),
      this.getRandomnessRules(),
      this.getBankrollRules(),
      this.readMetadata("getAccessRules", "accessRules", 3),
    ]);
    check(
      access.bytes.equals(Buffer.from([1, 1, 1])) &&
        account.ticketCostLamports.eq(rules.quickTicketCostLamports) &&
        account.payoutLamports.eq(rules.quickPayoutLamports) &&
        new PublicKey(account.padding).toBase58() === UAT_ADMIN,
    );
    const capacity = await this.getCapacity(rules);
    return {
      ...account,
      ...rules,
      revision: 1,
      rulesRevision: 1,
      verified: true,
      uatEnabled: true,
      publicPlayEnabled: true,
      publicResultsEnabled: true,
      permissionlessSettlement: true,
      randomnessVerified: true,
      randomnessMode: "orao-vrf",
      randomnessRules,
      bankrollRules,
      sourceProgram: LEMON_PROGRAM_ID,
      programId: LEMON_PROGRAM_ID,
      vaultAddress: this.vaultAddress.toBase58(),
      outcomes: rules.outcomeCount,
      entryLamports: amount(rules.dailyTicketCostLamports),
      prizeLamports: amount(rules.dailyPayoutLamports),
      quickEntryLamports: amount(rules.quickTicketCostLamports),
      quickPrizeLamports: amount(rules.quickPayoutLamports),
      capacity: { ...capacity, dailySlots: null, quickSlots: null },
    };
  }

  async getPurchaseQuote(numbers, { drawTime, config } = {}) {
    this.validateSelection(numbers);
    if (Number(drawTime) % 14_400 === 7200)
      throw new Error(
        "This former Lemon daily slot is closed to new entries. Choose a current daily draw or a fresh Quick draw.",
      );
    const active = config ?? (await this.getConfig());
    check(
      active?.verified &&
        active?.bankrollRules?.ticketVersion === 4 &&
        active.randomnessVerified,
    );
    const quote = await this.bankroll.quote(numbers, {
      drawTime,
      config: active,
      quick: !this.isDailyDrawTime(Number(drawTime)),
    });
    return {
      ...quote,
      isReady: quote.canPurchase,
      oracleFeeLamports: null,
      totalLamports: quote.entryLamports + quote.accountRentLamports,
      issuedAt: this.now(),
      validUntil: this.now() + 30_000,
      walletAddress: this.wallet?.publicKey?.toBase58(),
      sourceProgram: LEMON_PROGRAM_ID,
    };
  }

  assertPurchaseQuote(fresh, { quote: approved } = {}) {
    if (
      !approved ||
      approved.sourceProgram !== LEMON_PROGRAM_ID ||
      approved.walletAddress !== this.wallet?.publicKey?.toBase58() ||
      approved.validUntil <= this.now() ||
      approved.drawTime !== fresh.drawTime ||
      approved.numbers?.join(",") !== fresh.numbers.join(",") ||
      approved.entryLamports !== fresh.entryLamports ||
      approved.prizeLamports !== fresh.prizeLamports ||
      fresh.totalLamports > approved.totalLamports
    )
      throw new Error(
        "Your Lemon entry quote changed or expired. Review the current costs before buying.",
      );
  }

  async submitPurchase(numbers, options = {}) {
    const recovered = await this.recoverPendingPurchase();
    if (recovered) return recovered;
    this.validateSelection(numbers);
    return super.submitPurchase(numbers, {
      ...options,
      drawTime: options.drawTime ?? nextLemonDrawTime(this.now()),
      config: await this.getConfig(),
    });
  }

  async quoteOracleRequest(drawTime) {
    const account = await this.getDraw(drawTime);
    if (!account) throw new Error("This draw is not recorded on-chain.");
    const draw = await this.inspectDraw(account);
    if (draw.oracleReadError)
      throw new Error(
        "The oracle request is temporarily unavailable. Refresh before continuing.",
      );
    const quote =
      draw.status === "open"
        ? await this.getOracleQuote()
        : {
            feeLamports: 0,
            pendingRentLamports: 0,
            clientRentLamports: 0,
            totalLamports: 0,
          };
    return {
      ...quote,
      rentLamports: quote.pendingRentLamports + quote.clientRentLamports,
      drawTime: Number(drawTime),
      requiresPayment: draw.status === "open",
      drawStatus: draw.status,
      draw,
      walletAddress: this.wallet?.publicKey?.toBase58(),
      sourceProgram: LEMON_PROGRAM_ID,
      validUntil: this.now() + 30_000,
    };
  }

  assertOracleQuote(fresh, { quote: approved, drawTime } = {}) {
    if (
      !approved ||
      !approved.requiresPayment ||
      approved.drawTime !== drawTime ||
      approved.walletAddress !== this.wallet?.publicKey?.toBase58() ||
      approved.sourceProgram !== LEMON_PROGRAM_ID ||
      approved.validUntil <= this.now() ||
      fresh.totalLamports > approved.totalLamports ||
      fresh.feeLamports > approved.feeLamports ||
      fresh.treasury !== approved.treasury ||
      fresh.oracleProgram !== approved.oracleProgram ||
      fresh.networkAddress !== approved.networkAddress
    )
      throw new Error(
        "The Lemon oracle quote changed or expired. Review reveal costs again before signing.",
      );
  }

  async initialize(ticketCostLamports, payoutLamports) {
    if (ticketCostLamports == null || payoutLamports == null)
      throw new Error(
        "Explicit verified Lemon initialization amounts are required.",
      );
    await this.assertDevnet();
    return super.initialize(ticketCostLamports, payoutLamports);
  }
}

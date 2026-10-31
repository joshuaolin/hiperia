import { AnchorProvider, Program, utils } from "@coral-xyz/anchor";
import BN from "bn.js";
import { Buffer } from "buffer";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import vrfIdl from "../../idl/hiperia_vrf.json" with { type: "json" };
import { DodosClient, UAT_ADMIN } from "./DodosClient.js";
import { loadRandomnessRules } from "./chainRules.js";
import {
  getDrawPda,
  getOracleClientPda,
  getOracleRequestPda,
  getTicketPda,
  u64LeBytes,
  i64LeBytes,
} from "./pdas.js";
import { getNextDrawTime } from "./time.js";
import { MIN_NUMBER, MAX_NUMBER, PICK_COUNT } from "./rules.js";
import { DEVNET_GENESIS_HASH } from "../network.js";
import { OracleClient, deriveOracleSeed } from "./OracleClient.js";
import { winningNumbersFromRandomness } from "./vrfRandomness.js";

const emptyKey = SystemProgram.programId.toBase58();

function transactionPacketBytes(transaction, payer) {
  const estimate = new Transaction({
    feePayer: new PublicKey(payer),
    recentBlockhash: emptyKey,
  }).add(...transaction.instructions);
  try {
    return estimate.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }).length;
  } catch {
    return Infinity;
  }
}

function amount(value) {
  const integer = BigInt(value.toString());
  if (integer < 0n || integer > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("An on-chain amount exceeds the supported range.");
  return Number(integer);
}

function validNumbers(numbers) {
  return (
    Array.isArray(numbers) &&
    numbers.length === PICK_COUNT &&
    numbers.every(
      (number) =>
        Number.isInteger(number) &&
        number >= MIN_NUMBER &&
        number <= MAX_NUMBER,
    ) &&
    numbers[0] !== numbers[1]
  );
}

export class VrfDodosClient extends DodosClient {
  constructor(options = {}) {
    const { connection, wallet } = options;
    const canSign =
      wallet?.publicKey && wallet.signTransaction && wallet.signAllTransactions;
    const program =
      options.program ??
      new Program(
        vrfIdl,
        canSign
          ? new AnchorProvider(connection, wallet, {
              commitment: "confirmed",
              preflightCommitment: "confirmed",
            })
          : { connection },
      );
    super({ ...options, program });
    this.randomnessRulesLoader =
      options.randomnessRulesLoader ?? loadRandomnessRules;
    this.oracle =
      options.oracle ?? new OracleClient({ connection: this.connection });
    this.oracleNonces = new Map();
    this.oracleNonceFactory =
      options.oracleNonceFactory ??
      (() => globalThis.crypto.getRandomValues(new Uint8Array(32)));
    this.delay =
      options.delay ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async assertDevnet() {
    if ((await this.connection.getGenesisHash()) !== DEVNET_GENESIS_HASH)
      throw new Error(
        "This public demo requires Solana Devnet. No transaction was sent.",
      );
  }

  async getRandomnessRules({ fresh = false } = {}) {
    return this.randomnessRulesLoader({
      connection: this.connection,
      program: this.program,
      configAddress: this.configAddress,
      payer: new PublicKey(UAT_ADMIN),
      now: this.now,
      fresh,
    });
  }

  async getConfig() {
    const config = await super.getConfig();
    if (!config) return null;
    const [randomnessRules, capacity] = await Promise.all([
      this.getRandomnessRules(),
      this.getCapacity(config),
    ]);
    if (
      config.rulesRevision !== 6 ||
      !config.publicPlayEnabled ||
      !config.publicResultsEnabled
    )
      throw new Error("The public VRF game rules could not be verified.");
    return {
      ...config,
      randomnessRules,
      capacity,
      permissionlessSettlement: true,
      randomnessMode: "orao-vrf",
      randomnessVerified: true,
      legacy: false,
      sourceProgram: this.program.programId.toBase58(),
    };
  }

  async getCapacity(config) {
    const account = await this.connection.getAccountInfo(
      this.vaultAddress,
      "confirmed",
    );
    const bytes = account?.data;
    const discriminator = this.program.idl.accounts.find(
      (entry) => entry.name.toLowerCase() === "vault",
    )?.discriminator;
    if (
      !account?.owner.equals(this.program.programId) ||
      !bytes ||
      bytes.length !== 41 ||
      !bytes.subarray(0, 8).equals(Buffer.from(discriminator ?? [])) ||
      bytes.subarray(17).some((byte) => byte !== 0)
    )
      throw new Error("The on-chain prize reserve could not be verified.");
    const rentLamports =
      await this.connection.getMinimumBalanceForRentExemption(
        bytes.length,
        "confirmed",
      );
    const reservedLamports = amount(bytes.readBigUInt64LE(9));
    const vaultLamports = amount(account.lamports);
    const freeLamports = Math.max(
      0,
      vaultLamports - rentLamports - reservedLamports,
    );
    const slots = (prize, price) => {
      const backing = amount(prize) - amount(price);
      return backing > 0 ? Math.floor(freeLamports / backing) : null;
    };
    return {
      vaultLamports,
      balanceLamports: vaultLamports,
      reservedLamports,
      rentLamports,
      freeLamports,
      dailySlots: slots(
        config.dailyPayoutLamports,
        config.dailyTicketCostLamports,
      ),
      quickSlots: slots(
        config.quickPayoutLamports,
        config.quickTicketCostLamports,
      ),
    };
  }

  async getDraw(drawTime) {
    return this.program.account.draw.fetchNullable(
      getDrawPda(drawTime, this.program.programId)[0],
    );
  }

  drawRecord(account, address) {
    const drawTime = amount(account.drawTime);
    const expected = getDrawPda(drawTime, this.program.programId)[0];
    if (
      (address && !expected.equals(new PublicKey(address))) ||
      ![0, 1, 2].includes(account.status)
    )
      throw new Error("The on-chain draw record could not be verified.");
    const final = account.status === 2;
    const numbers = Array.from(account.numbers);
    if (final && !validNumbers(numbers))
      throw new Error("The recorded draw numbers are invalid.");
    if (
      account.status !== 0 &&
      (!account.oracleClient.equals(
        getOracleClientPda(drawTime, this.program.programId)[0],
      ) ||
        !account.oracleRequest.equals(
          getOracleRequestPda(account.seed, this.oracle.programId)[0],
        ))
    )
      throw new Error("The recorded oracle accounts do not match this draw.");
    return {
      address: expected.toBase58(),
      drawTime,
      status: ["open", "pending", "final"][account.status],
      seed: Array.from(account.seed),
      oracleRequest:
        account.oracleRequest.toBase58() === emptyKey
          ? null
          : account.oracleRequest.toBase58(),
      oracleClient:
        account.oracleClient.toBase58() === emptyKey
          ? null
          : account.oracleClient.toBase58(),
      requestedBy:
        account.requestedBy.toBase58() === emptyKey
          ? null
          : account.requestedBy.toBase58(),
      requestedAt: amount(account.requestedAt),
      numbers: final ? numbers : null,
      drawType: account.isDaily ? "daily" : "quick",
      ticketCount: account.ticketCount.toString(),
      ticketCostLamports: amount(account.ticketCostLamports),
      payoutLamports: amount(account.payoutLamports),
    };
  }

  async inspectDraw(account, address) {
    const draw = this.drawRecord(account, address);
    if (draw.status !== "pending") return draw;
    try {
      const proof = await this.oracle.readRequest({
        seed: draw.seed,
        client: draw.oracleClient,
        address: draw.oracleRequest,
      });
      if (proof.status === "fulfilled") draw.status = "fulfilled";
      draw.oracleReadError = proof.status === "missing";
    } catch {
      draw.oracleReadError = true;
    }
    return draw;
  }

  resultRecord(draw) {
    if (draw.status !== "final") return null;
    return {
      ...draw,
      id: draw.address,
      isPublished: true,
      sourceProgram: this.program.programId.toBase58(),
      legacy: false,
      randomnessMode: "orao-vrf",
      oracleProgram: this.oracle.programId.toBase58(),
    };
  }

  async getResult(drawTime) {
    const account = await this.getDraw(drawTime);
    return account ? this.resultRecord(this.drawRecord(account)) : null;
  }

  async getTickets(config) {
    if (!this.wallet?.publicKey) return [];
    const entries = await this.program.account.ticket.all([
      { memcmp: { offset: 8, bytes: this.wallet.publicKey.toBase58() } },
    ]);
    const times = [
      ...new Set(entries.map(({ account }) => account.drawTime.toString())),
    ];
    const draws = new Map();
    for (let offset = 0; offset < times.length; offset += 20) {
      const batch = times.slice(offset, offset + 20);
      const addresses = batch.map(
        (time) => getDrawPda(time, this.program.programId)[0],
      );
      const records = await this.program.account.draw.fetchMultiple(addresses);
      for (let index = 0; index < records.length; index++) {
        if (records[index])
          draws.set(
            batch[index],
            await this.inspectDraw(records[index], addresses[index]),
          );
      }
    }
    const rules =
      config?.randomnessRules ??
      (await this.getRandomnessRules().catch(() => null));
    const now = Math.floor(this.now() / 1000);
    return entries
      .map(({ publicKey, account }) => {
        const drawTime = amount(account.drawTime);
        const draw = draws.get(account.drawTime.toString()) ?? null;
        const snapshot = Buffer.from(account.padding);
        if (snapshot[0] !== 2)
          throw new Error("The ticket prize snapshot could not be verified.");
        return {
          id: account.nonce.toString(),
          address: publicKey.toBase58(),
          user: account.user.toBase58(),
          numbers: Array.from(account.numbers),
          drawTime,
          settled: account.settled,
          refunded: snapshot[9] === 1,
          paidLamports: amount(account.paidLamports),
          payoutLamports: amount(snapshot.readBigUInt64LE(1)),
          sourceProgram: this.program.programId.toBase58(),
          legacy: false,
          draw,
          refundEligible: Boolean(
            rules &&
              !account.settled &&
              draw &&
              ["open", "pending"].includes(draw.status) &&
              !draw.oracleReadError &&
              now >= drawTime + rules.refundAfterSeconds,
          ),
          result: draw ? this.resultRecord(draw) : null,
        };
      })
      .sort((first, second) => second.drawTime - first.drawTime);
  }

  async getResults() {
    const entries = await this.program.account.draw.all();
    return entries
      .filter(({ account }) => account.status === 2)
      .map(({ publicKey, account }) =>
        this.resultRecord(this.drawRecord(account, publicKey)),
      )
      .sort((first, second) => second.drawTime - first.drawTime);
  }

  async submitPurchase(numbers, options) {
    this.requireSigner();
    const recovered = await this.recoverPendingPurchase();
    if (recovered) return recovered;
    if (!validNumbers(numbers))
      throw new TypeError(
        `Choose two different numbers from ${MIN_NUMBER} to ${MAX_NUMBER}.`,
      );
    const selection = [...numbers];
    const seconds = Math.floor(this.now() / 1000);
    const drawTime = options.drawTime ?? getNextDrawTime(this.now());
    const nonce =
      this.pendingPurchase?.id ?? options.nonce ?? this.nonceFactory();
    u64LeBytes(nonce);
    i64LeBytes(drawTime);
    if (
      !Number.isSafeInteger(Number(drawTime)) ||
      Number(drawTime) <= seconds ||
      Number(drawTime) > seconds + 86_400
    )
      throw new RangeError("Choose a future draw within 24 hours.");
    const config = options.config ?? (await this.getConfig());
    if (!config?.randomnessVerified || config.rulesRevision !== 6)
      throw new Error(
        "Wait for the verified public VRF game rules before purchasing.",
      );
    this.rememberPurchase({
      id: String(nonce),
      numbers: selection,
      drawTime: Number(drawTime),
    });
    try {
      await this.assertDevnet();
      options.assertActive?.();
      const signature = await this.program.methods
        .buyTicket(new BN(String(nonce)), new BN(String(drawTime)), selection)
        .accountsStrict({
          config: this.configAddress,
          vault: this.vaultAddress,
          ticket: getTicketPda(
            this.wallet.publicKey,
            nonce,
            this.program.programId,
          )[0],
          user: this.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          draw: getDrawPda(drawTime, this.program.programId)[0],
        })
        .rpc({ maxRetries: 0 });
      this.completePurchase();
      return {
        id: String(nonce),
        numbers: selection,
        drawTime: Number(drawTime),
        signature,
        settled: false,
        sourceProgram: this.program.programId.toBase58(),
        legacy: false,
      };
    } catch (cause) {
      let receipt;
      try {
        receipt = await this.recoverPendingPurchase();
      } catch {
        receipt = null;
      }
      if (receipt) return receipt;
      throw new Error(
        `${cause.message || "Purchase confirmation unavailable."} Refresh to check the ticket. A retry will reuse the same purchase ID.`,
        { cause },
      );
    }
  }

  async getOracleQuote() {
    const rules = await this.getRandomnessRules();
    return this.oracle.quote(rules.pendingRequestSpace);
  }

  requestStorageKey(drawTime) {
    return `${this.purchaseKey ?? `hiperia:${this.program.programId.toBase58()}`}:oracle:${drawTime}`;
  }

  async requestNonce(drawTime, { replace = false } = {}) {
    const key = this.requestStorageKey(drawTime);
    const saved = replace
      ? null
      : (this.oracleNonces.get(key) ?? this.storage?.getItem(key));
    const nonce = saved
      ? JSON.parse(saved)
      : Array.from(this.oracleNonceFactory());
    if (
      !Array.isArray(nonce) ||
      nonce.length !== 32 ||
      nonce.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)
    )
      throw new Error(
        "Saved randomness request information is invalid. Refresh before continuing.",
      );
    const encoded = JSON.stringify(nonce);
    this.storage?.setItem(key, encoded);
    this.oracleNonces.set(key, encoded);
    return nonce;
  }

  async requestDraw(drawTime, options = {}) {
    this.requireSigner();
    const account = await this.getDraw(drawTime);
    if (!account) throw new Error("This draw has no on-chain ticket record.");
    const draw = this.drawRecord(account);
    if (draw.status !== "open")
      return { signature: null, draw, recovered: true };
    const rules = await this.getRandomnessRules();
    const now = Math.floor(this.now() / 1000);
    if (now < drawTime) throw new Error("The draw has not started yet.");
    if (now >= Number(drawTime) + rules.refundAfterSeconds)
      throw new Error(
        "The randomness request window has ended. Unresolved tickets can be refunded.",
      );
    const quote = await this.getOracleQuote();
    let nonce = await this.requestNonce(drawTime);
    let seed;
    let request;
    for (let attempt = 0; attempt < 2; attempt++) {
      seed = await deriveOracleSeed(
        this.program.programId,
        draw.address,
        nonce,
      );
      request = getOracleRequestPda(seed, this.oracle.programId)[0];
      const existing = await this.connection.getAccountInfo(
        request,
        "confirmed",
      );
      if (
        !existing ||
        (existing.owner.equals(SystemProgram.programId) &&
          !existing.lamports &&
          !existing.data.length)
      )
        break;
      const latest = await this.getDraw(drawTime);
      if (latest?.status === 1 || latest?.status === 2)
        return {
          signature: null,
          draw: this.drawRecord(latest),
          recovered: true,
        };
      let ours = false;
      try {
        ours =
          this.oracle.decodeRequest(existing, {
            seed,
            client: getOracleClientPda(drawTime, this.program.programId)[0],
            address: request,
          }).status !== "missing";
      } catch {
        ours = false;
      }
      if (ours)
        throw new Error(
          "This draw's oracle request already exists. Refresh to recover its confirmed status before continuing.",
        );
      if (attempt === 1)
        throw new Error(
          "This uncommitted request seed is occupied. Try requesting the draw again; no transaction was sent.",
        );
      nonce = await this.requestNonce(drawTime, { replace: true });
    }
    options.onProgress?.({
      phase: "request",
      quote,
      oracleRequest: request.toBase58(),
    });
    await this.assertDevnet();
    options.assertActive?.();
    try {
      const signature = await this.program.methods
        .requestDraw(new BN(String(drawTime)), nonce, new BN(quote.feeLamports))
        .accountsStrict({
          config: this.configAddress,
          draw: new PublicKey(draw.address),
          oracleClient: getOracleClientPda(drawTime, this.program.programId)[0],
          requester: this.wallet.publicKey,
          oracleProgram: this.oracle.programId,
          networkState: new PublicKey(quote.networkAddress),
          treasury: new PublicKey(quote.treasury),
          oracleRequest: request,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ maxRetries: 0 });
      const confirmed = await this.getDraw(drawTime);
      return { signature, draw: confirmed ? this.drawRecord(confirmed) : draw };
    } catch (cause) {
      let confirmed;
      try {
        confirmed = await this.getDraw(drawTime);
      } catch {
        confirmed = null;
      }
      if (confirmed?.status === 1 || confirmed?.status === 2)
        return {
          signature: null,
          draw: this.drawRecord(confirmed),
          recovered: true,
        };
      throw new Error(
        `The randomness request was not confirmed. Refresh before trying again. Its saved nonce will be reused; no replacement request was sent. ${cause.message || ""}`,
        { cause },
      );
    }
  }

  async finalizationPlan(
    draw,
    proof,
    { payer = this.wallet?.publicKey, prefixInstructions = [] } = {},
  ) {
    if (
      draw.status !== "pending" ||
      proof.status !== "fulfilled" ||
      proof.address !== draw.oracleRequest
    )
      throw new Error(
        "Verified fulfilled randomness is required to complete this draw.",
      );
    const winningNumbers = await winningNumbersFromRandomness(proof.randomness);
    const transaction = new Transaction().add(
      ...prefixInstructions,
      await this.program.methods
        .finalizeDraw(new BN(String(draw.drawTime)))
        .accountsStrict({
          config: this.configAddress,
          draw: new PublicKey(draw.address),
          oracleRequest: new PublicKey(draw.oracleRequest),
        })
        .instruction(),
    );
    let reclaimSkipped = false;
    let requester;
    try {
      requester = await this.connection.getAccountInfo(
        new PublicKey(draw.requestedBy),
        "confirmed",
      );
    } catch {
      reclaimSkipped = true;
    }
    if (requester?.executable) reclaimSkipped = true;
    if (!reclaimSkipped) {
      const reclaim = await this.oracleReclaimInstruction(draw.drawTime, draw);
      transaction.add(reclaim);
      if (
        transaction.instructions.length > 8 ||
        transactionPacketBytes(transaction, payer) > 1232
      ) {
        transaction.instructions.pop();
        reclaimSkipped = true;
      }
    }
    if (
      transaction.instructions.length > 8 ||
      transactionPacketBytes(transaction, payer) > 1232
    )
      throw new Error(
        "The draw completion transaction exceeds its packet budget.",
      );
    const addresses = [];
    let cleanupSkipped = false;
    try {
      const entries = await this.program.account.ticket.all([
        {
          memcmp: {
            offset: 48,
            bytes: utils.bytes.bs58.encode(i64LeBytes(draw.drawTime)),
          },
        },
      ]);
      for (const { publicKey, account } of entries) {
        const snapshot = Buffer.from(account.padding);
        const expected = getTicketPda(
          account.user,
          account.nonce.toString(),
          this.program.programId,
        );
        if (
          !expected[0].equals(publicKey) ||
          account.bump !== expected[1] ||
          account.drawTime.toString() !== String(draw.drawTime) ||
          account.settled !== false ||
          snapshot.length !== 32 ||
          snapshot[0] !== 2 ||
          snapshot[9] !== 0 ||
          snapshot.subarray(10).some((byte) => byte !== 0) ||
          snapshot.readBigUInt64LE(1) === 0n ||
          !validNumbers(Array.from(account.numbers)) ||
          account.numbers.every(
            (number, index) => number === winningNumbers[index],
          )
        )
          continue;
        if (addresses.length === 6 || transaction.instructions.length === 8) {
          cleanupSkipped = true;
          break;
        }
        const instruction = await this.releaseLosingInstruction({
          id: account.nonce.toString(),
          user: account.user.toBase58(),
          drawTime: draw.drawTime,
        });
        transaction.add(instruction);
        if (transactionPacketBytes(transaction, payer) > 1232) {
          transaction.instructions.pop();
          cleanupSkipped = true;
          break;
        }
        addresses.push(publicKey.toBase58());
      }
    } catch {
      transaction.instructions.splice(
        prefixInstructions.length + 1 + Number(!reclaimSkipped),
      );
      addresses.length = 0;
      cleanupSkipped = true;
    }
    return {
      transaction,
      plannedLosses: addresses.length,
      addresses,
      lossAddresses: addresses,
      cleanupSkipped,
      reclaimSkipped,
      packetBytes: transactionPacketBytes(transaction, payer),
      winningNumbers,
    };
  }

  async finalizeDraw(drawTime, options = {}) {
    this.requireSigner();
    const account = await this.getDraw(drawTime);
    if (!account) throw new Error("This draw is not recorded on-chain.");
    const draw = this.drawRecord(account);
    if (draw.status === "final")
      return { signature: null, draw, recovered: true, releasedLosses: 0 };
    if (draw.status !== "pending")
      throw new Error("Request randomness before completing the draw.");
    const proof = await this.oracle.readRequest({
      seed: draw.seed,
      client: draw.oracleClient,
      address: draw.oracleRequest,
    });
    if (proof.status !== "fulfilled")
      return { signature: null, draw, pending: true, releasedLosses: 0 };
    const plan = await this.finalizationPlan(draw, proof, {
      prefixInstructions: options.prefixInstructions ?? [],
    });
    const { transaction, reclaimSkipped, cleanupSkipped } = plan;
    await this.assertDevnet();
    options.assertActive?.();
    options.onProgress?.({
      phase: "finalize",
      oracleRequest: draw.oracleRequest,
      reclaimSkipped,
      plannedLosses: plan.plannedLosses,
    });
    let signature;
    try {
      signature = await this.program.provider.sendAndConfirm(transaction, [], {
        commitment: "confirmed",
        preflightCommitment: "confirmed",
        maxRetries: 0,
      });
    } catch (cause) {
      let confirmed;
      try {
        confirmed = await this.getDraw(drawTime);
      } catch {
        confirmed = null;
      }
      if (confirmed?.status === 2)
        return {
          signature: null,
          draw: this.drawRecord(confirmed),
          recovered: true,
          reclaimSkipped,
          cleanupSkipped,
          releasedLosses: 0,
        };
      throw new Error(
        `Draw completion was not confirmed. Refresh to check its recorded status. No replacement transaction was sent. ${cause.message || ""}`,
        { cause },
      );
    }
    let confirmedDraw = {
      ...draw,
      status: "final",
      numbers: plan.winningNumbers,
    };
    let refreshWarning = false;
    try {
      confirmedDraw = this.drawRecord(await this.getDraw(drawTime));
    } catch {
      refreshWarning = true;
    }
    let releasedLosses = 0;
    if (plan.plannedLosses) {
      try {
        const confirmed = await this.program.account.ticket.fetchMultiple(
          plan.addresses.map((address) => new PublicKey(address)),
        );
        releasedLosses = confirmed.filter(
          (ticket) => ticket?.settled && ticket.padding[9] === 0,
        ).length;
        if (releasedLosses !== plan.plannedLosses) refreshWarning = true;
      } catch {
        refreshWarning = true;
      }
    }
    return {
      signature,
      draw: confirmedDraw,
      reclaimSkipped,
      cleanupSkipped,
      releasedLosses,
      settled: releasedLosses,
      refreshWarning,
    };
  }

  async oracleReclaimInstruction(drawTime, draw) {
    return this.program.methods
      .reclaimOracleFunding(new BN(String(drawTime)))
      .accountsStrict({
        config: this.configAddress,
        draw: new PublicKey(draw.address),
        oracleClient: new PublicKey(draw.oracleClient),
        requester: new PublicKey(draw.requestedBy),
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  async reclaimOracleFunding(drawTime, options = {}) {
    this.requireSigner();
    const account = await this.getDraw(drawTime);
    if (!account) throw new Error("This draw is not recorded on-chain.");
    const draw = this.drawRecord(account);
    if (draw.status !== "final")
      throw new Error("Complete this draw before reclaiming request funding.");
    const requester = await this.connection.getAccountInfo(
      new PublicKey(draw.requestedBy),
      "confirmed",
    );
    if (requester?.executable)
      throw new Error(
        "The original requester is executable and cannot receive request funding. The finalized draw and ticket prizes remain available.",
      );
    const transaction = new Transaction().add(
      await this.oracleReclaimInstruction(drawTime, draw),
    );
    await this.assertDevnet();
    options.assertActive?.();
    return this.program.provider.sendAndConfirm(transaction, [], {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
      maxRetries: 0,
    });
  }

  async recordDraw(drawTime, options = {}) {
    const requested = await this.requestDraw(drawTime, options);
    if (requested.draw.status === "final")
      return { ...requested, pending: false, phase: "final", settled: 0 };
    let elapsed = 0;
    const started = Date.now();
    const timeout = Math.max(0, Math.min(options.waitMs ?? 90_000, 90_000));
    while (true) {
      options.assertActive?.();
      const account = await this.getDraw(drawTime);
      if (!account)
        throw new Error("Refresh to recover the confirmed randomness request.");
      const draw = this.drawRecord(account);
      if (draw.status === "final")
        return {
          ...requested,
          draw,
          phase: "final",
          pending: false,
          settled: 0,
        };
      let proof;
      try {
        proof = await this.oracle.readRequest({
          seed: draw.seed,
          client: draw.oracleClient,
          address: draw.oracleRequest,
        });
      } catch {
        proof = null;
      }
      if (proof?.status === "fulfilled") {
        const final = await this.finalizeDraw(drawTime, options);
        return {
          ...final,
          pending: Boolean(final.pending),
          phase: final.pending ? "pending" : "final",
          settled: final.releasedLosses ?? 0,
        };
      }
      options.onProgress?.({
        phase: "pending",
        oracleRequest: draw.oracleRequest,
      });
      elapsed = Math.max(elapsed, Date.now() - started);
      if (elapsed >= timeout)
        return {
          ...requested,
          draw,
          pending: true,
          phase: "pending",
          settled: 0,
          oracleRequest: draw.oracleRequest,
        };
      const pause = Math.min(3000, timeout - elapsed);
      await this.delay(pause);
      elapsed += pause;
    }
  }

  async publishResult(drawTime, options = {}) {
    return (await this.recordDraw(drawTime, options)).signature;
  }

  settlementAccounts(ticket) {
    const user = new PublicKey(ticket.user ?? this.wallet.publicKey);
    return {
      config: this.configAddress,
      vault: this.vaultAddress,
      ticket: getTicketPda(user, ticket.id, this.program.programId)[0],
      draw: getDrawPda(ticket.drawTime, this.program.programId)[0],
      user,
      systemProgram: SystemProgram.programId,
    };
  }

  async settleInstruction(ticket) {
    const result = await this.getResult(ticket.drawTime);
    if (
      result?.isPublished &&
      validNumbers(ticket.numbers) &&
      ticket.numbers.some((number, index) => number !== result.numbers[index])
    )
      return this.releaseLosingInstruction(ticket);
    return this.program.methods
      .settleTicket()
      .accountsStrict(this.settlementAccounts(ticket))
      .instruction();
  }

  async releaseLosingInstruction(ticket) {
    const {
      config,
      vault,
      ticket: address,
      draw,
    } = this.settlementAccounts(ticket);
    return this.program.methods
      .releaseLosingTicket()
      .accountsStrict({ config, vault, ticket: address, draw })
      .instruction();
  }

  async releaseLosingTicket(ticket, options = {}) {
    this.requireSigner();
    const transaction = new Transaction().add(
      await this.releaseLosingInstruction(ticket),
    );
    await this.assertDevnet();
    options.assertActive?.();
    return this.program.provider.sendAndConfirm(transaction, [], {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
      maxRetries: 0,
    });
  }

  async settlementQualifications() {
    return new Map();
  }

  async settleTicket(ticket, options = {}) {
    this.requireSigner();
    const transaction = new Transaction().add(
      await this.settleInstruction(ticket),
    );
    await this.assertDevnet();
    options.assertActive?.();
    return this.program.provider.sendAndConfirm(transaction, [], {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
      maxRetries: 0,
    });
  }

  async settleBatch(tickets, options = {}) {
    await this.assertDevnet();
    return super.settleBatch(tickets, options);
  }

  async refundTicket(ticket, options = {}) {
    this.requireSigner();
    const [account, rules] = await Promise.all([
      this.getDraw(ticket.drawTime),
      this.getRandomnessRules(),
    ]);
    if (
      !account ||
      Math.floor(this.now() / 1000) < ticket.drawTime + rules.refundAfterSeconds
    )
      throw new Error(
        "This unresolved ticket is not eligible for a refund yet.",
      );
    const draw = await this.inspectDraw(account);
    if (!["open", "pending"].includes(draw.status) || draw.oracleReadError)
      throw new Error(
        "A fulfilled draw cannot be refunded. Refresh to check the result.",
      );
    await this.assertDevnet();
    options.assertActive?.();
    return this.program.methods
      .refundTicket()
      .accountsStrict({
        ...this.settlementAccounts(ticket),
        oracleRequest:
          draw.status === "open"
            ? SystemProgram.programId
            : new PublicKey(draw.oracleRequest),
      })
      .rpc({ maxRetries: 0 });
  }
}

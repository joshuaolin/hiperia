import assert from "node:assert/strict";
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { utils } from "@coral-xyz/anchor";
import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import { VrfDodosClient } from "../../src/lib/onchain/VrfDodosClient.js";
import { getDrawPda, getTicketPda } from "../../src/lib/onchain/pdas.js";
import { VRF_PROGRAM_ID } from "../../src/lib/onchain/vrfProtocol.js";
import { DEVNET_GENESIS_HASH } from "../../src/lib/network.js";
import { pollTransaction } from "../../src/lib/uatConnection.js";

const unresolved = new Set(["prepared", "submitted", "uncertain"]);

export function processingOptions(args, environment = process.env) {
  const options = {
    execute: false,
    walletPath: environment.HIPERIA_OPERATOR_WALLET ?? null,
    rpc: environment.HIPERIA_OPERATOR_RPC ?? "https://api.devnet.solana.com",
    maxDraws: 3,
    maxSettlements: 20,
    batchSize: 3,
    maxTransactions: 20,
    waitSeconds: 30,
    maxOracleLamports: 0,
  };
  const numeric = {
    "--max-draws": ["maxDraws", 1, 10],
    "--max-settlements": ["maxSettlements", 1, 100],
    "--batch-size": ["batchSize", 1, 6],
    "--max-transactions": ["maxTransactions", 1, 50],
    "--wait-seconds": ["waitSeconds", 0, 90],
    "--max-oracle-lamports": ["maxOracleLamports", 0, Number.MAX_SAFE_INTEGER],
  };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    assert.ok(!seen.has(flag), `Duplicate option: ${flag}`);
    seen.add(flag);
    if (flag === "--execute") options.execute = true;
    else if (flag === "--wallet" || flag === "--rpc") {
      const value = args[++index];
      assert.ok(value && !value.startsWith("--"), `${flag} requires a value.`);
      options[flag === "--wallet" ? "walletPath" : "rpc"] = value;
    } else if (numeric[flag]) {
      const [key, minimum, maximum] = numeric[flag];
      const value = args[++index];
      assert.match(value ?? "", /^\d+$/, `${flag} requires an integer.`);
      const parsed = Number(value);
      assert.ok(
        Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum,
        `${flag} must be between ${minimum} and ${maximum}.`,
      );
      options[key] = parsed;
    } else throw new Error(`Unsupported option: ${flag}`);
  }
  assert.ok(["http:", "https:"].includes(new URL(options.rpc).protocol));
  if (options.execute)
    assert.ok(
      options.walletPath,
      "Execution requires --wallet or HIPERIA_OPERATOR_WALLET. No default wallet is selected.",
    );
  return options;
}

function integer(value, label) {
  const number = Number(value?.toString());
  assert.ok(Number.isSafeInteger(number) && number >= 0, `Invalid ${label}.`);
  return number;
}

function validNumbers(numbers) {
  return (
    numbers.length === 2 &&
    numbers.every(
      (value) => Number.isInteger(value) && value >= 2 && value <= 22,
    ) &&
    numbers[0] !== numbers[1]
  );
}

export function ticketRecord(
  { publicKey, account },
  programId = VRF_PROGRAM_ID,
) {
  assert.ok(
    getTicketPda(account.user, account.nonce, programId)[0].equals(publicKey),
    "The scanned ticket is not its canonical account.",
  );
  const padding = Buffer.from(account.padding);
  assert.ok(
    padding.length === 32 &&
      padding[0] === 2 &&
      padding[9] <= 1 &&
      padding.subarray(10).every((byte) => byte === 0),
    "The ticket prize snapshot could not be verified.",
  );
  const payoutLamports = padding.readBigUInt64LE(1);
  assert.ok(payoutLamports > 0n, "The ticket prize must be positive.");
  const numbers = Array.from(account.numbers);
  assert.ok(validNumbers(numbers), "Invalid on-chain ticket numbers.");
  return {
    address: publicKey.toBase58(),
    id: account.nonce.toString(),
    user: account.user.toBase58(),
    drawTime: integer(account.drawTime, "ticket draw time"),
    numbers,
    settled: account.settled,
    refunded: padding[9] === 1,
    payoutLamports: payoutLamports.toString(),
    paidLamports: account.paidLamports.toString(),
    sourceProgram: programId.toString(),
    legacy: false,
  };
}

export function settlementDecision(ticket, draw, chainTime) {
  if (ticket.settled) return "settled";
  assert.ok(!ticket.refunded, "An unsettled ticket cannot be marked refunded.");
  if (ticket.drawTime > chainTime) return "upcoming";
  if (!draw || draw.status !== "final") return "unresolved";
  assert.equal(
    draw.drawTime,
    ticket.drawTime,
    "The draw does not match the ticket.",
  );
  assert.ok(validNumbers(draw.numbers), "The final draw numbers are invalid.");
  return ticket.numbers.every((number, index) => number === draw.numbers[index])
    ? "preserve-win"
    : "release-loss";
}

function atomicJson(path, value) {
  const temporary = `${path}.tmp`;
  const descriptor = openSync(temporary, "w");
  try {
    writeFileSync(descriptor, JSON.stringify(value, null, 2) + "\n");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, path);
}

export class ProcessingReceipt {
  constructor(path, details) {
    this.path = path;
    this.context = {};
    this.data = {
      ...details,
      status: "running",
      startedAt: new Date().toISOString(),
      steps: [],
    };
    this.save();
  }

  save() {
    atomicJson(this.path, this.data);
  }

  assertWritable() {
    this.assertResolved();
    assert.ok(
      this.data.steps.length < this.data.maxTransactions,
      "The transaction limit was reached. Run another explicit one-shot after review.",
    );
  }

  assertResolved() {
    assert.ok(
      !this.data.steps.some((step) => unresolved.has(step.status)),
      "A signed transaction is unresolved. Stop and reconcile its signature before another write. No transaction was resent.",
    );
  }

  prepare(rawTransaction) {
    this.assertWritable();
    const transaction = VersionedTransaction.deserialize(rawTransaction);
    assert.ok(transaction.signatures[0]?.some((byte) => byte !== 0));
    const signature = utils.bytes.bs58.encode(transaction.signatures[0]);
    assert.ok(
      !this.data.steps.some((step) => step.signature === signature),
      "This signed transaction already has a receipt. It will not be submitted again.",
    );
    const step = {
      ...this.context,
      signature,
      blockhash: transaction.message.recentBlockhash,
      status: "prepared",
      preparedAt: new Date().toISOString(),
    };
    this.data.steps.push(step);
    this.save();
    return step;
  }

  status(signature, status, error) {
    const step = this.data.steps.find((entry) => entry.signature === signature);
    assert.ok(step, "The transaction has no persisted signed receipt.");
    step.status = status;
    step.updatedAt = new Date().toISOString();
    if (error) step.error = error;
    this.save();
  }
}

export class OperatorConnection extends Connection {
  constructor(endpoint, receipt) {
    super(endpoint, { commitment: "confirmed", disableRetryOnRateLimit: true });
    this.receipt = receipt;
  }

  async sendRawTransaction(bytes, options = {}) {
    assert.ok(this.receipt, "Dry runs cannot submit transactions.");
    assert.equal(await this.getGenesisHash(), DEVNET_GENESIS_HASH);
    assert.ok(
      options.maxRetries === 0,
      "Transaction resubmission is disabled.",
    );
    const step = this.receipt.prepare(bytes);
    try {
      const signature = await super.sendRawTransaction(bytes, {
        ...options,
        maxRetries: 0,
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });
      assert.equal(signature, step.signature);
      this.receipt.status(signature, "submitted");
      return signature;
    } catch (error) {
      this.receipt.status(step.signature, "uncertain", error.message);
      throw error;
    }
  }

  async confirmTransaction(strategy, commitment = "confirmed") {
    const signature =
      typeof strategy === "string" ? strategy : strategy.signature;
    try {
      const response = await pollTransaction(this, strategy, commitment);
      this.receipt.status(
        signature,
        response.value.err ? "failed" : "confirmed",
        response.value.err,
      );
      return response;
    } catch (error) {
      this.receipt.status(signature, "uncertain", error.message);
      throw error;
    }
  }
}

export async function processDraws({
  client,
  draws,
  tickets,
  chainTime,
  refundAfterSeconds,
  options,
  receipt,
  log = (value) => console.log(JSON.stringify(value)),
}) {
  const selected = draws
    .filter((draw) =>
      tickets.some(
        (ticket) =>
          !ticket.settled &&
          ticket.drawTime === draw.drawTime &&
          ticket.drawTime <= chainTime,
      ),
    )
    .sort((left, right) => left.drawTime - right.drawTime)
    .slice(0, options.maxDraws);
  let approvedOracleLamports = 0;
  let settled = 0;
  let preservedWins = 0;
  for (const selectedDraw of selected) {
    let draw = selectedDraw;
    const related = tickets.filter(
      (ticket) => ticket.drawTime === draw.drawTime,
    );
    const liability = related.reduce(
      (total, ticket) =>
        total + (ticket.settled ? 0n : BigInt(ticket.payoutLamports)),
      0n,
    );
    log({
      drawTime: draw.drawTime,
      phase: draw.status,
      tickets: related.length,
      unsettledLiabilityLamports: liability.toString(),
      mode: options.execute ? "execute" : "dry-run",
    });
    if (
      draw.status === "open" &&
      chainTime >= draw.drawTime + refundAfterSeconds
    ) {
      log({
        drawTime: draw.drawTime,
        skipped:
          "request-window-ended; unresolved entries may be refunded by their owners",
      });
      continue;
    }
    let reviewedQuote = null;
    if (draw.status === "open") {
      reviewedQuote = await client.getOracleQuote();
      log({
        drawTime: draw.drawTime,
        oracleQuote: reviewedQuote,
        budgetIsForEntireRun: true,
      });
    }
    if (!options.execute) {
      const decisions = related.map((ticket) =>
        settlementDecision(ticket, draw, chainTime),
      );
      preservedWins += decisions.filter(
        (value) => value === "preserve-win",
      ).length;
      log({
        drawTime: draw.drawTime,
        releasableLosses: decisions.filter((value) => value === "release-loss")
          .length,
        preservedWins: decisions.filter((value) => value === "preserve-win")
          .length,
      });
      continue;
    }
    if (draw.status !== "final") {
      if (reviewedQuote)
        assert.ok(
          integer(reviewedQuote.totalLamports, "oracle budget") <=
            options.maxOracleLamports - approvedOracleLamports,
          "The reviewed oracle funding exceeds --max-oracle-lamports for this entire run. No request was sent.",
        );
      receipt.assertWritable();
      const result = await client.recordDraw(draw.drawTime, {
        waitMs: options.waitSeconds * 1000,
        assertActive: () => receipt.assertWritable(),
        onProgress: (progress) => {
          receipt.context = { kind: progress.phase, drawTime: draw.drawTime };
          if (progress.phase === "request") {
            assert.ok(
              reviewedQuote,
              "An oracle request requires a reviewed quote.",
            );
            for (const key of [
              "feeLamports",
              "pendingRentLamports",
              "clientRentLamports",
              "totalLamports",
              "treasury",
              "networkAddress",
              "oracleProgram",
            ])
              assert.equal(
                progress.quote[key],
                reviewedQuote[key],
                "The oracle quote changed. Review it before another explicit run.",
              );
            approvedOracleLamports += integer(
              progress.quote.totalLamports,
              "oracle budget",
            );
            assert.ok(
              Number.isSafeInteger(approvedOracleLamports) &&
                approvedOracleLamports <= options.maxOracleLamports,
              "The reviewed oracle funding exceeds --max-oracle-lamports for this entire run. No request was sent.",
            );
          }
          log({ drawTime: draw.drawTime, ...progress });
        },
      });
      receipt.assertResolved();
      draw = result.draw;
      if (draw.status !== "final") {
        log({
          drawTime: draw.drawTime,
          pending: true,
          oracleRequest: draw.oracleRequest,
        });
        continue;
      }
    }
    const candidates = related.filter((ticket) => {
      const decision = settlementDecision(ticket, draw, chainTime);
      if (decision === "preserve-win") preservedWins++;
      return decision === "release-loss";
    });
    for (
      let offset = 0;
      offset < candidates.length && settled < options.maxSettlements;
      offset += options.batchSize
    ) {
      const batch = candidates.slice(
        offset,
        offset + Math.min(options.batchSize, options.maxSettlements - settled),
      );
      const records = await client.program.account.ticket.fetchMultiple(
        batch.map(
          (ticket) =>
            getTicketPda(ticket.user, ticket.id, client.program.programId)[0],
        ),
      );
      const losses = batch.flatMap((ticket, index) => {
        if (!records[index]) return [];
        const current = ticketRecord(
          {
            publicKey: getTicketPda(
              ticket.user,
              ticket.id,
              client.program.programId,
            )[0],
            account: records[index],
          },
          client.program.programId,
        );
        return settlementDecision(current, draw, chainTime) === "release-loss"
          ? [current]
          : [];
      });
      if (!losses.length) continue;
      receipt.context = {
        kind: "release-losses",
        drawTime: draw.drawTime,
        tickets: losses.map((ticket) => ticket.address),
      };
      receipt.assertWritable();
      const result = await client.settleBatch(losses, {
        assertActive: () => receipt.assertWritable(),
      });
      receipt.assertResolved();
      settled += result.settled;
      log({
        drawTime: draw.drawTime,
        settledLosses: result.settled,
        signatures: result.signatures,
      });
    }
  }
  return {
    processedDraws: selected.length,
    settledLosses: settled,
    preservedWins,
    approvedOracleLamports,
  };
}

async function run() {
  const options = processingOptions(process.argv.slice(2));
  const directory = resolve(".local");
  const receiptPath = resolve(directory, "vrf-due-processing.json");
  const lockPath = `${receiptPath}.lock`;
  let lock;
  let receipt;
  try {
    if (options.execute) {
      mkdirSync(directory, { recursive: true });
      lock = openSync(lockPath, "wx");
    }
    const connection = new OperatorConnection(options.rpc);
    assert.equal(
      await connection.getGenesisHash(),
      DEVNET_GENESIS_HASH,
      "This processor only supports Solana Devnet.",
    );
    if (existsSync(receiptPath)) {
      const previous = JSON.parse(readFileSync(receiptPath, "utf8"));
      assert.equal(previous.program, VRF_PROGRAM_ID);
      const pending = previous.steps.filter((step) =>
        unresolved.has(step.status),
      );
      for (const step of pending) {
        const response = await connection.getSignatureStatuses(
          [step.signature],
          { searchTransactionHistory: true },
        );
        console.log(
          JSON.stringify({
            reconcile: step.signature,
            confirmationStatus:
              response.value[0]?.confirmationStatus ?? "unknown",
            error: response.value[0]?.err ?? null,
          }),
        );
      }
      if (options.execute) {
        assert.ok(
          !pending.length && ["complete", "failed"].includes(previous.status),
          "An unresolved or interrupted receipt exists. Inspect its signatures and on-chain targets, then archive it manually. No transaction was resent.",
        );
        copyFileSync(receiptPath, `${receiptPath}.${Date.now()}.archive`);
      }
    }
    let wallet;
    let storage;
    if (options.execute) {
      let secret;
      try {
        secret = JSON.parse(readFileSync(resolve(options.walletPath), "utf8"));
      } catch {
        throw new Error(
          "The explicit operator keypair file could not be read.",
        );
      }
      assert.ok(
        Array.isArray(secret) &&
          secret.length === 64 &&
          secret.every(
            (byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255,
          ),
        "Invalid explicit operator keypair file.",
      );
      const payer = Keypair.fromSecretKey(Uint8Array.from(secret));
      wallet = {
        publicKey: payer.publicKey,
        async signTransaction(transaction) {
          if (transaction instanceof VersionedTransaction)
            transaction.sign([payer]);
          else transaction.partialSign(payer);
          return transaction;
        },
        async signAllTransactions(transactions) {
          return Promise.all(
            transactions.map((transaction) =>
              this.signTransaction(transaction),
            ),
          );
        },
      };
      const noncePath = resolve(directory, "vrf-due-oracle-nonces.json");
      const nonces = existsSync(noncePath)
        ? JSON.parse(readFileSync(noncePath, "utf8"))
        : {};
      storage = {
        getItem: (key) => nonces[key] ?? null,
        setItem(key, value) {
          nonces[key] = value;
          atomicJson(noncePath, nonces);
        },
      };
    }
    const client = new VrfDodosClient({ connection, wallet, storage });
    assert.equal(client.program.programId.toBase58(), VRF_PROGRAM_ID);
    const program = await connection.getAccountInfo(
      client.program.programId,
      "confirmed",
    );
    assert.ok(program?.executable, "The public VRF program is not deployed.");
    const config = await client.getConfig();
    assert.ok(
      config?.randomnessVerified && config.rulesRevision === 6,
      "Public VRF metadata must be verified.",
    );
    const [drawRecords, ticketRecords, slot] = await Promise.all([
      client.program.account.draw.all(),
      client.program.account.ticket.all(),
      connection.getSlot("confirmed"),
    ]);
    const chainTime = await connection.getBlockTime(slot);
    assert.ok(
      Number.isSafeInteger(chainTime),
      "The confirmed chain clock is unavailable.",
    );
    const draws = [];
    for (const { publicKey, account } of drawRecords)
      draws.push(await client.inspectDraw(account, publicKey));
    const tickets = ticketRecords.map((record) => ticketRecord(record));
    for (const draw of draws)
      assert.equal(
        draw.address,
        getDrawPda(draw.drawTime, client.program.programId)[0].toBase58(),
      );
    console.log(
      JSON.stringify({
        mode: options.execute ? "execute" : "dry-run",
        program: VRF_PROGRAM_ID,
        cluster: "devnet",
        chainTime,
        scannedDraws: draws.length,
        scannedTickets: tickets.length,
        capacity: config.capacity,
        operator: wallet?.publicKey.toBase58() ?? null,
        maxOracleLamportsForEntireRun: options.maxOracleLamports,
      }),
    );
    if (options.execute) {
      receipt = new ProcessingReceipt(receiptPath, {
        program: VRF_PROGRAM_ID,
        cluster: "devnet",
        payer: wallet.publicKey.toBase58(),
        chainTime,
        maxTransactions: options.maxTransactions,
      });
      connection.receipt = receipt;
    }
    const summary = await processDraws({
      client,
      draws,
      tickets,
      chainTime,
      refundAfterSeconds: config.randomnessRules.refundAfterSeconds,
      options,
      receipt,
    });
    if (receipt) {
      receipt.data.status = "complete";
      receipt.data.summary = summary;
      receipt.data.completedAt = new Date().toISOString();
      receipt.save();
    }
    console.log(
      JSON.stringify({
        status: "complete",
        ...summary,
        mode: options.execute ? "execute" : "dry-run",
      }),
    );
  } catch (error) {
    if (receipt) {
      receipt.data.status = receipt.data.steps.some((step) =>
        unresolved.has(step.status),
      )
        ? "uncertain"
        : "failed";
      receipt.data.error = error.message;
      receipt.save();
    }
    throw error;
  } finally {
    if (lock !== undefined) {
      closeSync(lock);
      unlinkSync(lockPath);
    }
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

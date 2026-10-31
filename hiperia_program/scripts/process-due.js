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
import * as anchor from "@coral-xyz/anchor";
import { SystemProgram, Transaction } from "@solana/web3.js";
import { createClient, requireCurrentUatRules } from "./client.js";
import { DEVNET_GENESIS_HASH } from "../../src/lib/network.js";
import { getReferralPda, getResultPda } from "../../src/lib/onchain/pdas.js";

const pause = (milliseconds) =>
  new Promise((resolvePause) => setTimeout(resolvePause, milliseconds));

export function processingOptions(args) {
  let includeWins = false;
  let maxTransactions = 20;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--include-wins" && !includeWins) includeWins = true;
    else if (args[index] === "--max-transactions") {
      const value = args[++index];
      if (!/^\d+$/.test(value ?? ""))
        throw new Error("Enter a transaction limit from 1 to 50.");
      maxTransactions = Number(value);
      if (maxTransactions < 1 || maxTransactions > 50)
        throw new Error("Enter a transaction limit from 1 to 50.");
    } else
      throw new Error(
        "Supported options: --include-wins --max-transactions 1..50",
      );
  }
  return { includeWins, maxTransactions };
}

export function settlementDecision(ticket, result, chainTime, includeWins) {
  const drawTime = Number(ticket.drawTime.toString());
  if (!Number.isSafeInteger(drawTime) || drawTime <= 0)
    throw new Error("Invalid on-chain ticket draw time.");
  if (ticket.settled) return "settled";
  if (chainTime < drawTime) return "upcoming";
  if (!result?.isPublished) return "unpublished";
  if (Number(result.drawTime.toString()) !== drawTime)
    throw new Error("The result does not belong to this ticket's draw.");
  const picks = Array.from(ticket.numbers);
  const numbers = Array.from(result.numbers);
  if (picks.length !== 2 || numbers.length !== 2)
    throw new Error("Invalid on-chain pick count.");
  const won = picks.every((value, index) => value === numbers[index]);
  return won ? (includeWins ? "pay-owner" : "unclaimed-win") : "release-loss";
}

class ProcessingReceipt {
  constructor(path, details) {
    this.path = path;
    this.data = {
      ...details,
      startedAt: new Date().toISOString(),
      status: "running",
      steps: [],
      skipped: [],
    };
    this.save();
  }

  save() {
    const temporary = `${this.path}.tmp`;
    const descriptor = openSync(temporary, "w");
    try {
      writeFileSync(descriptor, JSON.stringify(this.data, null, 2) + "\n");
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporary, this.path);
  }
}

async function run() {
  const options = processingOptions(process.argv.slice(2));
  const directory = resolve(".local");
  const receiptPath = resolve(directory, "due-ticket-processing.json");
  const lockPath = `${receiptPath}.lock`;
  mkdirSync(directory, { recursive: true });
  const lock = openSync(lockPath, "wx");
  let receipt;
  try {
    const { client, provider } = await createClient();
    const connection = provider.connection;
    assert.equal(
      await connection.getGenesisHash(),
      DEVNET_GENESIS_HASH,
      "This one-shot processor requires Solana Devnet.",
    );
    await requireCurrentUatRules(client);
    if (existsSync(receiptPath)) {
      const previous = JSON.parse(readFileSync(receiptPath, "utf8"));
      assert.equal(previous.program, client.program.programId.toBase58());
      assert.equal(previous.cluster, "devnet");
      const unresolved = previous.steps.filter((step) =>
        ["prepared", "submitted", "uncertain"].includes(step.status),
      );
      if (unresolved.length) {
        for (const step of unresolved) {
          const response = await connection.getSignatureStatuses(
            [step.signature],
            { searchTransactionHistory: true },
          );
          const status = response.value[0];
          console.log(
            JSON.stringify({
              reconcile: step.signature,
              confirmationStatus: status?.confirmationStatus ?? "unknown",
              error: status?.err ?? null,
            }),
          );
        }
        throw new Error(
          "An unresolved signed transaction exists. Inspect its signature and on-chain target, then archive the receipt manually before another run. No transaction was resent.",
        );
      }
      assert.ok(
        ["complete", "failed"].includes(previous.status),
        "An incomplete receipt exists. Inspect and archive it before another run.",
      );
      copyFileSync(receiptPath, `${receiptPath}.${Date.now()}.archive`);
    }

    const [tickets, results, slot] = await Promise.all([
      client.program.account.ticket.all(),
      client.program.account.resultAccount.all(),
      connection.getSlot("confirmed"),
    ]);
    const chainTime = await connection.getBlockTime(slot);
    assert.ok(
      Number.isSafeInteger(chainTime),
      "The confirmed chain clock is unavailable.",
    );
    const published = new Map(
      results
        .filter(({ account }) => account.isPublished)
        .map(({ account }) => [account.drawTime.toString(), account]),
    );
    const due = tickets
      .filter(
        ({ account }) =>
          !account.settled && Number(account.drawTime.toString()) <= chainTime,
      )
      .sort(
        (left, right) =>
          Number(left.account.drawTime.toString()) -
          Number(right.account.drawTime.toString()),
      );
    receipt = new ProcessingReceipt(receiptPath, {
      cluster: "devnet",
      program: client.program.programId.toBase58(),
      payer: provider.wallet.publicKey.toBase58(),
      chainTime,
      ...options,
      scannedTickets: tickets.length,
      dueTickets: due.length,
    });

    const sendOnce = async (kind, details, instruction) => {
      assert.ok(
        receipt.data.steps.length < options.maxTransactions,
        "Transaction limit reached.",
      );
      const blockhash = await connection.getLatestBlockhash("confirmed");
      const transaction = new Transaction({
        feePayer: provider.wallet.publicKey,
        ...blockhash,
      }).add(instruction);
      const signed = await provider.wallet.signTransaction(transaction);
      const bytes = signed.serialize();
      assert.ok(
        signed.signature,
        "The fee payer did not sign the transaction.",
      );
      const signature = anchor.utils.bytes.bs58.encode(signed.signature);
      const step = {
        ...details,
        kind,
        signature,
        ...blockhash,
        status: "prepared",
        preparedAt: new Date().toISOString(),
      };
      receipt.data.steps.push(step);
      receipt.save();
      try {
        const submitted = await connection.sendRawTransaction(bytes, {
          skipPreflight: false,
          maxRetries: 0,
          preflightCommitment: "confirmed",
        });
        assert.equal(submitted, signature);
        step.status = "submitted";
        receipt.save();
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const response = await connection.getSignatureStatuses([signature], {
            searchTransactionHistory: true,
          });
          const status = response.value[0];
          if (status?.err) {
            step.status = "failed";
            step.error = status.err;
            receipt.save();
            throw new Error(`Transaction failed on-chain: ${signature}`);
          }
          if (["confirmed", "finalized"].includes(status?.confirmationStatus)) {
            step.status = "confirmed";
            step.confirmedAt = new Date().toISOString();
            receipt.save();
            console.log(JSON.stringify({ kind, signature, ...details }));
            return signature;
          }
          await pause(2_000);
        }
        throw new Error(`Confirmation is uncertain: ${signature}`);
      } catch (error) {
        if (!["confirmed", "failed"].includes(step.status))
          step.status = "uncertain";
        step.error ??= error.message;
        receipt.save();
        throw error;
      }
    };

    for (const record of due) {
      if (receipt.data.steps.length >= options.maxTransactions) break;
      const ticket = await client.program.account.ticket.fetchNullable(
        record.publicKey,
      );
      if (!ticket || ticket.settled) continue;
      const drawTime = ticket.drawTime.toString();
      const [resultAddress] = getResultPda(drawTime, client.program.programId);
      let result =
        await client.program.account.resultAccount.fetchNullable(resultAddress);
      if (!result?.isPublished) {
        assert.ok(
          !published.has(drawTime),
          "A previously published result disappeared.",
        );
        await sendOnce(
          "publish",
          { drawTime, result: resultAddress.toBase58() },
          await client.program.methods
            .publishResult(ticket.drawTime)
            .accountsStrict({
              config: client.configAddress,
              vault: client.vaultAddress,
              result: resultAddress,
              payer: provider.wallet.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .instruction(),
        );
        result =
          await client.program.account.resultAccount.fetch(resultAddress);
        published.set(drawTime, result);
      }
      const decision = settlementDecision(
        ticket,
        result,
        chainTime,
        options.includeWins,
      );
      if (!["release-loss", "pay-owner"].includes(decision)) {
        receipt.data.skipped.push({
          ticket: record.publicKey.toBase58(),
          reason: decision,
        });
        receipt.save();
        continue;
      }
      if (receipt.data.steps.length >= options.maxTransactions) break;
      await sendOnce(
        decision,
        {
          ticket: record.publicKey.toBase58(),
          owner: ticket.user.toBase58(),
          drawTime,
        },
        await client.program.methods
          .settleTicket()
          .accountsStrict({
            config: client.configAddress,
            vault: client.vaultAddress,
            ticket: record.publicKey,
            result: resultAddress,
            user: ticket.user,
            systemProgram: SystemProgram.programId,
          })
          .instruction(),
      );
      const settled = await client.program.account.ticket.fetch(
        record.publicKey,
      );
      assert.ok(
        settled.settled,
        "The confirmed settlement is not visible yet; inspect the receipt.",
      );
    }
    if (
      receipt.data.steps.length < options.maxTransactions &&
      (await client.referrals.purchaseRules(await client.getConfig()))
    ) {
      const profiles = await client.program.account.referralProfile.all();
      for (const { publicKey, account } of profiles) {
        if (receipt.data.steps.length >= options.maxTransactions) break;
        if (
          account.qualified ||
          !account.bindingLocked ||
          account.referrer.equals(SystemProgram.programId)
        )
          continue;
        const ticket = await client.program.account.ticket.fetchNullable(
          account.firstTicket,
        );
        if (!ticket?.settled) continue;
        await sendOnce(
          "qualify-referral",
          {
            profile: publicKey.toBase58(),
            owner: account.owner.toBase58(),
            ticket: account.firstTicket.toBase58(),
          },
          await client.program.methods
            .qualifyReferral()
            .accountsStrict({
              profile: publicKey,
              ticket: account.firstTicket,
              referrerProfile: getReferralPda(
                account.referrer,
                client.program.programId,
              )[0],
            })
            .instruction(),
        );
      }
    }
    receipt.data.status = "complete";
    receipt.data.completedAt = new Date().toISOString();
    receipt.data.limitReached =
      receipt.data.steps.length >= options.maxTransactions;
    receipt.save();
    console.log(
      JSON.stringify({
        status: receipt.data.status,
        transactions: receipt.data.steps.length,
        limitReached: receipt.data.limitReached,
        receipt: receiptPath,
      }),
    );
  } catch (error) {
    if (receipt) {
      receipt.data.status = receipt.data.steps.some((step) =>
        ["prepared", "submitted", "uncertain"].includes(step.status),
      )
        ? "uncertain"
        : "failed";
      receipt.data.error = error.message;
      receipt.save();
    }
    throw error;
  } finally {
    closeSync(lock);
    unlinkSync(lockPath);
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import BN from "bn.js";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  createClient,
  fundVault,
  requireCurrentUatRules,
} from "../hiperia_program/scripts/client.js";
import { UAT_ADMIN } from "../src/lib/onchain/DodosClient.js";
import { DEVNET_GENESIS_HASH } from "../src/lib/network.js";
import { getResultPda, getTicketPda } from "../src/lib/onchain/pdas.js";
import { getUatDrawTime } from "../src/lib/onchain/time.js";

const pause = (milliseconds) =>
  new Promise((resolvePause) => setTimeout(resolvePause, milliseconds));
const nonce = () => randomBytes(8).readBigUInt64LE().toString();
const UAT_RESULT = [2, 22];

class SecurityReceipt {
  constructor(details, resumeAfterLosing = false) {
    this.path = resolve(".local/uat-security-receipt.json");
    if (resumeAfterLosing) {
      assert.ok(existsSync(this.path), "There is no UAT receipt to resume.");
      this.data = JSON.parse(readFileSync(this.path, "utf8"));
      assert.equal(this.data.status, "incomplete");
      for (const key of [
        "cluster",
        "program",
        "wallet",
        "costLamports",
        "payoutLamports",
      ])
        assert.equal(
          this.data[key],
          details[key],
          `Receipt ${key} does not match this run.`,
        );
      assert.equal(
        this.data.steps.winningPurchase,
        undefined,
        "The winning purchase has already started. Reconcile it manually.",
      );
      return;
    }
    if (existsSync(this.path)) {
      const previous = JSON.parse(readFileSync(this.path, "utf8"));
      assert.equal(
        previous.status,
        "complete",
        "An incomplete UAT receipt exists. Reconcile its tickets and transactions before another run.",
      );
    }
    this.data = {
      ...details,
      startedAt: new Date().toISOString(),
      status: "running",
      simulations: [],
      steps: {},
    };
    mkdirSync(dirname(this.path), { recursive: true });
    this.save();
  }

  save() {
    writeFileSync(this.path, JSON.stringify(this.data, null, 2) + "\n");
  }
}

class UatContractSuite {
  constructor({ client, provider }, resumeAfterLosing = false) {
    this.client = client;
    this.provider = provider;
    this.connection = provider.connection;
    this.user = provider.wallet.publicKey;
    this.attacker = Keypair.generate().publicKey;
    this.resumeAfterLosing = resumeAfterLosing;
  }

  async simulate(label, instructions, expectedCode) {
    const message = new TransactionMessage({
      payerKey: this.user,
      recentBlockhash: PublicKey.default.toBase58(),
      instructions: Array.isArray(instructions) ? instructions : [instructions],
    }).compileToV0Message();
    const { value } = await this.connection.simulateTransaction(
      new VersionedTransaction(message),
      {
        commitment: "confirmed",
        sigVerify: false,
        replaceRecentBlockhash: true,
      },
    );
    const actualCode = value.err?.InstructionError?.[1]?.Custom;
    this.receipt.data.simulations.push({
      label,
      expectedCode,
      actualCode,
      error: value.err,
    });
    this.receipt.save();
    assert.equal(
      actualCode,
      expectedCode,
      `${label}: ${JSON.stringify(value)}`,
    );
    console.log(
      JSON.stringify({ simulation: label, rejectedWith: actualCode }),
    );
  }

  async paid(name, details, action) {
    const step = {
      ...details,
      status: "prepared",
      startedAt: new Date().toISOString(),
    };
    this.receipt.data.steps[name] = step;
    this.receipt.save();
    const result = await action();
    step.signature = typeof result === "string" ? result : result?.signature;
    assert.ok(
      step.signature,
      `${name} did not return a transaction signature.`,
    );
    step.status = "confirmed";
    step.result = result;
    this.receipt.save();
    console.log(JSON.stringify({ step: name, signature: step.signature }));
    return result;
  }

  async snapshot() {
    const [account, balance] = await Promise.all([
      this.client.program.account.vault.fetch(this.client.vaultAddress),
      this.connection.getBalance(this.client.vaultAddress, "confirmed"),
    ]);
    return {
      balance,
      reserved: Number(Buffer.from(account.padding).readBigUInt64LE()),
    };
  }

  buyInstruction(numbers, drawTime, ticketNonce = nonce(), user = this.user) {
    return this.client.program.methods
      .buyTicket(new BN(ticketNonce), new BN(drawTime), numbers)
      .accountsStrict({
        config: this.client.configAddress,
        vault: this.client.vaultAddress,
        ticket: getTicketPda(
          user,
          ticketNonce,
          this.client.program.programId,
        )[0],
        user,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  publishInstruction(drawTime, payer = this.user) {
    return this.client.program.methods
      .publishResult(new BN(drawTime))
      .accountsStrict({
        config: this.client.configAddress,
        vault: this.client.vaultAddress,
        result: getResultPda(drawTime, this.client.program.programId)[0],
        payer,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  settleInstruction(ticket, user = this.user) {
    return this.client.program.methods
      .settleTicket()
      .accountsStrict({
        config: this.client.configAddress,
        vault: this.client.vaultAddress,
        ticket: getTicketPda(
          this.user,
          ticket.id,
          this.client.program.programId,
        )[0],
        result: getResultPda(ticket.drawTime, this.client.program.programId)[0],
        user,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  async transactionDeltas(signature) {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const transaction = await this.connection.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      if (transaction?.meta) {
        assert.equal(transaction.meta.err, null);
        const keys =
          transaction.transaction.message.staticAccountKeys ??
          transaction.transaction.message.accountKeys;
        const delta = (key) => {
          const index = keys.findIndex((entry) => entry.equals(key));
          assert.ok(index >= 0);
          return (
            transaction.meta.postBalances[index] -
            transaction.meta.preBalances[index]
          );
        };
        return {
          fee: transaction.meta.fee,
          walletDelta: delta(this.user),
          vaultDelta: delta(this.client.vaultAddress),
        };
      }
      await pause(1_000);
    }
    throw new Error(
      `Transaction metadata unavailable: ${signature}. Inspect the saved receipt before retrying.`,
    );
  }

  async waitForDraw(drawTime) {
    console.log(JSON.stringify({ waitingForDraw: drawTime }));
    const deadline = Date.now() + 90_000;
    while (Date.now() / 1_000 < drawTime + 4) {
      assert.ok(Date.now() < deadline, "The draw wait exceeded 90 seconds.");
      await pause(1_000);
    }
  }

  async exerciseTicket(name, numbers, delay) {
    const drawTime = getUatDrawTime(Date.now(), delay);
    const ticketNonce = nonce();
    const ticket = await this.paid(
      `${name}Purchase`,
      { ticketNonce, drawTime, numbers },
      () => this.client.buyTicket(numbers, { drawTime, nonce: ticketNonce }),
    );
    const stored = await this.client.getTicket(ticket.id);
    assert.deepEqual(Array.from(stored.numbers), numbers);
    assert.equal(stored.settled, false);
    assert.equal((await this.snapshot()).reserved, this.payout);
    if (name === "losing") {
      const { balance, reserved } = await this.snapshot();
      const account = await this.connection.getAccountInfo(
        this.client.vaultAddress,
        "confirmed",
      );
      const rent = await this.connection.getMinimumBalanceForRentExemption(
        account.data.length,
      );
      const count =
        Math.floor((balance - rent - reserved) / (this.payout - this.cost)) + 1;
      assert.ok(
        count > 0 && count <= 5,
        "The vault is too large for the bounded overbooking probe.",
      );
      const instructions = await Promise.all(
        Array.from({ length: count }, () =>
          this.buyInstruction(UAT_RESULT, getUatDrawTime(Date.now(), 3_600)),
        ),
      );
      await this.simulate(
        "overbooking an outstanding prize",
        instructions,
        6014,
      );
    }
    await this.waitForDraw(drawTime);
    await this.paid(`${name}Publish`, { drawTime }, () =>
      this.client.publishResult(drawTime),
    );
    const outcome = await this.client.checkTicket(ticket);
    assert.deepEqual(outcome.numbers, UAT_RESULT);
    assert.equal(outcome.status, name === "winning" ? "won" : "lost");
    if (name === "losing")
      await this.simulate(
        "settling another wallet's ticket",
        await this.settleInstruction(ticket, this.attacker),
        6003,
      );
    const signature = await this.paid(
      `${name}Settle`,
      { ticketId: ticket.id },
      () => this.client.settleTicket(ticket),
    );
    const deltas = await this.transactionDeltas(signature);
    const prize = name === "winning" ? this.payout : 0;
    assert.equal(deltas.vaultDelta, prize === 0 ? 0 : -prize);
    assert.equal(deltas.walletDelta, prize - deltas.fee);
    assert.equal((await this.client.getTicket(ticket.id)).settled, true);
    assert.equal((await this.snapshot()).reserved, 0);
    this.receipt.data.steps[`${name}Settle`].verification = {
      ...deltas,
      reserveAfter: 0,
      outcome,
    };
    this.receipt.save();
    await this.simulate(
      `duplicate ${name} settlement`,
      await this.settleInstruction(ticket),
      6004,
    );
  }

  async resumeLosingTicket() {
    const report = this.receipt.data;
    assert.deepEqual(Object.keys(report.steps).sort(), [
      "losingPublish",
      "losingPurchase",
      "losingSettle",
    ]);
    const required = [
      ["unauthorized UAT configuration", 6003],
      ["unauthorized ticket purchase", 6016],
      ["unauthorized result publication", 6016],
      ["invalid direct number selection", 6005],
      ["past draw purchase", 6010],
      ["publishing before draw time", 6008],
      ["overbooking an outstanding prize", 6014],
      ["settling another wallet's ticket", 6003],
    ];
    assert.deepEqual(
      report.simulations.map(({ label, expectedCode, actualCode, error }) => [
        label,
        expectedCode,
        actualCode,
        error?.InstructionError?.[1]?.Custom,
      ]),
      required.map(([label, code]) => [label, code, code, code]),
      "The original eight security probes must all have passed.",
    );
    for (const step of Object.values(report.steps)) {
      assert.equal(step.status, "confirmed");
      assert.ok(step.signature);
    }
    const purchase = report.steps.losingPurchase;
    const ticket = purchase.result;
    assert.equal(ticket.id, purchase.ticketNonce);
    assert.equal(ticket.drawTime, purchase.drawTime);
    assert.equal(ticket.signature, purchase.signature);
    const previousFixedResult = report.fixedResult ?? [6, 9];
    assert.ok(
      ticket.numbers.length === 2 &&
        (report.fixedResult
          ? ticket.numbers[0] === 22 && ticket.numbers[1] === 2
          : [1, 2].includes(ticket.numbers[0]) && ticket.numbers[1] === 22),
      "The saved losing purchase must match its receipt's test scenario.",
    );
    assert.deepEqual(purchase.numbers, ticket.numbers);
    assert.equal(report.steps.losingPublish.drawTime, ticket.drawTime);
    assert.equal(report.steps.losingSettle.ticketId, ticket.id);
    const stored = await this.client.getTicket(ticket.id);
    assert.ok(stored);
    assert.equal(stored.user.toBase58(), this.user.toBase58());
    assert.equal(stored.nonce.toString(), ticket.id);
    assert.equal(stored.drawTime.toString(), String(ticket.drawTime));
    assert.deepEqual(Array.from(stored.numbers), ticket.numbers);
    assert.equal(stored.settled, true);
    const result = await this.client.getResult(ticket.drawTime);
    assert.ok(result?.isPublished);
    assert.equal(result.drawTime.toString(), String(ticket.drawTime));
    assert.deepEqual(Array.from(result.numbers), previousFixedResult);
    const outcome = await this.client.checkTicket(ticket);
    assert.equal(outcome.status, "lost");
    const deltas = await this.transactionDeltas(
      report.steps.losingSettle.signature,
    );
    assert.equal(deltas.vaultDelta, 0);
    assert.equal(deltas.walletDelta, -deltas.fee);
    const current = await this.snapshot();
    assert.equal(current.reserved, 0);
    assert.equal(current.balance, report.initial.balance + this.cost);
    report.steps.losingSettle.verification = {
      ...deltas,
      reserveAfter: 0,
      outcome,
    };
    report.resumedAfterLosing = new Date().toISOString();
    report.previousError = report.error;
    delete report.error;
    report.status = "running";
    this.receipt.save();
    await this.simulate(
      "duplicate losing settlement",
      await this.settleInstruction(ticket),
      6004,
    );
  }

  async run() {
    assert.equal(
      await this.connection.getGenesisHash(),
      DEVNET_GENESIS_HASH,
      "This test requires Solana Devnet.",
    );
    assert.equal(
      this.user.toBase58(),
      UAT_ADMIN,
      "Use the UAT administrator wallet.",
    );
    await requireCurrentUatRules(this.client);
    const config = await this.client.getConfig();
    assert.ok(
      config?.uatEnabled,
      "Upgrade the UAT program and configure its tester first.",
    );
    this.cost = Number(config.ticketCostLamports.toString());
    this.payout = Number(config.payoutLamports.toString());
    assert.equal(this.payout, 1_000_000_000);
    assert.ok(this.cost > 0 && this.cost < this.payout);
    const initial = await this.snapshot();
    assert.equal(
      initial.reserved,
      0,
      "Settle existing reserved tickets before running this test.",
    );
    this.receipt = new SecurityReceipt(
      {
        cluster: "devnet",
        program: this.client.program.programId.toBase58(),
        wallet: this.user.toBase58(),
        tester: config.uatTester,
        costLamports: this.cost,
        payoutLamports: this.payout,
        fixedResult: UAT_RESULT,
        initial,
      },
      this.resumeAfterLosing,
    );
    if (this.resumeAfterLosing) {
      await this.resumeLosingTicket();
    } else {
      const future = getUatDrawTime(Date.now(), 3_600);
      await this.simulate(
        "unauthorized UAT configuration",
        await this.client.program.methods
          .configureUat(this.attacker)
          .accountsStrict({
            config: this.client.configAddress,
            admin: this.attacker,
          })
          .instruction(),
        6003,
      );
      const simulatedFunding = SystemProgram.transfer({
        fromPubkey: this.user,
        toPubkey: this.attacker,
        lamports: 2_000_000,
      });
      await this.simulate(
        "unauthorized ticket purchase",
        [
          simulatedFunding,
          await this.buyInstruction(UAT_RESULT, future, nonce(), this.attacker),
        ],
        6016,
      );
      await this.simulate(
        "unauthorized result publication",
        [
          simulatedFunding,
          await this.publishInstruction(
            Math.floor(Date.now() / 1_000) - 1,
            this.attacker,
          ),
        ],
        6016,
      );
      await this.simulate(
        "invalid direct number selection",
        await this.buyInstruction([6, 6], future),
        6005,
      );
      await this.simulate(
        "past draw purchase",
        await this.buyInstruction(
          UAT_RESULT,
          Math.floor(Date.now() / 1_000) - 3_600,
        ),
        6010,
      );
      await this.simulate(
        "publishing before draw time",
        await this.publishInstruction(future),
        6008,
      );
      await this.exerciseTicket("losing", [22, 2], 35);
    }
    await this.exerciseTicket("winning", UAT_RESULT, 25);
    const recycleSignature = await this.paid(
      "recycleWinningPrize",
      { lamports: this.payout },
      () => fundVault(this.client, this.provider, this.payout / 1e9),
    );
    const recycle = await this.transactionDeltas(recycleSignature);
    assert.equal(recycle.vaultDelta, this.payout);
    assert.equal(recycle.walletDelta, -this.payout - recycle.fee);
    this.receipt.data.steps.recycleWinningPrize.verification = recycle;
    this.receipt.data.final = await this.snapshot();
    assert.equal(this.receipt.data.final.reserved, 0);
    assert.equal(
      this.receipt.data.final.balance,
      this.receipt.data.initial.balance + 2 * this.cost,
    );
    this.receipt.data.status = "complete";
    this.receipt.data.completedAt = new Date().toISOString();
    this.receipt.save();
    console.log(
      JSON.stringify({
        status: "complete",
        receipt: this.receipt.path,
        ...this.receipt.data.final,
      }),
    );
  }
}

const argumentsList = process.argv.slice(2);
assert.ok(
  argumentsList.length <= 1 &&
    argumentsList.every((argument) => argument === "--resume-after-losing"),
  "Supported option: --resume-after-losing",
);
const suite = new UatContractSuite(
  await createClient(),
  argumentsList.includes("--resume-after-losing"),
);
try {
  await suite.run();
} catch (failure) {
  if (suite.receipt) {
    suite.receipt.data.status = "incomplete";
    suite.receipt.data.error = failure.message;
    suite.receipt.save();
  }
  console.error(failure.message);
  process.exitCode = 1;
}

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { createClient } from "../hiperia_program/scripts/client.js";
import { getTicketPda } from "../src/lib/onchain/pdas.js";
import { getUatDrawTime } from "../src/lib/onchain/time.js";

const { client, provider } = await createClient();
const { connection, wallet } = provider;
const config = await client.getConfig();
if (!config) throw new Error("Initialize the program before the live test.");
const cost = Number(config.ticketCostLamports.toString());
const payout = Number(config.payoutLamports.toString());
const report = {
  cluster: "devnet",
  programId: client.program.programId.toBase58(),
  wallet: wallet.publicKey.toBase58(),
  costLamports: cost,
  payoutLamports: payout,
};
mkdirSync("hiperia_program/target/build", { recursive: true });
function save() {
  writeFileSync(
    "hiperia_program/target/build/live-test.json",
    JSON.stringify(report, null, 2) + "\n",
  );
}
const [beforeWallet, beforeVault] = await Promise.all([
  connection.getBalance(wallet.publicKey, "confirmed"),
  connection.getBalance(client.vaultAddress, "confirmed"),
]);
const ticket = await client.buyTicket([2, 22], {
  drawTime: getUatDrawTime(),
});
report.ticket = ticket;
save();
const address = getTicketPda(
  wallet.publicKey,
  ticket.id,
  client.program.programId,
)[0];
const [afterWallet, afterVault, account, transaction] = await Promise.all([
  connection.getBalance(wallet.publicKey, "confirmed"),
  connection.getBalance(client.vaultAddress, "confirmed"),
  connection.getAccountInfo(address, "confirmed"),
  connection.getTransaction(ticket.signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  }),
]);
if (!transaction?.meta || !account)
  throw new Error(
    "Purchase confirmed, but its account or transaction metadata is not available yet. Read the saved receipt before retrying.",
  );
report.purchase = {
  signature: ticket.signature,
  walletBefore: beforeWallet,
  walletAfter: afterWallet,
  walletDeduction: beforeWallet - afterWallet,
  ticketPrice: cost,
  ticketRent: account.lamports,
  transactionFee: transaction.meta.fee,
  vaultIncrease: afterVault - beforeVault,
};
assert.equal(report.purchase.vaultIncrease, cost);
assert.equal(
  report.purchase.walletDeduction,
  cost + account.lamports + transaction.meta.fee,
);
assert.deepEqual(
  Array.from((await client.getTicket(ticket.id)).numbers),
  [2, 22],
);
save();
console.log(JSON.stringify({ stage: "purchase-verified", ...report.purchase }));
console.log("Waiting for the 60-second draw...");
while (Date.now() / 1000 <= ticket.drawTime + 4)
  await new Promise((resolve) => setTimeout(resolve, 1000));
report.publishSignature = await client.publishResult(ticket.drawTime);
report.result = await client.checkTicket(ticket);
save();
const vaultBeforeSettlement = await connection.getBalance(
  client.vaultAddress,
  "confirmed",
);
report.settleSignature = await client.settleTicket(ticket);
report.settled = (await client.getTicket(ticket.id)).settled;
report.vaultPayout =
  vaultBeforeSettlement -
  (await connection.getBalance(client.vaultAddress, "confirmed"));
assert.equal(report.settled, true);
assert.equal(report.vaultPayout, report.result.status === "won" ? payout : 0);
save();
console.log(
  JSON.stringify({
    stage: "draw-and-settlement-verified",
    published: report.publishSignature,
    settled: report.settleSignature,
    result: report.result,
    vaultPayout: report.vaultPayout,
  }),
);

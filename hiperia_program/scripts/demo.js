import { createClient, requireCurrentUatRules } from "./client.js";
import { getUatDrawTime } from "../../src/lib/onchain/time.js";
const { client } = await createClient();
await requireCurrentUatRules(client);
if (!(await client.getConfig())?.uatEnabled)
  throw new Error("Upgrade and configure the fixed-result UAT program first.");
const values = process.argv.slice(2).map(Number);
const numbers = values.length ? values : [2, 22];
const drawTime = getUatDrawTime();
const ticket = await client.buyTicket(numbers, { drawTime });
console.log(`Ticket ${ticket.id} confirmed: ${ticket.signature}`);
console.log("Waiting 60 seconds for the demo draw.");
while (Date.now() / 1000 <= drawTime)
  await new Promise((resolve) => setTimeout(resolve, 1000));
console.log(
  `Published: ${(await client.publishResult(drawTime)) ?? "already published"}`,
);
const result = await client.checkTicket(ticket);
console.log(`Result: ${result.numbers.join(" - ")}; ticket ${result.status}.`);
console.log(`Settled: ${await client.settleTicket(ticket)}`);
console.log(
  result.status === "won"
    ? "Prize transferred to your wallet."
    : "No prize for this ticket; the on-chain flow completed.",
);

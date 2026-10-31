import { createClient } from "./client.js";
const { client } = await createClient();
const signature = await client.initialize();
console.log(
  signature ? `Initialized: ${signature}` : "Program is already initialized.",
);
const config = await client.getConfig();
console.log(
  `Ticket: ${Number(config.ticketCostLamports.toString()) / 1e9} SOL; prize: ${Number(config.payoutLamports.toString()) / 1e9} SOL.`,
);
console.log(`Fund prize vault: ${client.vaultAddress.toBase58()}`);

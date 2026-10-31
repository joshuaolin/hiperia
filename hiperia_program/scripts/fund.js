import { createClient, fundVault } from "./client.js";
const { client, provider } = await createClient();
if (!(await client.getConfig()))
  throw new Error("Initialize the program before funding the vault.");
const amount = Number(process.argv[2] ?? "2");
console.log(`Vault funded: ${await fundVault(client, provider, amount)}`);

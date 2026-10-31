import { inspectNetwork } from "../../src/lib/network.js";
import * as anchor from "@coral-xyz/anchor";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { DodosClient } from "../../src/lib/onchain/DodosClient.js";

export async function createClient() {
  process.env.ANCHOR_PROVIDER_URL ||= "https://api.devnet.solana.com";
  process.env.ANCHOR_WALLET ||= resolve(homedir(), ".config/solana/id.json");
  const provider = anchor.AnchorProvider.env();
  const network = await inspectNetwork(provider.connection);
  if (!network.allowed)
    throw new Error(
      "These demo scripts require Devnet, Testnet, or a local validator.",
    );
  const program = new DodosClient({
    connection: provider.connection,
    wallet: provider.wallet,
  });
  const account = await provider.connection.getAccountInfo(
    program.program.programId,
  );
  if (!account?.executable)
    throw new Error(
      "Program is not deployed at the configured address. Build, deploy, and sync the IDL first.",
    );
  return { client: program, provider };
}

export async function fundVault(client, provider, sol) {
  if (
    !Number.isFinite(sol) ||
    sol <= 0 ||
    !Number.isSafeInteger(Math.round(sol * 1e9))
  )
    throw new Error("Enter a positive SOL amount.");
  const instruction = anchor.web3.SystemProgram.transfer({
    fromPubkey: provider.wallet.publicKey,
    toPubkey: client.vaultAddress,
    lamports: Math.round(sol * 1e9),
  });
  return provider.sendAndConfirm(
    new anchor.web3.Transaction().add(instruction),
  );
}

export async function requireCurrentUatRules(client) {
  const rules = await client.getRules({ fresh: true });
  const config = await client.getConfig();
  if (
    rules.revision !== 4 ||
    config?.rulesRevision !== 4 ||
    !config.uatEnabled ||
    rules.winningNumbers.join(",") !== "2,22" ||
    rules.dailyHours.join(",") !== "2,6,10,14,18,22" ||
    rules.quickTicketCostLamports.toString() !== "7200000" ||
    rules.dailyTicketCostLamports.toString() !== "6250000" ||
    rules.quickPayoutLamports.toString() !== "1000000000" ||
    rules.dailyPayoutLamports.toString() !== "2000000000"
  )
    throw new Error(
      "Current UAT revision 4 with permissionless owner-directed settlement, fixed result 02 → 22, and draw prices must be verified before sending transactions.",
    );
  return rules;
}

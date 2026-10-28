import { inspectNetwork } from "../../lib/network.js";

export async function runDodosTransaction(connection, action) {
  const network = await inspectNetwork(connection);
  if (!network.allowed) {
    throw new Error(
      "Dodos transactions require Devnet, Testnet, or a local validator. Mainnet is disabled.",
    );
  }
  return action();
}

export const DEVNET_GENESIS_HASH =
  "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const TESTNET_GENESIS_HASH =
  "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY";
export const MAINNET_GENESIS_HASH =
  "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export async function inspectNetwork(connection) {
  const genesisHash = await connection.getGenesisHash();
  const rpcEndpoint = connection.rpcEndpoint;
  let local = false;
  try {
    const endpoint = new URL(rpcEndpoint);
    local =
      ["http:", "https:"].includes(endpoint.protocol) &&
      ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
  } catch {
    local = false;
  }
  const cluster =
    genesisHash === MAINNET_GENESIS_HASH
      ? "mainnet-beta"
      : genesisHash === DEVNET_GENESIS_HASH
        ? "devnet"
        : genesisHash === TESTNET_GENESIS_HASH
          ? "testnet"
          : local
            ? "custom"
            : null;
  const label =
    {
      "mainnet-beta": "Mainnet",
      devnet: "Devnet",
      testnet: "Testnet",
      custom: "Local validator",
    }[cluster] ?? "Unsupported network";
  return {
    label,
    genesisHash,
    allowed: ["devnet", "testnet", "custom"].includes(cluster),
    cluster,
    rpcEndpoint,
  };
}
export function explorerTransactionUrl(signature, network) {
  if (!signature || !network?.allowed) return null;
  const url = new URL(
    `https://explorer.solana.com/tx/${encodeURIComponent(signature)}`,
  );
  url.searchParams.set("cluster", network.cluster);
  if (network.cluster === "custom")
    url.searchParams.set("customUrl", network.rpcEndpoint);
  return url.toString();
}
const uiRequests = new WeakMap();
export function getNetworkStatus(connection) {
  const saved = uiRequests.get(connection);
  if (saved && Date.now() - saved.created < 30000) return saved.promise;
  const promise = inspectNetwork(connection).catch((error) => {
    uiRequests.delete(connection);
    throw error;
  });
  uiRequests.set(connection, { created: Date.now(), promise });
  return promise;
}

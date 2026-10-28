export function explorerAccountUrl(address, network) {
  if (
    !address ||
    !network?.allowed ||
    !["devnet", "testnet", "custom"].includes(network.cluster)
  )
    return null;
  const url = new URL(
    `https://explorer.solana.com/address/${encodeURIComponent(String(address))}`,
  );
  url.searchParams.set("cluster", network.cluster);
  if (network.cluster === "custom") {
    try {
      const rpc = new URL(network.rpcEndpoint);
      if (rpc.username || rpc.password || rpc.search || rpc.hash) return null;
      if (
        !["http:", "https:"].includes(rpc.protocol) ||
        !["localhost", "127.0.0.1", "[::1]"].includes(rpc.hostname)
      )
        return null;
      url.searchParams.set("customUrl", rpc.toString());
    } catch {
      return null;
    }
  }
  return url.toString();
}

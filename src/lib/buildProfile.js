export function isPublicVrfBuild(environment = import.meta.env ?? {}) {
  return (
    ["uat", "testnet-demo"].includes(environment.VITE_APP_ENV) &&
    environment.VITE_GAME_VERSION === "vrf" &&
    environment.VITE_SOLANA_RPC === "https://api.devnet.solana.com"
  );
}

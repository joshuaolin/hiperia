import test from "node:test";
import assert from "node:assert/strict";
import { isPublicVrfBuild } from "./buildProfile.js";

const publicProfile = {
  VITE_APP_ENV: "uat",
  VITE_GAME_VERSION: "vrf",
  VITE_SOLANA_RPC: "https://api.devnet.solana.com",
};

test("public VRF builds require explicit UAT or Devnet demo profiles", () => {
  for (const VITE_APP_ENV of ["uat", "testnet-demo"])
    assert.equal(isPublicVrfBuild({ ...publicProfile, VITE_APP_ENV }), true);

  for (const VITE_APP_ENV of [undefined, "", "production", "mainnet", "testnet"])
    assert.equal(isPublicVrfBuild({ ...publicProfile, VITE_APP_ENV }), false);

  for (const VITE_GAME_VERSION of [undefined, "", "legacy", "VRF"])
    assert.equal(isPublicVrfBuild({ ...publicProfile, VITE_GAME_VERSION }), false);

  assert.equal(isPublicVrfBuild({}), false);
});

test("public VRF builds require the exact Devnet endpoint", () => {
  for (const VITE_SOLANA_RPC of [
    undefined,
    "",
    "https://api.mainnet-beta.solana.com",
    "https://api.testnet.solana.com",
    "http://127.0.0.1:8899",
    "https://api.devnet.solana.com.attacker.example",
    "https://api.devnet.solana.com/",
  ])
    assert.equal(isPublicVrfBuild({ ...publicProfile, VITE_SOLANA_RPC }), false);
});

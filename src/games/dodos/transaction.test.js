import test from "node:test";
import assert from "node:assert/strict";
import { runDodosTransaction } from "./transaction.js";

const devnetHash = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const testnetHash = "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY";
const mainnetHash = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

test("Dodos permits verified test networks and explicit local validators", async () => {
  for (const [genesisHash, rpcEndpoint] of [
    [devnetHash, "https://rpc.example.com"],
    [testnetHash, "https://rpc.example.com"],
    ["local-genesis", "http://127.0.0.1:8899"],
  ]) {
    let calls = 0;
    const result = await runDodosTransaction(
      { rpcEndpoint, getGenesisHash: async () => genesisHash },
      async () => {
        calls += 1;
        return "signature";
      },
    );
    assert.equal(result, "signature");
    assert.equal(calls, 1);
  }
});

test("Dodos never invokes a signing action on mainnet or an unknown remote network", async () => {
  for (const [genesisHash, rpcEndpoint] of [
    [mainnetHash, "https://api.mainnet-beta.solana.com"],
    [mainnetHash, "http://127.0.0.1:8899"],
    ["unknown-genesis", "https://rpc.example.com"],
  ]) {
    let calls = 0;
    await assert.rejects(
      runDodosTransaction(
        { rpcEndpoint, getGenesisHash: async () => genesisHash },
        async () => {
          calls += 1;
        },
      ),
      /Mainnet is disabled/,
    );
    assert.equal(calls, 0);
  }
});

test("Dodos checks genesis for each transaction and fails closed when RPC verification fails", async () => {
  let genesisHash = devnetHash;
  let calls = 0;
  const connection = {
    rpcEndpoint: "https://rpc.example.com",
    getGenesisHash: async () => genesisHash,
  };
  const action = async () => {
    calls += 1;
  };
  await runDodosTransaction(connection, action);
  genesisHash = mainnetHash;
  await assert.rejects(
    runDodosTransaction(connection, action),
    /Mainnet is disabled/,
  );
  connection.getGenesisHash = async () => {
    throw new Error("RPC unavailable");
  };
  await assert.rejects(
    runDodosTransaction(connection, action),
    /RPC unavailable/,
  );
  assert.equal(calls, 1);
});

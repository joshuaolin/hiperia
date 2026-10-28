import test from "node:test";
import assert from "node:assert/strict";
import {
  DEVNET_GENESIS_HASH,
  getNetworkStatus,
  inspectNetwork,
} from "./network.js";

test("UI network reads share one request while signing checks remain fresh", async () => {
  let calls = 0;
  const connection = {
    rpcEndpoint: "https://api.devnet.solana.com",
    getGenesisHash: async () => {
      calls++;
      return DEVNET_GENESIS_HASH;
    },
  };
  const first = getNetworkStatus(connection);
  const second = getNetworkStatus(connection);
  assert.equal(first, second);
  assert.equal((await first).allowed, true);
  assert.equal(calls, 1);
  await inspectNetwork(connection);
  await inspectNetwork(connection);
  assert.equal(calls, 3);
});

test("a failed UI network request can be retried", async () => {
  let calls = 0;
  const connection = {
    rpcEndpoint: "https://api.devnet.solana.com",
    getGenesisHash: async () => {
      if (++calls === 1) throw Error("RPC unavailable");
      return DEVNET_GENESIS_HASH;
    },
  };
  await assert.rejects(getNetworkStatus(connection), /RPC unavailable/);
  assert.equal((await getNetworkStatus(connection)).cluster, "devnet");
  assert.equal(calls, 2);
});

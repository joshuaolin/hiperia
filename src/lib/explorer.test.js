import test from "node:test";
import assert from "node:assert/strict";
import { explorerAccountUrl } from "./explorer.js";

test("account history links identify the actual test cluster", () => {
  for (const cluster of ["devnet", "testnet"]) {
    const url = new URL(
      explorerAccountUrl("account", { allowed: true, cluster }),
    );
    assert.equal(url.origin, "https://explorer.solana.com");
    assert.equal(url.pathname, "/address/account");
    assert.equal(url.searchParams.get("cluster"), cluster);
  }
  assert.equal(
    explorerAccountUrl("account", { allowed: false, cluster: "mainnet-beta" }),
    null,
  );
  assert.equal(
    explorerAccountUrl("account", { allowed: true, cluster: "unknown" }),
    null,
  );
});

test("local history links preserve the validator endpoint without exposing credentials", () => {
  const network = {
    allowed: true,
    cluster: "custom",
    rpcEndpoint: "http://127.0.0.1:8899",
  };
  assert.equal(
    new URL(explorerAccountUrl("account", network)).searchParams.get(
      "customUrl",
    ),
    "http://127.0.0.1:8899/",
  );
  for (const rpcEndpoint of [
    "http://user:password@localhost:8899",
    "http://localhost:8899?token=secret",
    "https://untrusted.example",
    "javascript:alert(1)",
  ]) {
    assert.equal(
      explorerAccountUrl("account", { ...network, rpcEndpoint }),
      null,
    );
  }
});

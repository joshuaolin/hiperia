import test from "node:test";
import assert from "node:assert/strict";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import {
  createRpcProxy,
  DEVNET_RPC,
  validateRpcOrigin,
  validateRpcRequest,
} from "./rpcProxy.js";
import handler from "../../api/solana.js";

const keypair = Keypair.fromSeed(new Uint8Array(32).fill(7));
const address = keypair.publicKey.toBase58();
const request = (method, params = [], id = 1) => ({
  jsonrpc: "2.0",
  id,
  method,
  params,
});
const reply = (body, result) =>
  new Response(
    JSON.stringify({ jsonrpc: "2.0", id: JSON.parse(body).id, result }),
    { headers: { "content-type": "application/json" } },
  );

function transfer(recipient) {
  const transaction = new Transaction({
    feePayer: keypair.publicKey,
    recentBlockhash: address,
  });
  transaction.add(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: recipient,
      lamports: 1,
    }),
  );
  transaction.sign(keypair);
  return request("sendTransaction", [
    transaction.serialize().toString("base64"),
    { encoding: "base64", maxRetries: 0 },
  ]);
}

test("UAT RPC restricts origin, environment, methods, batches and bounded parameters", () => {
  const environment = {
    VERCEL_ENV: "preview",
    VERCEL_URL: "preview.vercel.app",
  };
  assert.doesNotThrow(() =>
    validateRpcOrigin(
      {
        host: "www.uat.hiperia.xyz",
        origin: "https://www.uat.hiperia.xyz",
        "sec-fetch-site": "same-origin",
      },
      environment,
    ),
  );
  for (const headers of [
    { host: "www.uat.hiperia.xyz" },
    { host: "www.uat.hiperia.xyz", origin: "https://attacker.example" },
    { host: "attacker.example", origin: "https://attacker.example" },
    {
      host: "www.uat.hiperia.xyz",
      origin: "https://www.uat.hiperia.xyz",
      "sec-fetch-site": "cross-site",
    },
  ])
    assert.throws(() => validateRpcOrigin(headers, environment));
  assert.throws(() =>
    validateRpcOrigin(
      { host: "www.uat.hiperia.xyz", origin: "https://www.uat.hiperia.xyz" },
      { ...environment, VERCEL_ENV: "production" },
    ),
  );
  for (const rpc of [
    [request("getGenesisHash")],
    request("requestAirdrop", [address, 1]),
    request("getProgramAccounts", [
      address,
      { encoding: "base64", filters: [] },
    ]),
    request("getAccountInfo", [address, { encoding: "jsonParsed" }]),
    request("getAccountInfo", [address, { url: "http://127.0.0.1/" }]),
    request("getMultipleAccounts", [Array(21).fill(address)]),
    request("getMinimumBalanceForRentExemption", [1_000_000]),
    request("getSignatureStatuses", [Array(9).fill("1".repeat(88))]),
    request("getBalance", ["invalid"]),
    { ...request("getGenesisHash"), id: null },
  ])
    assert.throws(() => validateRpcRequest(rpc));
});

test("RPC accepts exact app read shapes and restricts signed transfers to Hiperia", () => {
  for (const rpc of [
    request("getGenesisHash"),
    request("getBalance", [address, { commitment: "confirmed" }]),
    request("getAccountInfo", [
      address,
      { commitment: "confirmed", encoding: "base64" },
    ]),
    request("getLatestBlockhash", [{ commitment: "confirmed" }]),
    request("getBlockHeight", [{ commitment: "confirmed" }]),
    request("getSignatureStatuses", [
      ["1".repeat(88)],
      { searchTransactionHistory: true },
    ]),
    request("getFeeForMessage", ["AA==", { commitment: "confirmed" }]),
  ])
    assert.doesNotThrow(() => validateRpcRequest(rpc));
  const allowed = transfer("Ghxn7ree6MFQxC8hFTJ8Lo319xEZzqVFLcmDLKVFpPaa");
  assert.doesNotThrow(() => validateRpcRequest(allowed));
  assert.throws(() => validateRpcRequest(transfer(address)), /support-wallet/);
  assert.throws(() =>
    validateRpcRequest({
      ...allowed,
      params: [allowed.params[0], { encoding: "base64", skipPreflight: true }],
    }),
  );
  assert.throws(() =>
    validateRpcRequest(
      request("sendTransaction", ["AA==", { encoding: "base64" }]),
    ),
  );
});

test("RPC deduplicates concurrent reads, preserves ids, caches only selected reads", async () => {
  let calls = 0;
  let time = 1000;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const forward = createRpcProxy({
    now: () => time,
    fetchUpstream: async (url, init) => {
      assert.equal(url, DEVNET_RPC);
      assert.equal(init.redirect, "error");
      calls += 1;
      await gate;
      return reply(init.body, "devnet-genesis");
    },
  });
  const first = forward(request("getGenesisHash", [], "one"));
  const second = forward(request("getGenesisHash", [], "two"));
  release();
  assert.equal((await first).id, "one");
  assert.equal((await second).id, "two");
  assert.equal(calls, 1);
  await forward(request("getGenesisHash", [], "three"));
  assert.equal(calls, 1);
  time += 60_001;
  await forward(request("getGenesisHash"));
  assert.equal(calls, 2);
  for (const method of [
    "getBalance",
    "getLatestBlockhash",
    "getSignatureStatuses",
    "getAccountInfo",
  ]) {
    const params =
      method === "getLatestBlockhash"
        ? []
        : method === "getSignatureStatuses"
          ? [["1".repeat(88)]]
          : [address];
    await forward(request(method, params));
    await forward(request(method, params));
  }
  assert.equal(calls, 10);
});

test("RPC never retries, deduplicates or caches signed transaction submissions", async () => {
  let calls = 0;
  const forward = createRpcProxy({
    fetchUpstream: async () => {
      calls += 1;
      return new Response("busy", { status: 429 });
    },
  });
  const signed = transfer("Ghxn7ree6MFQxC8hFTJ8Lo319xEZzqVFLcmDLKVFpPaa");
  const results = await Promise.allSettled([forward(signed), forward(signed)]);
  assert.equal(calls, 2);
  assert.ok(
    results.every(
      (result) => result.status === "rejected" && result.reason.status === 429,
    ),
  );
  const reads = createRpcProxy({
    fetchUpstream: async (_url, init) => {
      calls += 1;
      return reply(init.body, null);
    },
  });
  for (let index = 0; index < 40; index += 1)
    await reads(request("getGenesisHash"), "same-ip");
  await assert.rejects(
    reads(request("getGenesisHash"), "same-ip"),
    (error) => error.status === 429,
  );
});

test("API rejects non-POST, invalid origin, non-JSON and oversized bodies before forwarding", async () => {
  const before = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = "preview";
  try {
    for (const [method, headers, body, expected] of [
      ["GET", {}, undefined, 405],
      ["POST", { host: "www.uat.hiperia.xyz" }, {}, 400],
      [
        "POST",
        {
          host: "www.uat.hiperia.xyz",
          origin: "https://www.uat.hiperia.xyz",
          "content-type": "text/plain",
        },
        "{}",
        415,
      ],
      [
        "POST",
        {
          host: "www.uat.hiperia.xyz",
          origin: "https://www.uat.hiperia.xyz",
          "content-type": "application/json",
        },
        "x".repeat(65_537),
        413,
      ],
      [
        "POST",
        {
          host: "www.uat.hiperia.xyz",
          origin: "https://www.uat.hiperia.xyz",
          "content-type": "application/json",
        },
        "{broken",
        400,
      ],
    ]) {
      const response = {
        setHeader() {},
        status(value) {
          this.code = value;
          return this;
        },
        json(value) {
          this.body = value;
          return this;
        },
      };
      await handler({ method, headers, body }, response);
      assert.equal(response.code, expected);
    }
  } finally {
    if (before === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = before;
  }
});

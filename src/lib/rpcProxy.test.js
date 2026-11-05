import test from "node:test";
import assert from "node:assert/strict";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  createRpcProxy,
  DEVNET_RPC,
  validateRpcOrigin,
  validateRpcRequest,
} from "./rpcProxy.js";
import handler from "../../api/solana.js";
import idl from "../idl/hiperia_program.json" with { type: "json" };
import vrfIdl from "../idl/hiperia_vrf.json" with { type: "json" };
import { getConfigPda } from "./onchain/pdas.js";

const keypair = Keypair.fromSeed(new Uint8Array(32).fill(7));
const address = keypair.publicKey.toBase58();
const rulesPayer = new PublicKey(
  "2txjN4S6WEiDDT8R3QvGFgwZrchQ8k5kBXRhbYFX1eSz",
);
const rulesDiscriminator = (method = "getrules", programIdl = idl) =>
  programIdl.instructions.find(
    ({ name }) => name.replaceAll("_", "").toLowerCase() === method,
  ).discriminator;
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

function rulesSimulation({
  payer = rulesPayer,
  program = new PublicKey(idl.address),
  config = getConfigPda(program)[0],
  writable = false,
  data = rulesDiscriminator(),
  extraInstructions = [],
  addressTables = [],
  mutate = () => {},
  rpcOptions = {},
} = {}) {
  const instruction = new TransactionInstruction({
    programId: program,
    keys: [{ pubkey: config, isSigner: false, isWritable: writable }],
    data: Buffer.from(data),
  });
  const transaction = new VersionedTransaction(
    new TransactionMessage({
      payerKey: payer,
      recentBlockhash: SystemProgram.programId.toBase58(),
      instructions: [instruction, ...extraInstructions],
    }).compileToV0Message(addressTables),
  );
  mutate(transaction);
  return request("simulateTransaction", [
    Buffer.from(transaction.serialize()).toString("base64"),
    {
      encoding: "base64",
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: "confirmed",
      ...rpcOptions,
    },
  ]);
}

function rulesResult(bytes = 56, programId = idl.address) {
  return {
    context: { slot: 123 },
    value: {
      err: null,
      logs: [],
      returnData: {
        programId,
        data: [Buffer.alloc(bytes, 3).toString("base64"), "base64"],
      },
    },
  };
}

function applicationTransaction(instructions) {
  const transaction = new VersionedTransaction(
    new TransactionMessage({
      payerKey: keypair.publicKey,
      recentBlockhash: address,
      instructions,
    }).compileToV0Message(),
  );
  transaction.sign([keypair]);
  return request("sendTransaction", [
    Buffer.from(transaction.serialize()).toString("base64"),
    { encoding: "base64", maxRetries: 0 },
  ]);
}

function appInstruction(programIdl, name, keys = []) {
  return new TransactionInstruction({
    programId: new PublicKey(programIdl.address),
    data: Buffer.from(
      programIdl.instructions.find((instruction) => instruction.name === name)
        .discriminator,
    ),
    keys,
  });
}

test("RPC accepts only the unsigned read-only get_rules simulation account set", () => {
  const valid = rulesSimulation();
  assert.doesNotThrow(() => validateRpcRequest(valid));
  for (const commitment of [undefined, "processed", "confirmed", "finalized"])
    assert.doesNotThrow(() =>
      validateRpcRequest(rulesSimulation({ rpcOptions: { commitment } })),
    );
  assert.doesNotThrow(() =>
    validateRpcRequest(
      rulesSimulation({
        mutate: ({ message }) => {
          [message.staticAccountKeys[1], message.staticAccountKeys[2]] = [
            message.staticAccountKeys[2],
            message.staticAccountKeys[1],
          ];
          const instruction = message.compiledInstructions[0];
          instruction.programIdIndex = 3 - instruction.programIdIndex;
          instruction.accountKeyIndexes[0] =
            3 - instruction.accountKeyIndexes[0];
        },
      }),
    ),
  );

  const otherInstructions = [
    "buy_ticket",
    "publish_result",
    "register_referral",
    "update_referral",
    "buy_ticket_referred",
    "qualify_referral",
  ].map((name) =>
    idl.instructions.find((instruction) => instruction.name === name),
  );
  for (const instruction of otherInstructions) {
    assert.ok(instruction);
    assert.throws(() =>
      validateRpcRequest(rulesSimulation({ data: instruction.discriminator })),
    );
  }
  const extraInstruction = new TransactionInstruction({
    programId: new PublicKey(idl.address),
    keys: [],
    data: Buffer.from(rulesDiscriminator()),
  });
  const lookup = new AddressLookupTableAccount({
    key: keypair.publicKey,
    state: {
      deactivationSlot: (1n << 64n) - 1n,
      lastExtendedSlot: 0,
      lastExtendedSlotStartIndex: 0,
      authority: undefined,
      addresses: [getConfigPda()[0]],
    },
  });
  for (const invalid of [
    rulesSimulation({ payer: keypair.publicKey }),
    rulesSimulation({ config: keypair.publicKey }),
    rulesSimulation({ program: SystemProgram.programId }),
    rulesSimulation({ writable: true }),
    rulesSimulation({ data: [...rulesDiscriminator(), 0] }),
    rulesSimulation({ extraInstructions: [extraInstruction] }),
    rulesSimulation({ addressTables: [lookup] }),
    rulesSimulation({
      mutate: (transaction) => {
        transaction.signatures[0][0] = 1;
      },
    }),
    rulesSimulation({
      mutate: ({ message }) => {
        message.compiledInstructions[0].accountKeyIndexes.push(0);
      },
    }),
    rulesSimulation({
      mutate: ({ message }) => {
        message.staticAccountKeys.push(keypair.publicKey);
        message.header.numReadonlyUnsignedAccounts += 1;
      },
    }),
    request("simulateTransaction", [
      Buffer.concat([
        Buffer.from(valid.params[0], "base64"),
        Buffer.alloc(1),
      ]).toString("base64"),
      valid.params[1],
    ]),
    request("simulateTransaction", ["AA==", valid.params[1]]),
    request("simulateTransaction", [valid.params[0]]),
    request("simulateTransaction", [...valid.params, {}]),
  ])
    assert.throws(() => validateRpcRequest(invalid));
  for (const rpcOptions of [
    { encoding: "jsonParsed" },
    { sigVerify: true },
    { sigVerify: undefined },
    { replaceRecentBlockhash: false },
    { replaceRecentBlockhash: undefined },
    { commitment: "invalid" },
    { accounts: { encoding: "base64", addresses: [address] } },
    { accountOverrides: {} },
    { innerInstructions: true },
    { minContextSlot: 0 },
  ])
    assert.throws(() => validateRpcRequest(rulesSimulation({ rpcOptions })));
  assert.throws(() =>
    validateRpcRequest(
      request("sendTransaction", [valid.params[0], { encoding: "base64" }]),
    ),
  );
});

test("referral metadata permits only the same readonly account set and a 34-byte return", async () => {
  const data = rulesDiscriminator("getreferralrules");
  assert.ok(data);
  const simulation = rulesSimulation({ data });
  assert.doesNotThrow(() => validateRpcRequest(simulation));
  for (const override of [
    { writable: true },
    { payer: keypair.publicKey },
    { config: keypair.publicKey },
    { data: [...data, 0] },
    { rpcOptions: { sigVerify: true } },
  ])
    assert.throws(() =>
      validateRpcRequest(rulesSimulation({ data, ...override })),
    );
  for (const [request, bytes, expectedCalls] of [
    [simulation, 34, 1],
    [simulation, 56, 2],
    [rulesSimulation(), 34, 2],
  ]) {
    let calls = 0;
    const forward = createRpcProxy({
      fetchUpstream: async (_url, init) => {
        calls++;
        return reply(init.body, rulesResult(bytes));
      },
    });
    if (expectedCalls === 1) {
      await forward(request);
      await forward({ ...request, id: "cached-check" });
    } else {
      await assert.rejects(forward(request), /Unexpected Hiperia metadata/);
      await assert.rejects(
        forward({ ...request, id: "cached-check" }),
        /Unexpected Hiperia metadata/,
      );
    }
    assert.equal(calls, expectedCalls);
  }
});

test("VRF readonly metadata requires its own program, config, discriminator and exact return format", async () => {
  const program = new PublicKey(vrfIdl.address);
  for (const [method, bytes] of [
    ["getrules", 56],
    ["getaccessrules", 3],
    ["getrandomnessrules", 39],
  ]) {
    const data = rulesDiscriminator(method, vrfIdl);
    const simulation = rulesSimulation({ program, data });
    assert.doesNotThrow(() => validateRpcRequest(simulation));
    for (const override of [
      { config: getConfigPda()[0] },
      { payer: keypair.publicKey },
      { writable: true },
      { data: [...data, 0] },
      { data: rulesDiscriminator("getreferralrules") },
      { rpcOptions: { sigVerify: true } },
    ])
      assert.throws(() =>
        validateRpcRequest(rulesSimulation({ program, data, ...override })),
      );

    for (const [returnedProgram, returnedBytes, encoding, expectedCalls] of [
      [vrfIdl.address, bytes, "base64", 1],
      [idl.address, bytes, "base64", 2],
      [address, bytes, "base64", 2],
      [vrfIdl.address, bytes - 1, "base64", 2],
      [vrfIdl.address, bytes + 1, "base64", 2],
      [vrfIdl.address, bytes, "base58", 2],
    ]) {
      let calls = 0;
      const forward = createRpcProxy({
        fetchUpstream: async (_url, init) => {
          calls++;
          const value = rulesResult(returnedBytes, returnedProgram);
          value.value.returnData.data[1] = encoding;
          return reply(init.body, value);
        },
      });
      if (expectedCalls === 1) {
        await forward(simulation);
        await forward({ ...simulation, id: "cache-check" });
      } else {
        await assert.rejects(
          forward(simulation),
          /Unexpected Hiperia metadata/,
        );
        await assert.rejects(
          forward({ ...simulation, id: "cache-check" }),
          /Unexpected Hiperia metadata/,
        );
      }
      assert.equal(
        calls,
        expectedCalls,
        `${method} ${returnedProgram} ${returnedBytes} ${encoding}`,
      );
    }
  }
  for (const name of [
    "initialize",
    "buy_ticket",
    "request_draw",
    "finalize_draw",
    "reclaim_oracle_funding",
    "release_losing_ticket",
    "settle_ticket",
    "refund_ticket",
  ])
    assert.throws(() =>
      validateRpcRequest(
        rulesSimulation({ program, data: appInstruction(vrfIdl, name).data }),
      ),
    );
  for (const method of ["getaccessrules", "getrandomnessrules"])
    assert.throws(() =>
      validateRpcRequest(
        rulesSimulation({ data: rulesDiscriminator(method, vrfIdl) }),
      ),
    );
});

test("metadata cache isolates matching discriminators across legacy and VRF programs", async () => {
  let calls = 0;
  const forward = createRpcProxy({
    fetchUpstream: async (_url, init) => {
      calls++;
      const encoded = JSON.parse(init.body).params[0];
      const { message } = VersionedTransaction.deserialize(
        Buffer.from(encoded, "base64"),
      );
      const program =
        message.staticAccountKeys[
          message.compiledInstructions[0].programIdIndex
        ].toBase58();
      return reply(init.body, rulesResult(56, program));
    },
  });
  const legacy = rulesSimulation();
  const vrf = rulesSimulation({ program: new PublicKey(vrfIdl.address) });
  for (const simulation of [legacy, vrf, legacy, vrf]) {
    const response = await forward(simulation);
    assert.equal(
      response.result.value.returnData.programId,
      simulation === legacy ? idl.address : vrfIdl.address,
    );
  }
  assert.equal(calls, 2);
});

test("RPC scans only the selected Hiperia program's own account discriminators", () => {
  const scan = (program, bytes, filters = []) =>
    request("getProgramAccounts", [
      program,
      {
        encoding: "base64",
        filters: [{ memcmp: { offset: 0, bytes } }, ...filters],
      },
    ]);
  for (const program of [idl.address, vrfIdl.address]) {
    for (const discriminator of ["SwB71qnXfS1", "81PvQMqKDRR", "cJJWPqNMczr"])
      assert.doesNotThrow(() =>
        validateRpcRequest(scan(program, discriminator)),
      );
  }
  assert.doesNotThrow(() =>
    validateRpcRequest(scan(vrfIdl.address, "eikdvv2Nho7")),
  );
  assert.doesNotThrow(() =>
    validateRpcRequest(scan(idl.address, "UTqcV5CTiFB")),
  );
  assert.doesNotThrow(() =>
    validateRpcRequest(scan(idl.address, "3Dx2CcGuVDq")),
  );
  for (const invalid of [
    scan(idl.address, "eikdvv2Nho7"),
    scan(vrfIdl.address, "UTqcV5CTiFB"),
    scan(vrfIdl.address, "3Dx2CcGuVDq"),
    scan(address, "81PvQMqKDRR"),
    scan("VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y", "eikdvv2Nho7"),
    scan(vrfIdl.address, "81PvQMqKDRR", [
      { memcmp: { offset: 129, bytes: address } },
    ]),
    scan(vrfIdl.address, "81PvQMqKDRR", Array(4).fill({ dataSize: 100 })),
    request("getProgramAccounts", [
      vrfIdl.address,
      { encoding: "base64", filters: [] },
    ]),
    request("getProgramAccounts", [
      vrfIdl.address,
      {
        encoding: "base64",
        filters: [{ memcmp: { offset: 1, bytes: "eikdvv2Nho7" } }],
      },
    ]),
  ])
    assert.throws(() => validateRpcRequest(invalid));
});

test("signed app transactions support both Hiperia programs while rejecting direct oracle calls", () => {
  for (const [program, names] of [
    [idl, ["buy_ticket", "publish_result", "settle_ticket"]],
    [
      vrfIdl,
      [
        "buy_ticket",
        "request_draw",
        "finalize_draw",
        "reclaim_oracle_funding",
        "release_losing_ticket",
        "settle_ticket",
        "refund_ticket",
      ],
    ],
  ]) {
    for (const name of names)
      assert.doesNotThrow(() =>
        validateRpcRequest(
          applicationTransaction([appInstruction(program, name)]),
        ),
      );
  }
  const oracle = new PublicKey("VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y");
  const appRequest = appInstruction(vrfIdl, "request_draw", [
    { pubkey: oracle, isSigner: false, isWritable: false },
  ]);
  assert.doesNotThrow(() =>
    validateRpcRequest(applicationTransaction([appRequest])),
  );
  assert.doesNotThrow(() =>
    validateRpcRequest(
      applicationTransaction([
        appInstruction(idl, "settle_ticket"),
        appInstruction(vrfIdl, "settle_ticket"),
      ]),
    ),
  );
  const directOracle = new TransactionInstruction({
    programId: oracle,
    keys: [],
    data: Buffer.from([38, 151, 209, 6, 195, 102, 28, 217]),
  });
  for (const instructions of [
    [directOracle],
    [appRequest, directOracle],
    [
      new TransactionInstruction({
        programId: keypair.publicKey,
        keys: [],
        data: Buffer.alloc(0),
      }),
    ],
  ])
    assert.throws(
      () => validateRpcRequest(applicationTransaction(instructions)),
      /Only Hiperia/,
    );
  assert.throws(() =>
    validateRpcRequest(applicationTransaction(Array(9).fill(appRequest))),
  );
});

test("wallet compute budgets fit alongside bounded multi-ticket draw completion", async () => {
  const budgets = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5_000 }),
  ];
  const completion = (losses) => [
    appInstruction(vrfIdl, "finalize_draw"),
    appInstruction(vrfIdl, "reclaim_oracle_funding"),
    ...Array.from({ length: losses }, () =>
      appInstruction(vrfIdl, "release_losing_ticket"),
    ),
  ];
  for (const losses of [3, 5, 6]) {
    for (const instructions of [
      [...budgets, ...completion(losses)],
      [...completion(losses), ...budgets],
    ])
      assert.doesNotThrow(() =>
        validateRpcRequest(applicationTransaction(instructions)),
      );
  }
  let calls = 0;
  const rpc = applicationTransaction([...budgets, ...completion(5)]);
  rpc.params[1] = {
    encoding: "base64",
    skipPreflight: false,
    preflightCommitment: "confirmed",
    maxRetries: 0,
  };
  const forward = createRpcProxy({
    fetchUpstream: async (_url, init) => {
      calls++;
      assert.deepEqual(JSON.parse(init.body), rpc);
      return reply(init.body, "confirmed-test-signature");
    },
  });
  assert.equal((await forward(rpc)).result, "confirmed-test-signature");
  assert.equal(calls, 1);
  for (const instructions of [
    completion(7),
    [...budgets.slice(0, 1), ...completion(7)],
    [...budgets, ...completion(7)],
  ])
    assert.throws(() =>
      validateRpcRequest(applicationTransaction(instructions)),
    );
});

test("compute budget exceptions reject malformed, repeated and unrelated instructions", () => {
  const app = appInstruction(vrfIdl, "finalize_draw");
  const limit = ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 });
  const price = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0 });
  const rawBudget = (data, keys = []) =>
    new TransactionInstruction({
      programId: ComputeBudgetProgram.programId,
      data: Buffer.from(data),
      keys,
    });
  for (const instructions of [
    [limit, limit, app],
    [price, price, app],
    [limit, price, limit, app],
    [rawBudget([2]), app],
    [rawBudget([2, 1, 0, 0, 0, 0]), app],
    [rawBudget([3]), app],
    [rawBudget([3, 0, 0, 0, 0, 0, 0, 0, 0, 0]), app],
    [rawBudget([1, 0, 0, 0, 0]), app],
    [
      rawBudget(limit.data, [
        { pubkey: keypair.publicKey, isSigner: false, isWritable: false },
      ]),
      app,
    ],
    [ComputeBudgetProgram.setComputeUnitLimit({ units: 0 }), app],
    [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_001 }), app],
  ])
    assert.throws(() =>
      validateRpcRequest(applicationTransaction(instructions)),
    );
  assert.doesNotThrow(() =>
    validateRpcRequest(
      applicationTransaction([
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
        price,
        app,
      ]),
    ),
  );
  assert.throws(() =>
    validateRpcRequest(applicationTransaction([limit, price])),
  );
});

test("RPC deduplicates and caches successful rules metadata for only 30 seconds", async () => {
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
      assert.equal(JSON.parse(init.body).method, "simulateTransaction");
      calls += 1;
      await gate;
      return reply(init.body, rulesResult());
    },
  });
  const simulation = rulesSimulation();
  const first = forward({ ...simulation, id: "first" });
  const second = forward({ ...simulation, id: "second" });
  release();
  assert.equal((await first).id, "first");
  assert.equal((await second).id, "second");
  assert.equal(calls, 1);
  time += 29_999;
  await forward({ ...simulation, id: "cached" });
  assert.equal(calls, 1);
  time += 1;
  await forward(simulation);
  assert.equal(calls, 2);
});

test("RPC does not cache simulation errors and rejects mismatched successful metadata", async () => {
  const unsupported = rulesResult();
  delete unsupported.value.returnData;
  const failed = rulesResult();
  failed.value.err = { InstructionError: [0, "InvalidInstructionData"] };
  const foreign = rulesResult();
  foreign.value.returnData.programId = address;
  const shortData = rulesResult();
  shortData.value.returnData.data[0] = Buffer.alloc(55).toString("base64");
  for (const simulation of [unsupported, failed, foreign, shortData]) {
    let calls = 0;
    const forward = createRpcProxy({
      fetchUpstream: async (_url, init) => {
        calls += 1;
        return reply(init.body, simulation);
      },
    });
    if (simulation === failed) {
      await forward(rulesSimulation());
      await forward(rulesSimulation());
    } else {
      for (let index = 0; index < 2; index++)
        await assert.rejects(
          forward(rulesSimulation()),
          (error) => error.status === 502 && /metadata/.test(error.message),
        );
    }
    assert.equal(calls, 2);
  }
  let errors = 0;
  const failedRpc = createRpcProxy({
    fetchUpstream: async (_url, init) => {
      errors += 1;
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: JSON.parse(init.body).id,
          error: { code: -32601, message: "Method unavailable" },
        }),
      );
    },
  });
  await failedRpc(rulesSimulation());
  await failedRpc(rulesSimulation());
  assert.equal(errors, 2);
});

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

test("production Devnet proxy requires exact server opt-in and fixed same-origin hosts", () => {
  const environment = {
    VERCEL_ENV: "production",
    VERCEL_URL: "hiperia-demo-team.vercel.app",
    HIPERIA_TESTNET_DEMO: "1",
  };
  const headers = (host) => ({
    host,
    origin: `https://${host}`,
    "sec-fetch-site": "same-origin",
  });
  for (const host of [
    "hiperia.xyz",
    "www.hiperia.xyz",
    "uat.hiperia.xyz",
    environment.VERCEL_URL,
  ])
    assert.doesNotThrow(() => validateRpcOrigin(headers(host), environment));
  for (const host of [
    "www.uat.hiperia.xyz",
    "attacker.example",
    "hiperia.xyz.attacker.example",
    "hiperia.xyz:443",
    "localhost",
  ])
    assert.throws(() => validateRpcOrigin(headers(host), environment));
  for (const flag of [undefined, "0", "true", " 1", "1 "])
    assert.throws(() =>
      validateRpcOrigin(headers("hiperia.xyz"), {
        ...environment,
        HIPERIA_TESTNET_DEMO: flag,
        VITE_APP_ENV: "testnet-demo",
      }),
    );
  for (const VERCEL_ENV of [undefined, "development", "test", "preview"])
    assert.throws(() =>
      validateRpcOrigin(headers("hiperia.xyz"), { ...environment, VERCEL_ENV }),
    );
  for (const invalid of [
    { host: "hiperia.xyz" },
    { ...headers("hiperia.xyz"), origin: "http://hiperia.xyz" },
    { ...headers("hiperia.xyz"), origin: "https://www.hiperia.xyz" },
    { ...headers("hiperia.xyz"), "sec-fetch-site": "cross-site" },
    { ...headers("hiperia.xyz"), "sec-fetch-site": "same-site" },
  ])
    assert.throws(() => validateRpcOrigin(invalid, environment));
  assert.doesNotThrow(() =>
    validateRpcOrigin(headers("www.uat.hiperia.xyz"), {
      ...environment,
      VERCEL_ENV: "preview",
    }),
  );
  assert.equal(DEVNET_RPC, "https://api.devnet.solana.com");
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

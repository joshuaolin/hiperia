import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { Buffer } from "node:buffer";
import idl from "../idl/hiperia_program.json" with { type: "json" };
import vrfIdl from "../idl/hiperia_vrf.json" with { type: "json" };

export const DEVNET_RPC = "https://api.devnet.solana.com";
export const RPC_BODY_LIMIT = 65_536;
const SUPPORT_WALLET = "Ghxn7ree6MFQxC8hFTJ8Lo319xEZzqVFLcmDLKVFpPaa";
const RULES_PAYER = "2txjN4S6WEiDDT8R3QvGFgwZrchQ8k5kBXRhbYFX1eSz";
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;
const COMMITMENTS = new Set(["processed", "confirmed", "finalized"]);
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function encodeDiscriminator(discriminator) {
  let number = BigInt(`0x${Buffer.from(discriminator).toString("hex")}`);
  let encoded = "";
  while (number > 0n) {
    encoded = ALPHABET[Number(number % 58n)] + encoded;
    number /= 58n;
  }
  for (const byte of discriminator) {
    if (byte !== 0) break;
    encoded = `1${encoded}`;
  }
  return encoded;
}
const PROGRAMS = new Map(
  [
    [idl, { getrules: 56, getreferralrules: 34 }],
    [vrfIdl, { getrules: 56, getaccessrules: 3, getrandomnessrules: 39 }],
  ].map(([program, sizes]) => [
    program.address,
    {
      config: PublicKey.findProgramAddressSync(
        [Buffer.from("config")],
        new PublicKey(program.address),
      )[0].toBase58(),
      metadata: program.instructions.flatMap(({ name, discriminator }) => {
        const bytes = sizes[name.replaceAll("_", "").toLowerCase()];
        return bytes
          ? [{ discriminator: Buffer.from(discriminator), bytes }]
          : [];
      }),
      discriminators: new Set(
        program.accounts.map(({ discriminator }) =>
          encodeDiscriminator(discriminator),
        ),
      ),
    },
  ]),
);
const READ_METHODS = new Set([
  "getGenesisHash",
  "getAccountInfo",
  "getMultipleAccounts",
  "getBalance",
  "getLatestBlockhash",
  "getBlockHeight",
  "getFeeForMessage",
  "getSignatureStatuses",
  "getMinimumBalanceForRentExemption",
  "getProgramAccounts",
  "simulateTransaction",
]);

export class RpcProxyError extends Error {
  constructor(message, status = 400, code = -32602) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function requireValue(condition, message = "Unsupported RPC parameters.") {
  if (!condition) throw new RpcProxyError(message);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function publicKey(value) {
  if (typeof value !== "string" || value.length > 44 || !BASE58.test(value))
    return false;
  try {
    return new PublicKey(value).toBase58() === value;
  } catch {
    return false;
  }
}

function base64(value, maximum = 1232) {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > Math.ceil(maximum / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  )
    return false;
  const bytes = Buffer.from(value, "base64");
  return (
    bytes.length > 0 &&
    bytes.length <= maximum &&
    bytes.toString("base64") === value
  );
}

function options(value = {}, extra = []) {
  requireValue(isObject(value));
  requireValue(
    Object.keys(value).every((key) =>
      ["commitment", "minContextSlot", ...extra].includes(key),
    ),
  );
  if (value.commitment !== undefined)
    requireValue(COMMITMENTS.has(value.commitment));
  if (value.minContextSlot !== undefined)
    requireValue(
      Number.isSafeInteger(value.minContextSlot) && value.minContextSlot >= 0,
    );
  if (value.encoding !== undefined) requireValue(value.encoding === "base64");
  return value;
}

function accountOptions(value) {
  return options(value, ["encoding"]);
}

function validateTransaction(encoded) {
  requireValue(
    base64(encoded),
    "Transaction exceeds the supported wire format.",
  );
  let transaction;
  try {
    transaction = VersionedTransaction.deserialize(
      Buffer.from(encoded, "base64"),
    );
  } catch {
    throw new RpcProxyError("Invalid transaction.");
  }
  const message = transaction.message;
  requireValue(
    !message.addressTableLookups?.length,
    "Address lookup tables are not supported by UAT.",
  );
  requireValue(
    transaction.signatures.length > 0 &&
      transaction.signatures.every((signature) =>
        signature.some((byte) => byte !== 0),
      ),
    "A signed transaction is required.",
  );
  const keys = message.staticAccountKeys;
  requireValue(
    message.compiledInstructions.length > 0 &&
      message.compiledInstructions.length <= 8,
  );
  let applicationInstruction = false;
  for (const instruction of message.compiledInstructions) {
    const program = keys[instruction.programIdIndex]?.toBase58();
    if (PROGRAMS.has(program)) {
      applicationInstruction = true;
      continue;
    }
    if (program === "ComputeBudget111111111111111111111111111111") {
      requireValue([2, 3].includes(instruction.data[0]));
      continue;
    }
    requireValue(
      program === "11111111111111111111111111111111",
      "Only Hiperia transactions are supported.",
    );
    const data = Buffer.from(instruction.data);
    requireValue(
      data.length === 12 &&
        data.readUInt32LE(0) === 2 &&
        keys[instruction.accountKeyIndexes[1]]?.toBase58() === SUPPORT_WALLET,
      "Only support-wallet transfers are supported.",
    );
    applicationInstruction = true;
  }
  requireValue(applicationInstruction, "A Hiperia instruction is required.");
}

function validateRulesSimulation(params) {
  requireValue(params.length === 2 && base64(params[0]));
  const config = params[1];
  requireValue(
    isObject(config) &&
      Object.keys(config).every((key) =>
        [
          "encoding",
          "sigVerify",
          "replaceRecentBlockhash",
          "commitment",
        ].includes(key),
      ) &&
      config.encoding === "base64" &&
      config.sigVerify === false &&
      config.replaceRecentBlockhash === true &&
      (config.commitment === undefined || COMMITMENTS.has(config.commitment)),
    "Only the read-only rules simulation is supported.",
  );
  let transaction;
  const wire = Buffer.from(params[0], "base64");
  try {
    transaction = VersionedTransaction.deserialize(wire);
    requireValue(Buffer.from(transaction.serialize()).equals(wire));
  } catch {
    throw new RpcProxyError("Invalid rules simulation transaction.");
  }
  const message = transaction.message;
  const keys = message.staticAccountKeys.map((key) => key.toBase58());
  const instruction = message.compiledInstructions[0];
  const programId = keys[instruction?.programIdIndex];
  const program = PROGRAMS.get(programId);
  requireValue(
    program &&
      message.version === 0 &&
      !message.addressTableLookups.length &&
      message.header.numRequiredSignatures === 1 &&
      message.header.numReadonlySignedAccounts === 0 &&
      message.header.numReadonlyUnsignedAccounts === 2 &&
      transaction.signatures.length === 1 &&
      transaction.signatures[0].every((byte) => byte === 0) &&
      keys.length === 3 &&
      new Set(keys).size === 3 &&
      keys[0] === RULES_PAYER &&
      keys.includes(program.config) &&
      keys.includes(programId) &&
      message.compiledInstructions.length === 1,
    "Only the unsigned read-only rules simulation is supported.",
  );
  const metadata = program.metadata.find(
    ({ discriminator }) =>
      discriminator.length === 8 &&
      Buffer.from(instruction.data).equals(discriminator),
  );
  requireValue(
    instruction.accountKeyIndexes.length === 1 &&
      keys[instruction.accountKeyIndexes[0]] === program.config &&
      metadata,
    "Only this Hiperia program's read-only metadata instructions are supported for simulation.",
  );
  return { programId, bytes: metadata.bytes };
}

function hasRulesReturnData(value, request) {
  const simulation = value.result?.value;
  const metadata = validateRulesSimulation(request.params);
  return (
    !value.error &&
    simulation?.err === null &&
    simulation.returnData?.programId === metadata.programId &&
    Array.isArray(simulation.returnData.data) &&
    simulation.returnData.data.length === 2 &&
    simulation.returnData.data[1] === "base64" &&
    base64(simulation.returnData.data[0], 56) &&
    Buffer.from(simulation.returnData.data[0], "base64").length ===
      metadata?.bytes
  );
}

export function validateRpcRequest(request) {
  requireValue(isObject(request), "RPC batches are not supported.");
  requireValue(
    Object.keys(request).every((key) =>
      ["jsonrpc", "id", "method", "params"].includes(key),
    ),
  );
  requireValue(
    request.jsonrpc === "2.0" &&
      ((typeof request.id === "string" && request.id.length <= 100) ||
        Number.isSafeInteger(request.id)),
    "A JSON-RPC request id is required.",
  );
  const { method } = request;
  requireValue(
    READ_METHODS.has(method) || method === "sendTransaction",
    "RPC method is not available.",
  );
  const params = request.params ?? [];
  requireValue(Array.isArray(params));
  if (method === "getGenesisHash") requireValue(params.length === 0);
  else if (["getLatestBlockhash", "getBlockHeight"].includes(method)) {
    requireValue(params.length <= 1);
    options(params[0]);
  } else if (["getAccountInfo", "getBalance"].includes(method)) {
    requireValue(
      params.length >= 1 && params.length <= 2 && publicKey(params[0]),
    );
    if (method === "getAccountInfo") accountOptions(params[1]);
    else options(params[1]);
  } else if (method === "getMultipleAccounts") {
    requireValue(
      params.length >= 1 &&
        params.length <= 2 &&
        Array.isArray(params[0]) &&
        params[0].length > 0 &&
        params[0].length <= 20 &&
        params[0].every(publicKey),
    );
    accountOptions(params[1]);
  } else if (method === "getMinimumBalanceForRentExemption") {
    requireValue(
      params.length >= 1 &&
        params.length <= 2 &&
        Number.isSafeInteger(params[0]) &&
        params[0] >= 0 &&
        params[0] <= 4096,
    );
    options(params[1]);
  } else if (method === "getFeeForMessage") {
    requireValue(params.length >= 1 && params.length <= 2 && base64(params[0]));
    options(params[1]);
  } else if (method === "getSignatureStatuses") {
    requireValue(
      params.length >= 1 &&
        params.length <= 2 &&
        Array.isArray(params[0]) &&
        params[0].length > 0 &&
        params[0].length <= 8 &&
        params[0].every(
          (value) =>
            typeof value === "string" &&
            value.length >= 64 &&
            value.length <= 88 &&
            BASE58.test(value),
        ),
    );
    if (params[1] !== undefined)
      requireValue(
        isObject(params[1]) &&
          Object.keys(params[1]).every(
            (key) => key === "searchTransactionHistory",
          ) &&
          typeof params[1].searchTransactionHistory === "boolean",
      );
  } else if (method === "getProgramAccounts") {
    requireValue(
      params.length === 2 && PROGRAMS.has(params[0]),
      "Only Hiperia programs may be scanned.",
    );
    const config = options(params[1], ["encoding", "filters", "withContext"]);
    requireValue(
      config.withContext === undefined ||
        typeof config.withContext === "boolean",
    );
    requireValue(
      Array.isArray(config.filters) &&
        config.filters.length >= 1 &&
        config.filters.length <= 4,
    );
    let discriminator = false;
    for (const filter of config.filters) {
      requireValue(isObject(filter) && Object.keys(filter).length === 1);
      if (filter.dataSize !== undefined)
        requireValue(
          Number.isSafeInteger(filter.dataSize) &&
            filter.dataSize > 0 &&
            filter.dataSize <= 4096,
        );
      else {
        const memcmp = filter.memcmp;
        requireValue(
          isObject(memcmp) &&
            Object.keys(memcmp).every((key) =>
              ["offset", "bytes", "encoding"].includes(key),
            ) &&
            Number.isInteger(memcmp.offset) &&
            memcmp.offset >= 0 &&
            memcmp.offset <= 128 &&
            typeof memcmp.bytes === "string" &&
            memcmp.bytes.length > 0 &&
            memcmp.bytes.length <= 128 &&
            BASE58.test(memcmp.bytes) &&
            (memcmp.encoding === undefined || memcmp.encoding === "base58"),
        );
        if (
          memcmp.offset === 0 &&
          PROGRAMS.get(params[0]).discriminators.has(memcmp.bytes)
        )
          discriminator = true;
      }
    }
    requireValue(discriminator, "An account discriminator filter is required.");
  } else if (method === "simulateTransaction") {
    validateRulesSimulation(params);
  } else if (method === "sendTransaction") {
    requireValue(params.length === 2);
    validateTransaction(params[0]);
    const config = params[1];
    requireValue(
      isObject(config) &&
        Object.keys(config).every((key) =>
          [
            "encoding",
            "skipPreflight",
            "preflightCommitment",
            "maxRetries",
            "minContextSlot",
          ].includes(key),
        ) &&
        config.encoding === "base64" &&
        config.skipPreflight !== true,
    );
    if (config.skipPreflight !== undefined)
      requireValue(config.skipPreflight === false);
    if (config.preflightCommitment !== undefined)
      requireValue(COMMITMENTS.has(config.preflightCommitment));
    if (config.maxRetries !== undefined)
      requireValue(
        Number.isInteger(config.maxRetries) &&
          config.maxRetries >= 0 &&
          config.maxRetries <= 3,
      );
    if (config.minContextSlot !== undefined)
      requireValue(
        Number.isSafeInteger(config.minContextSlot) &&
          config.minContextSlot >= 0,
      );
  }
  return { ...request, params };
}

export function validateRpcOrigin(headers, environment) {
  const preview = environment.VERCEL_ENV === "preview";
  const productionDemo =
    environment.VERCEL_ENV === "production" &&
    environment.HIPERIA_TESTNET_DEMO === "1";
  requireValue(
    preview || productionDemo,
    "RPC requires UAT Preview or an explicitly enabled Devnet demo deployment.",
  );
  const host = headers.host;
  const allowed = new Set(
    [
      ...(preview
        ? ["www.uat.hiperia.xyz"]
        : ["hiperia.xyz", "www.hiperia.xyz", "uat.hiperia.xyz"]),
      environment.VERCEL_URL,
    ].filter(Boolean),
  );
  requireValue(
    typeof host === "string" &&
      allowed.has(host) &&
      headers.origin === `https://${host}`,
    "A same-origin Hiperia testnet request is required.",
  );
  requireValue(
    !headers["sec-fetch-site"] || headers["sec-fetch-site"] === "same-origin",
    "Cross-site requests are not accepted.",
  );
}

export function createRpcProxy({
  fetchUpstream = globalThis.fetch,
  now = Date.now,
} = {}) {
  const cache = new Map();
  const inFlight = new Map();
  const buckets = new Map();
  let active = 0;

  function take(key, capacity, refill) {
    const time = now();
    const saved = buckets.get(key) ?? { tokens: capacity, at: time };
    saved.tokens = Math.min(
      capacity,
      saved.tokens + ((time - saved.at) * refill) / 1000,
    );
    saved.at = time;
    if (saved.tokens < 1)
      throw new RpcProxyError(
        "UAT RPC is busy. Please wait before retrying.",
        429,
        -32005,
      );
    saved.tokens -= 1;
    buckets.delete(key);
    buckets.set(key, saved);
    while (buckets.size > 256) buckets.delete(buckets.keys().next().value);
  }

  return async function forward(raw, identity = "unknown") {
    take("global", 80, 4);
    take(`ip:${String(identity).slice(0, 64)}`, 40, 2);
    const request = validateRpcRequest(raw);
    const write = request.method === "sendTransaction";
    if (write) {
      take("writes", 12, 0.2);
      take(`write:${String(identity).slice(0, 64)}`, 5, 0.08);
    }
    const key = JSON.stringify([request.method, request.params]);
    const ttl =
      request.method === "getGenesisHash"
        ? 60_000
        : request.method === "simulateTransaction"
          ? 30_000
          : request.method === "getProgramAccounts"
            ? 1_000
            : 0;
    const cached = cache.get(key);
    if (!write && cached && cached.until > now())
      return { ...cached.value, id: request.id };
    if (!write && inFlight.has(key))
      return { ...(await inFlight.get(key)), id: request.id };
    if (active >= 12)
      throw new RpcProxyError(
        "UAT RPC is busy. Please wait before retrying.",
        429,
        -32005,
      );

    const operation = (async () => {
      active += 1;
      try {
        const response = await fetchUpstream(DEVNET_RPC, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(12_000),
          redirect: "error",
        });
        if (!response.ok)
          throw new RpcProxyError(
            "Solana Devnet RPC is temporarily unavailable.",
            response.status === 429 ? 429 : 502,
            -32005,
          );
        const length = Number(response.headers.get("content-length"));
        if (length > 2_000_000)
          throw new RpcProxyError(
            "RPC response exceeds the UAT limit.",
            502,
            -32000,
          );
        const reader = response.body?.getReader();
        if (!reader)
          throw new RpcProxyError("Empty Devnet RPC response.", 502, -32000);
        const chunks = [];
        let bytes = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 2_000_000) {
            await reader.cancel();
            throw new RpcProxyError(
              "RPC response exceeds the UAT limit.",
              502,
              -32000,
            );
          }
          chunks.push(value);
        }
        const text = Buffer.concat(chunks).toString("utf8");
        const value = JSON.parse(text);
        if (
          !isObject(value) ||
          value.jsonrpc !== "2.0" ||
          value.id !== request.id ||
          !("result" in value || "error" in value)
        )
          throw new RpcProxyError(
            "Unexpected Devnet RPC response.",
            502,
            -32000,
          );
        if (
          request.method === "simulateTransaction" &&
          !value.error &&
          value.result?.value?.err == null &&
          !hasRulesReturnData(value, request)
        )
          throw new RpcProxyError(
            "Unexpected Hiperia metadata response.",
            502,
            -32000,
          );
        if (
          ttl &&
          !value.error &&
          (request.method !== "simulateTransaction" ||
            hasRulesReturnData(value, request))
        ) {
          cache.delete(key);
          cache.set(key, { until: now() + ttl, value });
          while (cache.size > 128) cache.delete(cache.keys().next().value);
        }
        return value;
      } catch (error) {
        if (error instanceof RpcProxyError) throw error;
        throw new RpcProxyError(
          "Devnet RPC could not be reached. Check transaction history before submitting again.",
          502,
          -32000,
        );
      } finally {
        active -= 1;
      }
    })();
    if (!write) inFlight.set(key, operation);
    try {
      return { ...(await operation), id: request.id };
    } finally {
      if (!write) inFlight.delete(key);
    }
  };
}

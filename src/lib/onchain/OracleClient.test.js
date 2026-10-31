import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { OracleClient, deriveOracleSeed } from "./OracleClient.js";
import {
  ORAO_PROGRAM_ID,
  ORAO_SEED_DOMAIN,
  VRF_PROGRAM_ID,
} from "./vrfProtocol.js";
import { getDrawPda, getOracleRequestPda } from "./pdas.js";

const owner = new PublicKey(ORAO_PROGRAM_ID);
const client = SystemProgram.programId;
const seed = new Uint8Array(32).fill(9);

function requestAccount(fulfilled = true) {
  const data = Buffer.alloc(fulfilled ? 137 : 749);
  data.set([139, 239, 184, 215, 227, 86, 191, 226]);
  data[8] = fulfilled ? 1 : 0;
  data.set(client.toBuffer(), 9);
  data.set(seed, 41);
  if (fulfilled) data.fill(7, 73);
  return { owner, data, executable: false };
}

test("oracle seed hashing matches the contract's domain and binds program, draw and nonce", async () => {
  const nonce = new Uint8Array(32).fill(3);
  const draw = getDrawPda(1_800_000_000)[0];
  const expected = createHash("sha256")
    .update(
      Buffer.concat([
        Buffer.from(ORAO_SEED_DOMAIN),
        new PublicKey(VRF_PROGRAM_ID).toBuffer(),
        draw.toBuffer(),
        Buffer.from(nonce),
      ]),
    )
    .digest();
  assert.deepEqual(
    Buffer.from(await deriveOracleSeed(VRF_PROGRAM_ID, draw, nonce)),
    expected,
  );
  assert.notDeepEqual(
    await deriveOracleSeed(VRF_PROGRAM_ID, getDrawPda(1_800_000_001)[0], nonce),
    new Uint8Array(expected),
  );
});

test("oracle fees and both rents are quoted from a verified network account", async () => {
  const data = Buffer.alloc(472);
  data.set([212, 237, 148, 56, 97, 245, 51, 169]);
  data.set(new PublicKey(VRF_PROGRAM_ID).toBuffer(), 40);
  data.writeBigUInt64LE(345_678n, 72);
  data.writeUInt32LE(4, 80);
  const rents = [];
  const connection = {
    getAccountInfo: async () => ({ owner, data, executable: false }),
    getMinimumBalanceForRentExemption: async (size) => {
      rents.push(size);
      return size ? 4_455_160 : 890_880;
    },
  };
  const oracle = new OracleClient({ connection });
  const quote = await oracle.quote(749);
  assert.equal(quote.feeLamports, 345_678);
  assert.equal(quote.totalLamports, 5_691_718);
  assert.deepEqual(rents, [749, 0]);
  connection.getAccountInfo = async () => ({
    owner: SystemProgram.programId,
    data,
  });
  await assert.rejects(oracle.quote(749), /network could not be verified/);
  await assert.rejects(oracle.quote(748), /verified oracle request size/);
});

test("oracle fulfilled data requires the expected owner, request PDA, client, seed and exact variant layout", () => {
  const oracle = new OracleClient({ connection: {} });
  const account = requestAccount();
  const options = { seed, client, address: getOracleRequestPda(seed)[0] };
  const decoded = oracle.decodeRequest(account, options);
  assert.equal(decoded.status, "fulfilled");
  assert.deepEqual(decoded.randomness, new Uint8Array(64).fill(7));
  for (const corrupt of [
    { ...account, owner: SystemProgram.programId },
    { ...account, executable: true },
    { ...account, data: Buffer.concat([account.data, Buffer.from([0])]) },
    { ...account, data: Buffer.alloc(137) },
  ])
    assert.throws(
      () => oracle.decodeRequest(corrupt, options),
      /oracle request/,
    );
  assert.throws(
    () =>
      oracle.decodeRequest(account, {
        ...options,
        client: new PublicKey(VRF_PROGRAM_ID),
      }),
    /does not match/,
  );
  assert.throws(
    () =>
      oracle.decodeRequest(account, {
        ...options,
        seed: new Uint8Array(32).fill(8),
      }),
    /does not match/,
  );
  assert.throws(
    () => oracle.decodeRequest(account, { ...options, address: client }),
    /does not match/,
  );
});

test("pending requests cannot be consumed as fulfilled randomness", () => {
  const oracle = new OracleClient({ connection: {} });
  const account = requestAccount(false);
  const options = { seed, client };
  assert.deepEqual(oracle.decodeRequest(account, options).status, "pending");
  account.data.writeUInt32LE(8, 73);
  assert.throws(
    () => oracle.decodeRequest(account, options),
    /unsupported state/,
  );
  assert.equal(oracle.decodeRequest(null, options).status, "missing");
});

test("reading oracle proof rejects an unrelated stored request address before any RPC read", async () => {
  let reads = 0;
  const oracle = new OracleClient({
    connection: {
      getAccountInfo: async () => {
        reads++;
        return requestAccount();
      },
    },
  });
  await assert.rejects(
    oracle.readRequest({ seed, client, address: SystemProgram.programId }),
    /stored oracle address/,
  );
  assert.equal(reads, 0);
});

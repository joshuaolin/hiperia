import { Buffer } from "buffer";
import { PublicKey } from "@solana/web3.js";
import { getOracleNetworkPda, getOracleRequestPda } from "./pdas.js";
import { ORAO_PROGRAM_ID, ORAO_SEED_DOMAIN } from "./vrfProtocol.js";

const networkDiscriminator = [212, 237, 148, 56, 97, 245, 51, 169];
const requestDiscriminator = [139, 239, 184, 215, 227, 86, 191, 226];

function sameBytes(left, right) {
  return (
    left.length === right.length &&
    left.every((byte, index) => byte === right[index])
  );
}

function safeLamports(value) {
  const amount = BigInt(value);
  if (amount < 0n || amount > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("The oracle fee is outside the supported range.");
  return Number(amount);
}

export async function deriveOracleSeed(programId, drawAddress, nonce) {
  if (
    !nonce ||
    nonce.length !== 32 ||
    Array.from(nonce).some(
      (byte) => !Number.isInteger(byte) || byte < 0 || byte > 255,
    )
  )
    throw new TypeError("Oracle request nonces must contain exactly 32 bytes.");
  const bytes = Buffer.concat([
    Buffer.from(ORAO_SEED_DOMAIN),
    new PublicKey(programId).toBuffer(),
    new PublicKey(drawAddress).toBuffer(),
    Buffer.from(nonce),
  ]);
  return new Uint8Array(
    await globalThis.crypto.subtle.digest("SHA-256", bytes),
  );
}

export class OracleClient {
  constructor({ connection, programId = ORAO_PROGRAM_ID } = {}) {
    if (!connection) throw new TypeError("An oracle connection is required.");
    if (new PublicKey(programId).toBase58() !== ORAO_PROGRAM_ID)
      throw new Error("The randomness oracle program could not be verified.");
    this.connection = connection;
    this.programId = new PublicKey(programId);
    this.networkAddress = getOracleNetworkPda(this.programId)[0];
  }

  async quote(pendingRequestSpace) {
    if (pendingRequestSpace !== 749)
      throw new Error("The verified oracle request size is required.");
    const account = await this.connection.getAccountInfo(
      this.networkAddress,
      "confirmed",
    );
    const bytes = account?.data;
    if (
      !account?.owner.equals(this.programId) ||
      account.executable ||
      !bytes ||
      bytes.length < 93 ||
      !sameBytes(Array.from(bytes.subarray(0, 8)), networkDiscriminator)
    )
      throw new Error("The on-chain oracle network could not be verified.");
    const authorities = bytes.readUInt32LE(80);
    const optionOffset = 84 + authorities * 32;
    if (
      authorities < 1 ||
      authorities > 10 ||
      optionOffset >= bytes.length ||
      ![0, 1].includes(bytes[optionOffset])
    )
      throw new Error("The on-chain oracle network could not be verified.");
    const numOffset = optionOffset + 1 + (bytes[optionOffset] ? 72 : 0);
    if (numOffset + 8 > bytes.length)
      throw new Error("The on-chain oracle network could not be verified.");
    const feeLamports = safeLamports(bytes.readBigUInt64LE(72));
    const treasury = new PublicKey(bytes.subarray(40, 72));
    const rents = await Promise.all([
      this.connection.getMinimumBalanceForRentExemption(
        pendingRequestSpace,
        "confirmed",
      ),
      this.connection.getMinimumBalanceForRentExemption(0, "confirmed"),
    ]);
    const pendingRentLamports = safeLamports(rents[0]);
    const clientRentLamports = safeLamports(rents[1]);
    const totalLamports = safeLamports(
      BigInt(feeLamports) +
        BigInt(pendingRentLamports) +
        BigInt(clientRentLamports),
    );
    return {
      feeLamports,
      pendingRentLamports,
      clientRentLamports,
      totalLamports,
      treasury: treasury.toBase58(),
      networkAddress: this.networkAddress.toBase58(),
      oracleProgram: this.programId.toBase58(),
    };
  }

  decodeRequest(account, { seed, client, address } = {}) {
    if (!account) return { status: "missing", randomness: null };
    const bytes = account.data;
    const expectedAddress = getOracleRequestPda(seed, this.programId)[0];
    if (
      (address && !expectedAddress.equals(new PublicKey(address))) ||
      !account.owner.equals(this.programId) ||
      account.executable ||
      !bytes ||
      bytes.length < 77 ||
      !sameBytes(Array.from(bytes.subarray(0, 8)), requestDiscriminator) ||
      !new PublicKey(bytes.subarray(9, 41)).equals(new PublicKey(client)) ||
      !sameBytes(Array.from(bytes.subarray(41, 73)), Array.from(seed))
    )
      throw new Error("The oracle request does not match this draw.");
    if (bytes[8] === 1 && bytes.length === 137)
      return {
        status: "fulfilled",
        randomness: new Uint8Array(bytes.subarray(73, 137)),
        address: expectedAddress.toBase58(),
      };
    if (bytes[8] === 0 && bytes.length === 749) {
      const responses = bytes.readUInt32LE(73);
      if (responses <= 7 && 77 + responses * 96 <= bytes.length)
        return {
          status: "pending",
          randomness: null,
          address: expectedAddress.toBase58(),
        };
    }
    throw new Error("The oracle request has an unsupported state.");
  }

  async readRequest(options) {
    const address = getOracleRequestPda(options.seed, this.programId)[0];
    if (options.address && !address.equals(new PublicKey(options.address)))
      throw new Error(
        "The stored oracle address does not match this draw's seed.",
      );
    const account = await this.connection.getAccountInfo(address, "confirmed");
    return this.decodeRequest(account, { ...options, address });
  }
}

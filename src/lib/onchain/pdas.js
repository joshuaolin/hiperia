import { Buffer } from "buffer";
import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID } from "./idl.js";
import { VRF_PROGRAM_ID, ORAO_PROGRAM_ID } from "./vrfProtocol.js";

function toInteger(value) {
  if (typeof value === "number" && !Number.isSafeInteger(value))
    throw new RangeError("Seed must be a safe integer.");
  if (value == null || !/^-?\d+$/.test(String(value)))
    throw new TypeError("Seed must be an integer.");
  return BigInt(String(value));
}

export function u64LeBytes(value) {
  const integer = toInteger(value);
  if (integer < 0n || integer > (1n << 64n) - 1n)
    throw new RangeError("Nonce must fit an unsigned 64-bit integer.");
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(integer);
  return bytes;
}

export function i64LeBytes(value) {
  const integer = toInteger(value);
  if (integer < -(1n << 63n) || integer > (1n << 63n) - 1n)
    throw new RangeError("Draw time must fit a signed 64-bit integer.");
  const bytes = Buffer.alloc(8);
  bytes.writeBigInt64LE(integer);
  return bytes;
}

export const getConfigPda = (programId = PROGRAM_ID) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    new PublicKey(programId),
  );
export const getVaultPda = (programId = PROGRAM_ID) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("vault")],
    new PublicKey(programId),
  );
export const getTicketPda = (user, nonce, programId = PROGRAM_ID) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("ticket"), new PublicKey(user).toBuffer(), u64LeBytes(nonce)],
    new PublicKey(programId),
  );
export const getResultPda = (drawTime, programId = PROGRAM_ID) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("result"), i64LeBytes(drawTime)],
    new PublicKey(programId),
  );
export const getReferralPda = (owner, programId = PROGRAM_ID) =>
  PublicKey.findProgramAddressSync(
    [
      Buffer.from("referral"),
      Buffer.from("v1"),
      new PublicKey(owner).toBuffer(),
    ],
    new PublicKey(programId),
  );

export const getDrawPda = (drawTime, programId = VRF_PROGRAM_ID) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("draw"), i64LeBytes(drawTime)],
    new PublicKey(programId),
  );

export const getOracleClientPda = (drawTime, programId = VRF_PROGRAM_ID) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("oracle-client"), i64LeBytes(drawTime)],
    new PublicKey(programId),
  );

export const getOracleNetworkPda = (programId = ORAO_PROGRAM_ID) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("orao-vrf-network-configuration")],
    new PublicKey(programId),
  );

export function getOracleRequestPda(seed, programId = ORAO_PROGRAM_ID) {
  if (!seed || seed.length !== 32)
    throw new TypeError("Oracle request seeds must contain exactly 32 bytes.");
  return PublicKey.findProgramAddressSync(
    [Buffer.from("orao-vrf-randomness-request"), Buffer.from(seed)],
    new PublicKey(programId),
  );
}

import { Buffer } from "buffer";
import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID } from "./idl.js";

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

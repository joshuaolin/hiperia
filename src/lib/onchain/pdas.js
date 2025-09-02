import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID } from "./idl";
import { Buffer } from "buffer"; // <- important polyfill import

const CONFIG_SEED = Buffer.from("config");
const VAULT_SEED  = Buffer.from("vault");
const TICKET_SEED = Buffer.from("ticket");
const RESULT_SEED = Buffer.from("result");

export const seeds = { CONFIG_SEED, VAULT_SEED, TICKET_SEED, RESULT_SEED };

function u64LeBytes(nBig) {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(BigInt(nBig));
  return b;
}

export function pdaConfig(programId = new PublicKey(PROGRAM_ID)) {
  return PublicKey.findProgramAddressSync([CONFIG_SEED], programId)[0];
}

export function pdaVault(programId = new PublicKey(PROGRAM_ID)) {
  return PublicKey.findProgramAddressSync([VAULT_SEED], programId)[0];
}

export function pdaTicket(userPk, nonceBig, programId = new PublicKey(PROGRAM_ID)) {
  return PublicKey.findProgramAddressSync(
    [TICKET_SEED, userPk.toBuffer(), u64LeBytes(nonceBig)],
    programId
  )[0];
}

export function pdaResult(drawTimeBig, programId = new PublicKey(PROGRAM_ID)) {
  return PublicKey.findProgramAddressSync(
    [RESULT_SEED, u64LeBytes(drawTimeBig)],
    programId
  )[0];
}

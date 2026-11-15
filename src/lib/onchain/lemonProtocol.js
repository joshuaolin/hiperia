import { Buffer } from "buffer";
import { PublicKey } from "@solana/web3.js";

export const LEMON_PROGRAM_ID = "7ZDTrz498pQuMyV4frPv2cZu5vR1ZrpfzFWAPGpVGcYr";
export const LEMON_RULES_BYTES = 58;
export const LEMON_ACCOUNT_SIZES = Object.freeze({
  drawSpace: 182,
  ticketSpace: 101,
});

export function validFruitNumbers(numbers) {
  return (
    Array.isArray(numbers) &&
    numbers.length === 3 &&
    numbers.every(
      (digit) => Number.isInteger(digit) && digit >= 0 && digit <= 9,
    )
  );
}

function acceptedTriple(bytes) {
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    const sample = bytes[index] | (bytes[index + 1] << 8);
    if (sample < 65_000) {
      const rank = sample % 1000;
      return [Math.floor(rank / 100), Math.floor(rank / 10) % 10, rank % 10];
    }
  }
  return null;
}

export async function lemonNumbersFromRandomness(randomness) {
  if (!(randomness instanceof Uint8Array) || randomness.length !== 64)
    throw new TypeError("A verified 64-byte oracle proof is required.");
  const direct = acceptedTriple(randomness);
  if (direct) return direct;
  for (let counter = 0; counter < 8; counter++) {
    const encoded = Buffer.alloc(4);
    encoded.writeUInt32LE(counter);
    const expanded = new Uint8Array(
      await globalThis.crypto.subtle.digest(
        "SHA-256",
        Buffer.concat([
          Buffer.from("hiperia-lemon-vrf-expand-v1"),
          randomness,
          encoded,
        ]),
      ),
    );
    const numbers = acceptedTriple(expanded);
    if (numbers) return numbers;
  }
  throw new Error("The oracle proof could not produce a valid fruit result.");
}

export async function deriveLemonOracleSeed(programId, drawAddress, nonce) {
  if (!Array.isArray(nonce) && !(nonce instanceof Uint8Array))
    throw new TypeError("Invalid oracle nonce.");
  if (
    nonce.length !== 32 ||
    Array.from(nonce).some(
      (byte) => !Number.isInteger(byte) || byte < 0 || byte > 255,
    )
  )
    throw new TypeError("Invalid oracle nonce.");
  return new Uint8Array(
    await globalThis.crypto.subtle.digest(
      "SHA-256",
      Buffer.concat([
        Buffer.from("hiperia-lemon-vrf-v1"),
        new PublicKey(programId).toBuffer(),
        new PublicKey(drawAddress).toBuffer(),
        Buffer.from(nonce),
      ]),
    ),
  );
}

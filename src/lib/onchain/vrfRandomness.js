import { Buffer } from "buffer";

function acceptedPair(entropy) {
  for (let offset = 0; offset + 1 < entropy.length; offset += 2) {
    const sample = entropy[offset] | (entropy[offset + 1] << 8);
    if (sample >= 65_520) continue;
    const rank = sample % 420;
    const first = Math.floor(rank / 20) + 2;
    let second = (rank % 20) + 2;
    if (second >= first) second++;
    return [first, second];
  }
  return null;
}

export async function winningNumbersFromRandomness(randomness) {
  if (
    !randomness ||
    randomness.length !== 64 ||
    Array.from(randomness).some(
      (byte) => !Number.isInteger(byte) || byte < 0 || byte > 255,
    )
  )
    throw new TypeError("Verified randomness must contain exactly 64 bytes.");
  const initial = acceptedPair(randomness);
  if (initial) return initial;
  for (let counter = 0; counter < 8; counter++) {
    const suffix = Buffer.alloc(4);
    suffix.writeUInt32LE(counter);
    const expanded = new Uint8Array(
      await globalThis.crypto.subtle.digest(
        "SHA-256",
        Buffer.concat([
          Buffer.from("hiperia-dodos-vrf-expand-v1"),
          Buffer.from(randomness),
          suffix,
        ]),
      ),
    );
    const numbers = acceptedPair(expanded);
    if (numbers) return numbers;
  }
  throw new Error("Verified randomness could not produce a valid pair.");
}

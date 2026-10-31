import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { winningNumbersFromRandomness } from "./vrfRandomness.js";

test("all 65520 accepted samples give each of the 420 ordered distinct pairs exactly 156 outcomes", async () => {
  const counts = new Map();
  for (let sample = 0; sample < 65_520; sample++) {
    const bytes = Buffer.alloc(64, 255);
    bytes.writeUInt16LE(sample);
    const pair = await winningNumbersFromRandomness(bytes);
    assert.ok(pair.every((number) => number >= 2 && number <= 22));
    assert.notEqual(pair[0], pair[1]);
    counts.set(pair.join(","), (counts.get(pair.join(",")) ?? 0) + 1);
  }
  assert.equal(counts.size, 420);
  assert.ok([...counts.values()].every((count) => count === 156));
});

test("samples at the rejection boundary are skipped before the next accepted sample", async () => {
  const bytes = Buffer.alloc(64, 255);
  bytes.writeUInt16LE(65_520, 0);
  bytes.writeUInt16LE(419, 2);
  assert.deepEqual(await winningNumbersFromRandomness(bytes), [22, 21]);
});

test("all FF entropy uses the same domain and little endian expansion counter as the contract", async () => {
  const bytes = Buffer.alloc(64, 255);
  const expanded = createHash("sha256")
    .update("hiperia-dodos-vrf-expand-v1")
    .update(bytes)
    .update(Buffer.alloc(4))
    .digest();
  const sample = expanded.readUInt16LE(0);
  assert.ok(sample < 65_520);
  const rank = sample % 420;
  const first = Math.floor(rank / 20) + 2;
  const second = (rank % 20) + 2;
  const expected = [first, second >= first ? second + 1 : second];
  assert.deepEqual(await winningNumbersFromRandomness(bytes), expected);
  assert.deepEqual(expected, [12, 9]);
});

test("incomplete or invalid randomness is rejected", async () => {
  for (const bytes of [null, [], new Uint8Array(63), Array(64).fill(256)])
    await assert.rejects(
      winningNumbersFromRandomness(bytes),
      /exactly 64 bytes/,
    );
});

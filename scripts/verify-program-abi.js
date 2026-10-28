import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";

const frontend = JSON.parse(
  readFileSync("src/idl/hiperia_program.json", "utf8"),
);
const compiled = JSON.parse(
  readFileSync("hiperia_program/target/build/remote-idl.json", "utf8"),
);
const binary = readFileSync("hiperia_program/target/deploy/remote-compiled.so");
assert.equal(binary.subarray(0, 4).toString("hex"), "7f454c46");
assert.ok(
  binary.includes(new PublicKey(frontend.address).toBuffer()),
  "Compiled program ID does not match the frontend",
);
const normalize = (value) => value.replaceAll("_", "").toLowerCase();
function type(value) {
  if (value === "publicKey") return "pubkey";
  return value;
}
for (const instruction of compiled.instructions) {
  const current = frontend.instructions.find(
    (entry) => normalize(entry.name) === normalize(instruction.name),
  );
  assert.ok(current, `Missing instruction: ${instruction.name}`);
  const rustName = instruction.name.replace(
    /[A-Z]/g,
    (letter) => "_" + letter.toLowerCase(),
  );
  const discriminator = createHash("sha256")
    .update(`global:${rustName}`)
    .digest()
    .subarray(0, 8);
  assert.deepEqual(current.discriminator, Array.from(discriminator));
  assert.deepEqual(
    current.args.map((arg) => [normalize(arg.name), type(arg.type)]),
    instruction.args.map((arg) => [normalize(arg.name), type(arg.type)]),
  );
  assert.deepEqual(
    current.accounts.map((account) => [
      normalize(account.name),
      !!account.writable,
      !!account.signer,
    ]),
    instruction.accounts.map((account) => [
      normalize(account.name),
      account.isMut,
      account.isSigner,
    ]),
  );
}
for (const account of compiled.accounts) {
  const current = frontend.types.find(
    (entry) => normalize(entry.name) === normalize(account.name),
  );
  assert.deepEqual(
    current.type.fields.map((field) => [
      normalize(field.name),
      type(field.type),
    ]),
    account.type.fields.map((field) => [
      normalize(field.name),
      type(field.type),
    ]),
  );
}
assert.deepEqual(frontend.errors, compiled.errors);
console.log(
  `Compiled ABI matches frontend: ${compiled.instructions.length} instructions, ${compiled.accounts.length} accounts, ${compiled.errors.length} errors.`,
);

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";

const vrf = process.argv.includes("--vrf");
const frontend = JSON.parse(
  readFileSync(
    vrf ? "src/idl/hiperia_vrf.json" : "src/idl/hiperia_program.json",
    "utf8",
  ),
);
const compiled = JSON.parse(
  readFileSync(
    vrf
      ? "hiperia_program/target/vrf-build/remote-idl.json"
      : "hiperia_program/target/build/remote-idl.json",
    "utf8",
  ),
);
const binary = readFileSync(
  vrf
    ? "hiperia_program/target/deploy/hiperia_vrf.so"
    : "hiperia_program/target/deploy/remote-compiled.so",
);
assert.equal(binary.subarray(0, 4).toString("hex"), "7f454c46");
assert.ok(
  binary.includes(new PublicKey(frontend.address).toBuffer()),
  "Compiled program ID does not match the frontend",
);
const normalize = (value) => value.replaceAll("_", "").toLowerCase();
function type(value) {
  if (value === "publicKey") return "pubkey";
  if (Array.isArray(value)) return value.map(type);
  if (value && typeof value === "object") {
    if (value.defined)
      return {
        defined: normalize(
          typeof value.defined === "string"
            ? value.defined
            : value.defined.name,
        ),
      };
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, type(entry)]),
    );
  }
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
    type(current.returns ?? null),
    type(instruction.returns ?? null),
  );
  assert.deepEqual(
    current.accounts.map((account) => [
      normalize(account.name),
      !!account.writable,
      !!account.signer,
      !!account.optional,
    ]),
    instruction.accounts.map((account) => [
      normalize(account.name),
      account.isMut,
      account.isSigner,
      !!account.isOptional,
    ]),
  );
}
for (const account of [...compiled.accounts, ...(compiled.types ?? [])]) {
  const current = frontend.types.find(
    (entry) => normalize(entry.name) === normalize(account.name),
  );
  assert.ok(current, `Missing compiled type: ${account.name}`);
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

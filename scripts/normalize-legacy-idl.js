import { createHash } from "node:crypto";

const snake = (name) =>
  name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
const discriminator = (namespace, name) =>
  Array.from(
    createHash("sha256").update(`${namespace}:${name}`).digest().subarray(0, 8),
  );

function type(value) {
  if (value === "publicKey") return "pubkey";
  if (Array.isArray(value)) return value.map(type);
  if (value && typeof value === "object") {
    if (value.defined)
      return {
        defined: {
          name:
            typeof value.defined === "string"
              ? value.defined
              : value.defined.name,
        },
      };
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, type(entry)]),
    );
  }
  return value;
}

const fields = (entries) =>
  entries.map((field) => ({ name: snake(field.name), type: type(field.type) }));

export function normalizeLegacyIdl(compiled, address) {
  const instructions = compiled.instructions.map((instruction) => {
    const name = snake(instruction.name);
    return {
      name,
      discriminator: discriminator("global", name),
      accounts: instruction.accounts.map((account) => ({
        name: snake(account.name),
        ...(account.isMut ? { writable: true } : {}),
        ...(account.isSigner ? { signer: true } : {}),
        ...(account.isOptional ? { optional: true } : {}),
        ...(account.name === "systemProgram"
          ? { address: "11111111111111111111111111111111" }
          : {}),
      })),
      args: fields(instruction.args),
      ...(instruction.returns ? { returns: type(instruction.returns) } : {}),
    };
  });
  const accountTypes = [...compiled.accounts, ...(compiled.types ?? [])].map(
    (entry) => ({
      name: entry.name,
      type: { kind: "struct", fields: fields(entry.type.fields) },
    }),
  );
  const events = compiled.events ?? [];
  return {
    address,
    metadata: { name: compiled.name, version: compiled.version, spec: "0.1.0" },
    instructions,
    accounts: compiled.accounts.map((entry) => ({
      name: entry.name,
      discriminator: discriminator("account", entry.name),
    })),
    events: events.map((entry) => ({
      name: entry.name,
      discriminator: discriminator("event", entry.name),
    })),
    errors: compiled.errors ?? [],
    types: [
      ...accountTypes,
      ...events.map((entry) => ({
        name: entry.name,
        type: { kind: "struct", fields: fields(entry.fields) },
      })),
    ],
  };
}

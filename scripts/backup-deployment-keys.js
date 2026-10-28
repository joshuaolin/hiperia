import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@solana/web3.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = resolve(root, ".local/solana");
mkdirSync(directory, { recursive: true });
for (const name of ["deployer-keypair.json", "hiperia_program-keypair.json"]) {
  const source = readFileSync(
    resolve(root, "hiperia_program/target/deploy", name),
  );
  const signer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(source.toString())),
  );
  const destination = resolve(directory, name);
  if (existsSync(destination)) {
    const existing = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(readFileSync(destination, "utf8"))),
    );
    if (!existing.publicKey.equals(signer.publicKey))
      throw new Error(
        `An existing ${name} backup belongs to another key. It was preserved.`,
      );
  } else writeFileSync(destination, source, { flag: "wx", mode: 0o600 });
  console.log(
    `Local backup verified: ${name} (${signer.publicKey.toBase58()})`,
  );
}

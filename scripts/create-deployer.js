import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@solana/web3.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const filename = resolve(
  root,
  "hiperia_program/target/deploy/deployer-keypair.json",
);
let keypair;
if (existsSync(filename))
  keypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(filename, "utf8"))),
  );
else {
  mkdirSync(dirname(filename), { recursive: true });
  keypair = Keypair.generate();
  writeFileSync(filename, JSON.stringify(Array.from(keypair.secretKey)), {
    mode: 0o600,
  });
}
console.log(`Test deployment wallet: ${keypair.publicKey.toBase58()}`);
console.log(
  "The ignored keypair stays local. Never upload it or use this wallet for Mainnet.",
);

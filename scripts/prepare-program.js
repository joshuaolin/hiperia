import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@solana/web3.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const keyPath = resolve(
  root,
  "hiperia_program/target/deploy/hiperia_program-keypair.json",
);
let keypair;
if (existsSync(keyPath))
  keypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(keyPath, "utf8"))),
  );
else {
  if (!process.argv.includes("--new"))
    throw new Error(
      "Restore your existing program keypair, or pass --new to prepare a new deployment.",
    );
  mkdirSync(dirname(keyPath), { recursive: true });
  keypair = Keypair.generate();
  writeFileSync(keyPath, JSON.stringify(Array.from(keypair.secretKey)), {
    mode: 0o600,
  });
}
const address = keypair.publicKey.toBase58();
const rustPath = resolve(
  root,
  "hiperia_program/programs/hiperia_program/src/lib.rs",
);
writeFileSync(
  rustPath,
  readFileSync(rustPath, "utf8").replace(
    /declare_id!\("[^"]+"\)/,
    `declare_id!("${address}")`,
  ),
);
const anchorPath = resolve(root, "hiperia_program/Anchor.toml");
writeFileSync(
  anchorPath,
  readFileSync(anchorPath, "utf8").replace(
    /hiperia_program = "[^"]+"/g,
    `hiperia_program = "${address}"`,
  ),
);
const idlPath = resolve(root, "src/idl/hiperia_program.json");
const idl = JSON.parse(readFileSync(idlPath, "utf8"));
idl.address = address;
writeFileSync(idlPath, JSON.stringify(idl, null, 2) + "\n");
console.log(`Program ID synchronized: ${address}`);
console.log(
  "Keep the ignored program keypair safe for future upgrades. Build and deploy before using this ID.",
);

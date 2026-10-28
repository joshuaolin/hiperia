import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cwd = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../hiperia_program",
);
const result = spawnSync("anchor", ["test", "--provider.cluster", "localnet"], {
  cwd,
  stdio: "inherit",
});
if (result.error)
  console.error(
    "Anchor CLI is required. Run this command in a Solana/Anchor development environment such as WSL.",
  );
process.exitCode = result.status ?? 1;

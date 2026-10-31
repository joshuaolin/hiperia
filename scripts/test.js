import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tests = ["src", "hiperia_program/scripts"]
  .flatMap((directory) =>
    readdirSync(resolve(root, directory), { recursive: true })
      .filter((name) => name.endsWith(".test.js"))
      .map((name) => resolve(root, directory, name)),
  )
  .sort();
const result = spawnSync(process.execPath, ["--test", ...tests], {
  cwd: root,
  stdio: "inherit",
});
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;

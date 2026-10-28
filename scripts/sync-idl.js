import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const idl = JSON.parse(
  readFileSync(
    resolve(root, "hiperia_program/target/idl/hiperia_program.json"),
    "utf8",
  ),
);
if (!idl.address || !Array.isArray(idl.instructions))
  throw new Error("Build the Anchor program before syncing its IDL.");
function stripDocs(value) {
  if (Array.isArray(value)) value.forEach(stripDocs);
  else if (value && typeof value === "object") {
    delete value.docs;
    Object.values(value).forEach(stripDocs);
  }
}
stripDocs(idl);
writeFileSync(
  resolve(root, "src/idl/hiperia_program.json"),
  JSON.stringify(idl, null, 2) + "\n",
);
console.log(`Frontend IDL synchronized: ${idl.address}`);

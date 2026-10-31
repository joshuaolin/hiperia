import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";

const source = readFileSync(
  process.argv.includes("--vrf")
    ? "hiperia_program/programs/hiperia_vrf/src/lib.rs"
    : "hiperia_program/programs/hiperia_program/src/lib.rs",
  "utf8",
);
const vrf = process.argv.includes("--vrf");
const buildDirectory = vrf
  ? "hiperia_program/target/vrf-build"
  : "hiperia_program/target/build";
const binaryPath = vrf
  ? "hiperia_program/target/deploy/hiperia_vrf.so"
  : "hiperia_program/target/deploy/remote-compiled.so";
const idl = JSON.parse(
  readFileSync(
    vrf ? "src/idl/hiperia_vrf.json" : "src/idl/hiperia_program.json",
    "utf8",
  ),
);
const endpoint = "https://api.solpg.io";
if (!source.includes(`declare_id!("${idl.address}")`))
  throw new Error("Synchronize the program ID before building.");
const response = await fetch(`${endpoint}/build`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    files: [["/src/lib.rs", source]],
    flags: { noDocs: true, safetyChecks: true, seedsFeature: true },
  }),
  signal: AbortSignal.timeout(180_000),
});
const text = await response.text();
mkdirSync(buildDirectory, { recursive: true });
writeFileSync(`${buildDirectory}/remote-response.json`, text);
if (!response.ok)
  throw new Error(
    `Remote compiler returned HTTP ${response.status}. See the local build report.`,
  );
const result = JSON.parse(text);
if (
  result.success === false ||
  /\berror(?:\[|:)/.test(result.stderr ?? "") ||
  !result.uuid ||
  !result.idl
) {
  throw new Error("Remote compilation failed. See the local build report.");
}
const download = await fetch(`${endpoint}/deploy/${result.uuid}`, {
  signal: AbortSignal.timeout(60_000),
});
if (!download.ok)
  throw new Error(`Program download returned HTTP ${download.status}.`);
const bytes = Buffer.from(await download.arrayBuffer());
if (
  bytes.subarray(0, 4).toString("hex") !== "7f454c46" ||
  !bytes.includes(new PublicKey(idl.address).toBuffer())
) {
  throw new Error(
    "The downloaded ELF does not contain the expected program ID.",
  );
}
mkdirSync("hiperia_program/target/deploy", { recursive: true });
writeFileSync(binaryPath, bytes);
writeFileSync(
  `${buildDirectory}/remote-idl.json`,
  JSON.stringify(result.idl, null, 2),
);
writeFileSync(
  `${buildDirectory}/build-manifest.json`,
  JSON.stringify(
    {
      builder: endpoint,
      toolchain: "server-selected legacy Anchor",
      uuid: result.uuid,
      programId: idl.address,
      builtAt: new Date().toISOString(),
      sourceHash: createHash("sha256").update(source).digest("hex"),
      binaryHash: createHash("sha256").update(bytes).digest("hex"),
      binaryBytes: bytes.length,
    },
    null,
    2,
  ),
);
await import("./verify-program-abi.js");
console.log(
  `Remote ELF ready: ${bytes.length} bytes. This uses the server's dependency set; use local Anchor for a build with pinned dependencies.`,
);

import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32")
  throw new Error(
    "This installer is for Windows. Use the official Agave installer on Linux or macOS.",
  );
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = resolve(root, ".tools");
const archive = resolve(directory, "solana-v4.2.2-windows.tar.bz2");
mkdirSync(directory, { recursive: true });
const metadata = await fetch(
  "https://api.github.com/repos/anza-xyz/agave/releases/tags/v4.2.2",
  { signal: AbortSignal.timeout(30_000) },
);
if (!metadata.ok)
  throw new Error(`Unable to verify the official release: ${metadata.status}`);
const asset = (await metadata.json()).assets.find(
  (item) => item.name === "solana-release-x86_64-pc-windows-msvc.tar.bz2",
);
const expected =
  "08846ef03752d281d61ccbab1f43ba53cef69f81cd8077ec7f777456ddee9b1f";
if (asset?.digest !== `sha256:${expected}`)
  throw new Error(
    "Official release checksum does not match the pinned release.",
  );
if (!existsSync(archive)) {
  console.log("Downloading verified Agave 4.2.2 Windows tools (112 MB)...");
  const download = await fetch(asset.browser_download_url, {
    signal: AbortSignal.timeout(180_000),
  });
  if (!download.ok) throw new Error(`Tool download failed: ${download.status}`);
  await pipeline(Readable.fromWeb(download.body), createWriteStream(archive));
}
const hash = createHash("sha256");
for await (const chunk of createReadStream(archive)) hash.update(chunk);
if (hash.digest("hex") !== expected)
  throw new Error("Downloaded tools failed checksum verification.");
const extraction = spawnSync(
  "C:/Windows/System32/tar.exe",
  ["-xf", archive, "-C", directory],
  { stdio: "inherit" },
);
if (extraction.status !== 0)
  throw new Error("Unable to extract the verified tools.");
const executable = resolve(directory, "solana-release/bin/solana.exe");
const version = spawnSync(executable, ["--version"], { stdio: "inherit" });
if (version.status !== 0)
  throw new Error("The installed Solana CLI could not start.");
console.log(`Local CLI ready: ${executable}`);

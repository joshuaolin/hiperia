import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { assert } from "chai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// emulate __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// load IDL manually
const idlPath = path.join(__dirname, "../target/idl/hiperia_program.json");
const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));

describe("hiperia_program", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const programId = new PublicKey(idl.address);
  const program = new anchor.Program(
    idl as anchor.Idl,
    programId,
    provider
  ) as Program;

  it("Can donate lamports", async () => {
    const payer = provider.wallet as anchor.Wallet;

    const [donationPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("donation"), payer.publicKey.toBuffer()],
      program.programId
    );

    console.log("PDA:", donationPda.toBase58());

    await program.methods
      .donate(new anchor.BN(1_000_000)) // 0.001 SOL
      .accounts({
        payer: payer.publicKey,
        donationWallet: new PublicKey(
          "Ghxn7ree6MFQxC8hFTJ8Lo319xEZzqVFLcmDLKVFpPaa"
        ),
        donation: donationPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // ✅ now fetch should work
    const donationAccount = await program.account.donationAccount.fetch(donationPda);

    console.log("Decoded donation account:", donationAccount);

    assert.equal(
      donationAccount.donator.toBase58(),
      payer.publicKey.toBase58()
    );
    assert.equal(donationAccount.amount.toNumber(), 1_000_000

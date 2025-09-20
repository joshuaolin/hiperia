const anchor = require("@coral-xyz/anchor");
const connection = new anchor.web3.Connection("https://api.devnet.solana.com", "confirmed");
const wallet = anchor.Wallet.local(); // Uses ~/.config/solana/id.json
const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
anchor.setProvider(provider);
const idl = require("../target/idl/hiperia_program.json");
console.log("Loaded IDL:", JSON.stringify(idl, null, 2)); // Debug the exact IDL

try {
  const program = new anchor.Program(idl, new anchor.web3.PublicKey("4BqH8D4WRxthkMBKjyFHoWVBbrogaCWJf8oC2tV2HGnR"), provider);
  console.log("Program created successfully");

  async function initialize() {
    const [configPda] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);
    const [vaultPda] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("vault")], program.programId);

    await program.methods
      .initialize(new anchor.BN(7200000), new anchor.BN(1000000000)) // 0.0072 SOL, 1 SOL payout
      .accounts({
        config: configPda,
        vault: vaultPda,
        payer: provider.wallet.publicKey,
        system_program: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    console.log("Program initialized! Config PDA:", configPda.toBase58());
  }

  initialize().catch(console.error);
} catch (error) {
  console.error("Error creating program:", error.message, error.stack);
}
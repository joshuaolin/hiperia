import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { HiperiaLottery } from "../target/types/hiperia_lottery";

describe("hiperia_lottery", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.HiperiaLottery as Program<HiperiaLottery>;

  it("Initialize", async () => {
    const lotteryState = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("lottery-state")],
      program.programId
    )[0];
    await program.methods.initialize().accounts({
      lotteryState,
      authority: provider.wallet.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).rpc();
  });

  it("Buy Ticket", async () => {
    const lotteryState = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("lottery-state")],
      program.programId
    )[0];
    const ticketCount = 0;
    const ticket = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("ticket"), provider.wallet.publicKey.toBuffer(), Buffer.from(ticketCount.toString())],
      program.programId
    )[0];
    const leaderboard = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("leaderboard"), provider.wallet.publicKey.toBuffer()],
      program.programId
    )[0];
    await program.methods.buyTicket(1, 2).accounts({
      lotteryState,
      ticket,
      payer: provider.wallet.publicKey,
      leaderboard,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).rpc();
  });

  it("Donate", async () => {
    const lotteryState = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("lottery-state")],
      program.programId
    )[0];
    const donation = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("donation"), provider.wallet.publicKey.toBuffer(), Buffer.from(Date.now().toString())],
      program.programId
    )[0];
    await program.methods.donate(new anchor.BN(1_000_000_000)).accounts({
      lotteryState,
      donation,
      payer: provider.wallet.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).rpc();
  });

  it("Request and Fulfill Draw", async () => {
    const lotteryState = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("lottery-state")],
      program.programId
    )[0];
    const leaderboard = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("leaderboard"), provider.wallet.publicKey.toBuffer()],
      program.programId
    )[0];
    await program.methods.requestVrf().accounts({
      lotteryState,
      authority: provider.wallet.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).rpc();
    const ticket = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("ticket"), provider.wallet.publicKey.toBuffer(), Buffer.from("0")],
      program.programId
    )[0];
    await program.methods.fulfillVrf().accounts({
      lotteryState,
      leaderboard,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).remainingAccounts([{ pubkey: ticket, isSigner: false, isWritable: false }]).rpc();
  });
});
import * as anchor from "@coral-xyz/anchor";
import { SystemProgram, PublicKey, Connection } from "@solana/web3.js";
import { HIPERIA_IDL, PROGRAM_ID } from "./idl";
import { pdaConfig, pdaVault, pdaTicket, pdaResult } from "./pdas";
import { nextDrawTimeUtcSeconds } from "./time";

export function getProvider({ wallet, rpcUrl = "https://api.devnet.solana.com" }) {
  const connection = new Connection(rpcUrl, "confirmed");
  return new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
}

export function getProgram(provider) {
  const PROGRAM_PUBKEY = new PublicKey(PROGRAM_ID);
  return new anchor.Program(HIPERIA_IDL, PROGRAM_PUBKEY, provider);
}

export async function initializeProgram(provider, ticketCostLamports, payoutLamports) {
  const program = getProgram(provider);
  const config = pdaConfig(program.programId);
  const vault  = pdaVault(program.programId);

  await program.methods
    .initialize(new anchor.BN(ticketCostLamports), new anchor.BN(payoutLamports))
    .accounts({ config, vault, payer: provider.wallet.publicKey, systemProgram: SystemProgram.programId })
    .rpc();

  return { config, vault };
}

export async function buyTicket(provider, numbers /* [a,b] */, drawTimeSeconds, nonceMs = Date.now()) {
  const program = getProgram(provider);
  const config = pdaConfig(program.programId);
  const vault  = pdaVault(program.programId);

  const nonce = BigInt(nonceMs);
  const drawTime = BigInt(drawTimeSeconds ?? nextDrawTimeUtcSeconds());
  const ticket = pdaTicket(provider.wallet.publicKey, nonce, program.programId);

  await program.methods
    .buyTicket(new anchor.BN(nonce.toString()), new anchor.BN(drawTime.toString()), numbers)
    .accounts({ config, vault, ticket, user: provider.wallet.publicKey, systemProgram: SystemProgram.programId })
    .rpc();

  return { ticket, drawTime: Number(drawTime), nonce: nonce.toString() };
}

export async function publishResult(provider, drawTimeSeconds) {
  const program = getProgram(provider);
  const config = pdaConfig(program.programId);
  const vault  = pdaVault(program.programId);
  const result = pdaResult(BigInt(drawTimeSeconds), program.programId);

  await program.methods
    .publishResult(new anchor.BN(drawTimeSeconds))
    .accounts({ config, vault, result, payer: provider.wallet.publicKey, systemProgram: SystemProgram.programId })
    .rpc();

  return { result };
}

export async function settleTicket(provider, nonceStr, drawTimeSeconds) {
  const program = getProgram(provider);
  const config = pdaConfig(program.programId);
  const vault  = pdaVault(program.programId);
  const ticket = pdaTicket(provider.wallet.publicKey, BigInt(nonceStr), program.programId);
  const result = pdaResult(BigInt(drawTimeSeconds), program.programId);

  await program.methods
    .settleTicket()
    .accounts({ config, vault, ticket, result, user: provider.wallet.publicKey, systemProgram: SystemProgram.programId })
    .rpc();

  const tAcc = await program.account.ticket.fetch(ticket);
  const rAcc = await program.account.resultAccount.fetch(result);

  const isWinner =
    Number(tAcc.numbers[0]) === Number(rAcc.numbers[0]) &&
    Number(tAcc.numbers[1]) === Number(rAcc.numbers[1]);

  return {
    isWinner,
    ticket,
    result,
    ticketNumbers: [Number(tAcc.numbers[0]), Number(tAcc.numbers[1])],
    resultNumbers: [Number(rAcc.numbers[0]), Number(rAcc.numbers[1])],
  };
}

export async function ensureInitialized(provider, { ticketCostLamports = 7_200_000, payoutLamports = 1_000_000_000 } = {}) {
  const program = getProgram(provider);
  try {
    // try read config PDA; if it exists and is_initialized, we’re good
    const config = pdaConfig(program.programId);
    const cfg = await program.account.config.fetchNullable(config);
    if (cfg && cfg.isInitialized) return { didInit: false, config };
  } catch (_) {
    // fallthrough to initialize
  }

  // create config + vault
  await initializeProgram(provider, ticketCostLamports, payoutLamports);
  return { didInit: true };
}

export async function buyTicketWithLogs(provider, numbers, drawTimeSeconds, nonceMs = Date.now()) {
  const program = getProgram(provider);
  const config = pdaConfig(program.programId);
  const vault  = pdaVault(program.programId);

  const nonce = BigInt(nonceMs);
  const drawTime = BigInt(drawTimeSeconds);
  const ticket = pdaTicket(provider.wallet.publicKey, nonce, program.programId);

  // 1) simulate to get precise logs (great for errors)
  try {
    await program.methods
      .buyTicket(new anchor.BN(nonce.toString()), new anchor.BN(drawTime.toString()), numbers)
      .accounts({ config, vault, ticket, user: provider.wallet.publicKey, systemProgram: SystemProgram.programId })
      .simulate();
  } catch (simErr) {
    console.error("simulate logs:", simErr);
    throw simErr; // surface nice logs to UI
  }

  // 2) if simulate ok, send the tx
  const sig = await program.methods
    .buyTicket(new anchor.BN(nonce.toString()), new anchor.BN(drawTime.toString()), numbers)
    .accounts({ config, vault, ticket, user: provider.wallet.publicKey, systemProgram: SystemProgram.programId })
    .rpc();
  return { ticket, drawTime: Number(drawTime), nonce: nonce.toString(), signature: sig };
}

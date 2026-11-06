import { Buffer } from "buffer";
import { SystemProgram } from "@solana/web3.js";
import { getBankrollDrawPda, getDrawPda } from "./pdas.js";
import { isDailyDrawTime } from "./time.js";

function amount(value) {
  const result = Number(value.toString());
  if (!Number.isSafeInteger(result) || result < 0)
    throw new Error("The bankroll amount could not be verified.");
  return result;
}

export class BankrollClient {
  constructor(client) { this.client = client; }

  address(drawTime) {
    return getBankrollDrawPda(drawTime, this.client.program.programId)[0];
  }

  validate(account, drawTime, address) {
    const [expected, bump] = getBankrollDrawPda(drawTime, this.client.program.programId);
    if (!expected.equals(address) || account.bump !== bump ||
      account.drawTime.toString() !== String(drawTime) || ![0, 1].includes(account.phase) ||
      Buffer.from(account.padding).some((byte) => byte !== 0) ||
      (account.phase === 1 && amount(account.pendingEntryLamports) !== 0))
      throw new Error("The draw's entry refund account could not be verified.");
    amount(account.pendingEntryLamports);
    amount(account.unsettledEntries);
    return { ...account, address: address.toBase58() };
  }

  validateDraw(ledger, draw) {
    const count = BigInt(ledger.unsettledEntries.toString());
    const expected = ledger.phase === 0 ? count * BigInt(draw.ticketCostLamports.toString()) : 0n;
    if (count > BigInt(draw.ticketCount.toString()) ||
      BigInt(ledger.pendingEntryLamports.toString()) !== expected ||
      (ledger.phase === 1 && ![2, "final"].includes(draw.status)))
      throw new Error("The draw's protected entry totals could not be verified.");
  }

  async read(drawTime) {
    const { connection, program } = this.client;
    const address = this.address(drawTime);
    const info = await connection.getAccountInfo(address, "confirmed");
    if (!info || (info.owner.equals(SystemProgram.programId) && !info.executable && !info.data.length)) return null;
    if (!info.owner.equals(program.programId) || info.executable || info.data.length !== 50)
      throw new Error("The draw's entry refund account has an invalid owner or size.");
    return this.validate(program.coder.accounts.decode("bankrollDraw", info.data), drawTime, address);
  }

  async quote(numbers, { drawTime, config, quick = false }) {
    const { connection, program } = this.client;
    if (!config?.bankrollRules || config.bankrollRules.ticketVersion !== 4)
      throw new Error("Wait for the verified claim-funded prize rules.");
    const daily = !quick && isDailyDrawTime(Number(drawTime));
    const cost = daily ? config.dailyTicketCostLamports : config.quickTicketCostLamports;
    const prize = daily ? config.dailyPayoutLamports : config.quickPayoutLamports;
    const [ledger, draw, capacity] = await Promise.all([
      this.read(drawTime), this.client.getDraw(drawTime), this.client.getCapacity(config, { includeEntryHolds: false }),
    ]);
    if ((draw && (draw.status !== 0 || draw.isDaily !== daily || !draw.ticketCostLamports.eq(cost) || !draw.payoutLamports.eq(prize))) || (ledger && ledger.phase !== 0))
      throw new Error("This draw is closed or its offer changed. Refresh before buying.");
    if (ledger && !draw) throw new Error("The draw's entry refund record is incomplete.");
    if (ledger) this.validateDraw(ledger, draw);
    const [ledgerRent, drawRent, ticketRent, ledgerInfo, drawInfo] = await Promise.all([
      ledger ? 0 : connection.getMinimumBalanceForRentExemption(50, "confirmed"),
      draw ? 0 : connection.getMinimumBalanceForRentExemption(181, "confirmed"),
      connection.getMinimumBalanceForRentExemption(100, "confirmed"),
      ledger ? null : connection.getAccountInfo(this.address(drawTime), "confirmed"),
      draw ? null : connection.getAccountInfo(getDrawPda(drawTime, program.programId)[0], "confirmed"),
    ]);
    const ledgerRentLamports = Math.max(0, ledgerRent - (ledgerInfo?.lamports ?? 0));
    const drawRentLamports = Math.max(0, drawRent - (drawInfo?.lamports ?? 0));
    return { bankroll: true, pooled: false, ticketVersion: 4, quick, drawTime: Number(drawTime), numbers: [...numbers],
      entryLamports: amount(cost), prizeLamports: amount(prize), reserveIncreaseLamports: amount(cost),
      requiredBackingLamports: 0, freeLamports: capacity.freeLamports, canPurchase: true,
      ledgerRentLamports, riskRentLamports: ledgerRentLamports, drawRentLamports, ticketRentLamports: ticketRent,
      accountRentLamports: ledgerRentLamports + drawRentLamports + ticketRent };
  }

  async funding(ticket) {
    const { connection, program, vaultAddress } = this.client;
    const ledgerAddress = this.address(ticket.drawTime);
    const drawAddress = getDrawPda(ticket.drawTime, program.programId)[0];
    const snapshot = await connection.getMultipleAccountsInfoAndContext(
      [ledgerAddress, drawAddress, vaultAddress], "confirmed",
    );
    const entries = snapshot?.value;
    if (!Number.isSafeInteger(snapshot?.context?.slot) || snapshot.context.slot < 0 || !Array.isArray(entries) || entries.length !== 3 ||
      entries.some((info, index) => !info || !info.owner.equals(program.programId) || info.executable || info.data.length !== [50, 181, 41][index]))
      throw new Error("The prize vault funding snapshot could not be verified. Refresh before claiming.");
    const [ledgerInfo, drawInfo, vaultInfo] = entries;
    const ledger = this.validate(program.coder.accounts.decode("bankrollDraw", ledgerInfo.data), ticket.drawTime, ledgerAddress);
    const draw = this.client.drawRecord(program.coder.accounts.decode("draw", drawInfo.data), drawAddress);
    this.validateDraw(ledger, draw);
    if (amount(ticket.payoutLamports) !== draw.payoutLamports || amount(ticket.paidLamports) !== draw.ticketCostLamports)
      throw new Error("This ticket's entry and fixed prize do not match its recorded draw.");
    const discriminator = program.idl.accounts.find((entry) => entry.name.toLowerCase() === "vault")?.discriminator;
    if (draw.status !== "final" || !vaultInfo.data.subarray(0, 8).equals(Buffer.from(discriminator ?? [])) ||
      vaultInfo.data.subarray(17).some((byte) => byte !== 0))
      throw new Error("Refresh to verify the recorded draw and claim funding.");
    const reserved = vaultInfo.data.readBigUInt64LE(9);
    const releasable = ledger.phase === 0 ? amount(ledger.pendingEntryLamports) : 0;
    if (BigInt(releasable) > reserved)
      throw new Error("The protected entry hold could not be verified.");
    const rent = await connection.getMinimumBalanceForRentExemption(41, "confirmed");
    const spendable = BigInt(vaultInfo.lamports) - BigInt(rent) - reserved + BigInt(releasable);
    const availableLamports = amount(spendable > 0n ? spendable : 0n);
    return { claimFundingVerified: true, claimFunded: availableLamports >= amount(ticket.payoutLamports),
      claimAvailableLamports: availableLamports, releasableEntryLamports: releasable, fundingSlot: snapshot.context.slot };
  }
}

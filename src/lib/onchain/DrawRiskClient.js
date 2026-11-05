import { SystemProgram } from "@solana/web3.js";
import { getDrawPda, getDrawRiskPda } from "./pdas.js";
import { pooledEntryQuote } from "./drawRisk.js";

function amount(value) {
  const number = Number(value.toString());
  if (!Number.isSafeInteger(number) || number < 0)
    throw new RangeError("The draw quote exceeds the supported range.");
  return number;
}

export class DrawRiskClient {
  constructor(client) {
    this.client = client;
  }

  address(drawTime) {
    return getDrawRiskPda(drawTime, this.client.program.programId)[0];
  }

  async read(drawTime) {
    const { connection, program } = this.client;
    const [address, bump] = getDrawRiskPda(drawTime, program.programId);
    const info = await connection.getAccountInfo(address, "confirmed");
    if (!info || (info.owner.equals(SystemProgram.programId) && !info.executable && info.data.length === 0))
      return null;
    if (!info.owner.equals(program.programId) || info.executable)
      throw new Error("The draw's backing account could not be verified.");
    const rules = await this.client.getLiabilityRules();
    if (info.data.length !== rules.riskAccountSpace)
      throw new Error("The draw's backing account has an unexpected size.");
    const risk = program.coder.accounts.decode("drawRisk", info.data);
    if (risk.bump !== bump || risk.drawTime.toString() !== String(drawTime) || ![0, 1].includes(risk.phase))
      throw new Error("The draw's backing account does not match this draw.");
    return { ...risk, address: address.toBase58() };
  }

  async quote(numbers, { drawTime, config }) {
    const { connection, program } = this.client;
    const rules = config.liabilityRules ?? await this.client.getLiabilityRules();
    if (!rules.dailyPooled)
      throw new Error("Pooled daily backing has not been verified.");
    const [risk, draw, capacity] = await Promise.all([
      this.read(drawTime), this.client.getDraw(drawTime), this.client.getCapacity(config),
    ]);
    const cost = config.dailyTicketCostLamports;
    const prize = config.dailyPayoutLamports;
    if (draw && (draw.status !== 0 || !draw.ticketCostLamports.eq(cost) || !draw.payoutLamports.eq(prize)))
      throw new Error("This draw is closed or its offer has changed. Refresh before buying.");
    if (risk && risk.phase !== 0)
      throw new Error("This draw's backing is already finalized.");
    const counts = risk?.counts ?? Array(rules.pairCount).fill(0n);
    const quote = pooledEntryQuote(counts, numbers, cost, prize);
    if (risk && (quote.totalCount !== BigInt(risk.totalCount.toString()) || quote.reservedBeforeLamports !== BigInt(risk.reservedLamports.toString())))
      throw new Error("The draw's backing totals could not be verified.");
    const [riskRent, ticketRent, drawRent] = await Promise.all([
      risk ? 0 : connection.getMinimumBalanceForRentExemption(rules.riskAccountSpace, "confirmed"),
      connection.getMinimumBalanceForRentExemption(100, "confirmed"),
      draw ? 0 : connection.getMinimumBalanceForRentExemption(181, "confirmed"),
    ]);
    const [riskInfo, drawInfo] = await Promise.all([
      risk ? null : connection.getAccountInfo(this.address(drawTime), "confirmed"),
      draw ? null : connection.getAccountInfo(getDrawPda(drawTime, program.programId)[0], "confirmed"),
    ]);
    const riskRentLamports = Math.max(0, riskRent - (riskInfo?.lamports ?? 0));
    const drawRentLamports = Math.max(0, drawRent - (drawInfo?.lamports ?? 0));
    return {
      pooled: true, drawTime: Number(drawTime), numbers: [...numbers],
      entryLamports: amount(cost), prizeLamports: amount(prize),
      reserveIncreaseLamports: amount(quote.reserveIncreaseLamports),
      requiredBackingLamports: amount(quote.requiredBackingLamports),
      freeLamports: capacity.freeLamports,
      canPurchase: BigInt(capacity.freeLamports) >= quote.requiredBackingLamports,
      riskRentLamports, drawRentLamports, ticketRentLamports: ticketRent,
      accountRentLamports: riskRentLamports + drawRentLamports + ticketRent,
    };
  }

}

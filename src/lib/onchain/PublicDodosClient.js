import { DodosClient } from "./DodosClient.js";
import { VrfDodosClient } from "./VrfDodosClient.js";
import { PROGRAM_ID } from "./idl.js";
import { VRF_PROGRAM_ID } from "./vrfProtocol.js";
import { isPublicVrfBuild } from "../buildProfile.js";

function annotate(entries, sourceProgram, legacy) {
  return entries.map((entry) => ({
    ...entry,
    sourceProgram,
    legacy,
    randomnessMode: legacy ? "legacy-fixed" : "orao-vrf",
  }));
}

export class PublicDodosClient {
  constructor(options = {}) {
    this.primary = options.primary ?? new VrfDodosClient(options);
    this.legacy = options.legacy ?? new DodosClient(options);
    this.program = this.primary.program;
    this.wallet = this.primary.wallet;
    this.connection = this.primary.connection;
    this.referrals = this.primary.referrals;
  }

  get configAddress() {
    return this.primary.configAddress;
  }
  get vaultAddress() {
    return this.primary.vaultAddress;
  }
  getConfig() {
    return this.primary.getConfig();
  }
  getRules(options) {
    return this.primary.getRules(options);
  }
  getAccessRules(options) {
    return this.primary.getAccessRules(options);
  }
  getRandomnessRules(options) {
    return this.primary.getRandomnessRules(options);
  }
  getOracleQuote(drawTime) {
    return this.primary.getOracleQuote(drawTime);
  }
  getPurchaseQuote(numbers, options) {
    return this.primary.getPurchaseQuote(numbers, options);
  }
  getPendingPurchase() {
    return this.primary.getPendingPurchase();
  }
  getLegacyPendingPurchase() {
    return this.legacy.getPendingPurchase();
  }
  requireSigner() {
    return this.primary.requireSigner();
  }
  buyTicket(numbers, options) {
    return this.primary.buyTicket(numbers, options);
  }

  async recoverPendingPurchase() {
    const [current, legacy] = await Promise.all([
      this.primary.recoverPendingPurchase(),
      this.legacy.recoverPendingPurchase(),
    ]);
    return current ?? legacy;
  }

  async getTickets(config) {
    const legacyConfig = await this.legacy.program.account.config.fetchNullable(
      this.legacy.configAddress,
    );
    const [current, legacy] = await Promise.all([
      this.primary.getTickets(config),
      this.legacy.getTickets(legacyConfig ?? {}),
    ]);
    return [
      ...annotate(current, VRF_PROGRAM_ID, false),
      ...annotate(legacy, PROGRAM_ID, true),
    ].sort((first, second) => second.drawTime - first.drawTime);
  }

  async getResults() {
    const [current, legacy] = await Promise.all([
      this.primary.getResults(),
      this.legacy.getResults(),
    ]);
    return [
      ...annotate(current, VRF_PROGRAM_ID, false),
      ...annotate(legacy, PROGRAM_ID, true),
    ].sort((first, second) => second.drawTime - first.drawTime);
  }

  async getRecentResults(limit = 3) {
    return (await this.getResults()).slice(0, limit);
  }

  clientFor(ticket) {
    if (
      ticket?.sourceProgram === VRF_PROGRAM_ID ||
      (!ticket?.sourceProgram && ticket?.legacy === false)
    )
      return this.primary;
    if (!ticket?.sourceProgram || ticket.sourceProgram === PROGRAM_ID)
      return this.legacy;
    throw new Error("This ticket belongs to an unsupported game program.");
  }

  checkTicket(ticket) {
    return this.clientFor(ticket).checkTicket(ticket);
  }
  settleTicket(ticket, options) {
    return this.clientFor(ticket).settleTicket(ticket, options);
  }
  refundTicket(ticket, options) {
    if (this.clientFor(ticket) !== this.primary)
      throw new Error("Legacy tickets retain their original settlement rules.");
    return this.primary.refundTicket(ticket, options);
  }

  recordDraw(drawTime, options = {}) {
    const client = options.ticket
      ? this.clientFor(options.ticket)
      : this.primary;
    return client.recordDraw(drawTime, options);
  }

  publishResult(drawTime, options = {}) {
    const client = options.ticket
      ? this.clientFor(options.ticket)
      : this.primary;
    return client.publishResult(drawTime, options);
  }

  async claimAll(options = {}) {
    this.requireSigner();
    const tickets = options.tickets ?? (await this.getTickets());
    const now = Math.floor(this.primary.now() / 1000);
    const wins = tickets.filter(
      (ticket) =>
        !ticket.settled &&
        ticket.drawTime <= now &&
        ticket.result?.isPublished &&
        ticket.numbers.every(
          (number, index) => number === ticket.result.numbers[index],
        ),
    );
    const progress = { settled: 0, signatures: [] };
    for (const client of [this.legacy, this.primary]) {
      const group = wins.filter((ticket) => this.clientFor(ticket) === client);
      if (!group.length) continue;
      options.assertActive?.();
      try {
        const result = await client.settleBatch(group, options);
        progress.settled += result.settled;
        progress.signatures.push(...result.signatures);
      } catch (cause) {
        const failure = new Error(
          `${progress.settled ? `${progress.settled} earlier prize${progress.settled === 1 ? " was" : "s were"} confirmed. ` : ""}${cause.message || "The next prize batch was not confirmed."} Refresh to check the remaining tickets; confirmed claims are not resent.`,
          { cause },
        );
        failure.confirmedSettlements =
          progress.settled + (cause.confirmedSettlements ?? 0);
        failure.confirmedSignatures = [
          ...progress.signatures,
          ...(cause.confirmedSignatures ?? []),
        ];
        throw failure;
      }
    }
    return progress;
  }
}

export function createDodosClient(
  options = {},
  environment = import.meta.env ?? {},
) {
  return isPublicVrfBuild(environment)
    ? new PublicDodosClient(options)
    : new DodosClient(options);
}

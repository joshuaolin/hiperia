import BN from "bn.js";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { getConfigPda, getReferralPda, getTicketPda } from "./pdas.js";
import { loadReferralRules } from "./chainRules.js";

const emptyKey = SystemProgram.programId.toBase58();

function count(value) {
  if (!BN.isBN(value) || value.isNeg() || value.bitLength() > 64)
    throw new Error("The on-chain referral count is invalid.");
  return value.toString();
}

export class ReferralClient {
  constructor({
    program,
    wallet,
    connection,
    payer,
    now = Date.now,
    rulesLoader = loadReferralRules,
  }) {
    this.program = program;
    this.wallet = wallet;
    this.connection = connection;
    this.payer = payer;
    this.now = now;
    this.rulesLoader = rulesLoader;
  }

  requireSigner() {
    if (
      !this.wallet?.publicKey ||
      !this.wallet.signTransaction ||
      !this.wallet.signAllTransactions
    )
      throw new Error("Connect a wallet that can sign transactions.");
  }

  async getRules({ fresh = false } = {}) {
    return this.rulesLoader({
      program: this.program,
      connection: this.connection,
      configAddress: getConfigPda(this.program.programId)[0],
      payer: this.payer,
      now: this.now,
      fresh,
    });
  }

  async getProfile(owner = this.wallet?.publicKey) {
    if (!owner) return null;
    const key = new PublicKey(owner);
    const [address, bump] = getReferralPda(key, this.program.programId);
    const account =
      await this.program.account.referralProfile.fetchNullable(address);
    if (!account) return null;
    const referrer = account.referrer.toBase58();
    const firstTicket = account.firstTicket.toBase58();
    const registeredCount = count(account.registeredCount);
    const qualifiedCount = count(account.qualifiedCount);
    if (
      account.version !== 1 ||
      account.bump !== bump ||
      !account.owner.equals(key) ||
      key.toBase58() === emptyKey ||
      referrer === key.toBase58() ||
      (account.benefitsEnabled && referrer === emptyKey) ||
      account.bindingLocked !== (firstTicket !== emptyKey) ||
      (account.qualified && !account.bindingLocked) ||
      BigInt(qualifiedCount) > BigInt(registeredCount)
    )
      throw new Error("The on-chain referral profile could not be verified.");
    return {
      address: address.toBase58(),
      owner: key.toBase58(),
      code: account.sharingEnabled ? key.toBase58() : null,
      referrer: referrer === emptyKey ? null : referrer,
      firstTicket: firstTicket === emptyKey ? null : firstTicket,
      sharingEnabled: account.sharingEnabled,
      benefitsEnabled: account.benefitsEnabled,
      bindingLocked: account.bindingLocked,
      qualified: account.qualified,
      registeredCount,
      qualifiedCount,
      canQualify: false,
    };
  }

  async load(config) {
    const rules = await this.purchaseRules(config);
    if (!rules)
      return {
        available: false,
        loaded: true,
        rules: null,
        profile: null,
        discountEligible: false,
        error: null,
      };
    const current = await this.getProfile();
    const profile = current ? { ...current } : null;
    if (profile?.firstTicket && !profile.qualified && profile.referrer) {
      const ticket = await this.program.account.ticket.fetchNullable(
        new PublicKey(profile.firstTicket),
      );
      profile.canQualify = Boolean(
        ticket?.settled &&
          ticket.user.equals(new PublicKey(profile.owner)) &&
          ticket.paidLamports.gt(new BN(0)) &&
          ticket.padding?.[0] === 2,
      );
    }
    return {
      available: true,
      loaded: true,
      rules,
      profile,
      discountEligible: Boolean(profile?.referrer && profile.benefitsEnabled),
      error: null,
    };
  }

  async purchaseRules(config) {
    if (![4, 5].includes(config?.rulesRevision)) return null;
    const rules = await this.getRules();
    if (!rules) return null;
    if (
      !rules.normalQuickTicketCostLamports.eq(config.quickTicketCostLamports) ||
      !rules.normalDailyTicketCostLamports.eq(config.dailyTicketCostLamports)
    )
      throw new Error(
        "The on-chain referral prices do not match the game rules.",
      );
    return rules;
  }

  registerInstruction(sharingEnabled) {
    return this.program.methods
      .registerReferral(Boolean(sharingEnabled))
      .accountsStrict({
        profile: getReferralPda(
          this.wallet.publicKey,
          this.program.programId,
        )[0],
        owner: this.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  async send(instructions) {
    this.requireSigner();
    return this.program.provider.sendAndConfirm(
      new Transaction().add(...instructions),
      [],
      {
        commitment: "confirmed",
        preflightCommitment: "confirmed",
        maxRetries: 0,
      },
    );
  }

  async update({ sharingEnabled, referrer, benefitsEnabled } = {}) {
    this.requireSigner();
    const current = await this.getProfile();
    const sharing = sharingEnabled ?? current?.sharingEnabled ?? false;
    const inviter =
      referrer === undefined ? (current?.referrer ?? null) : referrer;
    const key = inviter ? new PublicKey(inviter) : SystemProgram.programId;
    const benefits = benefitsEnabled ?? current?.benefitsEnabled ?? false;
    if (key.equals(this.wallet.publicKey))
      throw new Error("You cannot use your own referral code.");
    if (benefits && key.equals(SystemProgram.programId))
      throw new Error("Choose a referral code before enabling its discount.");
    if (current?.bindingLocked && inviter !== current.referrer)
      throw new Error(
        "Your referrer is permanent after the first paid campaign ticket. You can still turn the discount off.",
      );
    if (inviter && current?.referrer !== inviter) {
      const parent = await this.getProfile(key);
      if (!parent?.sharingEnabled)
        throw new Error("This referral code is not accepting new players.");
    }
    const instructions = [];
    if (!current) instructions.push(await this.registerInstruction(sharing));
    if (current || inviter || benefits) {
      instructions.push(
        await this.program.methods
          .updateReferral(sharing, key, benefits)
          .accountsStrict({
            profile: getReferralPda(
              this.wallet.publicKey,
              this.program.programId,
            )[0],
            owner: this.wallet.publicKey,
            referrerProfile: inviter
              ? getReferralPda(key, this.program.programId)[0]
              : null,
          })
          .instruction(),
      );
    }
    return this.send(instructions);
  }

  async setSharing(enabled) {
    return this.update({ sharingEnabled: Boolean(enabled) });
  }

  async bind(referrer) {
    return this.update({
      referrer: new PublicKey(referrer).toBase58(),
      benefitsEnabled: true,
    });
  }

  async removeBenefits() {
    const current = await this.getProfile();
    if (!current)
      throw new Error("No referral profile exists for this wallet.");
    return this.update({
      referrer: current.bindingLocked ? current.referrer : null,
      benefitsEnabled: false,
    });
  }

  async preparePurchase() {
    this.requireSigner();
    const profile = await this.getProfile();
    return {
      profile: getReferralPda(this.wallet.publicKey, this.program.programId)[0],
      referrerProfile: profile?.referrer
        ? getReferralPda(profile.referrer, this.program.programId)[0]
        : null,
      instructions: profile ? [] : [await this.registerInstruction(false)],
    };
  }

  async settlementQualification(ticket, profile) {
    if (!profile?.referrer || profile.qualified || !profile.bindingLocked)
      return null;
    const address =
      ticket.address ??
      getTicketPda(
        ticket.user,
        ticket.id,
        this.program.programId,
      )[0].toBase58();
    if (profile.owner !== ticket.user || profile.firstTicket !== address)
      return null;
    return this.program.methods
      .qualifyReferral()
      .accountsStrict({
        profile: new PublicKey(profile.address),
        ticket: new PublicKey(address),
        referrerProfile: getReferralPda(
          profile.referrer,
          this.program.programId,
        )[0],
      })
      .instruction();
  }

  async qualify() {
    this.requireSigner();
    const profile = await this.getProfile();
    if (profile?.qualified) return null;
    if (!profile?.referrer || !profile.firstTicket)
      throw new Error(
        "A referred paid campaign ticket must be settled before qualification.",
      );
    const ticket = await this.program.account.ticket.fetchNullable(
      new PublicKey(profile.firstTicket),
    );
    if (!ticket?.settled)
      throw new Error(
        "Settle the first campaign ticket before recording a qualified referral.",
      );
    const instruction = await this.program.methods
      .qualifyReferral()
      .accountsStrict({
        profile: new PublicKey(profile.address),
        ticket: new PublicKey(profile.firstTicket),
        referrerProfile: getReferralPda(
          profile.referrer,
          this.program.programId,
        )[0],
      })
      .instruction();
    return this.send([instruction]);
  }
}

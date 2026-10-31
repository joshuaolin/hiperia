import test from "node:test";
import assert from "node:assert/strict";
import { BN } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { createClient, fundVault } from "../scripts/client.js";
import { getResultPda, getTicketPda } from "../../src/lib/onchain/pdas.js";

test(
  "referral campaign binds paid play, qualifies once and preserves owner payouts",
  { timeout: 120_000 },
  async () => {
    const endpoint = new URL(
      process.env.ANCHOR_PROVIDER_URL ?? "http://localhost",
    );
    assert.ok(
      ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname),
      "This destructive fresh-campaign fixture requires a local validator.",
    );
    const { client, provider } = await createClient();
    await client.initialize();
    const program = client.program;
    const owner = provider.wallet.publicKey;
    const inviter = Keypair.generate();
    const stranger = Keypair.generate();
    const profileAddress = (wallet) =>
      PublicKey.findProgramAddressSync(
        [Buffer.from("referral"), Buffer.from("v1"), wallet.toBuffer()],
        program.programId,
      )[0];
    const profile = profileAddress(owner);
    const inviterProfile = profileAddress(inviter.publicKey);
    const strangerProfile = profileAddress(stranger.publicKey);
    assert.equal(
      await program.account.referralProfile.fetchNullable(profile),
      null,
    );
    const register = (wallet, address) =>
      program.methods.registerReferral(true).accountsStrict({
        profile: address,
        owner: wallet,
        systemProgram: SystemProgram.programId,
      });
    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: owner,
          toPubkey: inviter.publicKey,
          lamports: 3_000_000,
        }),
        SystemProgram.transfer({
          fromPubkey: owner,
          toPubkey: stranger.publicKey,
          lamports: 3_000_000,
        }),
      ),
    );
    await register(inviter.publicKey, inviterProfile).signers([inviter]).rpc();
    await register(stranger.publicKey, strangerProfile)
      .signers([stranger])
      .rpc();
    await register(owner, profile).rpc();
    const update = (
      referrer,
      referrerProfile,
      benefitsEnabled = true,
      sharingEnabled = true,
    ) =>
      program.methods
        .updateReferral(sharingEnabled, referrer, benefitsEnabled)
        .accountsStrict({
          profile,
          owner,
          referrerProfile,
        });
    await assert.rejects(update(owner, profile).rpc(), /SelfReferral/);
    await assert.rejects(
      update(inviter.publicKey, strangerProfile).rpc(),
      /InvalidReferrer/,
    );
    await update(inviter.publicKey, inviterProfile).rpc();
    const updated = await program.account.referralProfile.fetch(profile);
    assert.equal(updated.referrer.toBase58(), inviter.publicKey.toBase58());
    assert.equal(updated.bindingLocked, false);
    assert.equal(updated.benefitsEnabled, true);
    await program.methods
      .updateReferral(false, PublicKey.default, false)
      .accountsStrict({
        profile: inviterProfile,
        owner: inviter.publicKey,
        referrerProfile: null,
      })
      .signers([inviter])
      .rpc();
    await assert.rejects(
      program.methods
        .updateReferral(true, inviter.publicKey, true)
        .accountsStrict({
          profile: strangerProfile,
          owner: stranger.publicKey,
          referrerProfile: inviterProfile,
        })
        .signers([stranger])
        .rpc(),
      /ReferralSharingDisabled/,
    );
    await assert.rejects(
      program.methods
        .updateReferral(false, inviter.publicKey, false)
        .accountsStrict({
          profile,
          owner: stranger.publicKey,
          referrerProfile: inviterProfile,
        })
        .signers([stranger])
        .rpc(),
      /ConstraintSeeds/,
    );
    await fundVault(client, provider, 1);
    let drawTime = Math.floor(Date.now() / 1000) + 10;
    if (drawTime % 14400 === 7200) drawTime++;
    const nonce = new BN(Date.now());
    const ticket = getTicketPda(owner, nonce, program.programId)[0];
    const purchase = (numbers) =>
      program.methods
        .buyTicketReferred(nonce, new BN(drawTime), numbers)
        .accountsStrict({
          config: client.configAddress,
          vault: client.vaultAddress,
          ticket,
          user: owner,
          systemProgram: SystemProgram.programId,
          profile,
          referrerProfile: inviterProfile,
        });
    await assert.rejects(purchase([2, 2]).rpc(), /InvalidNumbers/);
    assert.equal(
      (
        await program.account.referralProfile.fetch(inviterProfile)
      ).registeredCount.toString(),
      "0",
    );
    assert.equal(
      (await program.account.referralProfile.fetch(profile)).bindingLocked,
      false,
    );
    await purchase([22, 2]).rpc();
    const storedTicket = await program.account.ticket.fetch(ticket);
    assert.equal(storedTicket.paidLamports.toString(), "7100000");
    const joined = await program.account.referralProfile.fetch(profile);
    assert.equal(joined.bindingLocked, true);
    assert.equal(joined.firstTicket.toBase58(), ticket.toBase58());
    assert.equal(
      (
        await program.account.referralProfile.fetch(inviterProfile)
      ).registeredCount.toString(),
      "1",
    );
    await assert.rejects(
      update(stranger.publicKey, strangerProfile).rpc(),
      /ReferralBindingLocked/,
    );
    await assert.rejects(
      update(PublicKey.default, null, false).rpc(),
      /ReferralBindingLocked/,
    );
    await update(inviter.publicKey, inviterProfile, false, false).rpc();
    assert.equal(
      (await program.account.referralProfile.fetch(profile)).benefitsEnabled,
      false,
    );
    await update(inviter.publicKey, inviterProfile).rpc();
    const qualify = (referrerProfile = inviterProfile) =>
      program.methods
        .qualifyReferral()
        .accountsStrict({ profile, ticket, referrerProfile });
    await assert.rejects(qualify().rpc(), /ReferralNotEligible/);
    while (Math.floor(Date.now() / 1000) <= drawTime + 1)
      await new Promise((resolve) => setTimeout(resolve, 500));
    await client.publishResult(drawTime);
    await provider.sendAndConfirm(
      new Transaction().add(
        await program.methods
          .settleTicket()
          .accountsStrict({
            config: client.configAddress,
            vault: client.vaultAddress,
            ticket,
            result: getResultPda(drawTime, program.programId)[0],
            user: owner,
            systemProgram: SystemProgram.programId,
          })
          .instruction(),
        await qualify().instruction(),
      ),
    );
    assert.equal((await program.account.ticket.fetch(ticket)).settled, true);
    assert.equal(
      (await program.account.referralProfile.fetch(profile)).qualified,
      true,
    );
    assert.equal(
      (
        await program.account.referralProfile.fetch(inviterProfile)
      ).qualifiedCount.toString(),
      "1",
    );
    await qualify().rpc();
    assert.equal(
      (
        await program.account.referralProfile.fetch(inviterProfile)
      ).qualifiedCount.toString(),
      "1",
    );
    await assert.rejects(qualify(strangerProfile).rpc(), /InvalidReferrer/);
    await assert.rejects(register(owner, profile).rpc());
  },
);

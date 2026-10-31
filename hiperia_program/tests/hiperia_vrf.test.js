import test from "node:test";
import assert from "node:assert/strict";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import idl from "../../src/idl/hiperia_vrf.json" with { type: "json" };
import { UAT_ADMIN } from "../../src/lib/onchain/DodosClient.js";
import { getUpcomingDrawTimes } from "../../src/lib/onchain/time.js";

test(
  "public VRF purchases accept repeated daily entries and a prefunded draw PDA",
  { timeout: 120_000 },
  async (context) => {
    const endpoint = new URL(
      process.env.ANCHOR_PROVIDER_URL ?? "http://localhost",
    );
    if (!["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)) {
      context.skip("This funded fixture requires a local validator.");
      return;
    }
    const provider = AnchorProvider.env();
    assert.equal(provider.wallet.publicKey.toBase58(), UAT_ADMIN);
    const program = new Program(idl, provider);
    const pda = (...seeds) =>
      PublicKey.findProgramAddressSync(seeds, program.programId)[0];
    const config = pda(Buffer.from("config"));
    const vault = pda(Buffer.from("vault"));
    if (!(await program.account.config.fetchNullable(config))) {
      await program.methods
        .initialize(new BN(7_200_000), new BN(1_000_000_000))
        .accountsStrict({
          config,
          vault,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }
    const rules = await program.methods
      .getRules()
      .accountsStrict({ config })
      .view();
    assert.equal(rules.revision, 6);
    assert.deepEqual([...rules.winningNumbers], [0, 0]);
    const access = await program.methods
      .getAccessRules()
      .accountsStrict({ config })
      .view();
    assert.deepEqual(access, {
      revision: 1,
      publicPlay: true,
      publicResults: true,
    });
    const randomness = await program.methods
      .getRandomnessRules()
      .accountsStrict({ config })
      .view();
    assert.equal(randomness.refundAfterSeconds, 86_400);
    assert.equal(randomness.pendingRequestSpace, 749);
    assert.equal(
      randomness.oracleProgram.toBase58(),
      "VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y",
    );
    const outsider = Keypair.generate();
    const cost = rules.dailyTicketCostLamports.toNumber();
    const prize = rules.dailyPayoutLamports.toNumber();
    const time = getUpcomingDrawTimes()[0];
    const draw = pda(
      Buffer.from("draw"),
      new BN(time).toArrayLike(Buffer, "le", 8),
    );
    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: provider.wallet.publicKey,
          toPubkey: vault,
          lamports: 2 * prize,
        }),
        SystemProgram.transfer({
          fromPubkey: provider.wallet.publicKey,
          toPubkey: outsider.publicKey,
          lamports: 2 * cost + 20_000_000,
        }),
        SystemProgram.transfer({
          fromPubkey: provider.wallet.publicKey,
          toPubkey: draw,
          lamports: 1,
        }),
      ),
    );
    const before = await program.account.vault.fetch(vault);
    const reservedBefore = Buffer.from(before.padding).readBigUInt64LE();
    for (const id of [new BN(1), new BN(2)]) {
      const ticket = pda(
        Buffer.from("ticket"),
        outsider.publicKey.toBuffer(),
        id.toArrayLike(Buffer, "le", 8),
      );
      const purchase = program.methods
        .buyTicket(id, new BN(time), [22, 2])
        .accountsStrict({
          config,
          vault,
          ticket,
          user: outsider.publicKey,
          systemProgram: SystemProgram.programId,
          draw,
        })
        .signers([outsider]);
      await purchase.rpc();
      const stored = await program.account.ticket.fetch(ticket);
      assert.equal(stored.user.toBase58(), outsider.publicKey.toBase58());
      assert.equal(stored.paidLamports.toNumber(), cost);
      assert.equal(stored.drawTime.toNumber(), time);
      assert.equal(stored.settled, false);
      assert.equal(
        Buffer.from(stored.padding).readBigUInt64LE(1),
        BigInt(prize),
      );
      assert.equal(stored.padding[9], 0);
      await assert.rejects(purchase.rpc());
    }
    const after = await program.account.vault.fetch(vault);
    assert.equal(
      Buffer.from(after.padding).readBigUInt64LE(),
      reservedBefore + 2n * BigInt(prize),
    );
    const storedDraw = await program.account.draw.fetch(draw);
    assert.equal(storedDraw.ticketCount.toNumber(), 2);
    assert.equal(storedDraw.status, 0);
    assert.deepEqual([...storedDraw.numbers], [0, 0]);
    assert.equal(storedDraw.ticketCostLamports.toNumber(), cost);
    assert.equal(storedDraw.payoutLamports.toNumber(), prize);
  },
);

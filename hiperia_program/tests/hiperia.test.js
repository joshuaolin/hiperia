import test from "node:test";
import assert from "node:assert/strict";
import {
  Keypair,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createClient,
  fundVault,
  requireCurrentUatRules,
} from "../scripts/client.js";
import { UAT_ADMIN } from "../../src/lib/onchain/DodosClient.js";
import { getUatDrawTime } from "../../src/lib/onchain/time.js";
import { getResultPda, getTicketPda } from "../../src/lib/onchain/pdas.js";

test(
  "buys, publishes and settles to the immutable owner through a third-party payer",
  { timeout: 120_000 },
  async () => {
    assert.ok(
      process.env.ANCHOR_PROVIDER_URL,
      "Run through anchor test on localnet, or explicitly configure the test cluster URL.",
    );
    const { client, provider } = await createClient();
    assert.equal(
      provider.wallet.publicKey.toBase58(),
      UAT_ADMIN,
      "Use the configured UAT administrator wallet for this contract test.",
    );
    await client.initialize();
    await requireCurrentUatRules(client);
    const config = await client.getConfig();
    assert.equal(
      config.uatEnabled,
      true,
      "Configure the UAT tester before testing an upgraded deployment.",
    );
    await fundVault(
      client,
      provider,
      Number(config.payoutLamports.toString()) / 1e9,
    );
    const drawTime = getUatDrawTime(Date.now(), 20);
    const ticket = await client.buyTicket([2, 22], { drawTime });
    const stored = await client.getTicket(ticket.id);
    assert.deepEqual(Array.from(stored.numbers), [2, 22]);
    assert.equal(stored.user.toBase58(), provider.wallet.publicKey.toBase58());
    assert.equal(stored.drawTime.toString(), String(drawTime));
    assert.equal(stored.settled, false);
    await assert.rejects(client.publishResult(drawTime), /not started/);
    await assert.rejects(client.buyTicket([2, 2]), /different numbers/);
    await assert.rejects(client.buyTicket([1, 22]), /different numbers/);
    await assert.rejects(
      client.buyTicket([2, 3], { drawTime: Math.floor(Date.now() / 1000) - 1 }),
      /future draw/,
    );
    while (Date.now() / 1000 <= drawTime + 2)
      await new Promise((resolve) => setTimeout(resolve, 1000));
    await client.publishResult(drawTime);
    const result = await client.checkTicket(ticket);
    assert.equal(result.status, "won");
    assert.deepEqual(result.numbers, [2, 22]);
    const beforeVault = await provider.connection.getBalance(
      client.vaultAddress,
    );
    const relayer = Keypair.generate();
    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: provider.wallet.publicKey,
          toPubkey: relayer.publicKey,
          lamports: 2_000_000,
        }),
      ),
    );
    const beforeOwner = await provider.connection.getBalance(
      provider.wallet.publicKey,
    );
    const settlement = (recipient) =>
      client.program.methods
        .settleTicket()
        .accountsStrict({
          config: client.configAddress,
          vault: client.vaultAddress,
          ticket: getTicketPda(
            provider.wallet.publicKey,
            ticket.id,
            client.program.programId,
          )[0],
          result: getResultPda(drawTime, client.program.programId)[0],
          user: recipient,
          systemProgram: SystemProgram.programId,
        })
        .instruction();
    const relay = async (recipient) =>
      sendAndConfirmTransaction(
        provider.connection,
        new Transaction().add(await settlement(recipient)),
        [relayer],
        { commitment: "confirmed", maxRetries: 0 },
      );
    await assert.rejects(relay(relayer.publicKey), /Unauthorized/);
    await relay(provider.wallet.publicKey);
    assert.equal((await client.getTicket(ticket.id)).settled, true);
    const afterVault = await provider.connection.getBalance(
      client.vaultAddress,
    );
    assert.equal(
      beforeVault - afterVault,
      result.status === "won" ? Number(config.payoutLamports.toString()) : 0,
    );
    assert.equal(
      (await provider.connection.getBalance(provider.wallet.publicKey)) -
        beforeOwner,
      Number(config.payoutLamports.toString()),
    );
    await assert.rejects(relay(provider.wallet.publicKey));
    console.log(
      "Validator flow checked with fixed result 02 → 22 and a third-party settlement paid only to the ticket owner.",
    );
  },
);

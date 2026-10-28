import test from "node:test";
import assert from "node:assert/strict";
import {
  Keypair,
  PublicKey,
  SystemInstruction,
  SystemProgram,
} from "@solana/web3.js";
import {
  DONATION_ADDRESS,
  DonationClient,
  canSignDonation,
  explorerTransactionUrl,
  formatSol,
  inspectNetwork,
  parseSolAmount,
} from "./donation.js";

const RPC_GENESIS_HASHES = {
  devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  testnet: "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY",
  mainnet: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
};

function fixture({
  genesisHash = RPC_GENESIS_HASHES.devnet,
  balance = 1_000_000_000,
  fee = 5_000,
} = {}) {
  const calls = { sent: 0, confirmed: 0, stages: [] };
  const blockhash = {
    blockhash: new PublicKey(new Uint8Array(32).fill(3)).toBase58(),
    lastValidBlockHeight: 1_000,
  };
  const connection = {
    rpcEndpoint: "https://api.devnet.solana.com",
    getGenesisHash: async () => genesisHash,
    getLatestBlockhash: async () => blockhash,
    getBalance: async () => balance,
    getFeeForMessage: async () => ({ value: fee }),
    confirmTransaction: async (strategy, commitment) => {
      calls.confirmed += 1;
      calls.strategy = strategy;
      calls.commitment = commitment;
      return { value: { err: null } };
    },
  };
  const wallet = {
    connected: true,
    publicKey: Keypair.generate().publicKey,
    signTransaction: async (transaction) => transaction,
    sendTransaction: async (transaction, rpc, options) => {
      calls.sent += 1;
      calls.transaction = transaction;
      calls.connection = rpc;
      calls.options = options;
      return "donation-signature";
    },
  };
  const client = new DonationClient({ connection, wallet });
  return {
    calls,
    blockhash,
    connection,
    wallet,
    client,
    onStatus: (status) => calls.stages.push(status),
  };
}

test("SOL input preserves lamports exactly without rounding", () => {
  assert.equal(parseSolAmount("0.000000001"), 1);
  assert.equal(parseSolAmount("0.100000001"), 100_000_001);
  assert.equal(parseSolAmount(" 001.002300000 "), 1_002_300_000);
  assert.equal(parseSolAmount("9007199.254740991"), Number.MAX_SAFE_INTEGER);
  assert.equal(formatSol(100_000_001), "0.100000001");
  assert.equal(formatSol(1_000_000_000), "1");
  assert.equal(formatSol(0), "0");
});

test("SOL input rejects zero, excess precision, unsafe integers, and numeric notation", () => {
  for (const value of [
    "",
    " ",
    "0",
    "0.000000000",
    "-1",
    "+1",
    "1e2",
    "NaN",
    "Infinity",
    "1,000",
    "0.0000000001",
    "9007199.254740992",
    0.1,
  ]) {
    assert.throws(() => parseSolAmount(value), Error, String(value));
  }
});

test("genesis checks identify Devnet and Testnet even behind custom RPC providers", async () => {
  for (const [genesisHash, cluster] of [
    [RPC_GENESIS_HASHES.devnet, "devnet"],
    [RPC_GENESIS_HASHES.testnet, "testnet"],
  ]) {
    const result = await inspectNetwork({
      rpcEndpoint: "https://rpc.example.com",
      getGenesisHash: async () => genesisHash,
    });
    assert.equal(result.allowed, true);
    assert.equal(result.cluster, cluster);
    assert.equal(result.genesisHash, genesisHash);
  }
});

test("mainnet is denied even through a loopback RPC", async () => {
  const result = await inspectNetwork({
    rpcEndpoint: "http://127.0.0.1:8899",
    getGenesisHash: async () => RPC_GENESIS_HASHES.mainnet,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.cluster, "mainnet-beta");
  assert.equal(explorerTransactionUrl("signature", result), null);
});

test("unknown genesis is permitted only on an explicit HTTP loopback endpoint", async () => {
  for (const endpoint of [
    "http://localhost:8899",
    "http://127.0.0.1:8899",
    "http://[::1]:8899",
  ]) {
    const result = await inspectNetwork({
      rpcEndpoint: endpoint,
      getGenesisHash: async () => "local-genesis",
    });
    assert.equal(result.allowed, true, endpoint);
    assert.equal(result.cluster, "custom");
    const explorer = new URL(explorerTransactionUrl("signature", result));
    assert.equal(explorer.searchParams.get("customUrl"), endpoint);
  }
  for (const endpoint of [
    "https://rpc.example.com",
    "https://localhost.example.com",
    "https://127.0.0.1.example.com",
    "file://localhost/validator",
    "invalid",
  ]) {
    const result = await inspectNetwork({
      rpcEndpoint: endpoint,
      getGenesisHash: async () => "unknown-genesis",
    });
    assert.equal(result.allowed, false, endpoint);
  }
});

test("a read-only wallet is not considered a signer", () => {
  const { wallet } = fixture();
  assert.equal(canSignDonation(wallet), true);
  assert.equal(
    canSignDonation({ ...wallet, wallet: { adapter: { name: "Read only" } } }),
    false,
  );
  assert.equal(canSignDonation({ ...wallet, connected: false }), false);
  assert.equal(
    canSignDonation({ ...wallet, signTransaction: undefined }),
    false,
  );
});

test("donations build the exact SystemProgram transfer and confirm the returned signature", async () => {
  const { client, calls, wallet, connection, blockhash, onStatus } = fixture();
  assert.equal(calls.sent, 0);
  const result = await client.donate("0.100000001", { onStatus });
  assert.equal(calls.sent, 1);
  assert.equal(calls.confirmed, 1);
  assert.equal(calls.transaction.instructions.length, 1);
  const instruction = calls.transaction.instructions[0];
  assert.ok(instruction.programId.equals(SystemProgram.programId));
  const transfer = SystemInstruction.decodeTransfer(instruction);
  assert.ok(transfer.fromPubkey.equals(wallet.publicKey));
  assert.equal(transfer.toPubkey.toBase58(), DONATION_ADDRESS);
  assert.equal(transfer.lamports, 100_000_001n);
  assert.ok(calls.transaction.feePayer.equals(wallet.publicKey));
  assert.equal(calls.connection, connection);
  assert.deepEqual(calls.options, {
    preflightCommitment: "confirmed",
    skipPreflight: false,
    maxRetries: 0,
  });
  assert.deepEqual(calls.strategy, {
    signature: "donation-signature",
    ...blockhash,
  });
  assert.equal(calls.commitment, "confirmed");
  assert.deepEqual(
    calls.stages.map(({ stage }) => stage),
    ["checking", "signing", "confirming", "confirmed"],
  );
  assert.equal(result.stage, "confirmed");
  assert.equal(
    explorerTransactionUrl(result.signature, result.network),
    "https://explorer.solana.com/tx/donation-signature?cluster=devnet",
  );
});

test("insufficient balance includes the estimated fee and never requests a signature", async () => {
  const { client, calls } = fixture({ balance: 10_004_999 });
  await assert.rejects(client.donate("0.01"), /plus 0.000005 SOL/);
  assert.equal(calls.sent, 0);
  assert.equal(calls.confirmed, 0);
});

test("the exact balance for the amount and fee is accepted", async () => {
  const { client, calls } = fixture({ balance: 10_005_000 });
  await client.donate("0.01");
  assert.equal(calls.sent, 1);
});

test("unknown fees, invalid amounts, unsupported networks, and disconnected wallets never send", async () => {
  const fixtures = [
    [fixture({ fee: null }), "0.01", /fee is unavailable/],
    [fixture(), "0.0000000001", /decimal places/],
    [
      fixture({ genesisHash: RPC_GENESIS_HASHES.mainnet }),
      "0.01",
      /Mainnet is disabled/,
    ],
    [
      fixture({ genesisHash: "unknown-genesis" }),
      "0.01",
      /Mainnet is disabled/,
    ],
  ];
  const disconnected = fixture();
  disconnected.wallet.connected = false;
  fixtures.push([disconnected, "0.01", /Connect your wallet/]);
  const readOnly = fixture();
  readOnly.wallet.wallet = { adapter: { name: "Read only" } };
  fixtures.push([readOnly, "0.01", /cannot sign/]);
  for (const [{ client, calls }, amount, message] of fixtures) {
    await assert.rejects(client.donate(amount), message);
    assert.equal(calls.sent, 0);
  }
});

test("a wallet change during validation cancels the transfer", async () => {
  const { connection, wallet, calls } = fixture();
  let currentWallet = wallet;
  connection.getBalance = async () => {
    currentWallet = { ...wallet, publicKey: Keypair.generate().publicKey };
    return 1_000_000_000;
  };
  const client = new DonationClient({
    connection,
    wallet: () => currentWallet,
  });
  await assert.rejects(client.donate("0.01"), /wallet changed/);
  assert.equal(calls.sent, 0);
});

test("concurrent submissions are rejected without sending a second transfer", async () => {
  const { client, calls, connection } = fixture();
  let finishNetworkCheck;
  connection.getGenesisHash = () =>
    new Promise((resolve) => {
      finishNetworkCheck = resolve;
    });
  const first = client.donate("0.01");
  await assert.rejects(client.donate("0.02"), /already in progress/);
  finishNetworkCheck(RPC_GENESIS_HASHES.devnet);
  await first;
  assert.equal(calls.sent, 1);
  assert.equal(client.pending, false);
});

test("wallet rejection is surfaced and never retried", async () => {
  const { client, calls, wallet } = fixture();
  wallet.sendTransaction = async () => {
    calls.sent += 1;
    throw new Error("User rejected the request");
  };
  await assert.rejects(client.donate("0.01"), /User rejected/);
  assert.equal(calls.sent, 1);
  assert.equal(calls.confirmed, 0);
  assert.equal(client.pending, false);
});

test("confirmation failure preserves the signature and does not retry a submitted transfer", async () => {
  const { client, calls, connection } = fixture();
  connection.confirmTransaction = async () => {
    throw new Error("RPC timeout");
  };
  await assert.rejects(client.donate("0.01"), (error) => {
    assert.equal(error.signature, "donation-signature");
    assert.equal(error.confirmationUncertain, true);
    assert.equal(error.network.cluster, "devnet");
    assert.match(error.message, /Check its status before sending another/);
    return true;
  });
  assert.equal(calls.sent, 1);
});

test("an on-chain failure is never presented as a confirmed donation", async () => {
  const { client, calls, connection, onStatus } = fixture();
  connection.confirmTransaction = async () => ({
    value: { err: { InstructionError: [0, "InsufficientFunds"] } },
  });
  await assert.rejects(client.donate("0.01", { onStatus }), (error) => {
    assert.equal(error.signature, "donation-signature");
    assert.equal(error.confirmationUncertain, false);
    assert.match(error.message, /failed on chain/);
    return true;
  });
  assert.equal(calls.sent, 1);
  assert.ok(!calls.stages.some(({ stage }) => stage === "confirmed"));
});

# Hiperia

Dodos on Solana Devnet, with a focused dashboard and optional wallet-signed donations. The mini game, placeholder games, carousel, matrix effects, duplicate files, and unused dependencies have been removed. The UI uses a dark navy and mint palette inspired by [Hyperliquid](https://hyperliquid.xyz/).

## Run

Use Node.js 22.12 or newer:

```sh
npm ci
npm run dev
```

Open `http://localhost:5173/` and connect the approved **Devnet** test wallet. The live UAT program records fixed new results **06 → 09**. The frontend shows **06 → 07** only as a target pending a separate on-chain upgrade; until that upgrade, new results remain **06 → 09**. Purchases stay restricted to the tester and administrator, and each ticket reserves a full prize. Existing blockchain records keep their original results. Transactions stay paused in the UI until the on-chain UAT configuration is present. The default RPC is `https://api.devnet.solana.com`; copy [.env.example](./.env.example) to `.env.local` for a custom test RPC. Network verification uses genesis hashes; Mainnet signing actions are disabled.

`http://localhost:5173/dev/dummy-wallet.html` is a development-only, read-only wallet harness. It cannot sign purchases or donations. Use the normal app with a real browser wallet for transactions.

## UAT on Vercel

[Open UAT](https://www.uat.hiperia.xyz/). Always use this hostname for UAT. This is a Vercel Preview deployment using Solana Devnet and an explicit UAT badge. Vercel authentication is enabled; sign in with the project owner's Vercel account when prompted.

The project is linked locally to `joshua-olins-projects/hiperia.xyz`. Deploy another UAT preview with:

```sh
npx --yes vercel@65.5.0 deploy --yes --environment preview --scope joshua-olins-projects --build-env VITE_SOLANA_RPC=https://api.devnet.solana.com --build-env VITE_APP_ENV=uat
```

After the Preview is READY, assign its generated URL to the UAT domain:

```sh
npx --yes vercel@65.5.0 alias set <ready-preview-url> www.uat.hiperia.xyz --scope joshua-olins-projects
npx --yes vercel@65.5.0 inspect https://www.uat.hiperia.xyz --scope joshua-olins-projects --json
```

Verify the alias points to the new deployment ID with target `preview` and status `READY`, then open the custom URL and check the app before reporting completion. Keep production domains unchanged. The custom domain is also configured for the Git branch `uat` for branch deployments. [AGENTS.md](./AGENTS.md) records this workflow for future sessions.

[.vercelignore](./.vercelignore) allows frontend source, public assets, the UAT RPC function, and required build configuration. Local keypairs, backend build files, development harnesses, caches, and environment files are excluded from uploads. The Preview-only [RPC function](./api/solana.js) forwards bounded app requests to the fixed Devnet endpoint so browsers do not call the public RPC directly. Confirmation uses HTTP polling. Its cache and throttle are per function instance; the public upstream can still rate-limit.

## Deployed Devnet program

- Program: [HDodgjBzz7Fo2irAU1ahf5X2arwr773ZcHXD3iSb7nmQ](https://explorer.solana.com/address/HDodgjBzz7Fo2irAU1ahf5X2arwr773ZcHXD3iSb7nmQ?cluster=devnet)
- Prize vault: `DYmcQeHB9kdf7GLMjcbtbudiNnLTNkxxvvTyqcWTRyDo`
- Ticket: 0.0072 SOL, plus ticket account rent and network fees.
- Exact ordered match: 1 SOL. The vault received 1.1 Devnet SOL for testing.

On October 27, 2026, a [live ticket purchase](https://explorer.solana.com/tx/4TT25P1DPLmREHU4eKFyo3Kd3xWhN47BwVELDYm5aM5ehMmYhkADEfajq1VsjDLsXvfwXdFHPaNvLcfpwQz4nayY?cluster=devnet) was confirmed and its exact wallet deduction verified:

| Charge                 |            SOL |
| ---------------------- | -------------: |
| Ticket                 |         0.0072 |
| Ticket account rent    |     0.00115824 |
| Network fee            |       0.000005 |
| Total wallet deduction | **0.00836324** |

The test picked `1–22`; the published result was `19–3`. [Result publication](https://explorer.solana.com/tx/4P4Gm9PEkNxd1JPuwZJcsQZz2mTPMgEwYRrbUyhhbxGvUaGLQWofrH6tSkTBzZ4fswR7EuTdNQYoAP3a1T95d7fu?cluster=devnet) and [ticket settlement](https://explorer.solana.com/tx/4MVqb61P9r2c4TNRgvKZ4pHpx7djpH5tLFBhKRXCVNngT5UDUehq8Qejubet58aUXRWEAsg3HcrJJb4kmQF88wwr?cluster=devnet) succeeded. This losing ticket did not transfer a prize; the live test does not establish the winning payout branch.

On October 28, 2026, the fixed-result UAT upgrade was deployed and its exact binary verified. The approved tester is `Ghxn7ree6MFQxC8hFTJ8Lo319xEZzqVFLcmDLKVFpPaa`. Ten adversarial simulations, a losing ticket closure, and a [winning 1 SOL payout](https://explorer.solana.com/tx/3Y1mCtqT8c8pEApZDhYV3cCTnx3b7kb3arnKHXQxMD5NYeFsY59BwNVhJUSGLmYpbGe4K8pVhWhjsWxTi4XVwgnp?cluster=devnet) passed. The winning wallet increased by 0.999995 SOL after its network fee. The test prize was recycled into the vault, then another 2 Devnet SOL was added for testing. See the [UAT review](./docs/UAT-AUDIT.md) for transaction evidence and limits.

## Play and donate

1. Select two different numbers from 1 to 22. Order matters: 06 → 07 differs from 07 → 06.
2. Choose an exact dated 2 PM or 4 PM draw, UTC+8. One ticket covers one draw; it cannot be reused for both. The 60-second option is a UAT testing shortcut with the same prize.
3. Sign before the selected draw starts. The countdown updates every second; the chain rejects late purchases without collecting the ticket price. Failed transactions can still cost a network fee.
4. **View result** reads the chain for free. **Record draw result** creates the fixed result after the draw and costs a network fee plus account rent. It does not let the wallet choose the numbers.
5. **Claim prize** transfers a winning payout. **Close ticket** settles a loss without a prize and releases reserved capacity. Both cost a network fee. UAT claims have no deadline after the draw.

Tickets and results come from the chain. Prices and payout amounts come from the program config. Ticket and draw history links open their blockchain accounts. Purchases pause when the vault cannot reserve another full prize. For example, roughly 1.1 SOL can back one outstanding 1 SOL ticket; additional funds provide more capacity.

Manual Refresh has an eight-second cooldown and shares in-flight reads. Temporary 429 responses trigger an increasing retry delay, up to one minute, while preserving the same wallet's last loaded data. Confirmed transactions request a fresh read; no transaction is automatically resent.

Read the [UAT security review and payout math](./docs/UAT-AUDIT.md) before considering real funds. The fixed UAT result is deliberately predictable. It is not a production randomizer, and the 462-outcome count does not establish exploit resistance.

If purchase confirmation is interrupted, the browser keeps the purchase ID and checks its on-chain ticket before retrying. Retries reuse that ID, so the contract can accept only one purchase for it. Refresh checks the pending ticket without sending another transaction.

Donations send the reviewed SOL amount directly to `Ghxn7ree6MFQxC8hFTJ8Lo319xEZzqVFLcmDLKVFpPaa`. Each transfer requires wallet approval. The donation form validates lamports exactly, checks the amount plus network fee, and preserves an uncertain transaction's signature instead of automatically resending it. No donation was sent during the live Dodos test.

## Build and deploy

For a pinned local build, install Rust, Solana CLI and Anchor CLI **0.31.1** using the [official installation guide](https://www.anchor-lang.com/docs/installation). Contract development on Windows normally uses WSL.

```sh
npm run program:prepare -- --new
cd hiperia_program
anchor build
cargo test -p hiperia_program
cd ..
npm run program:sync-idl
npm run test:contract
```

The prepare command reuses an existing program keypair. Restore the original keypair and upgrade authority when upgrading an existing deployment. Generated program and deployer keypairs stay in the ignored `hiperia_program/target/deploy/` directory. Verified backups of this deployment are stored outside the build directory in the ignored `.local/solana/` directory. Keep a separate secure backup before deleting either directory; never upload keypairs. The development server blocks both directories and other private build artifacts.

A Windows fallback is available:

```sh
npm run setup:solana:windows
npm run program:create-deployer
npm run program:build:remote
npm run program:verify-abi
```

The Windows installer downloads a pinned official Agave release and verifies its SHA-256 checksum. The remote build sends only Rust source to Solana Playground and uses its server-selected legacy Anchor dependencies. It is not a reproducible build of the locally pinned crate version. Its compiled instruction/account ABI is checked against the frontend IDL before use. The current Devnet deployment used this fallback and passed the live purchase, publish, and losing-ticket settlement test.

Native Windows validator testing encountered operating-system privilege and genesis extraction errors. Local-validator and Rust tests require a supported Linux/WSL setup; unit and browser checks do not.

Set `ANCHOR_PROVIDER_URL` and `ANCHOR_WALLET` to the intended test RPC and local signing wallet. Defaults are Devnet and `~/.config/solana/id.json`. Then use:

For the funded deployment wallet on this Windows workspace:

```powershell
$env:ANCHOR_PROVIDER_URL = "https://api.devnet.solana.com"
$env:ANCHOR_WALLET = (Resolve-Path .local/solana/deployer-keypair.json).Path
```

```sh
npm run program:initialize
npm run program:configure-uat -- Ghxn7ree6MFQxC8hFTJ8Lo319xEZzqVFLcmDLKVFpPaa
npm run program:fund -- 1.1
npm run program:demo -- 1 22
```

`program:test-live` buys one new ticket, verifies the wallet deduction, waits for the draw, publishes, and settles. Run it only when you intend to spend test SOL. Its receipt is saved under `hiperia_program/target/build/live-test.json`. If an operation fails after purchase, inspect that receipt and the on-chain ticket before starting another test.

After upgrading and configuring the UAT program, `npm run program:test-uat` simulates access violations, bad draw inputs, overselling and duplicate claims against the actual program, then buys and settles one losing and one winning ticket. It checks exact payout balances and returns the administrator's test prize to the vault. It spends test SOL on tickets, rent and fees; progress is saved in `.local/uat-security-receipt.json`. It refuses to overwrite an incomplete run.

## Checks and structure

```sh
npm run lint
npm test
npm run build
npm run test:ui
npm run test:ui:uat
```

The browser check needs the dev server running and Google Chrome installed. It checks 320, 390, 768 and 1440px layouts, selection limits, donation validation, and blocked keypair URLs. Screenshots go into ignored `test-results/`.

- [DodosClient](./src/lib/onchain/DodosClient.js): Anchor transactions and account queries.
- [Dodos UI hook](./src/games/dodos/useDodosGame.js): state, selections, refreshes, and transaction feedback.
- [Donation client](./src/components/donation.js): exact amount validation and wallet-signed transfers.
- [Network utilities](./src/lib/network.js): cluster verification and shared UI network reads.

This is a restricted fixed-result test-network demo. The upgraded source removes timestamp randomness, gates initialization/tester changes to the administrator, and gates purchases/publication to the administrator and tester. Winning payouts preserve rent and other tickets' reserved prizes. Public real-fund use requires a separately reviewed randomness and liability design. See the [UAT review](./docs/UAT-AUDIT.md) for limits and verification status.

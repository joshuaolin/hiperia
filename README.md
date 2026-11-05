# Hiperia

Dodos on Solana Devnet, with ordered number picks, on-chain tickets and results, optional wallet-signed donations, and a Solana purple/green dashboard. Lemon remains disabled with a 2027 coming-soon label.

The [public UAT](https://www.uat.hiperia.xyz/) uses the separate [ORAO VRF game program](https://explorer.solana.com/address/6SWK5s22L7HDzvNdFbMhTjtMQNPfUmMzM4D8S3ZRRgRy?cluster=devnet), open to all signing wallets using test SOL. The same public Devnet game is enabled for the [production hostname](https://www.hiperia.xyz/) by the November 1 release profile below. On October 31, 2026, its deployed bytes, funded prize pool, repeated mobile browser purchases and an actual fulfilled random draw were verified. The existing fixed-result program remains separate for historical claims. See [the verification evidence and limits](./docs/UAT-AUDIT.md#public-devnet-live-verification-october-31-2026). This is a public Devnet beta; draws still need explicit request/completion approvals, and no unattended keeper is configured.

## Run

Use Node.js 24.x:

```sh
npm ci
npm run dev
```

Open `http://localhost:5173/`. The default build continues to use the legacy restricted game. For the public Devnet client, explicitly set `VITE_APP_ENV=uat`, `VITE_GAME_VERSION=vrf` and `VITE_SOLANA_RPC=https://api.devnet.solana.com` before starting Vite. The same client is selected by `VITE_APP_ENV=testnet-demo` with the identical VRF flag and exact Devnet endpoint. No wallet allowlist is used by the new program. Purchases unlock only after readonly game, access and randomness metadata are verified; new pooled daily purchases also require verified liability metadata and a fresh quote for the selected draw and ordered pair. Prices, prizes, schedule and backing come from chain data. New daily tickets share refund-safe backing across combinations in their draw; quick and previously accepted v2 tickets retain full-prize backing. Buying adds only its entry payment to the vault and does not pay out a reward. The UI separates actual vault balance, reserved backing and available backing. Winning payouts leave only through once-only settlement to the recorded owner.

The public client retains the legacy program's existing tickets, published history and accepted prizes. It routes claims to the original source program. Legacy fixed results are never relabeled as random. Referral purchases and the referral dashboard are disabled for the new public game; existing legacy attribution remains on-chain.

The default RPC is `https://api.devnet.solana.com`; copy [.env.example](./.env.example) to `.env.local` for a custom test RPC. The new program's signing client verifies the Devnet genesis hash. No Mainnet release is configured.

`http://localhost:5173/dev/dummy-wallet.html` is a development-only, read-only wallet harness. It cannot sign purchases or donations. Use the normal app with a real browser wallet for transactions.

## UAT on Vercel

[Open UAT](https://www.uat.hiperia.xyz/). Always use this hostname for UAT. The November 5 pooled release is READY Preview `dpl_noRGDy6AgQ44yGFKfPmPFHJGQAq4`, built with `VITE_APP_ENV=uat`, `VITE_GAME_VERSION=vrf` and `VITE_SOLANA_RPC=https://api.devnet.solana.com`. The canonical hostname was verified with anonymous HTTP 200 and actual-chain browser checks after alias assignment. A protection exception applies only to `www.uat.hiperia.xyz`; project-wide protection, generated Preview protection and production domains/settings were left unchanged. Recheck the current alias and anonymous loading after each deployment, separately from wallet access. See [the November 5 deployment and purchase evidence](./docs/UAT-AUDIT.md#pooled-daily-live-verification-november-5-2026).

The project is linked locally to `joshua-olins-projects/hiperia.xyz`. Deploy another UAT preview with:

```sh
npx --yes vercel@65.5.0 deploy --yes --environment preview --scope joshua-olins-projects --build-env VITE_SOLANA_RPC=https://api.devnet.solana.com --build-env VITE_APP_ENV=uat --build-env VITE_GAME_VERSION=vrf
```

After the Preview is READY, assign its generated URL to the UAT domain:

```sh
npx --yes vercel@65.5.0 alias set <ready-preview-url> www.uat.hiperia.xyz --scope joshua-olins-projects
npx --yes vercel@65.5.0 inspect https://www.uat.hiperia.xyz --scope joshua-olins-projects --json
```

Verify the alias points to the new deployment ID with target `preview` and status `READY`, then open the custom URL and check the app before reporting completion. Keep production domains unchanged. The custom domain is also configured for the Git branch `uat` for branch deployments. [AGENTS.md](./AGENTS.md) records this workflow for future sessions.

[.vercelignore](./.vercelignore) allows frontend source, public assets, the UAT RPC function, and required build configuration. Local keypairs, backend build files, development harnesses, caches, and environment files are excluded from uploads. The [RPC function](./api/solana.js) serves UAT Preview and explicitly opted-in production Devnet demo deployments, forwarding bounded app requests to the fixed Devnet endpoint. Confirmation uses HTTP polling. Its cache and throttle are per function instance; the public upstream can still rate-limit.

## Production hostname as a Devnet demo

The user authorized the public VRF Devnet game on production hostnames on November 1, 2026. This replaces the earlier restricted production profile and does not launch a Mainnet game. Stage the build before assigning production aliases:

```sh
npx --yes vercel@65.5.0 deploy --prod --skip-domain --yes --scope joshua-olins-projects --build-env VITE_SOLANA_RPC=https://api.devnet.solana.com --build-env VITE_APP_ENV=testnet-demo --build-env VITE_GAME_VERSION=vrf --env HIPERIA_TESTNET_DEMO=1
```

Verify the staged deployment loads revision 6, public access and pinned ORAO metadata, actual history from both programs, and hidden referrals even while metadata is unavailable. Then use `vercel promote <ready-production-url> --yes --scope joshua-olins-projects` and verify anonymous production loading. Persist the same four configuration values in Vercel's Production environment so GitHub deployments select the public game too. Omitting the VRF build flag selects the legacy client even with current source. The server-side flag enables the bounded, same-origin, fixed-Devnet proxy on the existing production hosts. No Mainnet RPC or server wallet is configured. Keep the canonical UAT alias on its separate Preview deployment and preserve protection settings.

## Legacy Devnet program and historical verification

- Program: [HDodgjBzz7Fo2irAU1ahf5X2arwr773ZcHXD3iSb7nmQ](https://explorer.solana.com/address/HDodgjBzz7Fo2irAU1ahf5X2arwr773ZcHXD3iSb7nmQ?cluster=devnet)
- Prize vault: `DYmcQeHB9kdf7GLMjcbtbudiNnLTNkxxvvTyqcWTRyDo`
- Quick draw: 0.0072 SOL entry, 1 SOL exact-match prize.
- Scheduled draw: 0.00625 SOL entry, 2 SOL exact-match prize.
- Daily slots: 2 AM, 6 AM, 10 AM, 2 PM, 6 PM and 10 PM, Manila time.
- Ticket account rent and network fees are additional. The vault uses faucet SOL for testing.

On October 27, 2026, a [live ticket purchase](https://explorer.solana.com/tx/4TT25P1DPLmREHU4eKFyo3Kd3xWhN47BwVELDYm5aM5ehMmYhkADEfajq1VsjDLsXvfwXdFHPaNvLcfpwQz4nayY?cluster=devnet) was confirmed and its exact wallet deduction verified:

| Charge                 |            SOL |
| ---------------------- | -------------: |
| Ticket                 |         0.0072 |
| Ticket account rent    |     0.00115824 |
| Network fee            |       0.000005 |
| Total wallet deduction | **0.00836324** |

The test picked `1–22`; the published result was `19–3`. [Result publication](https://explorer.solana.com/tx/4P4Gm9PEkNxd1JPuwZJcsQZz2mTPMgEwYRrbUyhhbxGvUaGLQWofrH6tSkTBzZ4fswR7EuTdNQYoAP3a1T95d7fu?cluster=devnet) and [ticket settlement](https://explorer.solana.com/tx/4MVqb61P9r2c4TNRgvKZ4pHpx7djpH5tLFBhKRXCVNngT5UDUehq8Qejubet58aUXRWEAsg3HcrJJb4kmQF88wwr?cluster=devnet) succeeded. This losing ticket did not transfer a prize; the live test does not establish the winning payout branch.

On October 28, 2026, the fixed-result UAT upgrade was deployed and its exact binary verified. The approved tester is `Ghxn7ree6MFQxC8hFTJ8Lo319xEZzqVFLcmDLKVFpPaa`. Ten adversarial simulations, a losing ticket closure, and a [winning 1 SOL payout](https://explorer.solana.com/tx/3Y1mCtqT8c8pEApZDhYV3cCTnx3b7kb3arnKHXQxMD5NYeFsY59BwNVhJUSGLmYpbGe4K8pVhWhjsWxTi4XVwgnp?cluster=devnet) passed. The winning wallet increased by 0.999995 SOL after its network fee. The test prize was recycled into the vault, then another 2 Devnet SOL was added for testing. See the [UAT review](./docs/UAT-AUDIT.md) for transaction evidence and limits.

Revision 3 was [upgraded on October 29, 2026](https://explorer.solana.com/tx/5g6C48Tb8U9Y4zcCUivwE6L9u65Pa7tYDhySN7RTKkjcDHwt3fgv9JjabJQjTXPKhtzsCSSmMkVRencVngNSwnwQ?cluster=devnet). Its 331,696-byte ELF and zero-filled allocation tail were verified against ProgramData. All six scheduled offers, result metadata and reserve limits passed thirteen read-only BPF simulations. New losing/winning quick flows and ten rejection probes also passed, including an actual [02 → 22 prize claim](https://explorer.solana.com/tx/gym5ye7NRQSWzhFcRVoAkZf2tUYC8cyvRew3bHVZGJ3dNcHFUUrBbQ1qqmcx8iSWprAzugQnKiP6m3pUp9oGeLH?cluster=devnet). The 2 SOL scheduled prize was simulated; it was not live-claimed while waiting for a future slot.

## Public Devnet flow

1. Select two different numbers from 02 to 22. Order matters: 02 → 22 differs from 22 → 02.
2. Choose one exact dated draw from the six four-hour slots, UTC+8, or an approximately 60-second quick draw. One ticket covers one occurrence. Scheduled entry is 0.00625 SOL for a 2 SOL prize; quick entry stays 0.0072 SOL for a 1 SOL prize.
3. Sign before the selected draw starts. The countdown updates every second; the chain rejects late purchases without collecting the ticket price. Failed transactions can still cost a network fee.
4. After sales close, **Review reveal costs** reads the oracle fee and account rent without submitting a transaction. **Reveal result** requests ORAO randomness using wallet-approved funding separate from the prize pool. Once fulfilled, **Complete draw** records the numbers; it can require a second approval. That completion approval may also reconcile pooled daily backing and process a bounded batch of losing tickets. Ongoing bulk actions review costs once per unique source program and draw, retain confirmed progress and require wallet approvals. **Refresh** and **Check oracle status** only read chain data. One accepted request is bound to each draw; no reroll or fixed-number fallback is offered.
5. Open **Win** in Your tickets and use **Claim prize** or **Claim all**. Claims use each ticket's purchase-time prize; a large selection may need several approvals. **Ongoing** contains upcoming/unpublished tickets; **Done** contains paid prizes, known losses and refunded entries. WIN, LOSS and REFUNDED labels follow actual account state. There is no manual Close ticket button. Accepted winning prizes have no claim deadline.
6. If an open draw or unfulfilled oracle request passes the on-chain 24-hour timeout, an eligible ticket offers **Refund entry**. The actual entry payment is refunded to its immutable owner. Network fees and account rent are separate. A fulfilled or finalized result cannot use this timeout refund.

New public draws use the pinned [ORAO VRF program](https://explorer.solana.com/address/VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y?cluster=devnet). Request submission checks the pinned executable oracle; finalization validates the request's pinned program owner, address, draw seed, client and fulfilled state, then uses rejection sampling for 420 ordered pairs from distinct numbers 02–22. Draw results link both the result and oracle accounts. The first requester pays oracle costs. Any reclaimed unused funding goes only to that original requester; returning it must not block result finalization. Current costs are read from Devnet before approval.

Both programs permit owner-directed settlement without requiring the ticket owner's signature; prizes can only reach the immutable owner. For pooled v3 daily tickets, confirmed draw reconciliation retains only outstanding winning prizes and releases excess backing without a payout or marking losing tickets settled. Quick and historical v2 losing reserves still require their own confirmed release transactions. Displaying a ticket under Done changes no on-chain state. There is no unattended keeper. The legacy one-shot processor, `npm run program:process-due`, handles only the old program. Pass `-- --include-wins` only when intending to pay outstanding legacy prizes directly to their owners. It persists signed receipts before broadcast and stops on ambiguous outcomes.

The new completion transaction can include pooled draw reconciliation and up to six unsettled losing tickets from that exact draw, reduced to fit the transaction size while reserving space for two wallet-added compute-budget instructions. Their outcome is derived from the fulfilled oracle proof; winning, settled and refunded tickets are excluded. Optional reconciliation or cleanup read failures do not prevent valid result finalization. Pooled winning claims reconcile their draw if needed. The explicit public-game one-shot processor, `npm run program:process-vrf-due`, can reconcile remaining pooled backing and process actual losses; its default run is read-only. A pooled losing ticket's later closure does not release its full snapshot prize again. See [operator limits and execution requirements](./docs/UAT-AUDIT.md#public-devnet-one-shot-operations). No separate Close ticket approval or automatic signing is introduced.

Tickets and results come from the chain. Prices and payout amounts come from the program config. Ticket and draw history links open their blockchain accounts. Daily checkout reads the selected draw's actual risk counts and a fresh vault balance to quote the chosen ordered pair. A different combination can need no additional treasury backing, while repeated bets on the largest matching bucket increase its possible payout. Missing or stale quotes pause new daily purchases without blocking existing claims. The first pooled entry's creator pays the actual shared risk-account rent separately from the vault.

Multiple tickets for the same scheduled occurrence are allowed, each with a fresh purchase nonce. New pooled daily backing is `N * entry + max_pair_count * (prize - entry)` before finalization, covering both possible winning prizes and timeout refunds. For example, three different daily pairs require 2.0125 SOL of backing at the documented offer, while three identical pairs still require 6 SOL. Quick tickets retain independent full-prize backing. Outstanding wins remain fully backed until paid; verified reconciliation releases only the excess liability for its own draw. See [daily backing by combination](./docs/DODOS-ECONOMICS.md#daily-backing-by-combination) for the model and finite-capital limits.

Manual Refresh has an eight-second cooldown and shares in-flight reads. Temporary 429 responses trigger an increasing retry delay, up to one minute, while preserving the same wallet's last loaded data. Confirmed transactions request a fresh read; no transaction is automatically resent.

Read the [UAT security review](./docs/UAT-AUDIT.md) and [economics](./docs/DODOS-ECONOMICS.md) before considering real funds. The legacy fixed result is deliberately predictable. The new random game has 420 ordered outcomes; that count alone does not establish exploit resistance or guarantee profit. Pooled daily backing improves capacity for different combinations, but same-pair concentration, simultaneous draws and independent quick draws can still occupy a finite treasury. Twenty SOL cannot guarantee unlimited fixed-prize entries.

Draw history is loaded from program-owned result accounts, with local date/session filters and blockchain links. New result records snapshot their offer; older rows keep their recorded combinations instead of taking the current fixed pair. Mobile date inputs use full-width controls and validate inclusive Manila date ranges. Search and pagination do not send new RPC scans.

See [production/GitHub precautions](./docs/PRODUCTION-READINESS.md) and the [queued Airtable evaluation](./docs/ROADMAP.md). Airtable is not connected and is not required for current on-chain settlement.

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

The Windows installer downloads a pinned official Agave release and verifies its SHA-256 checksum. The remote build sends only Rust source to Solana Playground and uses its server-selected legacy Anchor dependencies. It is not a reproducible build of the locally pinned crate version. Its compiled instruction/account ABI is checked against the frontend IDL before use. The legacy Devnet deployment used this fallback and passed its recorded live tests.

The new program has a separate source, IDL, binary and build manifest. Its October 31 deployment has a verified 428,992-byte ELF and a 10 Devnet SOL initial prize allocation, separate from legacy funds. Existing program keys must be reused; never generate a replacement key for an upgrade. Build and compare its ABI with:

```sh
npm run program:build:vrf
npm run program:verify:vrf
```

These commands do not deploy, initialize or fund a program. Do not run the legacy initialize/configure/demo commands against the new program: the account and instruction interfaces differ. The new program's native contract fixtures are under [the VRF test suite](./hiperia_program/tests/hiperia_vrf.test.js).

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
node scripts/test-ui-vrf.js
```

The browser check needs the dev server running and Google Chrome installed. It checks 320, 390, 768 and 1440px layouts, selection limits, donation validation, and blocked keypair URLs. Screenshots go into ignored `test-results/`.

- [Public client](./src/lib/onchain/PublicDodosClient.js): new purchases plus source-routed legacy tickets, results and claims.
- [VRF client](./src/lib/onchain/VrfDodosClient.js): draw requests, verified oracle reads, finalization and refunds.
- [Oracle client](./src/lib/onchain/OracleClient.js): on-chain fee quotes, request derivation and proof decoding.
- [Legacy client](./src/lib/onchain/DodosClient.js): original restricted-program transactions and account queries.
- [Dodos UI hook](./src/games/dodos/useDodosGame.js): state, selections, refreshes, and transaction feedback.
- [Donation client](./src/components/donation.js): exact amount validation and wallet-signed transfers.
- [Network utilities](./src/lib/network.js): cluster verification and shared UI network reads.

Public Devnet testing is separate from a real-fund launch. Both source programs preserve accepted prize snapshots and other tickets' reserves. The administrator retains upgrade authority. An independent review, reproducible deployment process, operational monitoring and a reviewed liability design remain required before real funds. See the [UAT review](./docs/UAT-AUDIT.md) for verification status and limitations.

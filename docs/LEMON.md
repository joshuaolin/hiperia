# Lemon on Devnet

Lemon is an ordered three-digit lottery shown as fruit symbols. Each position has ten equally likely choices, digits 0 through 9, and repeats are allowed. A ticket wins only when all three positions match in order. There are `10 × 10 × 10 = 1,000` outcomes, so each exact triple has a 0.1% chance under uniform unpredictable randomness. Three lemons are the triple `000`; they have the same chance and payout as every other exact triple. The title and fruit presentation do not add scatter bonuses, jackpots or extra payout paths.

The November 16 release changes new Lemon daily purchases to 03:00, 07:00, 11:00, 15:00, 19:00 and 23:00, UTC+8. The interval remains 14,400 seconds, with offset 10,800. Quick draws use a separate selected timestamp for players who want an earlier result. A ticket enters one exact draw. Repeated entries and repeated fruit symbols are allowed. Dodos retains its existing 02/06/10/14/18/22 schedule.

Accepted tickets retain their original draw type, paid entry and fixed prize. An old 02-hour Lemon daily ticket remains a daily ticket even though that timestamp is no longer offered for new daily purchases; an accepted 03-hour quick ticket keeps its original quick prize. New purchases at the retired daily seconds (`timestamp % 14400 === 7200`) reject before payment, even for an unused draw. This prevents a cached old client from quoting a 0.00625 SOL daily entry and being charged the 0.0072 SOL quick entry after upgrade. Quick selection skips both current daily seconds and retired daily seconds. Claims, eligible refunds, result verification and their immutable snapshots are unchanged.

The play area, ticket cards and result rows show fruit symbols without numeric overlays. The game guide lists the public digit mapping: Lemon 0, Cherry 1, Orange 2, Grape 3, Watermelon 4, Strawberry 5, Pineapple 6, Apple 7, Peach 8 and Kiwi 9. The badge indicates on-chain verification; the probability explanation, symbol mapping and program link remain in the guide. There is one game guide rather than a second introduction repeating the same rules.

## Prices and expected returns

These values describe the reviewed implementation. The application reads active prices, fixed prizes, schedule and results from verified on-chain metadata and accounts.

| Per ticket                     | Lemon daily |     Dodos daily | Lemon quick |     Dodos quick |
| ------------------------------ | ----------: | --------------: | ----------: | --------------: |
| Possible ordered outcomes      |       1,000 |             420 |       1,000 |             420 |
| Entry payment                  | 0.00625 SOL |     0.00625 SOL |  0.0072 SOL |      0.0072 SOL |
| Exact-match prize              |    4.75 SOL |           2 SOL |     2.5 SOL |           1 SOL |
| Expected prize cost            | 0.00475 SOL | 0.004761905 SOL |  0.0025 SOL | 0.002380952 SOL |
| Theoretical player return      |         76% |          76.19% |      34.72% |          33.07% |
| Expected gross operator margin |         24% |          23.81% |      65.28% |          66.93% |
| Expected gross before expenses |  0.0015 SOL | 0.001488095 SOL |  0.0047 SOL | 0.004819048 SOL |

The daily prize preserves approximately Dodos's daily expected return while increasing the displayed fixed prize. The quick prize uses a similar return to Dodos quick. These calculations exclude account rent, transaction fees, oracle costs, hosting, RPC, maintenance and other expenses. Positive expected margin does not guarantee profit, solvency or immediate payment from any particular bankroll. Many identical tickets on one shared draw can win together.

The wallet requesting randomness pays the reviewed current ORAO fee and oracle account rents separately from the prize vault. A daily result shares one accepted request across all entries in that occurrence. Independent quick draws each require their own request. A request/completion still requires explicit wallet approvals; there is no unattended keeper. Devnet uses faucet SOL. Infrastructure and domain costs can still exist independently of the test SOL.

## Separate accounts and settlement

Lemon uses the separate [program 7ZDTrz498pQuMyV4frPv2cZu5vR1ZrpfzFWAPGpVGcYr](https://explorer.solana.com/address/7ZDTrz498pQuMyV4frPv2cZu5vR1ZrpfzFWAPGpVGcYr?cluster=devnet). Its prize vault is [CYsGBjbXZwLRkw856H4hDeEUygogxFehnqEAazyeCTVu](https://explorer.solana.com/address/CYsGBjbXZwLRkw856H4hDeEUygogxFehnqEAazyeCTVu?cluster=devnet), derived from the `vault` seed and that program ID. The address derivation does not prove deployment or funding. Neither the Dodos vault nor personal administrator/support wallets fund Lemon claims. Existing Dodos and legacy programs, tickets, results and accepted claims remain separate.

Every new Lemon ticket snapshots version 4 and its exact paid entry and fixed prize. Buying transfers only the entry payment into this vault and protects that same amount for a possible eligible timeout refund. Balance and entry holds rise together, so buying consumes no available operator capital. The buyer separately pays actual account rents. Account sizes, including the discriminator, are Config 58 bytes, Vault 41, Ticket 101, Draw 182 and BankrollDraw 50. The ledger seeds are `bankroll-draw`, `v1` and the draw timestamp.

Verified finalization permits idempotent reconciliation of only that draw's entry holds. Reconciliation pays zero SOL and marks no ticket paid. A winning claim can spend only vault funds above rent and every remaining protected entry hold. It transfers the full immutable snapshot prize once to the ticket's recorded owner. If funds are insufficient, the whole claim fails without a partial transfer or paid marker. The unpaid winner remains claimable without expiry, under **Win / Waiting for treasury funding**. An operator refill enables a fresh explicit claim; it does not trigger automatic signing or payment. No FIFO ordering or immediate-payout guarantee is offered.

A timeout refund returns only the actual paid entry after the verified 24-hour condition for an open or still-unfulfilled draw. A fulfilled or finalized draw cannot refund. Refund-plus-claim and same-ticket payout replay are prohibited. Losing cleanup is permissionless, does not need the owner's signature or current wallet account type, and never pays a prize. Completion can combine bounded cleanup, subject to the same packet and instruction limits as the reviewed Dodos client. Displaying a loss in Done changes no on-chain state.

## Randomness and client verification

The contract pins [ORAO VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y](https://explorer.solana.com/address/VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y?cluster=devnet). Sales close before a fresh request. Each draw accepts one request, bound to the Lemon program, draw, nonce and `hiperia-lemon-vrf-v1` domain. Finalization verifies the exact oracle owner, request PDA, client, seed and fulfilled state.

Sampling accepts little-endian 16-bit values below 65,000 and takes the value modulo 1,000. Every accepted triple has exactly 65 preimages. Rejected samples are skipped; deterministic hash expansion uses only that same committed proof with the separate Lemon expansion domain. Exhaustion rejects without a reroll or predictable fallback. Zero is a valid result, so the frontend displays a triple only after verified finalization and never treats an open draw's zero-filled storage as a published result.

Before enabling purchases the client verifies Lemon's distinct 58-byte `get_rules` revision 1, public access, pinned randomness metadata and exact nine-byte bankroll rules. It binds a fresh entry/rent quote to the wallet, program, triple and draw and reviews actual oracle costs before a new request. The Devnet genesis check blocks Mainnet writes. Read-only RPC simulation permits only the target program's exact metadata instructions and response sizes. A rules-read failure pauses purchases while preserving loaded history and valid claim paths.

Reveal cost review appears beside its ticket. Entries sharing a source program and draw timestamp share one reveal action, oracle request and recorded result. An approval is consumed synchronously before the first asynchronous step; cancelled, expired, failed or context-changed approvals cannot be reused through a stale callback. Pending and finalized draws do not show a new oracle-cost approval. Finalized draws recover the existing result without another request, fee or result row.

Confirmed action progress and advances learned from actual account refreshes are retained monotonically for the same wallet and endpoint. A stale RPC snapshot cannot restore an earlier draw state or remove a known finalized result. Fresh complete oracle fields replace partial local request progress. This display cache never marks a ticket Paid, settled or refunded; only actual confirmed on-chain state can do that. There is no automatic transaction resend, wallet signing or payout keeper.

## Build and test evidence

### November 16 release checks

The schedule and admission-guard build uses the existing remote compiler at `https://api.solpg.io`. Its normalized ABI remains unchanged: 13 instructions, 5 accounts, 29 errors, a 58-byte revision 1 rules response, and the same account layouts and PDA seeds. This build was activated and its deployed bytes verified on November 16. Two new-hour daily purchases, a quick purchase, actual ORAO fulfillment and a repeat completion with no additional signature or oracle fee passed; original ticket snapshots remained unchanged. See [the live upgrade and release evidence](./UAT-AUDIT.md#lemon-reveal-and-schedule-verification-november-16-2026).

- Source SHA-256: `1ebc2c9435bc3a6a26622b26ba36535a8991b5053eb0ea6608a29ae50674f527`.
- ELF SHA-256: `dfb312c9e3297dfde94f40ea07ddf563cd374168321c41a80107159ddd757ed2`.
- ELF length: 469,400 bytes.
- 41 actual compiled BPF checks passed under Linux LiteSVM 1.6.2, executing 101 synthetic transactions: 73 successful and 28 expected rejections. The temporary protected runner and its bearer token were removed.
- The compatibility checks execute purchases with the previous November 15 ELF, load the new ELF into the same VM, then verify the accepted old daily 4.75 SOL claim and 0.00625 SOL refund, and an accepted new-hour historical quick 2.5 SOL claim. Replays reject; all unrelated entry holds remain protected. An unused retired daily timestamp rejects a stale-client purchase before payment.
- 14 Lemon JavaScript client/protocol/proxy tests, eight reveal-state/schedule helper tests and 22 actual-hook browser scenarios passed. They cover current offer classification, retired seconds, consumed approvals, context changes, same-draw entries, stale refreshes, confirmation failures and preserved claims. Browser fixtures do not use private keys or send live transactions.
- The 17 native Rust unit tests remain unexecuted on this Windows environment and are not counted as passed.

The remote compiler selects its own legacy Anchor dependencies; byte and ABI verification do not establish a reproducible build of the locally pinned Anchor 0.31.1 toolchain. Synthetic oracle-owned fixtures establish neither live ORAO fulfillment nor a live winning payout.

### Historical November 15 build

The original November 15, 2026 build used the same remote compiler. Its ABI was compared field by field against the normalized frontend IDL: 13 instructions, 5 accounts and 29 errors.

- Source SHA-256: `bd8366fe835b4a85f220c9da53ce8fd0d92b5d227bba2d6d11abd5aa18a03135`.
- ELF SHA-256: `3e0f9b01fdc4d73ff6ce0a435a4b55dcaf3192f9eae457f266c43478a5dd6e2b`.
- ELF length: 469,640 bytes.
- 33 actual compiled BPF checks passed under Linux LiteSVM 1.6.2, executing 85 synthetic transactions: 63 successful and 22 expected rejections. The temporary protected runner and its bearer token were removed after verification.
- 10 Lemon JavaScript client/protocol/proxy tests passed in addition to the existing 250 tests at the initial integration checkpoint.
- 17 Rust unit tests are included in the source but were not executed on this Windows environment. They are not counted among the passed runtime tests.

The BPF suite covers multiple daily/quick purchases without capital depletion, repeated/zero/high fruit triples, invalid selections, wrong ledger and oracle accounts, seed/client mismatches, pending proofs, timeout rules, fulfilled-refund refusal, refund replay, late fulfillment after partial refund, immutable recipients, losing cleanup, claim replay and no-expiry winners. An underfunded winning claim was verified to fail atomically, then pay once after a one-lamport top-up while preserving all other entry holds. Its oracle accounts are synthetic fixtures; this does not establish live oracle fulfillment.

```sh
npm run program:build:lemon
npm run program:verify:lemon
node --test src/lib/onchain/LemonClient.test.js
node --test src/games/lemon/revealState.test.js src/games/lemon/lemonSchedule.test.js
npm test
```

On a Linux environment with the native dependency `litesvm@1.6.2` and the repository's JavaScript dependencies installed:

```sh
npm run test:contract:lemon
```

The runtime suite loads the compiled Lemon ELF and uses synthetic genesis accounts only. Set `HIPERIA_LEMON_PREVIOUS_ELF` to a verified copy of the original November 15 ELF to include the old-program purchase/upgrade compatibility checks; its SHA-256 must be `3e0f9b01fdc4d73ff6ce0a435a4b55dcaf3192f9eae457f266c43478a5dd6e2b`. The suite does not sign live wallet transactions. A local pinned Rust toolchain can separately run the included unit tests with `cargo test --manifest-path hiperia_program/programs/hiperia_lemon/Cargo.toml`.

## Live verification status

On November 15, 2026, the separate Devnet program was deployed, its bytes compared with the reviewed ELF, initialized and funded with 5 test SOL. Four purchases were confirmed: two independent quick draws and two entries in the same future daily draw. Available operator capital remained exactly 5 SOL after every accepted purchase. Both quick draws fulfilled through the actual pinned ORAO program and finalized to triples `350` and `423`; finalization paid no prize and released only those draws' entry holds. See [the live verification evidence](./UAT-AUDIT.md#lemon-devnet-verification-november-15-2026) for transactions, balances, deployment IDs and limitations. A live winning payout/refill was not observed; its atomicity and once-only protections were tested in the compiled BPF fixtures.

Only public Devnet faucet-SOL testing is authorized. This implementation and its test results do not establish Mainnet or real-fund readiness.

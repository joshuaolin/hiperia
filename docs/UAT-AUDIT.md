# Dodos UAT review

Reviewed on October 28, 2026. This is a code review and regression check for a restricted Devnet demo, not an independent security certification or approval to use real funds.

## Rules

- A ticket contains two different numbers from 1 to 22. Order matters: 06 → 09 differs from 09 → 06.
- Each ticket enters one exact date and time. Entering both the 2 PM and 4 PM draws requires two tickets.
- Daily times use Asia/Manila, UTC+8. The page updates its countdown every second. A selected draw stays selected as it expires; checkout asks for a new selection instead of moving the ticket silently. The chain's clock decides whether a purchase is on time.
- The 60-second option is a UAT testing shortcut with the same configured prize. It is not a separate 2 SOL game.
- The live program fixes newly recorded results at 06 → 09, including daily draws. The frontend's 06 → 07 display is only a target pending a separate on-chain upgrade. Existing blockchain records retain their original numbers.
- An approved tester or administrator records the result after the draw. The contract supplies the numbers; the transaction does not accept an arbitrary result.
- Viewing results is read-only. Recording results costs a network fee and account rent. Claiming a prize or closing a losing ticket costs a network fee. UAT claims have no expiry after the draw.
- Every accepted UAT ticket reserves its entire potential prize. A losing ticket releases that reserve when closed. A winning ticket spends its reserve when claimed. For example, a vault with approximately 1.1 SOL and a 1 SOL prize can back one outstanding ticket. Claim or close existing tickets, or fund more capacity.

## Findings and changes

| Finding                                                                                                                                                         | Severity before change                 | Change and remaining limits                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The result hashed public account addresses and the publication timestamp. A caller could search publication times and ticket timestamps for a favorable result. | Critical                               | Removed timestamp randomness. The current program is deliberately fixed-result UAT; it makes no random-fairness claim.                                                                                                                            |
| Mapping duplicate random picks to the adjacent number biased those pairs to roughly twice the probability of other pairs.                                       | High                                   | Removed this mapping with the old randomizer. A future random game needs uniform sampling as well as verifiable randomness.                                                                                                                       |
| Fixed winning numbers plus open purchases would let anybody repeatedly buy guaranteed winners and drain test funds.                                             | Critical for an open fixed-result demo | Purchases and result publication require the configured tester or hardcoded UAT administrator on-chain. Editing the frontend or calling the program directly does not bypass this check. Tester changes require the administrator.                |
| A prize could be sold without funds available to pay it, and concurrent tickets could spend the same backing funds.                                             | High                                   | The program reserves the full prize before collecting the ticket payment. Payouts preserve rent and all other reserved prizes. Account write locks and checked arithmetic cover concurrent purchases. Legacy tickets cannot release new reserves. |
| A five-minute claim deadline could expire during RPC trouble or delayed result publication.                                                                     | Medium                                 | Removed the UAT expiry. Claims remain available after the draw; reserves remain locked until the ticket is settled.                                                                                                                               |
| The daily dropdown hid the exact chosen occurrence and implied both daily draws might be included.                                                              | Medium                                 | Show exact dated choices, one-ticket/one-draw rules, live countdowns and an explicit late-purchase rejection.                                                                                                                                     |
| History was hard to verify externally.                                                                                                                          | Usability                              | Ticket and draw history links open the actual account on Solana Explorer with the connected test cluster. The claim transfer appears under the ticket account's transaction history.                                                              |

The original ticket PDA prevents a second successful purchase using the same wallet/nonce. The client persists that identity before sending, recovers the ticket after a timeout, and reuses the identity when retrying. Settlement verifies ticket ownership and result association, and rejects a settled ticket.

The contract intentionally permits flexible draw timestamps for approved UAT testers. Removing an option from the UI does not enforce a production schedule on-chain. Result publication is manual, and this repository does not run a scheduled draw publisher.

## Odds and payout assumptions

There are 22 × 21 = **462 ordered pairs**, or 231 unordered pairs. This game uses ordered pairs.

For a genuinely uniform, unpredictable draw and a 0.0072 SOL ticket:

| Prize | Expected prize per ticket | Prize return relative to ticket price |
| ----- | ------------------------: | ------------------------------------: |
| 1 SOL |   1 / 462 = 0.0021645 SOL |                                30.06% |
| 2 SOL |   2 / 462 = 0.0043290 SOL |                                60.13% |

These calculations exclude ticket rent, result rent, network fees and operating expenses. They do not guarantee a profit, sufficient cash for multiple winners, or protection against an exploitable randomizer. Buying all pairs costs 3.3264 SOL before fees. The previous biased mapping gave some adjacent pairs approximately 1/242 odds rather than 1/462, making a proposed 2 SOL payout particularly unsafe under the old assumptions.

For the live fixed UAT result, a 06 → 09 ticket has a known winning outcome once its new result is recorded. The uniform-odds calculations do not apply to this mode. The allowlist and prize reserves are deliberate UAT controls.

## Before a public real-fund launch

Replace this UAT program with a reviewed design that binds a verifiable randomness request to a specific draw, closes ticket sales before randomness can be known, prevents rerolling or substituting requests, and samples ordered pairs uniformly. Enforce the actual draw schedule in the program, define claim/refund and oracle-outage rules, and review reserve accounting against the chosen payout model. A full-prize reserve per ticket is conservative and limits capacity; changing it requires a separate liability design.

The administrator still holds the upgrade authority. Explorer links make records inspectable; they do not make the game immutable or eliminate operator trust. A public launch also needs a dedicated RPC, controlled upgrade governance, and an independent review. Solana's [RPC guidance](https://solana.com/docs/rpc) documents public endpoint rate limits, and the Solana Foundation's [verifiable randomness lesson](https://github.com/solana-foundation/developer-content/blob/main/content/courses/connecting-to-offchain-data/verifiable-randomness-functions.md) explains why public on-chain inputs do not provide secure randomness.

## Verification status

The UAT source compiled successfully and its compiled ABI matches the frontend: five instructions, four account types and twenty error codes. The remote compiler selects legacy Anchor dependencies; this is not a reproducible build of the locally pinned dependency version. Native Rust tests require the supported Rust/Anchor environment described in [the README](../README.md).

The 51 frontend unit, boundary and request-guard tests passed, along with lint and the frontend build. Browser checks cover six populated ticket states, free result reads, thirteen Explorer history links, an expired selected draw, configuration gating and four responsive widths without page errors. Refresh-spam checks verify that twenty clicks share one read, transient 429 errors preserve loaded tickets, and an initial loading failure can recover. The canonical UAT browser also loaded the actual Devnet config and draw history through the RPC function.

The [Devnet upgrade](https://explorer.solana.com/tx/2Z8xuTaNzZdo3Qnv67sLEvpLfjYpuLt91SqfkoeV7qZYcAzivKCmTKDWDNqz2mV9urczignaFtjDPbHdQmmkEVV5?cluster=devnet) completed on October 28, 2026. ProgramData bytes exactly match the 320,200-byte compiled ELF; the upload buffer was consumed. The configured tester is `Ghxn7ree6MFQxC8hFTJ8Lo319xEZzqVFLcmDLKVFpPaa`.

The deployed-program suite completed both paid flows and ten rejection simulations against the actual program:

| Actual test                                                              | Verified result                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Losing 01 → 22 ticket against fixed 06 → 09                              | Closed; vault delta 0, wallet delta −0.000005 SOL network fee, reserve released. [Settlement](https://explorer.solana.com/tx/3JUQQFMj6cgq347VZjun1DRJEyK8Mdf8DaaUneVzPnjzXNmiy5egA5L3x4ZhTTDUXVcKJ7NVNksTm7TX4Kj1tJ2o?cluster=devnet)                         |
| Winning 06 → 09 ticket                                                   | Vault paid exactly 1 SOL; wallet received 0.999995 SOL after its 0.000005 SOL network fee; reserve released. [Payout](https://explorer.solana.com/tx/3Y1mCtqT8c8pEApZDhYV3cCTnx3b7kb3arnKHXQxMD5NYeFsY59BwNVhJUSGLmYpbGe4K8pVhWhjsWxTi4XVwgnp?cluster=devnet) |
| Unauthorized configuration, purchase and publication                     | Rejected on-chain in simulation.                                                                                                                                                                                                                              |
| Invalid picks, past purchase and early publication                       | Rejected on-chain in simulation.                                                                                                                                                                                                                              |
| Overbooking, foreign settlement and duplicate settlement of both tickets | Rejected on-chain in simulation.                                                                                                                                                                                                                              |

The administrator's winning test prize was returned to the vault, and another 2 Devnet SOL was added for user testing. Receipts remain in the ignored local directory. A test-script zero-sign comparison was corrected after the losing settlement; the existing transaction was verified and the run resumed without purchasing the losing ticket again. Native Rust/local-validator tests were not run in this Windows environment.

The same-origin UAT RPC function is Preview-only, forwards to a fixed Devnet endpoint, validates methods and request sizes, limits account scans to this program, restricts submitted transactions, and never automatically retries a signed submission. Cache and throttling are per function instance; Vercel Preview Authentication remains the access control. The public upstream can still rate-limit or fail.

## Dependency review

A bounded lockfile update patched `bn.js`, `shell-quote` and the existing major versions of `ws`. `npm audit --omit=dev` changed from 34 findings, including one critical and nine high, to **31 findings: zero critical, eight high, twenty-two moderate and one low**. This is not a clean dependency audit.

The critical `shell-quote` path came through the wallet adapter's React Native tooling peers; it was absent from the browser bundle and no shell-execution path was found in this app. The compatible update removes that reported issue. The direct runtime `bn.js` and server-installed `ws` packages also received compatible patches. See the [shell-quote advisory](https://github.com/advisories/GHSA-w7jw-789q-3m8p), [bn.js advisory](https://github.com/advisories/GHSA-378v-28hj-76wf) and [ws advisory](https://github.com/advisories/GHSA-96hv-2xvq-fx4p).

Remaining high findings include Anchor's Node-only `toml` workspace loader and React Native/tooling peers. Module inspection found those paths absent from the browser bundle; the RPC function imports Web3 utilities and uses HTTP, without an inbound WebSocket server or the Anchor workspace loader. This narrows observed exposure but does not prove those dependencies safe for other uses. Some fixes require incompatible major upgrades, so this change does not force them into the wallet/Anchor stack. Revisit them during the production dependency review.

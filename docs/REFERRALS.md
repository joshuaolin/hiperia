# On-chain referrals

Campaign v1 is implemented on the legacy Devnet program. The separate public VRF game does not enroll new campaign purchases or display referral controls. Existing legacy attribution, counts, discounts and accepted tickets remain on-chain under their original program. No external database, cash referral reward or airdrop is configured. Legacy base game metadata stays at revision 4 for existing clients; separately verified get_referral_rules metadata reports referral revision 5 and campaign 1.

The program persists each wallet's binding and counters in [program-derived accounts](https://solana.com/docs/core/pda). The website reads these through RPC. A public wallet address is its code when sharing is enabled; otherwise there is no active code. A referral URL only proposes an inviter and never establishes an on-chain relationship without wallet approval.

## Campaign v1 behavior

1. A link such as `?ref=<public-wallet-address>` pre-fills a proposed inviter. The wallet owner approves creation or changes with a signed transaction. Existing published results, old tickets and their prizes stay unchanged.
2. The profile uses the seeds `referral`, `v1` and the owner wallet. The owner may change or clear an inviter before the first paid campaign entry. That first entry permanently records the inviter or the no-referrer choice. Self-referral and newly binding an inactive or invalid code are rejected; an existing profile cannot be recreated to reset its counters.
3. A successful paid purchase creates a pending participant. Qualify that wallet only when its first eligible paid ticket is successfully settled against the published on-chain result. Winning and losing tickets qualify equally. Increment the referrer's unique qualified-player count exactly once, in the same settlement transaction, with checked arithmetic.
4. Ignore link clicks, wallet connections, failed purchases, pending draws and repeat tickets for the unique-player count. A second settled ticket from the same wallet adds no second referral. Any future refunds/cancellations need explicit eligibility rules before they are introduced.
5. Anyone may submit qualification, but attribution comes from the immutable profile and its first campaign ticket. Qualified updates are idempotent. Compatible clients bundle the update with eligible settlement; if referral reads fail, existing claims continue and qualification can be recorded later with the dashboard action or explicit operator processor. No unattended keeper is configured. All accepted prizes, owner-directed payments and other tickets' reserves are preserved.

## Discount and opt-out

Current terms are read from the program's separate readonly referral metadata:

| Draw  | Normal entry | Active referral entry | Exact-match prize |
| ----- | -----------: | --------------------: | ----------------: |
| Daily |  0.00625 SOL |            0.0062 SOL |             2 SOL |
| Quick |   0.0072 SOL |            0.0071 SOL |             1 SOL |

After attribution is locked, the owner can disable their discount and later restore it for the same recorded inviter. Future opted-out entries use normal prices. Turning off one's own sharing code stops new bindings; existing players keep their established discounts. Removing benefits does not erase chain history, switch the inviter, close the profile or reset counts.

Entry discounts exclude network fees and account storage. Initial storage costs can exceed one ticket's discount. Each ticket stores its actual entry payment and purchase-time prize; published draw records retain their base offer metadata. Frontend tables contain no sample records or fallback prices/counts. An absent or failed profile read is not presented as a fabricated zero.

Under the hypothetical fair random assumptions in [economics](./DODOS-ECONOMICS.md), discounted entries have approximately 23.20% daily and 66.47% quick expected gross margins before expenses. These are not guarantees and do not apply to the known fixed UAT result. Prizes and full reserve requirements are unchanged.

Solana transactions [apply their instructions atomically](https://solana.com/docs/core/transactions), so a failed purchase or settlement must leave both ticket and referral counters unchanged. The UI can display confirmed pending progress; any later reward snapshot should use finalized state. Store profiles and counters as authoritative state, with events as supplementary audit records.

Count **qualified wallets**, not people. One person can control many wallets and pay for each. Requiring paid, completed games raises the cost of farming but does not prove genuine invitations. A malicious user can still occupy prize reserves until results are published and settled. Referral counters do not solve vault capacity or publisher availability. Do not increase prizes, reserve airdrop liabilities or reward losses to encourage qualification.

## Cost and access

Each 126-byte profile includes its counters and needs a [minimum storage balance](https://solana.com/docs/core/accounts/account-structure) plus transaction fees. Query [getMinimumBalanceForRentExemption](https://solana.com/docs/rpc/http/getminimumbalanceforrentexemption) for a current quote. The wallet funds account creation. Profiles cannot be closed and recreated to reclaim deposits or reset participation. Total storage grows with participating wallets.

Read an individual's profile and counter directly from their deterministic addresses. Use [getProgramAccounts](https://solana.com/docs/rpc/http/getprogramaccounts) with account-type/campaign/referrer filters for small participant lists. Its standard interface does not provide a pagination cursor; a large leaderboard or export needs a reviewed paged account layout or a rebuildable RPC index. An index can remain optional and must never approve referrals or payments. Preserve the app's request deduplication, backoff and last-good data on temporary RPC failures.

Do not rely only on historic transaction logs: a node's retained ledger has a [first available block](https://solana.com/docs/rpc/http/getfirstavailableblock). Existing ticket accounts do not record who invited a player, so past referrals cannot be reconstructed reliably. The minimal design counts first participation in the new campaign, not a provable first-ever player. Excluding all prior players would need a separately reviewed historical eligibility migration. [Devnet can reset](https://solana.com/docs/references/clusters#devnet), so test records must not imply a permanent mainnet reward entitlement.

## Benefits and future revisions

Start with transparent contribution counts and optional badges. Consider separately funded cosmetic benefits or early feature access later. A token or airdrop remains a separate decision with eligibility, budget, Sybil resistance and legal review; no amount or entitlement is promised here. Never fund referral rewards from reserved ticket prizes.

Future revisions need review of campaign eligibility, account migration, storage funding, concurrent first purchases and abuse controls. Public real-fund use still requires the [production readiness work](./PRODUCTION-READINESS.md). The current program is a restricted fixed-result Devnet demo.

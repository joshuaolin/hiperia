# Queued work

## Airtable evaluation

Requested October 29, 2026: consider [Airtable](https://airtable.com/) if history search, reporting or administration needs a separate database.

Keep the blockchain authoritative for ticket ownership, published combinations, prize liabilities and payment settlement. An Airtable integration would be a rebuildable read index or admin view, never the authority that chooses winners or approves payments. Evaluate query volume, pagination, cost and update lag before adding it.

Keep Airtable access tokens in server-side secrets with access limited to the required base and scopes. Do not put them in browser configuration, `VITE_` variables or GitHub. No Airtable account, base, subscription or integration has been created for this queued item. See [Airtable token scopes](https://support.airtable.com/docs/creating-personal-access-tokens).

## On-chain referrals

Evaluate database-free referral records and contribution counts in a later program revision. Bind one immutable referral choice per campaign and player wallet, then count that wallet once after an actual paid ticket settles, regardless of winning or losing. Clicks, wallet connections and repeat purchases do not add unique-player credit. Wallet counts do not prove unique people or stop funded Sybil accounts.

See the [referral proposal](./REFERRALS.md) for account storage costs, RPC access, migration limits and acceptance checks. No campaign, token allocation, airdrop entitlement, referral account or reward payment has been created.

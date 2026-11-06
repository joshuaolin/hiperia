# Dodos prize model

The base offer is **0.0072 SOL quick entry → 1 SOL prize**, and **0.00625 SOL scheduled entry → 2 SOL prize**. Picks are two distinct numbers from **02 through 22**, in order. Scheduled draws are every four hours at **2 AM, 6 AM, 10 AM, 2 PM, 6 PM and 10 PM**, UTC+8. Each ticket enters one specific draw. These documented values describe the implementation; the app reads its active offer from verified on-chain metadata.

The larger daily prize gives a reason to choose the scheduled draw. Both draw types have the same matching rule and, under uniform unpredictable randomness, the same winning probability. The separate public Devnet implementation uses ORAO VRF; its deployment and live verification status are recorded in [the UAT review](./UAT-AUDIT.md). The old fixed-result program does not satisfy the random assumptions below.

## Expected return under a fair random draw

There are 21 choices for the first number and 20 remaining choices for the second: **420 ordered outcomes**. A single pair therefore has a **1/420**, or approximately **0.2381%**, chance of winning if every outcome is equally likely and cannot be predicted before sales close.

| Per ticket                     |      Quick draw | Scheduled daily draw |
| ------------------------------ | --------------: | -------------------: |
| Ticket payment to vault        |      0.0072 SOL |          0.00625 SOL |
| Winning prize                  |           1 SOL |                2 SOL |
| Expected prize cost            | 0.002380952 SOL |      0.004761905 SOL |
| Theoretical player return      |          33.07% |               76.19% |
| Gross operator margin          |          66.93% |               23.81% |
| Expected gross before expenses | 0.004819048 SOL |      0.001488095 SOL |

The selected daily offer is **320× the entry**, reducing the entry fee while retaining a larger expense buffer. An exact **400×** offer with a 2 SOL prize would require **0.005 SOL entry**. Its theoretical player return would be **95.24%**, leaving only **4.76%** gross margin, or **0.000238095 SOL per ticket**, before expenses. That thinner offer is not selected while production randomness and operating costs remain unmeasured.

These are expectations, not guaranteed profit. They exclude hosting, domain renewal, RPC, randomness/oracle fees, transaction costs paid by the operator, maintenance and other expenses. Multiple tickets can share a draw and winning pair, so their outcomes can be correlated; a single draw can produce many winners.

For a draw with `N` tickets and operator-paid draw cost `F`, expected net profit in SOL is:

`N × (entry − prize / 420 − per-ticket overhead) − F`

A production launch needs measured expenses below that budget, an unpredictable and uniformly sampled result, sales closing before the result can be known, and an independent review. Positive expected margin does not make a predictable or manipulable randomizer profitable.

## Fixed prizes with funding on claim

The November 5 bankroll change preserves the fixed quick/daily prices and prizes above for new v4 tickets, while removing full-prize treasury checks at purchase. This is an operator-funded fixed-prize model, not a shared variable prize pot. The operator explicitly accepts the possibility of refilling the treasury when valid winnings exceed available funds.

Buying transfers only the entry payment into the prize vault. Its actual paid entry is held for a possible verified oracle-outage refund, funded entirely by that incoming payment. Thus the vault balance and protected entry holds rise by the same amount; available operator capital does not decrease when a new ticket is bought. No future prize is reserved. Exact account rent and network costs remain separate charges to the buyer.

Once the verified draw is finalized, reconciliation releases its remaining entry-refund holds without paying SOL or settling tickets. A matching v4 ticket remains entitled to its immutable fixed prize. Settlement checks the uncommitted treasury after preserving rent, historical v2/v3 prize reserves and all other open/pending draw entry holds. It transfers the entire prize once to the recorded owner, then marks that ticket settled. If the treasury is short, the transaction fails atomically and the winning ticket remains unpaid, unexpired and claimable after a refill. Partial payments, marking an unpaid ticket Paid, and automatic claim retries are not supported.

There is no new-purchase cap based on the number of prizes that current capital could cover. This does not guarantee unlimited immediate payouts, a funded payment date or profitability from 20 SOL: several valid tickets can win together, and earlier funded claims can consume available capital before later claims. No first-in-first-out queue is promised. This funding-wait condition must appear before checkout; old accepted v2/v3 tickets retain their original protected backing rather than being moved into this risk model. Timeout refunds remain limited to the actual entry after 24 hours for open or still-unfulfilled draws, never fulfilled/finalized results.

The expected per-ticket gross margins above are unchanged under the same random assumptions, but they do not guarantee solvency or profit. Pending fixed-prize obligations may exceed funds until the operator replenishes the actual program-owned prize vault. Account rents, oracle costs, infrastructure costs and correlated winning outcomes remain relevant.

New admissions require the exact nine-byte `get_bankroll_rules` revision 1: daily and quick enabled, only actual entry refunds protected, no prize reserved at purchase, claims require funding, ticket snapshot version 4 and a 50-byte canonical ledger. Both draw types use `buy_bankroll_ticket`; old v2/v3 purchase instructions reject new admissions while preserving existing claims and refunds. Ledger seeds are `bankroll-draw`, `v1` and the draw timestamp. Its first creator pays the actual ledger rent separately from the vault. Missing or stale bankroll metadata/quotes pause new purchases without disabling old claims. This describes the authorized implementation; [the UAT review](./UAT-AUDIT.md) records whether the matching contract and website have actually been deployed and verified.

The app keeps an insufficiently funded valid v4 winner under **Win**, labeled **Waiting for treasury funding**. A later top-up enables a fresh explicit claim; it does not trigger automatic payment. Same-ticket replay and refund-plus-claim remain prohibited, and an unsuccessful transfer cannot mark the ticket Paid. Reconciliation is idempotent and cannot spend another draw's protected entry holds or old accepted prizes. The explicit one-shot operator processor can reconcile finalized v4 entry holds and process verified losses with transaction receipts; it is read-only by default and adds no background signer. Losing-only cleanup does not depend on the owner's current account type.

Refill the actual [public program prize vault, FiYD4tUhgAgNE7D7fpoUDNzRWfR48EKo4Y4BfL5ekpMp](https://explorer.solana.com/address/FiYD4tUhgAgNE7D7fpoUDNzRWfR48EKo4Y4BfL5ekpMp?cluster=devnet), after verifying the ticket's source program. The personal administrator and Support Hiperia donation wallets are separate accounts. The bankroll change authorizes only public faucet-SOL Devnet testing; it does not authorize Mainnet or real-fund play.

## Historical daily backing by combination

The November 4 model introduced v3 daily snapshots and canonical draw-risk accounts that share backing between mutually exclusive ordered combinations in one draw. The November 5 bankroll change replaces this admission model for new daily and quick tickets. Already accepted v3 daily and v2 quick tickets retain their original reserves, claims and refunds; they are never migrated into v4 funding risk. Separate `get_liability_rules` revision 1 still describes the historical v3 model: daily pooling enabled, quick pooling disabled, 420 ordered pairs and a 3398-byte risk account derived from `draw-risk`, `v1` and the draw timestamp.

For `N` outstanding pooled tickets, entry `c`, prize `p`, and the largest ticket count on one exact ordered pair `M`, pre-final backing is:

`R = N × c + M × (p − c)`

This backs the largest possible winning combination **plus refunds for the other combinations**. Using only the larger of total entry refunds and one winning bucket would be unsafe: some entries can refund during an oracle outage before a later fulfillment establishes another combination's winners. Each partial refund decrements its actual pair and count, returns only its paid entry, and recomputes backing atomically.

| Same daily draw | Previous full-ticket backing | Pooled backing |
| --- | ---: | ---: |
| Three tickets on three different pairs | 6 SOL | 2.0125 SOL |
| One ticket on each of the 420 pairs | 840 SOL | 4.61875 SOL |
| Ten tickets on the same pair | 20 SOL | 20 SOL |

These figures describe liability, not SOL paid out on purchase. Buying transfers only the entry into the vault. Once verified ORAO randomness finalizes a draw, permissionless reconciliation retains only the actual outstanding winners' prizes; the other outcomes release their backing without transferring SOL or marking individual tickets settled. A winning claim transfers its snapshot prize once to the immutable ticket owner and reduces its winning count. Payouts remain available without expiry.

This historical model increased capacity for diversified daily entries while retaining a finite admission limit under same-pair concentration and independent v2 quick draws. V4 instead retains fixed prizes and removes full-prize admission limits by accepting operator funding risk and a possible claim wait; it does not change prizes to shares of a self-funded pot. Neither model makes 20 SOL a guarantee of arbitrary correlated winning payouts.

The first v3 pooled entry created a 3398-byte shared risk account, with actual rent paid by its creator separately from the prize vault. Historical claims and refunds keep using that account; new v4 tickets use their separate 50-byte ledger. No automatic account-close or rent-recovery promise is made. Game and oracle prices, rents, counts and balances come from chain data. Expected house margins above remain unchanged; they are not a guarantee against variance, infrastructure costs or deliberate concentration.

## Legacy fixed-result UAT

Referral campaign v1 adds optional entries of 0.0071 SOL quick and 0.0062 SOL daily for a valid active binding. Under the same hypothetical fair random assumptions, those leave approximately 66.47% and 23.20% expected gross margins before expenses, respectively. Prizes and full reserves are unchanged. Referral account storage and network fees are separate from the discount; no cash payment or future airdrop is funded by this change. Opting out returns future entries to normal pricing. The frontend reads these offers from readonly metadata. See [referrals](./REFERRALS.md).

Revision 3 fixes new UAT results at **02 → 22**. Choosing the fixed pair is a known win once its result is recorded, so the random-odds table above does **not** describe the UAT's actual returns. Each winning quick ticket reduces vault funds by **0.9928 Devnet SOL net of its ticket payment**; a winning scheduled ticket reduces them by **1.99375 Devnet SOL**. Older published combinations stay unchanged.

The on-chain allowlist limits who can test. The program reserves the actual prize for each new ticket before collecting payment and refuses another ticket if the vault cannot cover it. Each ticket snapshots its prize: changing the current schedule or offer does not turn an older 1 SOL ticket into a 2 SOL liability. Earlier tickets keep their original payout behavior. This protects solvency; it does not create profit from a fixed result.

The quick test targets about one minute after checkout. If that timestamp would equal an exact daily slot, the client adds one second. Exact daily timestamps receive the daily prize in the contract; other UAT timestamps receive the quick prize.

## Devnet and operating costs

Devnet SOL has no financial value and is obtained from faucets, so the test ticket, deployment, rent and network fees do not represent spending real SOL. [Solana cluster documentation](https://solana.com/docs/references/clusters)

Infrastructure can still have real costs:

- **Hosting:** Vercel Hobby is free within its limits and is intended for personal, non-commercial use. A commercial launch needs an appropriate plan; paid plans and usage can create charges. This update does not upgrade any plan or enable a paid service. [Vercel Hobby](https://vercel.com/docs/plans/hobby), [pricing](https://vercel.com/pricing)
- **RPC:** the current public Devnet RPC has no provider subscription, but shared capacity is rate-limited. Dedicated capacity requires a separate budget. [Solana RPC planning](https://solana.com/docs/rpc/providers)
- **Domain:** an existing custom domain can still have registration or renewal costs, regardless of the blockchain cluster.
- **Randomness:** the legacy fixed test uses no oracle. New public Devnet draws charge the requesting wallet the actual ORAO fee and request account rent, separate from the prize pool and entry payment. The cost review reads these values before approval; they are not fixed table prices. Reclaimed unused funding goes only to the original requester. The operator has an oracle cost only when its wallet requests a draw. Shared daily draws can amortize one request across multiple tickets, while separate quick draws each need their own request.

The practical answer is **no real SOL expense for faucet tests, but not an unconditional zero-OPEX business**. See the [UAT security review](./UAT-AUDIT.md) for security findings and verification limits.

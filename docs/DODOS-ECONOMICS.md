# Dodos prize model

Decision for the October 28, 2026 UAT update: a **0.0072 SOL ticket**, **1 SOL quick prize**, and **2 SOL scheduled daily prize**. Picks are two distinct numbers from **02 through 22**, in order. Daily draws are at 2 PM and 4 PM, Philippine time. Each ticket enters one specific draw.

The larger daily prize gives a reason to choose the scheduled draw. Both draw types have the same matching rule and, in a future uniform random implementation, the same winning probability.

## Expected return under a fair random draw

There are 21 choices for the first number and 20 remaining choices for the second: **420 ordered outcomes**. A single pair therefore has a **1/420**, or approximately **0.2381%**, chance of winning if every outcome is equally likely and cannot be predicted before sales close.

| Per ticket | Quick draw | Scheduled daily draw |
| --- | ---: | ---: |
| Ticket payment to vault | 0.0072 SOL | 0.0072 SOL |
| Winning prize | 1 SOL | 2 SOL |
| Expected prize cost | 0.002380952 SOL | 0.004761905 SOL |
| Theoretical player return | 33.07% | 66.14% |
| Gross operator margin | 66.93% | 33.86% |
| Expected gross before expenses | 0.004819048 SOL | 0.002438095 SOL |

These are expectations, not guaranteed profit. They exclude hosting, domain renewal, RPC, randomness/oracle fees, transaction costs paid by the operator, maintenance and other expenses. Multiple tickets can share a draw and winning pair, so their outcomes can be correlated; a single draw can produce many winners.

For a draw with `N` tickets and operator-paid draw cost `F`, expected net profit in SOL is:

`N × (0.0072 − prize / 420 − per-ticket overhead) − F`

A production launch needs measured expenses below that budget, an unpredictable and uniformly sampled result, sales closing before the result can be known, and an independent review. Positive expected margin does not make a predictable or manipulable randomizer profitable.

## What the current fixed UAT does

The live program fixes new UAT results at **06 → 09**. The frontend's **06 → 07** display is only a target pending an on-chain upgrade. Choosing the live fixed pair is a known win once its result is recorded, so the random-odds table above does **not** describe the UAT's actual returns. Each winning quick ticket reduces vault funds by **0.9928 Devnet SOL net of its ticket payment**; a winning daily ticket reduces them by **1.9928 Devnet SOL**.

The on-chain allowlist limits who can test. The program reserves the actual prize for each new ticket before collecting payment and refuses another ticket if the vault cannot cover it. Each ticket snapshots its prize: changing the current schedule or offer does not turn an older 1 SOL ticket into a 2 SOL liability. Earlier tickets keep their original payout behavior. This protects solvency; it does not create profit from a fixed result.

The quick test targets about one minute after checkout. If that timestamp would equal an exact daily slot, the client adds one second. Exact daily timestamps receive the daily prize in the contract; other UAT timestamps receive the quick prize.

## Devnet and operating costs

Devnet SOL has no financial value and is obtained from faucets, so the test ticket, deployment, rent and network fees do not represent spending real SOL. [Solana cluster documentation](https://solana.com/docs/references/clusters)

Infrastructure can still have real costs:

- **Hosting:** Vercel Hobby is free within its limits and is intended for personal, non-commercial use. A commercial launch needs an appropriate plan; paid plans and usage can create charges. This update does not upgrade any plan or enable a paid service. [Vercel Hobby](https://vercel.com/docs/plans/hobby), [pricing](https://vercel.com/pricing)
- **RPC:** the current public Devnet RPC has no provider subscription, but shared capacity is rate-limited. Dedicated capacity requires a separate budget. [Solana RPC planning](https://solana.com/docs/rpc/providers)
- **Domain:** an existing custom domain can still have registration or renewal costs, regardless of the blockchain cluster.
- **Randomness:** the current fixed test does not use a paid oracle. A reviewed production randomness service needs separate cost and failure-mode analysis.

The practical answer is **no real SOL expense for faucet tests, but not an unconditional zero-OPEX business**. See the [UAT security review](./UAT-AUDIT.md) for security findings and verification limits.

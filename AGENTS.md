# UAT deployments

Always use https://www.uat.hiperia.xyz/ as the public UAT URL. Deploy to the existing Vercel project `joshua-olins-projects/hiperia.xyz` as Preview with `VITE_APP_ENV=uat` and the Solana Devnet RPC. After the deployment is READY, assign `www.uat.hiperia.xyz` to it with `vercel alias set`, then verify the hostname resolves to that deployment and the app loads before reporting completion. Keep production domains unchanged and report the custom UAT URL as the main link. The domain is also configured for the Git branch `uat`.

See [the deployment steps](./README.md#uat-on-vercel).

The current Dodos program is restricted UAT with fixed new results 06 → 09, an on-chain tester allowlist, and full prize reserves per ticket. Preserve these controls and disclose the fixed result in the UI. Public real-fund use requires a separately reviewed randomness and liability design; see [the UAT review](./docs/UAT-AUDIT.md).

Keep refresh requests deduplicated and rate-limited. A temporary RPC failure must preserve the last loaded data for the same wallet; confirmed transactions need a fresh read, never an automatic transaction resubmission.

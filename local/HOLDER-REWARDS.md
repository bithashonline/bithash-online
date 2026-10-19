# Holder rewards — unsigned preparation and read-only reconciliation

The rewards manager allocates half of the second treasury's verified 30% distribution to holders and keeps half for development. Integer rounding occurs on cumulative receipts. It does not interpret unrelated wallet deposits as project fees, and a Pump distribution establishes routing rather than independent trading-fee origin.

## What works

- Read complete finalized token account snapshots with `getProgramAccounts`, aggregate accounts by owner, and compare their sum with the mint supply. The mint must have no mint authority; unsupported extensions or incomplete results hold preparation. The read is bounded to 100,000 accounts / 20 MB. Production RPC capacity for the eventual holder count remains to be established.
- Exclude explicitly reviewed treasury, liquidity and other ineligible wallets. An unreviewed program-owned holder blocks preparation instead of silently redirecting its share.
- Divide the selected reward budget proportionally, using integer largest-remainder allocation and deterministic wallet tie-breaking. No amount is lost to rounding.
- Persist receipts, immutable payout manifests, unpaid liabilities and signature attempts in a separate SQLite journal. Only one unresolved round is allowed. A round cannot consume development reserves or allocate the same receipt budget twice.
- Prepare unsigned WBTC transaction templates with idempotent recipient associated-token-account creation. These use an offline placeholder blockhash, not a usable live transaction.
- Reconcile supplied existing signatures against the exact signed message, finalized slot and source/destination token balance changes. Unknown transactions remain pending. A definitive failure permits a new attempt without discarding its liability; a confirmed payout cannot be attached again.
- Optionally prepare rounds in the background at a configured cadence and amount cap. This prepares unsigned liabilities only. It neither signs nor submits them.

The full account scan uses the [Solana getProgramAccounts API](https://solana.com/docs/rpc/http/getprogramaccounts). `getTokenLargestAccounts` is deliberately not used because it is not a complete holder list.

## Configuration

The Operator takes the project mint from `feeDetection.projectMint` and the two wallet addresses from its existing compute-treasury configuration. Add `holderRewards` settings only after selecting the eligibility policy. See `launch/holder-rewards.example.json`. Both treasury wallets must be excluded; any liquidity/program holders must be reviewed explicitly. The example is inactive and supplies no payment authority.

`policyConfirmed` means the eligibility/preparation policy was reviewed. It does not authorize live transfers. `automaticRounds` controls unsigned preparation, not payment execution. Configuration is frozen once fees or rounds exist; changing an active policy requires a deliberate migration.

The development reserve is cumulative and conservative. Development withdrawals are not tracked by this module; spending that reserve elsewhere may hold later rounds until separately reconciled. Snapshot-based eligibility is not a time-weighted dividend: holdings at the snapshot determine the allocation. Published token terms must explain that before activation.

## Console and routes

`/treasury#holder-rewards` shows allocation, configuration status and prepared rounds. Session, same-origin and CSRF protections cover refresh, prepare, attach-existing-signature and unsigned-template POST routes. `/treasury/status` includes the manifest and payout identities for local integration.

The local process checks every minute. Without a token/configuration it performs no holder RPC request and creates no sample fees or holders. Credentials and databases remain outside source control.

## Remaining live boundary

Signing, broadcasting and payments are hard-disabled. Current blockhash, fee, account-rent and simulation checks must be added to the reward execution path before it can send. A separately restricted custody/execution service, funded SOL reserve, approved payout settings and a small authorized end-to-end acceptance test remain necessary. The existing compute-transfer preflight accepts a different instruction structure and must not be substituted for the reward template check.

Tests cover complete holder aggregation, invalid/partial snapshots, fee-budget deduplication, reserve limits, unsigned account creation, restart recovery, failed/unknown outcomes, signature reuse and automatic preparation. No real transfer, card charge or GPU experiment was used.

## October 19 wallet execution update

Live reward fee/rent preflight and the durable wallet executor are now connected. This supersedes the earlier missing-preflight/executor statements above. See [WALLET-EXECUTION.md](WALLET-EXECUTION.md). The console can check each unpaid payout, preserving development and other unpaid liabilities. Production remains hard-disabled with no custody loader or actual wallet key. Configuration, custody deployment and explicitly authorized live acceptance remain required.

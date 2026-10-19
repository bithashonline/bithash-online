# Production funding coordinator — dry run

The local Operator now evaluates one flow from finalized Pump distributions through funding rules, persistent funding intents, restricted transaction inspection, read-only settlement records and a proposed fleet budget. It is an observer and planner. Signing, broadcasting, payments, rentals and production credit posting remain disabled.

## Data and execution boundary

`FundingCoordinator` receives only an observation callback. It stores its own journal in `funding-coordinator.sqlite`, separate from real treasury plans and the sample walkthrough. It has no wallet key, payment client or rental executor. The background check runs every minute while the local Operator process is running.

Without a configured project token mint, the coordinator reports `awaiting-token-launch` and creates no receipt or intent. Once configured, it requires complete finalized distribution observations, the expected 70/30 wallets and WBTC mint, fresh provider records and a healthy shadow ledger. A distribution establishes routing, not independent proof that its origin was trading fees.

The coordinator shares the automatic funding readiness checks and owner funding limits, then uses the fixed $100 reload policy in `coordinator-reload-policy.js`. It records at most one pending intent, with deterministic identity, exact amount, destination, policy hashes and receipt allocations. Those allocations reserve only the dry-run journal; they do not reserve actual funds. Restarts preserve the intent. Duplicate observations cannot create another funding intent. Changed or missing receipts, altered terms, inconsistent balances and ambiguous production links hold the flow for review.

## Connected stages

1. Read-only fee collection and the complete automatic-funding receipt history.
2. Fixed $100 native-reload planning using observed balances and dry-run assumptions. Full $100 card-funding batches only, preserving fee attribution, fresh observations, SOL reserves, WBTC reserves, card deposit limits and stricter owner limits. The earlier standalone automatic-funding preview retains its old target-balance policy; it does not drive coordinator jobs.
3. Offline inspection by `DisabledRestrictedFundingSigner`. This is not a successful live transaction preflight.
4. Automatic handoff of eligible real-record intents to durable production observation jobs, followed by the existing unsigned transaction preflight. The manager freezes the receipt allocations, identity, amount, destination and policies; retries and restarts reuse the same job. These remain dry-run intents, with no real treasury plan or reservation. Sample walkthroughs are excluded. A finalized chain observation waits for settlement attribution or the dedicated-card observation completion described below.
5. Shadow SolCard and Runpod accounting, including provider usage and reversals.
6. A conservative pooled compute-credit projection and fleet budget proposal. Opening provider credit and positive provider adjustments are excluded; usage, debit adjustments and matched reload reversals are deducted. This is policy inference, not exact fee-to-payment provenance. No projected credit is posted as spendable credit.

The real-record integration currently supplies no GPU quote, so it cannot propose a live fleet size. The isolated walkthrough supplies an explicitly invented quote. Neither path rents hardware.

## Console and sample walkthrough

`/treasury#funding-coordinator` shows stages, durable intents, holds and projected budget. Protected POST routes refresh read-only observations or run a separate in-memory sample walkthrough. The latter invents receipts, balances, a chain observation and pricing. It does not add sample records to the real journal.

The walkthrough demonstrates 0.01 WBTC split into 0.007 compute and 0.003 other treasury, a hypothetical $100 deposit at an assumed $100,000/WBTC, a $100 provider reload and $5 usage. It projects $95 pooled compute credit while retaining the missing deposit/payment-attribution hold. These are fixtures, not actual transactions.

The connected recovery walkthrough uses a separate instance of the same coordinator. Four $100 cycles complete across five intents: a failed-before-deposit intent releases its allocation, a declined reload retains its card deposit, and an unknown outcome waits for matching sample evidence. Completion requires explicit invented deposit and reload references with exact amounts; balance changes do not close jobs. Completed allocations remain consumed, cancelled allocations may be reused with a new intent ID, and pending allocations remain reserved. Every attempted intent counts against the example rolling daily cap, including cancelled attempts. The sample ends with 300,000 compute WBTC units, 400,000 consumed units and no pending reservation; the other treasury remains 300,000 units. No real ledger credit is posted.

`applySampleOutcome` is restricted to `sample-fixtures` databases. It cannot complete or release real-record jobs, clear policy holds or accept unmatched/reused sample references. Events deduplicate durably, and a conflicting replay fails atomically. Unknown and completed states survive closing/reopening the SQLite journal in tests. The UI walkthrough is intentionally in-memory and repeatable; its outcome records are not live evidence. Real-record observation completion is described below; live spending remains disabled.

The reload policy's $50 threshold, two-hour lead, $100 minimum card-funding batch, $500 combined float, $1,000 daily USD deposit cap and 100,000 retained WBTC units are simulation assumptions. Existing lower WBTC/card/owner limits still apply. WBTC conversion rounds upward to cover the full assumed USD batch, then rechecks caps; it never issues a partial batch. No current price or executable conversion quote is claimed. Effective policy hashes include reload settings and planning burn; old intents are held for review on a policy change, never silently rebound. Neither the coordinator nor a local hold controls Runpod's actual auto-pay settings.

## Verification and remaining work

October 19 verification: 522 full local tests pass, including 14 new reload/lifecycle tests. A final duplicate-event no-op refinement passes all 66 affected coordinator, handoff and automatic-funding tests. Coverage includes batch limits/rounding, repeated completion, consumed allocations, unknown/declined recovery, failed pre-deposit release, restart persistence, evidence replay and production isolation. The handoff tests run the actual manager and preflight engine with invented records and a fake RPC transport in separate test databases.

Local verification details are retained in the private workspace; this source release excludes account records, process identifiers and machine-specific paths.

Future work includes activating an accepted spendable-credit policy, live read-only pricing and independently authorized execution/custody. Token configuration, owner limits and fresh wallet observations are still required before the real-record path can produce its first eligible intent. Runpod native auto-pay remains OFF; actual card acceptance and production payment execution are untested. No test token, real transfer, card charge, provider purchase or GPU experiment is needed to exercise this dry-run walkthrough.

## October 19 completion update

Real-record jobs can now close as `policy-complete-observation` when a finalized exact chain transfer, new unique SolCard invoice/card credit and a new unique $100 card-debit/Runpod-reload pair agree under the dedicated-card policy. Account identities, record baselines, chronology and amount are checked; incomplete, reused, refunded or ambiguous observations do not close a job. Completed receipt allocations remain consumed. A definitively failed finalized transfer releases its allocation without erasing its attempt history. Multiple historical jobs are retained, with at most one unresolved intent.

This supersedes the earlier statement that all real-record completion was future work. It does not supersede the live-execution boundary: completion is policy inference, `exactCrossProviderProof` remains false, and spendable credit posted remains zero. Changed or unavailable accepted completion evidence holds subsequent planning. The provider feed's retention window may therefore require reviewed archival reconciliation for long-running operation.

The same release adds unsigned holder-reward preparation; see [HOLDER-REWARDS.md](HOLDER-REWARDS.md) and [the launch checklist](../launch/FUNDING-LAUNCH.md). All 538 development-workspace tests pass; the isolated public release passes all 499 tests in its published local suite. The local Operator was restarted twice with no key loaded and no real plans, production jobs or credit postings. The token is not configured, so real fee attribution and a paid end-to-end flow remain untested.

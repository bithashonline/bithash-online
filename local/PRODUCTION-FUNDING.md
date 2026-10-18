# Production funding jobs — observe only

Implemented October 18, 2026. This connects the real owner-recorded treasury to a keyless restricted signer interface and the existing real read-only reconciler. It is a production-path integration, **not an enabled production payment system**.

## Current behavior

`ProductionFundingJobs` scans existing `owner-recorded` / `solcard-wbtc` plans once per minute while the local Operator runs. It does not create plans, reserve additional funds, claim fees, sign, broadcast, charge cards, credit the treasury or operate GPUs. Simulation ledgers and simulation reconcilers are rejected; sample jobs never enter this path.

Each job freezes its source plan identity, amount, compute wallet, configured SolCard recipient, exact Portal WBTC mint, network, card slot and current policy. Changed source terms, destination or policy cause a review hold rather than rebinding the job. A policy change, including initially adding missing limits, currently requires a future explicit job-revision workflow; the observer does not grant new authority automatically.

The `DisabledRestrictedFundingSigner` has no key and no key-loading API. It reuses the existing `buildRestrictedTransfer` / `inspectRestrictedTransfer` message checks to inspect a single standard SPL `TransferChecked` between the derived WBTC associated token accounts. It validates structural terms and available transfer-limit configuration. Signing and broadcasting methods always throw. No unsigned or signed wire is returned to the browser.

This inspection deliberately uses an offline placeholder blockhash. It is **not** a live preflight: independent daily spending authority, actual token-account state, live blockhash/fees, SOL reserve, authenticated fee provenance and production custody remain unconnected. A passed structural check must never be treated as permission to sign.

## Existing transaction observation

An existing transaction signature can come from the plan's owner-recorded deposit reference or the protected local observation form. Providing a signature only asks for a read; it does not submit a transaction or advance accounting. A job's first signature is immutable and cannot be reused for another job. An incorrect signature stays held; an explicit correction/supersession workflow is still future work.

The fixed Solana adapter uses finalized `getTransaction` only. Null results remain unknown/pending. Before registering with `FundingReconciler`, the manager verifies the exact compiled transfer message, signature, mint, source and destination accounts, and successful token debit/credit amounts. Additional instructions, changed amounts and mismatched signatures cannot register. Finalized failed transactions are recorded as failures by the reconciler and never earn credit.

Registration intent is persisted before writing to the reconciler's separate database. A restart safely retries the same immutable registration; duplicate signatures and changed reconciliation terms are rejected. Observer writes never mutate the source plan or treasury. Restart and failed-write tests use synthetic transactions and temporary databases, not real transfers.

## Real provider evidence limitations

The manager is connected to the authenticated SolCard and Runpod read-only records and the existing observe-only reconciler. Missing/stale reads are distinct from missing attribution. Current SolCard records lack proven transfer-signature attribution; Runpod reloads lack a project-card payment link. Matching balances, timestamps or dollar amounts do not fill those gaps.

The real reconciler therefore remains at `awaiting-card` when chain proof exists but no attributable card credit exists. It cannot consume synthetic credited receipts in observe-only mode. Provider completion and automatic credit posting remain disabled. The UI shows these limitations even when both feeds are connected. Real live end-to-end payment reconciliation has not been demonstrated.

## Storage, UI and authorization

Private `production-funding-jobs.sqlite` is marked `observe-only` and rejects unrelated database schemas. It stores public funding terms, hashes, signature references, status and bounded event history; no keys, card details or transaction wire. One job per source plan, up to 1,000 stored jobs; at most 20 are inspected each tick. Overlapping ticks are skipped and signature attachment is blocked while a tick is busy.

The console section is `http://127.0.0.1:4185/treasury#production-funding`. The refresh and signature-observation routes inherit the existing loopback host, session, origin and CSRF checks. There is no enable-signing toggle. No existing Google GPU approval requirement is changed. No public deployment or service installation occurred.

## Validation

158/158 tests passed, including 19 new production-path tests. Coverage: keyless inspection/disabled execution, real-plan import and accounting isolation, empty-ledger behavior, simulation rejection, fixed read-only RPC, unknown outcomes, exact transfer and token deltas, missing card linkage, changed terms, signature reuse, restart across two databases, failed-save rollback and console state.

Tests exposed and fixed an existing event-ID length bug: adding a funding-stage prefix to an 88-character Solana signature exceeded the internal 100-character limit. External references retain their 100-character validation; internal event IDs now allow the bounded prefix up to 128 characters. Deduplication and conflict checks remain intact.

Local runtime validation uses the actual empty real ledger and connected read-only providers. It does not insert synthetic plans into that ledger. Test fixtures demonstrate transaction progression; actual live transfers remain untested by design. Private runtime outputs are excluded from this repository. See the [public release record](../experiments/2026-10-18-treasury-funding.md) for reproducible validation.

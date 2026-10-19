# Production funding jobs — observe only

**Settlement matching update:** [SETTLEMENT-MATCHING.md](SETTLEMENT-MATCHING.md) connects bounded invoice-detail reads, direct invoice/activity links and cross-provider candidate diagnostics to finalized funding jobs. Credit acceptance remains disabled because incoming-signature and card-charge/reload bindings are still missing.

**Fee collection update:** [FEE-COLLECTION.md](FEE-COLLECTION.md) connects a separate read-only Pump collection preview and finalized-receipt observer. It cannot create production plans or credit and does not enable signing or broadcasting.

**October 18 update:** live mainnet preflight is now connected separately from the offline structural inspector. See [TRANSACTION-PREFLIGHT.md](TRANSACTION-PREFLIGHT.md) for exact checks, current missing-account hold, validation and remaining authority limitations. The offline-only preflight limitation below describes the earlier implementation; signing/broadcast/payment restrictions remain current.

Implemented October 18, 2026. This connects the real owner-recorded treasury to a keyless restricted signer interface and the existing real read-only reconciler. It is a production-path integration, **not an enabled production payment system**.

## Current behavior

`ProductionFundingJobs` scans existing `owner-recorded` / `solcard-wbtc` plans and the coordinator's eligible real-record dry-run intents once per minute while the local Operator runs. It does not create treasury plans, reserve additional funds, claim fees, sign, broadcast, charge cards, credit the treasury or operate GPUs. Simulation ledgers and simulation reconcilers are rejected; sample jobs never enter this path.

### October 19: coordinator job handoff

The internal `bithash.coordinator-handoff.v1` snapshot must identify real records, dry-run mode, fresh observations and disabled execution. The manager validates allocated receipts, their amounts and hashes, project/wallet identity, destination and owner policy. Each intent receives one deterministic persistent observation job labelled `coordinator-dry-run` / `dry-run-only`. The treasury ledger is unchanged. Existing manual commitments and coordinator jobs both count when checking pending work and rolling limits.

The existing keyless inspector and unsigned preflight are connected automatically. Bindings are checked again after asynchronous RPC reads. Stale sources pause and can recover; changed or missing intents, receipts, destinations or policies latch review across restarts. A latched job cannot accept a signature or silently resume; reviewed correction is future work. No wire or signing key is exposed to the browser. Shutdown waits for production observations before closing their coordinator dependency.

494 local tests pass, including 12 handoff tests with synthetic records, fake RPC responses and separate databases. These verify exact unsigned message construction, crash recovery between import and acknowledgement, source isolation, changed-term holds, async invalidation and accounting isolation. Actual Operator restart verification confirms the handoff is connected, all execution disabled and zero production jobs before token launch; it does not prove a live payment flow. See [FUNDING-COORDINATOR.md](FUNDING-COORDINATOR.md).

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

Local verification details are retained in the private workspace; this source release excludes account records, process identifiers and machine-specific paths.


## Dedicated compute card shadow observer
The owner has designated all SolCard funds for compute. [Shadow bookkeeping](SHADOW-FUNDING.md) now uses real read-only records to classify the opening card balance and propose unique later card/reload matches. Fund-use designation does not establish token-fee origin. Opening Runpod credit stays legacy. Shadow matches are policy inferences and cannot post production credit; the existing production evidence gates remain unchanged.

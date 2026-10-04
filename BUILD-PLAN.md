# Puzzle Compute Launchpad build plan

October 3, 2026. Proposed roadmap for turning the local demonstrator into an original Solana launchpad with verifiable fee funded GPU work. This plan authorizes no spending, launches or publication. Financial and product choices below are recommendations until Isaac accepts them.

The first major result is one traceable cycle: confirmed creator fees → coin contribution ledger → provider credit/payment → bounded GPU job → checkpointed work → reconciled invoice → public evidence. After that works reliably for one coin, expand to multiple coins and open launches.

## Current baseline

Implemented: CPU reference search for solved puzzles 1–3, SQLite job/range/checkpoint/lease records, exact synthetic accounting, explicit mock provider and eleven passing tests. The demo searches four candidates from solved puzzle 3. This proves a small local slice.

Missing: real fee ingestion, production signer/custody, conversion/payment path, GPU worker, provider integration, independent watchdog, multi-coin accounting policy, launch transactions and user interface. Current target funding/public-key state and local GPU hardware remain unverified. The prototype's trusted checkpoint API and synthetic invoice are not production evidence.

## Recommended first release

Use existing Pump infrastructure, one GPU provider, one approved solver image and one active public puzzle target. Start with a single pilot coin, then a small invited group. Present a polished launch flow, coin directory, individual contribution pages, pooled compute activity and an evidence/status page.

Keep the existing Node/OpenSSL code as a correctness reference. Evolve the controller into a typed service with migrations, durable jobs and explicit interfaces. Select the production database in Part 4 based on multi-worker locking and deployment requirements; do not mistake experimental local SQLite support for production readiness.

Defer a platform token, custom bonding curve, AI agents, multiple GPU providers, referral incentives and complicated prize claims from the initial engineering scope. These are proposed scope choices, not settled economics.

## Build parts and completion tests

### Part 1 Product rules and decision register

Write the exact user journey and an example showing how one coin's creator fees become compute. Record the intended fee allocation, operating reserve, idle threshold, custody model, provider payment path, prize ownership, target-change policy and treatment of unused balances.

Recommend recording contribution attribution separately from prize entitlement: a coin's contribution page should not silently create a financial claim. Decide whether the product offers any such claim before its public copy or distribution code exists.

Deliverables: DECISIONS.md, one-page product specification and a money-flow example. Unresolved choices have a named dependency and remain open; none is invented to unblock coding.

Done when the proposed first release and all blocking decisions are visible. Fee split/custody must be accepted before final transaction/signing implementation; account/budget before paid tests; prize/target/unused-fund rules before unsolved paid search and public launch. Branding can wait until Part 8. Technical work in Parts 2–4 can continue while these decisions are open.

### Part 2 Real creator fee receipts

Implement a read-only Solana collector using pinned official program/IDL versions. Identify exact mint, creator vault/sharing config and recipient accounts. Distinguish accrued fees, claimed fees, wallet deposits and actual platform contributions.

Store finalized transaction evidence and deduplicate using signature plus instruction/inner-instruction location and asset. Handle multiple coins in one receipt, wrapped SOL, account rent, transaction costs, pagination, RPC gaps and restart backfill. Pending/reverted transactions must never become spendable credit.

Deliverables: receipt adapter, checked public receipt fixtures, reconciliation command and tests.

Done when a known real creator-fee receipt independently matches exact lamports/recipient/program, replay adds nothing, unrelated deposits are rejected, and an interrupted scan resumes without gaps or duplicate money. Saved WWW evidence is a starting sample to refresh, not an assumed current integration. No wallet signing needed.

### Part 3 Target registry and GPU solver validation

Refresh puzzle 71 identity, range, spend/funding state and public-key availability from independently checked Bitcoin data. Store timestamp, source, target version and allowed algorithm. Pause target eligibility when checks are stale or conflicting.

Inspect a maintained solver's source, license, build chain and exact interval/checkpoint semantics. Pin its source revision and container digest. Compare it with the CPU reference on solved fixtures, including first/last candidate, no-match ranges and a larger known solved interval. Test interruption, restart and candidate verification. Keep recovered candidates out of logs and public APIs.

Deliverables: target manifest, fixture suite, solver adapter and reproducible build/benchmark record.

Done when the GPU implementation finds the expected public fixture results with no boundary gaps, restart behavior is characterized, and actual throughput is measured on identified hardware. A CPU test cannot pass this gate for a GPU implementation. If no suitable owned GPU is available, finish build/tests that can run locally and perform GPU validation during the separately budgeted Part 5 trial.

### Part 4 Durable controller and pooled accounting

Extend the prototype into service boundaries for receipts, ledger, scheduler, worker reports and provider operations. Keep all amounts exact with named assets/units; never blend SOL, USD valuation and prepaid provider credits.

Implement reservation, conversion, provider-credit consumption, invoices, refunds/adjustments and outstanding liabilities. Preserve per-coin contributions and apply an accepted deterministic cost-allocation policy, including exact rounding/remainders. Sponsor funds must have their own source.

Harden multi-worker leases and fencing, target-version binding, retries, concurrent reservations, authentication and append-only audit events. Checkpoints report contiguous tested ranges; partial/lost work and overlap are disclosed. Bind telemetry to worker, device, image, target, range and job.

Deliverables: service API/schema, database migrations, accounting specification and failure tests.

Done when two workers cannot spend the same balance or claim the same active lease, interrupted operations recover, every journal entry balances by asset, and the ledger reconciles to wallet assets plus provider credits/liabilities. Rebuild state from stored evidence. Operator software controls remain distinct from onchain enforcement.

### Part 5 One real provider and a bounded GPU trial

Choose the provider only after checking a compatible GPU quote, account access, payment eligibility and workload terms. Capture compute, boot, disk, network, minimum billing and shutdown costs. Agree an explicit trial budget and funding source.

Build quote/create/inspect/stop/destroy/reconcile adapters. An ambiguous create must retain its liability until reconciled. Use an independent watchdog with its own controller access; test lost worker heartbeat, lost main controller, stale prices, API timeout, delayed invoice and continuing storage charges.

Deliverables: one provider adapter, watchdog, operator stop procedure and matched provider receipts.

Done when an authorized small trial validates solved fixtures on a real GPU, survives an injected failure, shuts down within the defined allowance, and its final invoice reconciles. Prefer a sponsored fixture trial for this gate; label it sponsored and do not call it creator-fee-funded work. No unsolved search required here.

### Part 6 Treasury and payment bridge

Implement the accepted custody design: separate signer, restricted destinations/instructions, narrowly scoped credentials, transaction simulation, replay protection and recorded approvals/limits. Workers and browsers never receive treasury signing authority.

Connect creator-fee collection and the accepted provider-payment route. If conversion or manual top-up is needed, record source asset, received provider credit, rate, fees, reference and operator action. Do not call a manual bridge automatic. Reconcile uncertain sends before retrying.

Deliverables: signer policy, custody disclosure, payment adapter or explicit manual settlement workflow, daily reconciliation and recovery runbook.

Done when rejected destinations/overspend/replays fail in tests, a lost controller cannot leave unrestricted spending, key rotation/recovery is rehearsed, and one authorized small funding operation is evidenced end to end. Only agreed account/budget/custody decisions unlock financial execution.

### Part 7 Launch transaction and coin registration

Build wallet connection, metadata validation/upload, transaction preview, supported token creation, creator-fee routing and onchain verification. Pin current official SDK/IDL and inspect the actual unsigned message.

Verify transaction size/compute limits and whether create plus permanent fee routing can be atomic. If it cannot, use an explicit recoverable setup flow and never label a coin fully onboarded before routing is verified. Handle rejected signatures, expired blockhashes, RPC timeout after landing, duplicate clicks and already-created coins.

Deliverables: launch service, wallet flow, coin registry and integration tests with recorded simulation/transaction results.

Done when a permitted pilot launch produces the intended mint and exact fee recipients/split, persists correctly after refresh, and cannot falsely report success on partial setup. Local validator/fork/simulation evidence is identified separately from mainnet receipts. Live launch needs explicit authorization.

### Part 8 Brand and product interface

Choose name, visual identity and clear explanation of pooled public-puzzle compute. Create a cohesive, mobile-friendly interface with five main areas: launch, explore coins, coin detail, compute activity and evidence/status.

Coin pages show verified identity, creator-fee allocation, contributions, cost attribution and recent activity. Compute pages show jobs, devices, measured rate, target/version, last heartbeat and checkpointed unique coverage. Display delayed/stale/failed states visibly. Show accrued, collected, reserved and billed values separately.

Keep dollar estimates timestamped. Use eligible unique address-search coverage for probability illustrations only when its assumptions hold; algorithm work counters are not automatically coverage. Do not imply reward entitlement until its policy is accepted.

Deliverables: approved design, working frontend and API contract.

Done when a new user can understand the fee destination before signing, launch or inspect a coin on mobile, and trace a displayed cost/job back to evidence. Refresh/disconnect/error states and accessibility checks pass. A preview may use clearly marked fixtures while integrations are underway.

### Part 9 Prove the complete cycle with one coin

Run an explicitly authorized pilot through real creator-fee receipt, collection, allocation, provider funding/credit usage, GPU work and invoice settlement. Link the relevant records with timestamps and stable IDs. Track any sponsor subsidy separately.

Rehearse controller crash, worker death, RPC outage, provider ambiguity, insufficient funds and target becoming ineligible. Restore the database from backup and reconcile before resuming. Have a separate reviewer inspect transaction construction, custody, ledger invariants, provider shutdown and candidate handling.

Deliverables: reproducible pilot evidence bundle, incident/recovery records and closed critical findings.

Done when at least one real fee-to-compute cycle reconciles without unexplained differences, all defined failure drills pass, and the interface faithfully exposes its state. If no genuine fee receipt exists, the fee-funded milestone remains incomplete; synthetic volume is not a substitute.

### Part 10 Invited beta and public launch

First admit a small capped set of participating coins. Measure successful launches, routing failures, receipt lag, actual jobs, billed cost per measured work, downtime, reserve coverage and support issues. Observe retention and repeat contributors separately from price/volume.

Proposed beta exit gate: three participating coins, seven consecutive days of monitoring, daily reconciliation with zero unexplained differences, all prescribed failure drills passed and no unresolved critical security/control findings. These are proposed acceptance thresholds, not evidence of adoption or a promised timeline. Quiet markets may produce few jobs; disclose funding shortfalls rather than subsidizing silently.

Finalize operating ownership, alerts, support contact, public custody/economic disclosures, source/evidence publication policy and pause/recovery controls. Scale concurrency only after the capped beta supports it.

Done when beta evidence meets the agreed gates and Isaac authorizes public rollout. Continue daily reconciliation and incident tracking after launch.

## Work order and dependencies

| Order | Unit | Can begin now | What blocks completion |
|---|---|---|---|
| 1 | Product rules | Yes, draft proposals and open choices | Isaac's economic/prize/custody decisions |
| 2 | Receipt collector | Yes, read-only real evidence | Usable RPC and verified sample receipts |
| 3 | Target and solver | Yes, inspection and fixture work | Fresh target evidence and compatible GPU |
| 4 | Controller and accounting | Yes, hardening and policy interfaces | Accepted allocation rules for final behavior |
| 5 | Provider trial | Adapter/mocks and quote research | Account, budget, terms and real GPU trial |
| 6 | Treasury and payment | Design and rejected-operation tests | Accepted custody/payment path and authorization |
| 7 | Launch transactions | Construction/simulation after rules settle | Verified routing and authorized pilot launch |
| 8 | Product interface | Wireframes/API design; then real data | Brand decision and verified integrations |
| 9 | Complete pilot | After Parts 2–7; evidence UI from Part 8 | Actual authorized fee-funded cycle |
| 10 | Beta and release | After pilot and security fixes | Agreed beta gates and rollout authorization |

Use this as a dependency map, not permission to run all stages. Tackle one numbered part at a time; independent design work can advance when a specific integration is blocked.

## First concrete work session

October 3 steering update: the user asked to prioritize Pump launch fundamentals and understandable product progress. Official research and unsigned SDK construction now exist in launch/. Next is the basic launch form plus simulation/routing validation. The original receipt-first session below is retained as a later integration task, not the current priority.

Start Part 2. Identify and retrieve one public finalized creator-fee receipt from the saved research, pin the relevant program definitions, and build a read-only decoder that produces exact coin/asset/source/recipient/instruction evidence. Add tests for replay, unrelated deposits, failed/pending transactions and restart backfill. Save a reconciliation report.

In the same planning record, draft Part 1's choices without selecting financial terms on Isaac's behalf. No provider purchase, wallet signature or token launch is required for this next session.

## How each part is handed off

Each completed part has source/config changes, a runnable demonstration, meaningful tests, an evidence record, known limitations and one next task. Update PROJECT.md and TASKS.md after each milestone. A mock, simulation, provider document, mainnet receipt and real GPU observation are different evidence types and must stay labeled.

The plan's critical success measure is a verifiable operating cycle. User growth, market performance and discovery of a puzzle solution are separate outcomes and are not required to claim that a correctly evidenced compute job ran.

## Source basis

Saved canonical Agency, Cobweb and Worldwide Web notes inform the architecture: incoming fee routing does not prove downstream provider settlement, and a public activity feed does not establish safe custody or hard spending caps. Their market outcomes are not forecasts for this build.

Current [Pump creator fee sharing documentation](https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/CREATOR_FEE_SHARING.md) describes one-time final sharing configuration; actual launch atomicity and deployed routing still need tests. [Runpod billing](https://docs.runpod.io/accounts-billing/billing) and [Vast billing](https://docs.vast.ai/guides/reference/billing) describe prepaid provider paths and storage liabilities; neither is a connected account or accepted quote here. Documentation checked October 3, 2026. Detailed environment limits remain in INTEGRATIONS-2026-10-03.md.

# Backend modules

Current release: Google owner approvals, mock automatic execution, bounded CPU fixtures, signed telemetry, collector proxy and provider read adapters. Install locked dependencies with npm ci --ignore-scripts, then npm test. See ../README.md for current deployment/evidence and limits.

The chronological notes below describe earlier stages; they do not override the current release status.

# Local demonstrator

October 3, 2026. No npm dependencies, credentials, signer, network client, paid adapter or #71 search.
Requires Node 22.16+ and its experimental built-in SQLite module. Tested on Node 22.16.0 / OpenSSL 3.0.16 / SQLite 3.49.1 on Windows.

From this directory:

```powershell
node --experimental-sqlite --test
node --experimental-sqlite demo.js
```

Demo state survives in `work/demo/state.sqlite`; `report.json` is regenerated from persisted state. Rerunning a settled demo does not debit again or repeat search. Use a new output directory argument for a fresh run. SQLite uses WAL, FULL synchronization and immediate write transactions. Keep DB/WAL together while active; use SQLite backup tooling for production backups.

## What executes

OpenSSL secp256k1 compressed public-key derivation, SHA256/RIPEMD160 and Base58Check match public solved puzzles #1–3 (seven total candidates in the fixture suite). Curve arithmetic is supplied by Node/OpenSSL, not custom ECC. A half-open CPU search executes every candidate in each requested fixture subrange, returning only match status, attempts and measured elapsed nanoseconds. The demo searches the four candidates of #3. This is a correctness reference, not a GPU solver or meaningful performance benchmark.

Fixture provenance: https://raw.githubusercontent.com/roadhero/Bitcoin-Puzzle-Info/main/BTC-Solved-Unsolved.txt — retrieved October 3. Address/key vectors are cross-checked against this public corpus. #3's initial address was mistakenly taken from #4; tests caught the mismatch and it was corrected before completion.

The controller reserves synthetic micro-USD credit, creates a deliberately mocked provider job, reconciles a timeout after acceptance, leases a non-overlapping range, performs CPU chunks, checkpoints, stops the mock and settles its synthetic invoice. Job states: planned → unknown → ready → running → work_done → settled. A timeout cannot free the reservation or retry creation before reconciliation. Expired leases receive new epochs; stale writers are fenced. Checkpoints advance contiguously and cannot move backwards or beyond the half-open range. Reservations and settlement remain atomic across concurrent connections.

The double-entry journal contains exact decimal integer amounts. Contributions have per-coin credit accounts; available/reserved/expense are debit accounts. Replay keys must agree on all immutable data. `charge` supports exact integer per-second rates, rounded billing quanta and minimum duration. The demo invoice uses **synthetic 10 seconds × 7 micro-USD/sec = 70**, not measured CPU duration or a provider tariff. There is no SOL→USD conversion, per-coin expense apportionment or creator-fee ingestion; none is implied by synthetic funding.

## Tests and evidence limits

Tests exercise solved vectors and boundaries, integers above Number precision, rounding/minimums, conflicting duplicate receipts/jobs, overlapping ranges, exhausted reservation budget, provider acceptance then timeout/reopen/reconcile, absent provider outcome, checkpoint restart/lease expiry, stale writers, duplicate coverage, invoice replay, bill over cap, reservation retention during stop and hard rejection of foreign adapters. A subprocess exits with an open SQLite write transaction; reopening rolls it back and repeats from the previous durable checkpoint.

Unique checkpointed coverage counts each disjoint range once. Lost work before a checkpoint may repeat; its physical attempt count is unknown. The low-level checkpoint API treats reports as trusted local inputs; it is not an authenticated remote-worker endpoint or cryptographic proof of coverage. The demo uses only the executing CPU path. Direct DB edits by an operator are possible; this is local accounting, not tamper-proof custody enforcement.

No real job runtime cap/independent watchdog/provider stop acknowledgement exists. The mock's stop is local state only. Caps currently constrain new reservations and accepted synthetic settlement, not a real provider's external liabilities. An over-cap bill is rejected and reserve retained pending reconciliation. Provider selection, complete pricing (storage/network/boot/shutdown), invoice reconciliation, independent watchdog, authenticated workers and immutable solver image must precede any paid implementation. There is no spending enable switch.

## Next independent development

Add read-only creator-fee receipt reconciliation with program/account/mint/signature/instruction validation. Separately pin and validate a GPU solver/image against these fixtures once a compatible GPU environment is established. Do not enable #71 or payment paths until current target state, compatible algorithm, provider terms/account, budget and prize policy are resolved.

## October 7: T01 versioned allocations
Run npm run allocation-demo for main plus two child fixture budgets; see ALLOCATIONS.md for exact semantics and evidence limits. 27 local tests now pass. Production shares remain unset, receipts are synthetic, and allocations do not enter mock-provider job funding automatically. Next planned task after review is T03.

## BitHash worker and target evidence — October 7
Run `npm run worker-demo` for a separate-process CPU worker on solved fixtures with checkpoint/restart. Run `npm run inspect-target` for a read-only two-explorer #71 funding snapshot (network required). No GPU, provider credentials or live search are enabled. `npm test` now passes 37 tests. See ../B01-TECHNICAL-EVIDENCE.md for the source pin, actual explorer evidence, scope and remaining GPU work.

Runpod lifecycle dry run: see [RUNPOD-DRYRUN.md](RUNPOD-DRYRUN.md). Run npm run provider-demo; full local suite now has 45 passing tests. No live rental or GPU execution.

October 11: authenticated CPU-fixture receipt service and loopback demo added. Run npm run receipt-demo; see WORKER-RECEIPTS.md. 53 backend tests pass. This adds local HTTP/signing for fixture evidence, not a production treasury signer or GPU provider. Earlier baseline descriptions above are historical.

# Operator upgrade — October 13, 2026

The Operator now checks a live Runpod Secure Cloud quote and drafts one bounded RTX A5000 known-answer benchmark proposal, or holds. The server retains the quote, allowed option, model choice, response ID and reason in approval-bound terms. Google owner approval remains the only approval step used by the application. The public dashboard is read-only and password-gated.

The current live capacity check returned A5000 NONE at 09:24:18 UTC, with a catalog compute price of USD0.27/hour. The system held before model inference and created no rental or replacement proposal. This is a dated availability observation, not a capacity reservation. New real AI option selection has fixture validation; a live model selection awaits available A5000 capacity.

## Implemented

- One GPU maximum, 5–15 minute rental limits and USD0.01–1.00 caps; no silent GPU substitution. Human approval binds the freshly quoted deployment and runtime.
- Durable planning tickets and saved choices reconcile uncertain proposal responses. Concurrent duplicate submissions create one proposal; model holds cannot be replaced by a racing spending choice. No automatic approval, wallet signer or provider top-up.
- Activity reporter retries temporary timeout/network/408/429/5xx failures after 1, 2 and 4 minutes, then returns to 15-minute cadence. Authentication and malformed-output failures do not rapidly retry. Attempts and retry state persist and count toward the existing rolling 96/day request limit. Cached publication failures no longer block new inference; cached records rotate in batches of eight.
- Fixed bootstrap uploads signed, bounded structured benchmark results before completion. Server validates the exact known-answer vector fields, counters, signature and enrollment binding, and stores the immutable envelope in SQLite. Conflicting uploads fail. Archives survive restart/deletion and link from proposals and each GPU record. Only whitelisted synthetic results are uploaded, not environment variables, arbitrary stderr or credentials.
- Archive upload attempts are bounded; failure never disables deadline shutdown. Missing archives remain explicitly missing. Prior runs cannot retroactively acquire raw results that were deleted.

## Validation and deployment

28 planning/retry/archive tests, 25 existing worker/approval/stream tests and 52 hosted dashboard tests passed. The final public release subset (including worker tests) passed 41 tests. Eighteen executor fixture tests also passed on the Linux server. The executor and local Operator were upgraded; shutdown/collector services and approval policy were preserved. Sites version24 was published and the public capacity-hold panel was checked in the browser.

No new GPU rental, payment or approval occurred. The new archive upload has not yet been exercised by a real rented worker. The already completed two owner-approved real rental flows and five-minute GPU/Operator test remain separate historical evidence. This worker repeats small public synthetic cases; it does not search Puzzle71 or establish unique coverage. Final billing reconciliation remains pending.

## Reproduction

From the repository root:

```sh
node --experimental-sqlite --test ops/live-executor/executor.test.mjs local/operator-live.test.js local/gpu-activity.test.js gpu/worker/core.test.mjs
cd dashboard
node --test
```

Public SSH adapters use YOUR_COLLECTOR_HOST rather than the private operational host value. Supply deployment-specific configuration outside the repository. Provider keys, reporting keys, account sessions and databases are never part of the release. Existing Node/Linux/CUDA artifact setup is described in gpu/worker/README.md and ops/live-executor/README.md.

The dated machine-readable validation record is experiments/evidence/2026-10-13-operator-upgrade.json. Its development-source hashes identify local source; the public tree manifest records sanitized public source. The bootstrap's original worker package remains digest pinned; the archive feature changes bootstrap/executor behavior without replacing the CUDA solver.

## Remaining

Fresh owner-approved A5000 acceptance of real AI selection and signed result upload; persistent raw artifact retention quotas and backups; final invoice reconciliation; actual Puzzle71 range workers; 5–10GPU rollout; restricted SSH capabilities; treasury custody/conversion/top-up execution. The Operator currently drafts on owner request, not by an unattended autonomous rental-planning schedule.

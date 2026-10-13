# Coverage-aware scheduling — October 12, 2026

Implemented locally in `coverage.js`, `controller.js`, and the read-only dashboard API. Exact external range imports influence preference, never completed-work credit or permanent exclusions. No live external feed is connected. The pool's aggregate percentage has NOT been converted into fictional intervals.

## Scheduling and evidence

- `Controller.planNextFixture(id, fixtureId, size, cap, now)` selects the first unallocated, externally unreported interval in numeric order, capped at `size`. Intervals may be shorter when a reported boundary splits them. When only externally reported intervals remain, it falls back to those intervals.
- Selection, synthetic budget reservation, and a persisted selection audit share a SQLite write transaction. Multiple processes cannot allocate the same range. Replaying the same job/request returns its original selection, even after reports change. Manual `plan()` remains available for explicit fixture ranges and enforces the same overlap/budget checks.
- Every existing job allocation is blocked from new allocation. Checkpointed work is counted separately. Unfinished jobs resume through existing job/lease/checkpoint APIs, never through a second overlapping allocation. This change does not add cancellation/reclamation for abandoned jobs.
- `previewCoverageRange(db, targetId, size, now)` is a read-only plan, not a lease. #71 supports preview and import only; execution remains restricted to solved fixtures 1–3 and the existing mock provider. Source changes do not cancel already allocated jobs.
- `/api/status` now includes aggregate `coverage.targets`: external reported candidates, own allocated candidates, own checkpointed candidates, active/inactive snapshot counts, evidence labels and dispatch/feed state. Counts use interval unions so overlaps are not counted twice. External and own counts may overlap; do not add them together as unique progress. Source URLs/import identifiers and individual ranges are not published by this projection. Hosted frontend rendering is unchanged.

Reports are unauthenticated claims from a recorded source. The stored SHA-256 establishes local payload consistency, not source honesty, exhaustive search, or cryptographic proof of work. Even our own checkpoints are not a universal proof that a remote worker honestly checked every candidate.

## Import contract

`CoverageLedger.importSnapshot(input, now)` accepts ONLY these fields:

```json
{
  "schema": "bithash.external-coverage.v1",
  "id": "example-fixture-snapshot",
  "targetId": "puzzle-3",
  "targetVersion": 1,
  "sourceUrl": "https://example.org/pool-a",
  "observedAt": 100,
  "expiresAt": 1000,
  "intervals": [{ "start": "4", "end": "6" }]
}
```

This is a synthetic fixture example, not real pool coverage. Times are Unix milliseconds; CLI imports need current timestamps. Maximum lifetime is 30 days, with future observations and already expired new imports rejected. Expiry removes scheduling preference, but retains history. The importer does not fetch the URL.

All ranges are half-open `[start,end)`, using canonical unsigned decimal strings, exact BigInt arithmetic and fixed target-version bounds. Convert an inclusive external end by adding one exactly BEFORE import, after checking source semantics. Never infer endpoints from percentage, prefix display or rounded pool range size. #71 v1 bounds are `[1180591620717411303424,2361183241434822606848)`; this record does not activate search.

Input has at most 10,000 intervals per snapshot; the CLI file limit is 2 MB. These are bounded initial importer limits, not a claim that a complete large-pool export fits. A complete feed adapter/sharded storage is future work if a source exceeds them. Adjacent and overlapping intervals are normalized to a union. Unknown fields, arbitrary targets, imprecise numbers, inverted/out-of-bounds ranges, credential-bearing URLs and aggregate-only imports are rejected atomically.

Each source URL/target pair has one current snapshot. A newer snapshot REPLACES that source's entire previous snapshot; it is not a delta. An empty newer snapshot retracts all its ranges. Different source URLs coexist. Use a stable canonical public HTTPS URL without query strings/fragments; source authenticity and URL identity require operator review. IDs cannot be reused with changed normalized content. Superseded or withdrawn snapshots never reactivate on replay. Older/equal-time replacement snapshots are rejected.

## Local administration

From `local/`, using a chosen controller database:

```powershell
node --experimental-sqlite coverage-cli.js work/coverage.sqlite import work/exact-range-snapshot.json
node --experimental-sqlite coverage-cli.js work/coverage.sqlite summary puzzle-71
node --experimental-sqlite coverage-cli.js work/coverage.sqlite preview puzzle-71 1000000
node --experimental-sqlite coverage-cli.js work/coverage.sqlite audit puzzle-71
node --experimental-sqlite coverage-cli.js work/coverage.sqlite withdraw SNAPSHOT_ID
node --experimental-sqlite coverage-demo.js
```

Import/withdraw are local administrative operations, not public HTTP endpoints. Audit includes normalized payload, source, observation/import/expiry/withdrawal timestamps, state and digest. Expiration is evaluated when scheduling/reading; an expired record may still have stored state `active` until replaced, while contributing zero active coverage.

## Validation and remaining integration

Ten new tests cover exact #71 bounds, scattered/overlapping claims, all 16 tiny coverage patterns, fallback, expiry, withdrawal/replacement, replay, invalid-input rollback, budget rollback, restart persistence, concurrent processes, and dashboard evidence separation. Full suite: **63/63 passing** on October 12; localhost HTTP tests require execution outside the network sandbox in this environment.

Next: obtain and inspect an exact public range export/API and its inclusive/exclusive conventions before building a source adapter. No real pool interval map has been imported. Then connect this scheduling policy to the future authenticated GPU job lifecycle. This implementation makes no provider purchase, credits no #71 search work, and does not change the accepted single-token economics.

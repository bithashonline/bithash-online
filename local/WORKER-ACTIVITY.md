# Signed worker activity

Implemented locally October 12, 2026. No remote deployment or GPU rental.

`POST /api/worker/activity` accepts Ed25519-signed activity envelopes through the existing development worker server. Enrollment reuses `WorkerReceipts.enroll`: the public key is bound to a job, lease epoch, provider and build digest. Activity accepts only the current running, unexpired lease. It never renews that lease, advances a checkpoint, credits work or authorizes spending.

`signWorkerActivity` signs the strict `bithash.worker-activity.v1` payload. Fields are `job`, `epoch`, `provider`, `build`, positive monotonically increasing `sequence`, `state` (idle/computing/error), `device` (cpu-fixture/rtx-a5000/rtx-4090/rtx-5090/other), nullable integer `utilizationPercent` (0–100) and nullable decimal-string `candidatesPerSecond` (up to 20 digits). No arbitrary device names, diagnostics or credential-bearing extra fields are accepted. Timing is recorded by the server.

SQLite stores only the latest accepted report for each job and epoch. Same-report retries are acknowledged without refreshing received time. Older sequences, conflicting retries, altered signatures, different enrollment bindings and clock rollback reject. Workers must preserve sequence state across restart or obtain a newly enrolled lease epoch; resetting sequence in the same epoch does not bypass replay protection.

`GET /api/status` adds `fixtures.items[].activity`, exposing freshness, last server receive time and sanitized reported state/device/utilization/rate. Reports become stale after 30 seconds or at lease expiry. Missing current-epoch reports are never-seen; stopped jobs are inactive; a backward projection clock is clock-unknown. Old epochs are not presented as current activity. `live.rigs` remains empty: there is no production fleet attached. Provider identifiers, job identifiers, public keys and signatures are excluded from this projection.

Signatures authenticate the enrolled key holder. They do not verify hardware, true utilization, throughput, loaded software or exhaustive search. All metrics are labeled `authenticated-worker-claim`; hardware verification is false. Current CPU receipt validation remains independent. Billing and actual GPU receipts are not implemented by this change.

Tests: `node --experimental-sqlite --test` from `local/` passed 68/68 with loopback HTTP enabled, including five new activity tests covering persistence, replay, freshness, lease fencing, payload validation, privacy and real HTTP ingestion. Initial restricted-environment run exposed a stopped-job projection issue (fixed) and blocked loopback HTTP (rerun with access). No hosted frontend changes, paid compute, treasury access or provider calls occur in these tests.

Remote deployment still requires TLS, rate/connection limits, key provisioning/revocation, supervised runtime, a worker-side sender, GPU protocol integration and frontend rendering. Latest-only storage is operational telemetry, not an immutable historical audit.

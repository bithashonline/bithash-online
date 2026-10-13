# Authenticated fixture receipts

Implemented October 11, 2026. Local development transport; no deployed service or paid provider integration.

`npm run receipt-demo` executes the existing solved-fixture CPU subprocess, signs its result with an ephemeral Ed25519 key, submits it over loopback HTTP, closes and reopens the server/database, and resubmits the same receipt. The first submission advances the checkpoint; the retry returns the same receipt ID without advancing again. Each run creates a new SQLite database beneath local/work/. No private key is saved. The demo harness signs the subprocess result; it is not an independent remote worker or hardware attestation.

`WorkerReceipts.enroll` binds an operator-provided public key and expected build digest to a job's assigned provider ID and lease epoch. Enrollment is immutable and has no HTTP route. `POST /api/worker/receipts` accepts only a strict signed schema with a solved-fixture request and CPU result. It rejects unknown fields, invalid signatures, wrong provider/build, stale or replaced leases, gaps and conflicting retries. A known committed receipt can be acknowledged after expiry without creating new work or refreshing the lease.

Receipt persistence, checkpoint insertion and progress update share one SQLite transaction. A failed write rolls back all three. The service independently reproduces the tiny solved fixture's match outcome. This does not authenticate reported elapsed time, physical GPU hardware, loaded binary identity, or exhaustive search. The build digest is an enrolled and signed assertion, not measured boot.

`createWorkerServer` provides the receipt route and existing read-only `/api/status`; callers control its bind address. The demo and tests bind only 127.0.0.1. Bodies are capped at 8 KiB, HTTP timeouts are bounded, compressed bodies are rejected, and errors do not echo submitted content. The status projection exposes authenticated receipt counts and explicit CPU-fixture evidence labels without keys, signatures, raw job IDs or provider IDs. Live rigs remain empty and GPU verification remains false.

Before remote deployment: add TLS, ingress rate/connection limits, trusted key provisioning and revocation, runtime supervision, and validated GPU protocol/build integration. Worker signatures authenticate a key holder, not truthful execution. Existing in-process fixture controller methods remain trusted local APIs; this endpoint is not a security boundary against code with database access.

Validation: 53 backend tests pass on Node 22.16.0, including six new receipt scenarios and an actual subprocess-to-HTTP-to-SQLite-to-status check. The full suite requires loopback network access. No token, payment, rental, model call or public release occurred.

# EXP-008 — signed worker activity (local)

Purpose: expose worker responsiveness and claimed device metrics separately from accepted search work, without depending on GPU supply.

Result: 68/68 backend tests passed, including five new activity scenarios. Real loopback HTTP ingestion and SQLite restart exercised. No GPU rented; USD0 spent. TensorDock onboarding/trial abandoned at user request.

Implementation and reproduction: `local/WORKER-ACTIVITY.md`, `local/worker-activity.js`, `local/worker-activity.test.js`, with integration in `local/worker-api.js` and `local/dashboard-api.js`. Run `node --experimental-sqlite --test` in `local/` with loopback networking allowed.

Failure retained: first focused run passed11/14; one stopped-job projection expectation failed because stop rotates the lease epoch, and two HTTP cases lacked loopback access. Missing activity for stopped jobs now projects inactive; complete suite rerun with loopback access passed68/68.

Limits: only local fixtures and synthetic telemetry. No physical GPU, provider billing, remote attestation, on-chain funding, production fleet or hosted frontend validation. A signed claim does not establish exhaustive search. Live deployment and GPU receipts remain unfinished.

Publication state: local source and experiment record only. Existing backend dependencies include unpublished work; this document is not a claim that a reproducible matching release is on GitHub. A complete source/history review is required before publishing that backend bundle.

# Owner-approved real GPU executor

Implemented October 13, 2026. One real Runpod Secure Cloud GPU per approved run, initially limited to 5–15 minutes and at most USD 1 per proposal. This is a staged **synthetic known-answer benchmark executor**, not a production Puzzle #71 range scanner. The first paid automatic acceptance remains pending until separately approved.

## Flow

1. Owner console requests a current catalog quote. Server fixes model, one GPU, disposable 20 GB disk, pinned container digest, worker/build hashes, bootstrap hash, expiry, duration and USD ceiling in an immutable proposal digest.
2. Google-owner session, CSRF and origin checks approve the exact digest through pinned SSH to a root-only Unix socket. Public routes cannot propose, approve or cancel. Approval authenticates the owner to the backend; the event is not an independently signed wallet approval.
3. Always-on server verifies watchdog/collector readiness, complete account inventory and a fresh price/availability observation. Initial rollout rejects any existing account Pod or unresolved executor request.
4. SQLite FULL/WAL commits the creation intent and absolute deadline **before** the single provider POST. Timeouts and 5xx never cause a second POST. Reconciliation traverses all inventory pages and matches the name, unique private capability, GPU, cloud, image and disposable storage. Empty inventory is not treated as proof of rejection. Explicit documented 4xx rejection releases the proposal; uncertain outcomes hold the slot for operator investigation.
5. Persist returned Pod ID, register the existing independent shutdown controller, then let that Pod enroll its locally generated Ed25519 reporting public key. The GPU receives only a run-scoped, expiring bootstrap capability. Runpod account and treasury credentials never enter the container.
6. Fixed Python bootstrap downloads hash-pinned Node and the previously GPU-tested worker archive, then runs the fixed validation and benchmark. An exclusive marker rejects container replay. The worker sends signed telemetry to the existing collector, which feeds the fleet, GPU detail pages and local AI reporter.
7. A signed completion claim triggers targeted early shutdown. Missing enrollment after five minutes also requests shutdown. Independent watchdog enforces the absolute deadline with 90 seconds of headroom even when the laptop or executor process is offline. Provider absence is recorded separately from stop/delete requests. Final invoice remains explicitly pending.

## Deployment and interfaces

`bithash-executor.service` runs on the external control server; it loads the already-authorized Runpod credential through systemd credentials. State is root-only under `/var/lib/bithash-executor`. The process currently runs as root to call the existing service-user enrollment/registration CLIs; a dedicated restricted broker remains future hardening.

`control.mjs` accepts bounded JSON on stdin over pinned SSH and calls `/run/bithash-executor/control.sock`, mode0600. Commands: `status`, `propose`, `approve`, `cancel`. Cancellation only applies before dispatch. `local/live-executor-api.js` connects these commands to owner-authenticated local routes. Do not expose the control socket over HTTP.

Public-site proxy exposes only `GET /api/executor/status` and `/api/executor/proof/<sha256>`, using the existing server-side read bearer and preview password wall. Nginx separately exposes the fixed public worker artifact and the capability-authenticated enrollment/completion routes. Unknown routes, query strings and wrong methods are rejected. Access logs are disabled by the existing telemetry vhost.

The collector and shutdown services remain independent of the executor. Existing registered GPU records automatically appear in the fleet and signed report views. AI report generation still requires the laptop to be running; raw logging, executor operation and shutdown do not.

## Evidence and limits

- Event hashes and their chain detect changes relative to a retained copy; they do not independently attest the server or provider. Worker signatures authenticate claims, not exhaustive search coverage.
- No treasury funds or synthetic credits authorize rentals. Runs consume existing Runpod account credit. V2 catalog/billing interfaces used here do not establish a current prepaid balance; an insufficient-balance rejection is surfaced, never automatically topped up.
- Price envelope: observed compute rate plus 5% and USD0.01/hour storage allowance. This is an operational shutdown budget, **not a provider-enforced hard financial cap**. Provider/network outages, host loss or delayed billing can exceed it. No automatic invoice settlement, restart of failed workers, GPU fallback, or deadline extensions.
- One external host remains a failure domain. A crash after creation but before registration is recovered by the executor's durable intent; permanent host failure can strand the rental. Clock rollback blocks executor dispatch/reconciliation until corrected; already registered leases remain protected by the watchdog's rollback handling. Add an independent recovery host before broad unattended scale.
- Only one real run at a time for the first acceptance; 5–10-GPU operations, production range partitioning and treasury signing are not enabled.

## Tests

`node --experimental-sqlite --test ops/live-executor/*.test.mjs ops/runpod-shutdown/*.test.mjs local/live-executor-api.test.js`

42 passing tests on Windows with loopback access; 12 executor fixtures also pass on the actual Linux server. Hosted dashboard has 50 passing tests including read-only route enforcement and proof digest validation. These fixtures do not rent hardware. Bootstrap passes Python compilation; pinned image metadata confirms Python availability. The exact rebuilt worker archive matches the prior successful RTX4090 integration: SHA256 `598d0d4acf2b22139e2968eafd610a9912465abdb60a42660c8dda86eea5da63`, manifest build `sha256:17e6a74ec89099ef934493871b380ae52fac22a67611b667849f132ab8b4021b`.

Pending: one separately approved live end-to-end acceptance, including actual container command handling, download/enrollment, signed GPU reports, early deletion, public visibility and subsequent billing read. Do not label this new automatic flow GPU-verified until that acceptance is recorded.

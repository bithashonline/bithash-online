# Runpod lifecycle dry run

Implemented October 7, 2026. Run `npm run provider-demo` from this directory with Node 22.16+. Run `npm test` for the full local suite (45 passing tests).

This is a local SQLite provider simulator plus a Runpod request preview. It has no network transport, API key, real pod, bill or GPU execution. The preview image digest is a deliberately nonexistent placeholder. A digest-shaped string does not establish image availability or trust.

The demo reserves synthetic micro-USD, persists an immutable request, simulates an accepted creation followed by a timeout, closes/reopens the controller, reconciles one simulated instance, runs two bounded CPU fixture chunks across another restart, terminates the simulated instance and settles a synthetic invoice. It ends with 88 available, zero reserved and 12 expense from 100 synthetic units. Its timestamps use an explicitly simulated clock.

An ambiguous creation remains `unknown` with its budget reserved. Re-submission is blocked, including when the simulated provider returns no matching instance. Termination fences worker epochs but does not release the reservation; settlement does that. Intent digests detect conflicting requests and mismatched simulated evidence. This does not establish Runpod server-side idempotency or name uniqueness.

The read-only `/api/status` projection now includes up to 100 fixture job records: hashed IDs, lifecycle state, exact checkpoint counts as decimal strings, and lease freshness. Live rigs remain empty and `gpuVerified` is false. Checkpoints alone would not prove exhaustive work by an untrusted remote worker. The existing local frontend API connection can consume this additive v1 response; the hosted frontend has no deployed backend and its presentation was not changed in this work.

Request fields were checked against the official [create pod](https://docs.runpod.io/api-reference/pods/POST/pods) and [list pods](https://docs.runpod.io/api-reference/pods/GET/pods) documentation. Actual availability, pricing, image pull, outbound connectivity and API acceptance are untested.

Next work: build and validate a digest-pinned CUDA worker against solved fixtures, then add authenticated remote evidence ingestion and a real provider transport with independent request/response reconciliation. Live execution still needs account connection, provider workload acceptance, a current quote and spending authorization. Current code is not a production scheduler, fleet autoscaler, live fee router or connected AI operator.

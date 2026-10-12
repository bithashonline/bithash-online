# External Runpod shutdown controller

Status: implemented and locally tested. **Not deployed or live-provider validated.** EXP-006's in-Pod stop request returned HTTP403; its root cause remains unknown. This controller uses an independently supplied credential on a separate host. It does not magically fix an unauthorized credential or make Runpod outages harmless.

## What it does

- Registers an immutable Pod ID, exact BitHash name, original billing start, absolute deadline, total hourly cost ceiling and per-Pod spending allowance in SQLite (WAL / FULL synchronization).
- Calculates the earlier of the time limit and `start + budget / hourly ceiling`, then starts shutdown 60–300 seconds early. Arithmetic uses integer USD millionths. Restart never grants a new allowance or deadline. Maximum lease lifetime is 30 minutes.
- Polls every five seconds, with at most five seconds per request. It saves shutdown intent before a request, retries failures and reconciles ambiguous outcomes after restart. Clock rollback, an observed rate over the ceiling, or operator stop also latches shutdown.
- Only sends GET Pod, POST stop and explicitly authorized DELETE Pod to the fixed Runpod HTTPS origin. It cannot create or restart Pods, top up credit or create credentials. Redirects are rejected. No operation targets an unregistered Pod; a matching ID/name must be observed before mutation.
- Can still request stop when a later status GET fails, if identity was previously checked. A mismatch revokes that verification. Deletion always needs a fresh identity check, explicit disposable-Pod authorization, zero persistent volume and explicitly absent network storage. Missing storage metadata blocks deletion.
- Keeps request acceptance, provider **expected** stopped status, and subsequent GET404 observation separate. None claims an invoice is reconciled. Stop-only registrations remain monitored for unexpected resumes; absence observations end monitoring of that ID.

The allowance is an **estimated shutdown threshold, not a provider-enforced billing cap**. It depends on a conservative total rate, correct original start time, API availability and an awake controller. Price increases, provider outages or a sleeping host can overrun it. Storage may continue billing after stop; only authorized disposal plus billing reconciliation resolves that exposure. There is no create-path admission gate, fleet-wide financial reservation, orphan discovery, external alert delivery or automatic fee funding in this component. `permitsNewRental` stays false.

## Run locally

Node22.16+ is required; no third-party dependencies. From the repository root:

```sh
node --experimental-sqlite --test ops/runpod-shutdown/cli.test.mjs ops/runpod-shutdown/controller.test.mjs ops/runpod-shutdown/provider.test.mjs
node --experimental-sqlite ops/runpod-shutdown/demo.mjs
```

Tests use injected fixture transports and a loopback server. The demo simulates an HTTP403 stop failure, controller restart, authorized deletion and confirmed absence. It does not contact Runpod or spend money. On an environment that blocks localhost sockets, run the tests with loopback permitted; do not mislabel that restriction as a successful network test.

## Operator setup for a future authorized live check

1. Run on a separate always-on host under a process supervisor; keep its SQLite directory private and durable. Never run this on the worker being shut down. The CLI rejects a Runpod Pod environment. Host deployment/supervision has not been configured in this experiment. A desktop or chat session alone is not an independent always-on safeguard.
2. Inject an appropriately restricted account/controller credential as `BITHASH_RUNPOD_CONTROLLER_KEY` through the host's secret mechanism. Do not put it in source, a lease, CLI arguments, browser code, the GPU environment or public logs. The existing Pod-scoped `RUNPOD_API_KEY` is deliberately not reused. Required operations are Pod read/stop and, only for disposal tests, delete; actual Runpod permission granularity must be verified. A successful GET proves read access only.
3. Prepare a private lease from [example-lease.json](example-lease.json). Use the exact allocated Pod ID/name and a start at or **before** actual paid allocation; use an audited earlier start for an existing Pod. Never use controller startup as a fresh billing origin. The example ID/dates are fixtures. Include storage and mandatory charges in the hourly ceiling. Register immediately after a separately authorized allocation and verify identity before worker startup; automated allocation/admission remains unimplemented.
4. Keep `deleteDisposablePod: false` unless deletion of that disposable Pod and its temporary data is explicitly authorized. True permits deletion even if stop was rejected or timed out. Collect anything needed from temporary disk before the deadline; the controller will not wait for evidence retrieval. Persistent or unknown storage is never automatically deleted.
5. Register, check, then supervise the watcher. `check` performs a real controller pass and **can stop/delete a due registration**. `status` is offline. Commands below assume the environment credential has already been securely supplied:

```sh
node --experimental-sqlite ops/runpod-shutdown/cli.mjs register work/shutdown/state.sqlite work/shutdown/lease.json
node --experimental-sqlite ops/runpod-shutdown/cli.mjs status work/shutdown/state.sqlite
node --experimental-sqlite ops/runpod-shutdown/cli.mjs check work/shutdown/state.sqlite
node --experimental-sqlite ops/runpod-shutdown/cli.mjs watch work/shutdown/state.sqlite
# Manual latched kill switch for registered Pods only:
node --experimental-sqlite ops/runpod-shutdown/cli.mjs stop-all work/shutdown/state.sqlite
```

SIGINT/SIGTERM latch stop and attempt a bounded final reconciliation; a hard process kill requires a supervisor restart. Run one watcher per database; stop/delete requests are designed for retry, but duplicate watchers are not a high-availability deployment. At most eight active registrations are admitted and independent Pods are polled concurrently. Logs and SQLite expose only selected control facts, never raw API bodies or credentials. Protect the database from untrusted edits; it is operational state, not a cryptographic authorization mechanism.

## Live acceptance still required

Provision a separate controller credential, verify GET and mutation access on one explicitly authorized disposable rental, then exercise the deadline and a controller restart. Confirm provider audit stop/delete events, no remaining allocation/storage liability, and final billing. Keep console access available during this canary. Permission failures remain errors and must not be treated as shutdown success. **No such rental or secret setup was performed by the local tests.**

Official references checked October12,2026: [stop](https://docs.runpod.io/api-reference/pods/POST/pods/podId/stop), [get](https://docs.runpod.io/api-reference/pods/GET/pods/podId), [delete](https://docs.runpod.io/api-reference/pods/DELETE/pods/podId), [credential permissions](https://docs.runpod.io/get-started/credentials), [Pod-provided variables](https://docs.runpod.io/pods/templates/environment-variables), [Pod lifecycle](https://docs.runpod.io/pods/manage-pods). The GET field `desiredStatus` is an expected state, not a settled billing receipt.

# EXP-007 — external shutdown controller and failure recovery

**Implemented and tested locally: 25/25 tests passed. Not deployed or validated against live Runpod. USD0 spent.** This replaces reliance on EXP-006's in-Pod helper with a separately runnable controller; it does not establish that the original HTTP403 is resolved for any real credential.

The controller persists each registered Pod's identity, absolute deadline, conservative hourly rate and per-Pod allowance. Shutdown starts before the earlier time/budget threshold. Restart preserves the original limits and pending intent. It retries ambiguous or rejected requests, verifies provider observations, refuses mismatched identities and protects persistent/unknown storage. Its API transport has read, stop and explicitly authorized disposable-Pod deletion only; no rental creation, resume, credit purchase or key-management path.

Source and setup: [ops/runpod-shutdown](../ops/runpod-shutdown/README.md). No dependencies beyond Node22.16+ and its SQLite module. Source is published alongside the evidence; unrelated local backend work is excluded.

## Captured evidence

Final run: October12,2026,08:22:03–08:22:05UTC, Nodev22.16.0 on Windows.

- [Result and exact test counts](runs/2026-10-12T08-22-03-799Z-shutdown/result.json).
- [Full test transcript](runs/2026-10-12T08-22-03-799Z-shutdown/test-output.txt).
- [SHA256 source manifest](runs/2026-10-12T08-22-03-799Z-shutdown/source-manifest.json).
- [Simulated HTTP403 → restart → delete → absence demonstration](runs/2026-10-12T08-22-03-799Z-shutdown/demo.json).

The tests exercise integer budget math, immutable deadlines, future-start rejection, stop acceptance without confirmed state, repeated403s, timeout after accepted deletion, status-read failures, identity changes, unknown/persistent storage, unexpected resume, rate overruns, clock rollback, operator stop, secret-safe error handling and CLI credential/host checks. A real subprocess exits after its simulated provider accepts stop; the parent reopens SQLite and completes disposal/absence reconciliation. A real loopback HTTP server exercises the request adapter and timeout behavior. Neither contacts Runpod.

During development, the first sandboxed run passed21/22 tests; its loopback test failed because local network access was restricted. Rerunning with loopback access passed22/22. Three additional checks and stricter storage/identity handling produced the final25/25 result. No failed real provider request was made in EXP-007; EXP-006's real403 remains documented separately.

Reproduce from the repository root:

```sh
node --experimental-sqlite --test ops/runpod-shutdown/cli.test.mjs ops/runpod-shutdown/controller.test.mjs ops/runpod-shutdown/provider.test.mjs
node --experimental-sqlite ops/runpod-shutdown/demo.mjs
node experiments/verify-shutdown-run.mjs experiments/runs/2026-10-12T08-22-03-799Z-shutdown
```

`node experiments/record-shutdown-run.mjs` captures a fresh local run. Verification checks matching source and transcript/demo hashes; it does not attest remote execution.

## Limits and live acceptance

Runpod describes `desiredStatus` as an expected state. A successful stop response therefore remains distinct from an observed stopped expectation, a later GET404 and billing reconciliation. The implementation never marks a bill settled or authorizes a new rental. Source: [Runpod GET Pod reference](https://docs.runpod.io/api-reference/pods/GET/pods/podId).

The controller must run on a separate awake, supervised host with a controller credential. No such host/service or credential was configured here. No Runpod tool is exposed in this chat and no controller key is present in the process environment. Existing OAuth connection records do not prove this standalone process has Pod mutation access. The old Pod-scoped key is deliberately not reused; see [Runpod credential guidance](https://docs.runpod.io/get-started/credentials) and [Pod-provided variables](https://docs.runpod.io/pods/templates/environment-variables).

Time/cost cutoffs are conservative operational thresholds, not provider-enforced financial caps. They cannot guarantee a limit during an API outage, machine sleep or bad rate/start input. Stop-only operation can leave storage costs. Deletion requires explicit disposable-data authorization and fresh storage checks. Fleet-wide accounting/admission, orphan discovery, externally delivered alarms and production process supervision remain unfinished.

Next acceptance test: securely supply a controller credential with the required Pod operations, use one separately approved disposable A5000 rental with a proposed USD0.10 /10minute ceiling, force a short shutdown deadline, interrupt/restart the controller, and reconcile provider audit, deletion and final billing. This is a proposal, not a rental or access grant already performed. Keep console access available while validating it.

# Supervised GPU reporting acceptance package

Local integration prepared October 13, 2026. This is the next **synthetic GPU acceptance test**, not a production puzzle #71 scanner. No new GPU validation or provider rental is implied by the package build.

The package combines the unchanged CUDA binary previously tested on A5000, 4090 and 5090 with a Node 22 supervisor and the existing signed collector client. It runs the fixed `small validate` case followed by `small benchmark`. There is no arbitrary target, address, range or command input. Benchmark profiles overlap and do not count as unique coverage. The upstream pinned source and build instructions remain in `gpu/comparison`.

## Build without renting

From the repository root, with Node 22 and tar installed:

```sh
node gpu/worker/package.mjs experiments/artifacts/bithash-comparison-package.tar.gz NEW_OUTPUT_DIRECTORY
node --experimental-sqlite --test gpu/worker/core.test.mjs
```

The builder pins the original archive hash, verifies selected runtime files, and creates a new allowlisted directory, manifest and `.tar.gz`. It excludes the historical ineffective own-Pod watchdog, provider credentials, previous run data and signing keys. Its output `build` is the SHA256 of the exact manifest bytes, **not an OCI image digest**. Runtime files are verified before scanning; the operator must bind the build value to the reviewed package and collector enrollment. A manifest cannot attest honest execution on an untrusted host.

## Before a separately authorized live test

Use a compatible Linux x86-64 Ubuntu 24.04 GPU environment with a driver supporting the bundled CUDA 12.4 runtime. Node >=22.16 must already be installed; no network installation occurs at worker startup. This is a transferable runtime bundle, not a published container image. Exactly one exposed GPU must match `a5000`, `3090`, `4090` or `5090`. Native SM86/89 and forward-compatible PTX are retained; no new optimization is claimed.

1. Create and verify an independently hosted shutdown-controller lease for the approved provider Pod. Its deadline must bound the rental. The worker cannot stop provider billing.
2. On the trusted operator machine, generate a fresh Ed25519 worker key and immutable collector enrollment. Match its provider Pod ID and manifest `build`. Set telemetry expiry no later than the shutdown deadline. Never copy provider, treasury or model keys to the worker.
3. Transfer only the worker key, trusted public collector certificate and private config over the authenticated provisioning channel. File modes: key/config `0600`, state directory `0700`. Keep these outside the package and public source.
4. Start `node /opt/bithash-worker/worker.mjs /private/worker-config.json`. Do not expose the config through provider environment variables or command-line JSON.

Private config fields (fill on the provisioner; never commit real config):

```json
{
  "origin": "https://collector.example.invalid:8443",
  "caFile": "/private/collector-ca.pem",
  "keyFile": "/private/worker-key.pem",
  "lease": "00000000000000000000000000000000",
  "expiresAt": 0,
  "build": "sha256:REPLACE_WITH_REVIEWED_MANIFEST_SHA256",
  "gpu": "a5000",
  "durationSeconds": 600,
  "stateDir": "/private/worker-state"
}
```

The placeholder config deliberately cannot run. Maximum requested runtime is 900 seconds; effective runtime is also bounded by enrollment expiry and a monotonic timer. SIGTERM/SIGINT, sample failures, reporting failures, malformed output, deadline or scanner failure abort the child. An exclusive lease marker blocks concurrent execution and restart with reset counters. Use a new enrollment for another run, retaining the old state; crash recovery/resume is not implemented. The external shutdown controller remains essential if the supervisor crashes or the host hangs.

## Counters and evidence

Every ten seconds the supervisor samples host-reported utilization and sends an Ed25519 report directly to the TLS collector. The scanner gets a minimal environment without provider or signing credentials. Reports do not extend the rental or enrollment.

Candidate counts advance **only after a whole case completes and passes schema, expected count, boundary-match and timing checks**. During a running case speed is null and the count stays at the last completed case; no interpolation is used. A completed case's displayed speed is its scan average, not instantaneous throughput. If interrupted, partial work is not credited. Both cases scan synthetic overlapping ranges; puzzle #71 work remains zero.

Local lease state includes atomically replaced `metrics.json`, completed `cases.json`, durable sequence, latest receipt digest and final `result.json`. Only fixed normalized results are retained; raw child output/errors are never logged. An error without fresh collector delivery should become stale on the dashboard; it must not be shown as current progress. Collector acceptance receipt digest must match the signed payload. Existing proof links expose the signed envelope, enrollment key and server receipt time. These establish authenticated claims, not independently verified GPU hardware or exhaustive search.

Live acceptance still required: observe actual compute and multiple signed reports, open the dashboard proof links, independently verify signatures and matching build, interrupt the worker to verify stale/error behavior, and confirm external shutdown plus provider absence and eventual invoice. Keep these results distinct from local fixture tests. No paid test, image push or deployment is performed by these scripts.

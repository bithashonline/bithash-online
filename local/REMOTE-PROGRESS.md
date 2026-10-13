# Hosted GPU reporting and dashboard

Implemented and deployed October12,2026. The collector accepts signed telemetry over TLS and the local dashboard proxies read-only snapshots/proofs using an explicitly trusted server certificate. This is separate from compute dispatch, spending approvals and verified search coverage.

## Components

- `gpu-telemetry.js`: immutable operator enrollment, Ed25519 authentication, expiry/revocation, monotonic sequence/counter checks, SQLite report history and proof projection.
- `worker-api.js`: `/api/worker/gpu-progress` POST, `/api/gpu-progress` GET, `/api/gpu-proof/<sha256>` GET. Remote TLS mode exposes only these routes. Existing fixture APIs remain available only in development HTTP mode. Eight-KiB request bodies, ten-second request/header timeouts,32connections and50requests/second global limit.
- `collector-client.js`: HTTPS client with explicit CA and hostname verification; five-second timeout, bounded262144byte response, redirects rejected by non200 handling. No disabled TLS verification. Local read-only proxy accepts only fixed progress/proof paths.
- `gpu-reporter.js`: Node22 worker sidecar, ten-second reports, one GPU(index0), nvidia-smi utilization, optional scanner metrics file, durable sequence file. Only the worker signing key and public server certificate enter the worker. Provider/treasury/AI credentials do not.
- Dashboard `dashboard/public/remote-progress.mjs`: hosted progress cards, missing/stale/expired/revoked/unavailable states, candidate count and rate explicitly labeled as reports, permanent proof links. Older fixture/approval state remains separate.

## Enrollment / deployment

Generate one Ed25519 keypair per telemetry lease on a trusted provisioning machine. Provision only the public enrollment to the collector. Provision the private worker key only to its worker through private file transfer; do not put it in images, repositories, CLI arguments or provider environment dumps. The public enrollment schema is:

```json
{"id":"32-lowercase-hex-characters","publicKey":"PEM Ed25519 public key","build":"sha256:64-lowercase-hex-characters","providerPodId":"actual-provider-pod-id","kind":"gpu","expiresAt":1791849600000}
```

The example placeholders are not valid enrollment values. `expiresAt` is epoch milliseconds, future and at most24hours from enrollment. IDs bind immutable keys/build/provider references. The operator must verify the Pod identity and use a telemetry expiry no later than its approved shutdown deadline. Enrollment is an operator-only CLI, not an internet endpoint:

```sh
runuser -u bithash-collector -- node --experimental-sqlite /opt/bithash/local/telemetry-enroll.js enroll /var/lib/bithash-collector/state.sqlite PUBLIC_ENROLLMENT.json
runuser -u bithash-collector -- node --experimental-sqlite /opt/bithash/local/telemetry-enroll.js revoke /var/lib/bithash-collector/state.sqlite LEASE_ID
```

Private worker JSON config contains `origin` (HTTPS collector origin), `caFile` (public trusted server certificate), `lease`, `expiresAt`, `kind:"gpu"`, `keyFile`, `sequenceFile`, and optional `metricsFile`. The dashboard uses only origin/caFile through `BITHASH_COLLECTOR_CONFIG`. It never receives the worker signing key.

```sh
node gpu-reporter.js PRIVATE_CONFIG.json watch
```

Run under the worker's supervisor and stop when the lease ends. Do not reset the sequence file in a reused lease. A new epoch requires a new enrollment ID. The sender stores the next sequence before delivery; delivery failures can leave sequence gaps but cannot replay an old report as fresh. No report extends a compute lease.

Scanner integration: atomically write `metricsFile` with `observedAt` (epoch milliseconds), `state` (`idle`, `computing`, `error`), `candidatesPerSecond` and `candidatesChecked` (decimal strings or null). Missing/stale/error samples never invent counters. Counters may include repeated synthetic ranges and must not be presented as unique coverage. Existing CUDA benchmark packages were not modified or rerun by this change; packaging this sidecar and metrics producer into the next GPU worker image remains necessary before a live GPU telemetry acceptance run.

## Evidence

The proof endpoint returns the exact signed normalized payload, signature, public enrollment, domain, SHA256 and server receive time. Verify Ed25519 against `Buffer.from(proof.domain + JSON.stringify(proof.envelope.payload))` and recompute SHA256 of the same bytes. The signature authenticates an enrolled key holder; it does not prove the reported hardware, build execution, timing or exhaustive search. Enrollment metadata is operator supplied; the receive timestamp is collector supplied. Neither is independently signed by Runpod.

## Operations and limits

TLS uses a dedicated self-signed certificate explicitly trusted through pinned SSH distribution. Private key stays root-only and is supplied using systemd credentials. Certificate expires October12,2027; renew and redistribute the public trust material before then. Direct browsers do not trust this certificate by default; dashboard proof links work through its validated backend proxy. Do not bypass browser warnings or disable certificate validation.

Collector is separately supervised on the USD6 host with256MiB memory/40%CPU/1GiB filesystem limits; shutdown retains its independent service, credential and filesystem. One host is not high availability. History preserves up to100,000 records then rejects new reports; at10workers reporting every10seconds this is about27.8hours. Archive/retention and capacity alerts remain required before sustained fleet operation. Latest100enrollments appear in the dashboard. No private keys or arbitrary diagnostic text are accepted into report records.

The dashboard itself remains local; closing this computer stops its UI/AI processes but does not stop a remote enrolled worker from reporting directly to the server. No GPU is presently enrolled. The transport test is explicitly marked `transport-test`, uses null speed/counters and is revoked after verification.

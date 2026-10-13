# BitHash
Public source and evidence for a community-funded attempt at the deliberately public Bitcoin puzzle #71. This release contains working prototypes and bounded tests; it does not establish a production search fleet or a solved puzzle.

## Current release — October 13, 2026
| Component | Observed status | Evidence |
| --- | --- | --- |
| GPU benchmarks | Real synthetic CUDA fixtures; A5000 led the recorded cost comparison | [comparison](experiments/2026-10-12-gpu-comparison.md) |
| Independent shutdown | Real RTX 3090 deadline shutdown, deletion/absence and crash recovery passed; final invoice pending | [live test](experiments/2026-10-12-live-shutdown.md) |
| Hosted reporting | TLS, signed transport, durable history and dashboard proof links passed with a non-GPU test enrollment | [report](experiments/2026-10-12-remote-progress.md), [signed proof](experiments/2026-10-12-remote-telemetry-proof.json) |
| Google approvals | Local sign-in and exact proposal approval implemented and browser-tested | [report](experiments/2026-10-12-google-owner.md) |
| Automatic executor | Approved mock proposals execute and settle in local simulation | [report](experiments/2026-10-12-automatic-mock-executor.md) |
| Dashboard | Local approvals plus hosted fleet, telemetry and cached AI assessment; graphite/amber operator redesign | [local setup](dashboard/README.md), [hosted build](dashboard/HOSTED.md) |
| ChatGPT-plan operator | Owner-triggered read-only inference accepted; cached report sync and online/offline display verified | [setup](local/CHATGPT-OPERATOR.md), [integration evidence](experiments/2026-10-12-hosted-operator.md) |
| GPU reporting acceptance | Real RTX 4090 synthetic run, interruption reports and independent deadline deletion observed | [acceptance](experiments/2026-10-13-hosted-gpu-acceptance.md) |
| Rental status | Read-only registered-Pod inventory joined to signed worker reports | [fleet integration](experiments/2026-10-13-fleet-panel.md) |

The AI explains evidence and suggests reviews; it cannot execute spending. Autonomous treasury transfers, provider top-ups and approval-to-real-provider dispatch are not connected. No #71 search coverage is claimed. Continuous report archival/retention and restricted SSH publishing remain pending. One control host is not high availability.

## Reproduce
Use Node 22.16+ with experimental SQLite:

```sh
npm ci --prefix local --ignore-scripts --no-audit --no-fund
npm --prefix local test
node --experimental-sqlite --test ops/runpod-shutdown/*.test.mjs
npm --prefix dashboard run build
node --test dashboard/*.test.mjs
node experiments/verify-live-evidence.mjs
cd dashboard
node --experimental-sqlite server.mjs
```

Open http://127.0.0.1:4173. These commands do not rent hardware or transfer funds. Unconfigured integrations fail closed; browser simulations are explicitly labeled. See [reporting](local/REMOTE-PROGRESS.md), [hosting](ops/runpod-shutdown/HOSTING.md) and [release validation](experiments/2026-10-12-public-update.md). Use the commit containing this release for its exact source; historical manifests refer to their original snapshots.

A signature authenticates an enrolled key holder's claim, not physical hardware, scanner execution or exhaustive coverage. Provider records are operator-collected observations, not provider-signed attestations. Tariffs and target balances are dated snapshots.

Private configurations, keys, owner identities, sessions and databases are excluded. Public enrollment keys and signatures are intentionally included for verification.

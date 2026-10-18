# BitHash
Public source and evidence for a community-funded attempt at the deliberately public Bitcoin puzzle #71. This release contains working prototypes and bounded tests; it does not establish a production search fleet or a solved puzzle.

## Treasury and automatic funding — October 18, 2026

The local Operator now includes the 70/30 treasury connection, authenticated read-only SolCard/Runpod records, fee-detection rules, restricted transaction inspection and persistent funding jobs. Continuous replenishment and fleet budgets work in **simulation**; the production funding connection is **observe only**. Real signing, broadcasting, automatic credit posting and GPU proposals remain disabled.

**294 local tests pass** in the publication checkout. No real transfer or GPU experiment was performed for this release. Provider receipt attribution, live preflight/custody, fee claiming and durable unattended operation remain incomplete.

[Release and reproduction](experiments/2026-10-18-treasury-funding.md) · [Production observation](local/PRODUCTION-FUNDING.md) · [Continuous replenishment simulation](local/CONTINUOUS-FUNDING.md) · [Read-only provider records](local/FUNDING-RECORDS.md).

Earlier sections below are dated snapshots; use the release above for current funding status.

## Owned range connection — October 13, 2026

The range-aware executor and owned ledger are deployed. Exact signed chunks advance durable checkpoints; enrollment retries and receipt replay do not add duplicate credit. The first 1,048,576-candidate #71 job is reserved, with zero searched coverage. New native solver checksum: `2fa95f416407975c757497c9d4cc6c4e235211da8a5fa7ac44f20b4383d5e555`. GPU qualification of this binary is still pending fresh exact Google owner approval. The previous successful live benchmark used a different interface and does not qualify it.

212 backend/executor tests and57 hosted dashboard tests passed, including range-aware AI tickets and archive checks;24 executor tests passed on the deployed Linux host. HTTPS artifact integrity and unauthenticated task rejection were read back. These overlap, so do not total them as independent checks. Owner recovery private material stays on the desktop; workers receive only its public key and their scoped lease. Signatures do not prove exhaustive GPU search.

[Range executor contract and limits](ops/live-executor/RANGE.md) · [Owned ledger](local/OWN-RANGE-SOLVER.md) · [Native source/build](gpu/range/README.md) · [Runtime manifest](gpu/range/runtime-manifest.json).

The deployment retains private pre-change state/source/configuration backups. Restricted SSH, off-host retention, treasury funding and multi-GPU operation remain future work. Earlier implementation snapshots below are historical.

## Earlier release snapshot — October 13, 2026
| Component | Observed status | Evidence |
| --- | --- | --- |
| GPU benchmarks | Real synthetic CUDA fixtures; A5000 led the recorded cost comparison | [comparison](experiments/2026-10-12-gpu-comparison.md) |
| Independent shutdown | Real RTX 3090 deadline shutdown, deletion/absence and crash recovery passed; final invoice pending | [live test](experiments/2026-10-12-live-shutdown.md) |
| Hosted reporting | TLS, signed transport, durable history and dashboard proof links passed with a non-GPU test enrollment | [report](experiments/2026-10-12-remote-progress.md), [signed proof](experiments/2026-10-12-remote-telemetry-proof.json) |
| Google approvals | Local sign-in and exact proposal approval implemented and browser-tested | [report](experiments/2026-10-12-google-owner.md) |
| Automatic executor | Two owner-approved real synthetic rentals completed and were automatically deleted; one GPU maximum | [upgrade and limits](experiments/2026-10-13-operator-upgrade.md), [retained executor records](https://bithash.online/api/executor/status) |
| Dashboard | Local approvals plus hosted fleet, telemetry and cached AI assessment; graphite/amber operator redesign | [local setup](dashboard/README.md), [hosted build](dashboard/HOSTED.md) |
| ChatGPT-plan Operator | Per-GPU activity reports and cached sync; bounded A5000 proposals with separate Google approval; new live option selection awaits capacity | [upgrade and validation](experiments/2026-10-13-operator-upgrade.md) |
| GPU reporting acceptance | Real RTX 4090 synthetic run, interruption reports and independent deadline deletion observed | [acceptance](experiments/2026-10-13-hosted-gpu-acceptance.md) |
| Rental status | Read-only registered-Pod inventory joined to signed worker reports | [fleet integration](experiments/2026-10-13-fleet-panel.md) |

The Operator explains observed GPU activity and can draft a bounded A5000 benchmark proposal. Google owner approval separately authorizes the real executor; the AI does not approve spending. The current live capacity check held because A5000 availability was NONE. Signed benchmark-result archival is implemented and fixture-tested but has not yet been exercised on a newly rented worker. No #71 search coverage is claimed. Autonomous treasury transfers, provider top-ups, production range workers, broader fleet concurrency, long-term retention/backups and restricted SSH capabilities remain pending. One control host is not high availability.

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

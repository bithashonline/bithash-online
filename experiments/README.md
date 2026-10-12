# BitHash experiment log

This directory records actual experiments, including unsuccessful runs and limitations. Dates in the index use America/Toronto; machine reports preserve their original timestamps. GPU experiments are separate from CPU tests, mock-provider tests and planning simulations.

| ID | Date | Experiment | Outcome | Evidence |
| --- | --- | --- | --- | --- |
| EXP-001 | 2026-10-07 | Compile bounded CUDA worker; try local execution | Build/link succeeded; local AMD machine could not execute CUDA validation. Six invalid-input checks and 47 backend tests passed. | [Build report](results/2026-10-07-cuda-build.json) |
| EXP-002 | 2026-10-11 | RTX 4090 known-answer pilot on Runpod | All 14 small fixture cases agreed with independent CPU references. Rental terminated/deleted. Displayed credit consumption USD0.07. | [Detailed record](2026-10-11-rtx4090-pilot.md), [original GPU report](results/2026-10-11-gpu-validation.json), [provider summary](results/2026-10-11-provider-summary.json) |
| EXP-003 | 2026-10-11 | Authenticated CPU worker receipts | Recorded local result: 53 tests passed, including subprocess-to-HTTP-to-database receipt handling. | Historical summary below; original complete test transcript was not archived here. |
| EXP-004 | 2026-10-12 | Coverage-aware scheduler | Recorded local result: 63 tests passed. External claims affect scheduling preference without crediting own work. No real pool interval map imported. | [Synthetic demo](results/2026-10-12-coverage-demo.json); captured reruns in `runs/`. |

## What these results establish

EXP-001 built Linux x86-64 CUDA SM89 software from pinned BitCrack sources. Its `gpuValidated: false` is the correct historical build-time status, superseded for the tested binary by EXP-002.

EXP-002 exercised a restricted fixture worker on one rented RTX 4090. Fixtures are already-solved public puzzles 1–3. The test includes both matching and non-matching ranges. It does not measure sustained throughput, demonstrate large-range correctness, search puzzle #71, or attest that a remote host cannot falsify reports. The complete validation process took 4.874 seconds; do not convert that duration into a production keys/second benchmark.

EXP-003 tested Ed25519-bound worker reports, CPU reproduction of tiny fixture results, durable receipt/checkpoint commits, duplicate handling, rejection of altered/stale reports and sanitized dashboard counts. It did not validate GPU receipt ingestion or an automated paid-provider lifecycle.

EXP-004 tested exact large-integer boundaries, overlap merging, fresh/unreported preference, reported-range fallback, expiry/withdrawal/replacement, restart replay, budget rollback and concurrent allocation. The demo's external coverage is deliberately synthetic. The first sandboxed test invocation failed at the localhost HTTP test; running the full suite outside the network sandbox passed. This was an execution-environment limitation, not a GPU result.

## Recording future experiments

Assign the next EXP number and add a dated record using [TEMPLATE.md](TEMPLATE.md). Record the hypothesis, exact software/build identity, hardware, input range semantics, method, timestamps, result, cost evidence, termination state, limitations and next decision. Retain failed runs and original reports; corrections get a dated note rather than rewriting historical outcomes.

For a fresh captured backend run, from the repository root:

```powershell
node experiments/record-backend-run.mjs
```

This runs only the local Node test suite, records a timestamped transcript/result and a SHA-256 manifest of the local source/configuration used, and exits with the test status. It makes no provider call or Git push. Where localhost networking is blocked, run in an environment that permits the suite's own loopback test server.

The experiment log and selected evidence are versioned separately from unfinished implementation work. A source manifest identifies the working files used; it does not mean every file is already published at the recorded Git HEAD. Check each run's `workingTreeWasDirty` field. Publication of a log is not an independent audit or a production deployment.

Do not archive credentials, treasury keys, discovered candidate secrets, authenticated browser exports, or account session data. Store public fixture results and relevant provider facts only. Human-observed billing is labelled as such; invoice-backed costs require the actual reconciled invoice.

## Still untested

- Sustained candidates/second and candidates/dollar on a realistic controlled workload.
- Large-range GPU worker correctness and multi-GPU scaling.
- Automated rental, shutdown/watchdog, GPU reporting and interrupted-job recovery as one remote system.
- Live puzzle #71 search or real creator-fee funding.

Future BitHash experiment work should update this log with results and evidence. There is no unattended recorder, recurring rental or automatic GitHub synchronization.

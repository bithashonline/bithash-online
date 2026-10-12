# EXP-006 — rented GPU cost-efficiency comparison

**Result: RTX A5000 was the most cost-efficient of the three GPUs actually tested, at the observed Runpod prices.** All36 controlled cases passed. RTX3090 was unavailable and remains untested; this is a partial comparison of the four planned models, not a claim about every rental option.

Date: October12,2026 (America/Toronto); lifecycle timestamps below are UTC. Authorized scope: A5000,3090,5090 and4090 repeat, one GPU at a time, USD2 total cap, at most30minutes per allocation. Actual displayed credit consumption was **USD0.21**, from9.69 to9.48. All three Pods were stopped and deleted; final displayed spend was USD0.000/hour. No new credit, automatic replenishment, deferred deployment or recurring rental was enabled.

## Ranking

| Tested GPU | Compute + temporary disk USD/hour | Best-profile median candidates/s | Projected trillion candidates/USD | Best-profile min–max billion/s |
| --- | ---: | ---: | ---: | ---: |
| **RTX A5000** | 0.270 + 0.004 | **1,194,452,033** | **15.69** | 1.191–1.196 |
| RTX4090 | 0.890 + 0.004 | 2,892,220,213 | 11.65 | 2.891–2.905 |
| RTX5090 | 1.190 + 0.004 | 3,784,906,477 | 11.41 | 3.782–3.805 |

Every GPU's fastest tested profile was `large`. A5000 delivered34.75% more candidates/USD than4090 and37.52% more than5090. The5090 was fastest in absolute throughput. The4090/5090 efficiency difference was only about2%; do not generalize that small gap to every host, price, build or long run.

The main efficiency metric is **median scan candidates/s ×3600 ÷ observed hourly rate**. It is a scan-only projection, excluding startup, initialization, evidence collection and idle rental time. It is not a measured hour-long production yield. Storage quotes were rounded by the UI. Including per-case initialization, best-profile median rates were1.141B/s (A5000),2.529B/s (4090),3.355B/s (5090).

For the actual short experiments, total repeated attempts divided by estimated full active rental cost were7.55T/USD (A5000),4.08T/USD (4090),3.25T/USD (5090). These include different administrative overhead and all slower profiles, so they are not a clean hardware comparison or distinct search coverage. Full precision and all profiles are in [analysis.json](results/2026-10-12-comparison/analysis.json).

## Software and method

Matching source and runtime package were published **before** allocation at [52c1bc6508069a03e133abfe87f8b35173358680](https://github.com/bithashonline/bithash-online/tree/52c1bc6508069a03e133abfe87f8b35173358680/gpu/comparison). Upstream BitCrack revision6bf8059ef075eb1622298395866b0bd02375e1d9; CUDA12.4.131; native SM86/SM89 plus compute89 PTX. The5090 used the compatible driver-JIT path, not a separately optimized native Blackwell build. See [NVIDIA compatibility guidance](https://docs.nvidia.com/cuda/blackwell-compatibility-guide/index.html).

- Runtime archive SHA256: `dfe1255f3809c20bac939b91656f45d719bde0d982a7ef6cb7ffbbd071c96e17`.
- Executable SHA256: `50cc815754e9bde88315d92c3e1741ab0028821b6be4a0c67626024ad81ed485`.
- [Runtime archive](artifacts/bithash-comparison-package.tar.gz), [per-file manifest](artifacts/bithash-comparison-package-manifest.json), [source and reproduction procedure](../gpu/comparison/README.md).

CPU reference checks passed for24 synthetic vector entries before rental. The worker and vectors match EXP-005; packaging adds architecture support and a repeated procedure. Each model runs three two-batch boundary-validation cases, followed by nine timing cases: three repeats each of small, medium and large, rotating the order to reduce ordering effects. Settings are blocks/threads/points: small64/256/64, medium128/256/128, large128/256/256. Every timed case scans the same half-open synthetic interval `[1099511627776,1133871366144)`, containing2^35 candidates. Positive probes include the final candidate; exclusive-end probes must not match. Boundary cases also exercise the first candidate and batch transition. Counts, next-key boundary and expected matches are checked.

All12 cases passed on each rented model. Synchronous scan timing is separate from initialization. `nvidia-smi` telemetry samples include utilization, temperature, power and clocks. Reports were copied through the authenticated Jupyter editor and SHA256-compared with the original host output before termination. These are host-reported observations and sampled correctness controls, **not cryptographic remote attestation or proof of every individual scalar calculation**.

Repeated intervals overlap. **Zero puzzle#71 candidates were searched.** Whole suite durations were318.998575s (A5000),166.817557s (4090),137.272939s (5090). Individual timing cases lasted roughly9–41seconds. Thirty minutes was the maximum rental lifetime, not a claim of30minutes of continuous sustained benchmarking. Long-run thermal stability, failures/recovery and multi-GPU scaling remain untested.

## Provider and cost evidence

All used Secure Cloud, oneGPU, official `runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404`,30GB temporary disk and no persistent volume. Different CPU/driver/region allocations are recorded rather than treated as identical hosts.

| GPU / Pod | Location / vCPU / RAM | Created UTC | Stopped UTC | Deleted UTC | Estimated active rental USD |
| --- | --- | --- | --- | --- | ---: |
| A5000 / `sg6nuj66fgv7j9` | CA-MTL-1 /9 /50GB | 07:17:12 | 07:26:10 | 07:26:39 | 0.04095 |
| 5090 / `kcrx5upswb3u0i` | EU-RO-1 /16 /92GB | 07:28:43 | 07:33:30 | 07:33:48 | 0.09519 |
| 4090 / `jh4kex4yo8mxv6` | UI reported US /12 /31GB | 07:34:06 | 07:39:11 | 07:39:36 | 0.07574 |

Times were read from the authenticated provider audit log and converted to UTC. Generated Pod credential deletion was also confirmed. Provider JSON is a sanitized operator transcription, not a signed provider receipt; raw account audit exports are excluded. Estimated active costs totalUSD0.21188, consistent with the observedUSD0.21 balance change. No itemized invoice was inspected, and per-Pod estimates should not be called settled invoice charges. [Billing observation](results/2026-10-12-comparison/billing.json) and [cropped final billing screenshot](results/2026-10-12-comparison/comparison-billing.jpg).

| GPU | Raw report | Provider record | Rental / result screenshots | Report SHA256 |
| --- | --- | --- | --- | --- |
| A5000 | [JSON](results/2026-10-12-comparison/a5000-report.json) | [JSON](results/2026-10-12-comparison/a5000-provider.json) | [Rental](results/2026-10-12-comparison/a5000-rental.jpg) · [Results](results/2026-10-12-comparison/a5000-results.jpg) | `52ae33e0ce7e2536fb4df5abf5a6724bbf004af6156d3c74ef660e40cdddad53` |
| 4090 | [JSON](results/2026-10-12-comparison/4090-report.json) | [JSON](results/2026-10-12-comparison/4090-provider.json) | [Rental](results/2026-10-12-comparison/4090-rental.jpg) · [Results](results/2026-10-12-comparison/4090-results.jpg) | `99d4d7354880922d003af3932dbdb24e91f86715a41f01193d7c356b1e9671f7` |
| 5090 | [JSON](results/2026-10-12-comparison/5090-report.json) | [JSON](results/2026-10-12-comparison/5090-provider.json) | [Rental](results/2026-10-12-comparison/5090-rental.jpg) · [Results](results/2026-10-12-comparison/5090-results.jpg) | `e911b0e5b9a0af03b0c216ee49d379f8a0691d96de0336656f555703e79991a0` |

## Failures and incomplete work

1. **RTX3090 unavailable:** the Secure Cloud allocation lost capacity before deployment. The offered deferred-deployment subscription was cancelled. A final Community Cloud check with compatible CUDA versions and no minimum bandwidth also showed unavailable, despite a displayedUSD0.22/hour compute listing. No3090 Pod or subscription was created. [Status](results/2026-10-12-comparison/3090-status.json), [screenshot](results/2026-10-12-comparison/3090-unavailable.jpg). Its efficiency is unknown and it could change the ranking.
2. **Automatic stop request failed:** on A5000 the helper armed, but a direct test of its own-Pod REST stop request returnedHTTP403. Root cause was not established. [Failure screenshot](results/2026-10-12-comparison/a5000-stop-api-failure.jpg). Manual console stop/delete succeeded and was verified for every Pod. The20minute deadline path was not waited out; do not claim a working unattended watchdog or independent spend guarantee. The published runtime retains the original helper for reproducibility; current README warns against relying on it.
3. **Scope limits:** one host per model, three short repeats per profile, compatible but not architecture-optimized5090 build, no production target search, live GPU receipt ingestion or automated provider lifecycle. Earlier backend changes remain local and are not implicitly published by this experiment.

## Verify and next decision

From a clean checkout, run `node experiments/analyze-comparison.mjs`. It checks report schema, model, binary/manifest/vector hashes, all36 results, fixed ranges/counts/matches, timing arithmetic and provider lifecycle before calculating the ranking. It intentionally outputs `status: partial` and `missing: ["3090"]`. Original JSON is retained byte-for-byte; checksums detect file changes but do not establish trusted execution.

Use A5000 as the **provisional value choice for this tested workload and price**. Fix and verify an independent shutdown controller before unattended operation. Complete the3090 comparison when capacity and authorization permit, then validate sustained performance on the selected configuration before extrapolating to a fleet. No follow-up rental or scheduler was started.

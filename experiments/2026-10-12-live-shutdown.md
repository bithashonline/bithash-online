# Live GPU shutdown acceptance — October 12, 2026

Status: PASSED for live deadline stop-request acceptance, automatic deletion, absence confirmation and controller crash recovery. Final billing reconciliation is pending.

## Authorization and scope

User approved a single disposable GPU shutdown test, USD0.10 maximum. A5000 stock disappeared before creation; used the available RTX3090 in EU-CZ-1 at USD0.50/GPU-hour with 30GB ephemeral disk, no persistent or network mounts and no requested application or SSH ports. Six-minute deadline; shutdown starts one minute early. Conservative budget rate USD0.51/hour. No puzzle searching or compute benchmark is performed.

## Allocation and controller

- Pod: `90et1ky0nsxu7n`, name `bithash-shutdown-live-20261012`.
- Image: `runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404`, from official template catalog `runpod-torch-v280`; used the image directly without template storage or network defaults.
- Provider creation: `2026-10-12T23:41:02.928Z`.
- Conservative billing origin: `2026-10-12T23:40:58.666Z`, before create request.
- Trigger: `2026-10-12T23:45:58.666Z`; deadline: `2026-10-12T23:46:58.666Z`.
- Controller adapter SHA256: `0a57e455ea41305ff7aafb2f1d9c5beecf6db87a6640ca6b1a5b66370b8a7786`.
- Independent Linux service verified exact Pod identity; GET showed mounts `{}` and USD0.50/hour.
- Container log at23:41:20 UTC reported NVIDIA GeForce RTX3090 through nvidia-smi. Command then sleeps; this demonstrates GPU visibility, not puzzle work. A later provider runtime read showed an implicit HTTP port19123 despite empty requested ports; no application URL was used or published.
- Injected SIGKILL to the controller process after identity verification. systemd recovered PID4197 to4651, NRestarts1; persisted trigger and deadline unchanged, no stop reason latched by the crash.

## Evidence limits

Provider reads and container logs are authenticated observations collected by the operator, not signed third-party attestations. A deadline event, accepted stop request, stopped state, deletion, and billing reconciliation are distinct claims. Final billing may lag resource deletion. No model or treasury is involved. Reviewed source and evidence are included in this release.

## Final result

The independent server triggered shutdown automatically with reason `deadline_or_budget`. One stop request and one delete request were accepted, with no request errors and no manual provider mutations after creation.

| Controller event | UTC |
| --- | --- |
| Stop intent / accepted (same controller-pass timestamp) | 23:45:59.688 |
| Delete intent / accepted (same controller-pass timestamp) | 23:46:06.225 |
| Provider404 observed | 23:46:12.521 |

The stop pass started 1.022 seconds after its trigger. Absence was observed 46.145 seconds before the six-minute deadline. Event timestamps represent controller-pass start, not exact provider completion time. Independent MCP GET also returned404, and a complete Pod list returned empty (`hasNextPage:false`). Both hosted services remained active. No persistent/network storage was created.

Estimated rental expense is roughly USD0.04–0.05 at the observed USD0.50/hour compute rate plus temporary disk, below the approved USD0.10 threshold. The per-Pod hourly billing API had no records yet; this is **not** proof of a free rental or a settled invoice. `billingReconciled` remains false.

The intermediate EXITED state was not independently preserved; the evidence establishes accepted stop, accepted delete and subsequent absence. This single-Pod test does not establish fleet-scale behavior, physical attestation, unattended recovery from provider outages, public logging ingress, or final invoiced spend. No puzzle candidates were scanned.

Evidence: [controller event export](results/2026-10-12-live-shutdown/controller.json), [supervisor logs](results/2026-10-12-live-shutdown/supervisor.txt), [provider running observation](results/2026-10-12-live-shutdown/provider-running.json), [container/system logs](results/2026-10-12-live-shutdown/provider-logs.json), [cleanup observation](results/2026-10-12-live-shutdown/provider-cleanup.json). Controller export SHA256: `95b3d5aa32a600140fdedfb7aa9a4f4f05f1f0ce4492e4849a80594d6bdf93d3`.


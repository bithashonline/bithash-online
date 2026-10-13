# Hosted progress and proof integration

October12,2026. No new GPU rental or model call; USD0 incremental compute spend.

User requested connection of GPU reporting to the existing server/dashboard with proof links, then explicitly approved the internet-facing TLS endpoint onCOLLECTOR_HOST:8443 after automatic approval review initially blocked that exposure. Activated only after this approval. Existing shutdown service remained active throughout.

## Observed

- Dedicated collector certificate generated on the server; only its public certificate retrieved over pinned SSH. SHA256 fingerprint `26:B3:0A:3A:53:52:C0:94:08:79:DD:27:9E:40:0A:0F:39:CB:DA:64:83:C4:72:93:4B:C1:1B:2D:31:EB:9B:F6`.
- Bound public TLS8443 with signed-write/read-only-proof API; old fixture and operator APIs not exposed in TLS mode.
- One explicitly non-GPU test enrollment `c70a14a046688a266ebd4ec64f0a3798`, one accepted signed idle report with all metrics null. Private test key remained local; server stored its public key only.
- Report digest `2669592bb835b5c834d1f1f1741a9de48ce3a3af46c585cdd4e23cc438f3dbdd` verified independently against the returned public key. SHA256 recomputation matched.
- Local dashboard proxy returned byte-equivalent JSON data to the validated direct collector read. Untrusted certificate rejected; bad signature rejected without history growth.
- Restarted the collector; same proof survived and independently verified again. The card correctly aged to STALE after reports stopped.
- Browser displayed SERVER CONNECTED, TRANSPORT TEST · NO GPU, missing metrics, and the signed-report proof link. Test enrollment then revoked; retained evidence is unchanged.
-106/106 backend tests and17/17 frontend tests passed, including expiry/revocation/replay/counter rollback, proof verification and stale/disconnected UI behavior.

## Evidence and limits

[Verification record and signed envelope](2026-10-12-remote-telemetry-proof.json). [Operational instructions](../local/REMOTE-PROGRESS.md).

This validates real remote transport/storage/dashboard wiring with a test worker. It does not validate GPU-origin telemetry, scanner metric production, real search coverage or an AI model. The previous GPU shutdown experiment remains separate. Reporter packaging and an authorized live GPU acceptance run are pending; no GPU rental followed from this integration request. Archive/retention is still needed before long-duration fleet logging. Source and evidence are included in this public release.


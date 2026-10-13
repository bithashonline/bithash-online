# Public update — October 12, 2026

This commit publishes the approval backend, local dashboard, independent shutdown updates, signed telemetry collector/reporter and dated experiment evidence together. No new GPU rental, transfer or live application deployment was performed for publication.

## Verification from a clean release checkout

- Backend: 106/106 tests passed, Node 22.16.0 on Windows.
- Shutdown controller: 28/28 tests passed.
- Dashboard: 17/17 tests passed.
- Legacy unsigned launch builder: 7/7 tests passed.
- Archived transport-test Ed25519 signature and SHA256 independently verified; shutdown controller export SHA256 matched its experiment record.

The initial restricted-network test run could not connect to loopback HTTP fixtures (two backend tests and one shutdown test). Re-running with local networking enabled passed without source changes. This is local validation, not a claim that GitHub Actions or every supported platform has passed. CI now installs locked backend dependencies and covers all four suites plus the evidence verifier.

Full successful outputs are in [release-validation](results/release-validation/). Source hashes are listed in [source manifest](results/release-validation/source-manifest.json); the containing Git commit identifies the full reproducible release. Dashboard files were relocated from the private checkout's dist/ to dashboard/public/, with server/test imports adjusted. The dashboard's dated test count and inventory wording were corrected; substantive backend mechanisms are published.

## Publication review

Reviewed selected source, evidence, configuration examples and the nine-commit fetched public history, including decompressed historical benchmark archives. Pattern scanning covered private keys, common provider/GitHub/AWS tokens, JWTs, literal credentials, access-bearing URLs, sensitive filenames and private deployment/account identifiers. Flagged current literals were synthetic test inputs or regex false positives. No actual credential was found. Operational secrets, owner identity/configuration, sessions and databases were excluded; public verification keys/signatures remain available.

Personal filesystem paths already existed in old public commits. They are removed from the current published files; historical commits have not been rewritten. This review is not an independent security audit or a guarantee that all defects are absent. Historical benchmark screenshots and archives remain previously published evidence.

## What the evidence establishes

The [live shutdown test](2026-10-12-live-shutdown.md) observed a real rented RTX 3090, accepted deadline stop/delete, subsequent provider absence and process crash recovery. Final billing is still pending; the intermediate stopped state was not independently saved.

The [remote reporting test](2026-10-12-remote-progress.md) exercised actual TLS transport, signed reports, durable storage and dashboard proofs using a non-GPU test enrollment. Its enrollment was revoked after verification. This is not live GPU telemetry or proof of exhaustive search. The report sidecar still needs GPU packaging/acceptance; retention, autonomous real dispatch, AI inference and treasury/provider funding remain unfinished.

Publication review follow-up: automatic approval review flagged account metadata in the historical provider plan. The published provider-plan.json is now a non-operational example; account balances, funding settings, credential-inventory notes and duplicated deployment records are omitted. No execution module imports this example. The separate experiment records preserve the technical outcomes and their stated limits.

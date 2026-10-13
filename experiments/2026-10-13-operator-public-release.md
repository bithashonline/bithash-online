# Operator public source release

October 13, 2026 (America/Toronto). This release publishes the read-only ChatGPT-plan operator, cached-report server, hosted report renderer and new graphite/amber character artwork.

## Included evidence

- [Accepted AI assessment](evidence/2026-10-12-chatgpt-operator-report.json): six captured facts and four inert review suggestions. Diagnostic failures preceded acceptance; this is not a claim of a single total model request.
- [Hosted integration](2026-10-12-hosted-operator.md): report synchronization, offline/online display and proof-link limits.
- [Local setup](../local/CHATGPT-OPERATOR.md), [server setup](../ops/operator-reporting/README.md), [hosted build](../dashboard/HOSTED.md).

## Release validation

- 118 backend tests passed in the isolated release checkout, including 18 targeted operator/authentication/record checks.
- 37 dashboard tests passed after building the hosted Worker. The first packaging check identified a missing test fixture and an old text log in the public asset folder; the fixture was included and the historical log moved outside served assets before the passing run.
- The hosted asset/Worker build succeeds with 19 embedded assets. Browser artwork was separately verified in deployed Sites v12 (source `e5dc5f5c21426cb0487a27621e8ba9fca89b24dd`).
- Public report schema and captured-evidence digest validation pass for the archived assessment.
- Intended files and all 12 existing Git commits were scanned, including 50 archive members. Flagged strings were synthetic test credentials/URLs and previously published nonsecret workstation paths in history. No actual credential was detected by this review; a scan is not a guarantee of absence.

Private runtime files, account identities, connection configuration and live credentials are excluded. The public SSH adapter uses the documented `bithash-control` alias instead of the deployment-specific host address. Hosted project identity is omitted; runtime secrets must be configured separately. These are publication/configuration adaptations, not a claim that every deployment file is byte-identical.

The release does not enable spending, schedule inference, launch GPUs or transfer funds. Model suggestions remain non-executable. The archive is administrator-controlled and capped at 1,000 unique reports; retention, stronger provenance, restricted SSH publishing and real approval-to-rental dispatch remain unfinished.

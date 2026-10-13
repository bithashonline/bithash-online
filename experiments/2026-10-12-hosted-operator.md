# Hosted cached AI assessment

October 12, 2026, Toronto. No new inference or GPU rental for this integration.

The existing completed GPT-6.1-Sol report is now published through the local operator's fixed SSH synchronization transport, the existing server and the password-gated Sites dashboard. The laptop sends a validated report and heartbeat every20seconds while its operator process runs and a saved plan connection is present. This loop does not call a model, provider or treasury API. It does not prove an unexpired inference allowance, and is labelled local-process/report-sync status.

Hosted source commit: `e699ba19c8e92a2de889f2eca23685534219c9b7`; Sites version11; deployment `appgdep_6acdab7314108191b8ef571c9334cfa7`, succeeded, environment revision2 and password gate preserved. Public GitHub main has not been updated in this step.

Report: https://bithash.online/api/operator-proof/971e4dee5d37064d51a6727466985352e70e3cfc9da53bbaeab6571b962947d8

## Verified

- 37 hosted tests pass, including5 new operator tests;18 local operator/auth/record tests pass.
- Local source validates exact public report fields, known evidence IDs, captured-evidence digest, fixed proof URL shapes and inert advice. Unknown fields, including credentials, are rejected before SSH publication.
- Server report reader runs as nobody, has no provider/model credentials, listens only on loopback8791 and uses the existing authenticated HTTPS bridge. GPU collector, shutdown controller and fleet reader remained active.
- Existing report archive uses exclusive creation under its content digest. Subsequent heartbeats update only the atomic latest pointer. At1000 archived assessments, new unique report ingestion stops; retention policy remains pending.
- Live bridge authenticated200; unauthenticated401; POST405; query400. Archived report digest independently recomputed and matched.
- Browser on bithash.online showed LAPTOP OFFLINE and retained the historical assessment after heartbeat expiration, then LAPTOP ONLINE after sync activation. The report stayed labelled HISTORICAL EVIDENCE throughout. No new inference was needed to test either state.
- Direct browser-tool navigation to the long hosted archive URL was blocked by the client. The upstream live proof integrity check and hosted proxy tests passed; the dashboard's live snapshot, containing the same report and digest, rendered correctly. Do not represent direct hosted proof navigation as browser-verified.

## Boundaries

These records preserve the application-captured model assessment and evidence. A hash does not independently attest model execution, prove hardware execution, establish unique puzzle coverage or provide immutable third-party timestamping. Server administrators can alter storage. Provider-observation links are current reads; the report archive retains the facts used for that assessment. Worker proof links retain the existing signed worker claims.

The dashboard is read-only. Review suggestions are not executable spending proposals. Owner-approved rental integration, model provenance metadata, scheduled reviews, report retention and a restricted SSH publishing account remain unfinished. The current laptop transport uses the existing pinned root SSH connection; ChatGPT credentials never leave the laptop. Public access still requires the existing shared preview password.

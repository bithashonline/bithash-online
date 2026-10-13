# Approval dashboard — local implementation

October12, 2026. Local and unpublished. 82/82 backend and12/12 frontend tests pass.

The retained dashboard now shows exact proposal terms, cap, expiry, signing digest and ledger identity. Owners can submit an externally generated Ed25519 signature to approve a synthetic reservation. Keys are never requested in the browser. Live execution remains disabled; this is not a Solana wallet adapter.

Every new spending state-change event receives a transactionally stored evidence snapshot of its terms/state and balances. Approved records include public signature verification material. The timeline links each record through GET /api/approval-evidence/:seq, with SHA256 content digest. Missing historical evidence is visibly marked unverified rather than fabricated. Local database records can be modified by its owner; hashes alone are not independent attestation or immutable public history.

GET /api/approvals serves proposals and the timeline. POST /api/approvals/approve requires the exact local Origin, JSON, a bounded body and a valid signature over immutable terms and ledger ID. Invalid approval submissions receive generic errors and a sanitized failure event. Repeated approvals are idempotent and do not create a second reservation. Transport/origin rejection is not represented as operator activity. This is the spending state-change trail, not yet an integrated record of every model review, provider call or worker report. No fabricated Solscan links exist because no chain transaction occurred.

Configure the existing dashboard server using BITHASH_BACKEND_MODULE pointing to local/dashboard-api.js, BITHASH_APPROVAL_DB pointing to an existing proposal SQLite database and BITHASH_OWNER_PUBLIC_KEY_FILE pointing to the configured owner's public PEM. BITHASH_CONTROLLER_DB remains separate. Launch node --experimental-sqlite server.mjs from the dashboard directory. An absent store displays unavailable; no sample approval or owner key is silently created. Keep the listener on loopback. Do not deploy this local prototype as a public multi-user signing service.

Tests verify signatures from served evidence, historical snapshots, rejected signatures, origin enforcement, missing records, UI escaping and unsafe evidence URL rejection. Backend full suite uses local loopback permissions. Browser visual QA remains unperformed because the prior local URL security block must not be bypassed.

Next: wallet-backed owner signing, signed rejection/cancellation, model-to-proposal integration, pagination and authenticated production routing; then real chain/provider evidence adapters and a unified operator trail. Public evidence must redact payment sessions, credentials and personal invoice data. No payment, GPU rental, publication or live integration occurred.

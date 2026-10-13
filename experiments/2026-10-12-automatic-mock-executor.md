# Automatic approval-to-settlement mock test — October 12, 2026

Implemented local/mock-executor.js and mock-executor-cli.js, with a separate hidden process polling the approval ledger. No real provider API or payments. Four new tests plus the existing suite pass:98 backend/14 frontend.

Browser reload uncovered that the proposal form handler was registered only after the Google callback. Moved it to initial mount; verified creation with an already-authenticated session. Display caps and actual synthetic charges now preserve six decimals.

Browser created and approved one A5000 descriptor for60seconds, capped at4167 synthetic microcredits. Proposal operator-5c6f8206-1473-4c22-9fa8-b10e1d21f6ef. Independent executor picked up approval at22:23:32UTC and recorded dispatch/running without direct harness invocation. Settlement verification follows below.

Verified settlement22:24:32UTC, exactly60seconds after start.4167 synthetic microcredits; events10–15, with executor actor on transitions. [Evidence](evidence/2026-10-12-automatic-mock-executor.json). No manual lifecycle calls after browser approval. Background process left running; not a boot service, no real spending.

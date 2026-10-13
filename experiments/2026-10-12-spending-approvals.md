# EXP-009: Owner-approved spending contract

October 12, 2026. Local-only simulation; no publication, model request, treasury transfer or GPU rental. Cost: USD0.

Implemented immutable run proposals, ledger-bound Ed25519 owner approval, atomic full-cap reservations, duplicate protection, pre-dispatch cancellation, expiry, persisted dispatch intent, deadline stop requests and synthetic settlement. Fees accumulate; no automatic 80% allocation or spend is enforced here. Long-term earmark remains unresolved. Dashboard policy and analyst evidence updated; older browser simulator explicitly labeled legacy.

Validation: all 81 backend tests passed (seven new approval tests); all 10 frontend tests passed. Tests cover wrong signatures, quote changes, insufficient shared funds across two database connections, restart after dispatch intent, expiry, cancellation, replay, wrong owner, cross-ledger signature rejection, rounding/input bounds, and refusal of live execution. Two-connection test is sequential contention, not a simultaneous process stress test. Initial targeted tests failed because the edit helper could not start Python; applying the changes with Node resolved those failures.

Demo: 10 synthetic dollars received, 2 reserved for five simulated GPUs using invented prices, 1.60 settled, 8.40 available. Runtime expiry retains reservation until synthetic settlement. No real resource termination is established.

Source: [contract](../local/spending-approvals.js), [tests](../local/spending-approvals.test.js), [demo](../local/spending-demo.js), [limitations and reproduction](../local/SPENDING-APPROVALS.md). Evidence: [demo](results/2026-10-12-spending-demo.json), [test summary and source hashes](results/2026-10-12-spending-validation.json). Hashes identify working files, not a published reproducible release.

Still required: authenticated owner approval UI, constrained signer, verified fee ingestion, AI proposal adapter, provider executor/reconciliation integration, independent live shutdown validation, and publication review. No mutable HTTP endpoint was exposed. A local cap is not a guarantee against real provider billing overruns.

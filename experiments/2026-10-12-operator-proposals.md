# Operator run proposals — October 12, 2026

Implemented locally: authenticated POST /api/approvals/propose takes only GPU count (1–10) and duration (60–3600 seconds). A deterministic builder attaches the current local operator report, evidence digest, explicit synthetic quote, expiry and rounded cost calculation. The immutable proposal and its context are recorded in one SQLite transaction. Proposal creation reserves nothing; Google owner approval is separate.

The dashboard provides count/runtime controls and links every proposal to its saved source evidence. This is a rules preview with an invented A5000 test rate of $0.25/GPU-hour, clearly labelled synthetic. It is not live Runpod pricing, available capacity, model advice or a rental. Actual provider quotes and a connected AI model remain pending.

Validation:94 backend tests and14 frontend tests pass. New tests cover rounding, saved evidence, unchanged reservation on creation, bounds, injected provider fields, stale evidence, and authenticated/CSRF-gated API access. Browser verified the controls render. The server restart invalidated the memory-only login session; authenticated browser submission of this new form remains pending sign-in.

Source: local/operator-proposals.js, local/approval-api.js, local/spending-approvals.js. Dashboard remains local. No public deployment or real spending.

Browser follow-up: authenticated form creation passed. One mock A5000 for600seconds generated41667 microcredit cap and event4 source evidence. Remains proposed; no approval or execution. See evidence/2026-10-12-operator-browser-proposal.json.

### Approved mock lifecycle — 22:19 UTC
The browser already showed the requested proposal reserved, with Google owner approval event5. A local harness then called beginSimulation, confirmSimulation, requestStop and settleSimulation directly. The test deliberately supplied a1000-microcredit synthetic invoice and stopped immediately; it did not run600seconds of computation. Events6–9 appeared in the dashboard, ending settled.41667 reserved microcredits were released,1000 counted as synthetic spending and40667 returned to available balance. The older unrelated test reservation was untouched.

Checks passed: changed quote terms rejected; duplicate start rejected; reservation held until settlement; invoice above cap rejected; balances reconciled; duplicate same invoice did not add another charge/event. [Complete local evidence](evidence/2026-10-12-approved-mock-lifecycle.json).

Limit: approval-to-execution was driven by the agent's test harness, not an autonomous service or dashboard executor. No provider calls, GPU workload, real invoice, shutdown verification or payment. The simulation event named absence_and_invoice_confirmed is a mock state transition, not external evidence. No public push.

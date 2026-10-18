# Funding job manager — simulation only

Current integration: see [October 18 release](../experiments/2026-10-18-treasury-funding.md), [production observer](PRODUCTION-FUNDING.md) and [continuous shared simulation](CONTINUOUS-FUNDING.md). Earlier validation counts and pending-work notes below describe that component’s original implementation stage.

Implemented October 18, 2026. Local console: http://127.0.0.1:4185/treasury .

`funding-jobs.js` connects the existing pure `decideFunding` rules to a persistent
simulation workflow. `funding-jobs-ui.js` adds case selection, progress, an event
timeline, pause/resume, pre-submission cancellation and matching synthetic receipt
controls. The existing Operator hosts it and enforces its loopback Host/session/
Origin/CSRF checks. No public deployment.

## Flow

1. A selected case creates a durable job with frozen rules and fixture identity.
2. An invented 0.01 WBTC fee distribution assigns 0.007 compute and 0.003 other.
3. The existing rules decide whether to hold or reserve a bounded simulated top-up.
4. One simulated transfer request receives a stable `sim-chain-...` reference.
5. Simulated chain confirmation debits the sandbox wallet, then card credit awaits
   an exactly matching synthetic receipt.
6. A single simulated provider reload uses confirmed sandbox card credit, retaining
   the configured card buffer. Matching provider evidence posts only sandbox
   project credit and completes the job.

Default case: hypothetical 0.00095 WBTC at the assumed $100,000/WBTC credits the
simulated card $95. Its $5 buffer remains and $90 reaches simulated Runpod credit.
The invented initial $10 account balance is never classified as project funding.
No conversion fee/spread is simulated. The UI explicitly substitutes a simulated
$1/hour when the dry-run policy is idle. Direct manager callers can use zero burn
and get a held job. No live owner spending policy is changed.

## Persistence and recovery

Private `simulation-funding-jobs.sqlite` contains only simulation tables and an
explicit mode marker; unrelated/production database schemas are rejected before
simulation tables are written. Each job has an independent invented balance sheet.
Different cases/policies are independent scenarios, not a shared funded treasury;
their credits must never be summed or exported as real project funds. This does
not implement continuous replenishment against a shared production wallet.

Case + fixture version + frozen policy determines a stable job identity. Repeated
creation reopens the same job, including terminal/cancelled cases. No polling
retry or restart creates another transfer or provider reload. Job/balance updates,
receipt deduplication and events commit in one SQLite transaction. A storage error
rolls back all of them. A clock rollback holds progress. Up to 100 cases per database.

The local worker advances one stage every three seconds; it resumes persisted
unpaused jobs after restart. Page reload is needed to view progress. It has no
external I/O adapter and no transaction signer. Closing stops its timer. It is
part of the existing local process, not a Windows service or remote deployment.

Cases: normal; lost transfer response; finalized chain failure; delayed or wrong
card receipt; delayed or wrong provider receipt. Unknown transfer outcomes retain
the reservation and never resubmit. Delayed/mismatched evidence leaves the job at
its current stage without posting credit. The explicit matching-confirmation
control resolves only the applicable simulated fault; it does not authorize a
real transaction. Chain failure remains terminal with a held reservation for
review. Cancellation releases only pre-submission reservations. Pause freezes
simulation progression, while retaining all job data.

## Boundaries

No real key, signature, RPC submission, fee claim, invoice, card charge, billing
change, rental or model call occurs. The flow uses invented fee/chain/card/provider
evidence; it does not claim a verified Pump transaction or real payment completion.
It does not consume live provider observations as simulated receipts, change
owner-recorded accounting, register jobs in the real observe-only reconciler, or
call the offline signer. Those separate components retain their existing tests
and authority boundaries. Production signing and authenticated payment adapters
remain to integrate and authorize later.

## Verification

`node --test local/funding-jobs.test.js` covers full flow, 70/30 accounting, limits,
idempotency, pause/cancel, unknown/failed transfers, delayed/mismatched receipts,
restart recovery, transactional rollback, database isolation, clock rollback and
UI/accounting isolation. Together with eight existing funding/Operator suites:
109 tests passed. All external financial/GPU effects are mocked.

Local HTTP/browser verification completes the normal case, leaves the lost-response
case pending, restarts the actual Operator, supplies a matching synthetic confirmation
and verifies one transfer attempt, one reload attempt and no change to real balances.
Evidence lives under the current chat outputs as `bithash-funding-jobs-tests.tap`,
`bithash-funding-jobs-validation.json` and `bithash-funding-jobs-console.png`.

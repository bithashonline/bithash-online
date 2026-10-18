# Continuous replenishment — simulation only

Implemented October 18, 2026. Open the local Operator at `http://127.0.0.1:4185/treasury`.

The continuous simulation joins fee allocation, funding jobs and the existing pure fleet-budget planner around **one finite shared treasury**. The earlier independent funding/fleet fixtures remain available in a collapsed section. Their money does not enter this ledger. Nothing here authorizes real spending, claims fees, signs/broadcasts a transaction, charges a card, changes Runpod billing or rents a GPU. There is no AI model call in this worker.

## Money and decisions

- Explicit labelled sample fee events split 70% compute / 30% other. Replaying an ID is idempotent; changing its amount is rejected. Background ticks never invent more income.
- WBTC stays in the compute treasury until low runway requires funding. Example policy retains 0.001 WBTC ($100 at the assumed price), plus $50 provider reserve.
- A funding batch is $100–$500, bounded by cash above reserve, $1,000 converted per rolling day and $500 maximum operating exposure. Exposure includes provider credit, card credit, reserved transfers and in-flight converted funds. Only one pending job is allowed.
- Refill threshold is the greater of $100 or 12 hours of the affordable fleet's burn plus provider reserve. Target is 48 hours plus reserve, capped at $500; the $100 minimum can put credit above the calculated target but never above the exposure ceiling. Amounts round down to token precision.
- The budget uses the larger of confirmed sample compute fees / 72 hours and remaining spendable capital / 168 hours, then caps that by a 48-hour cash runway and the example hourly limit. Whole GPUs are admitted at an invented $1/GPU-hour, at most eight. These are finite-capital heuristics, not a revenue forecast or claim of profitability. GPU price is not increased when income rises.
- One-hour simulated sessions use `planFleetBudget` with a $500 rolling-day spend cap. Shrinking happens immediately when affordability drops; growth happens at the next session. Only confirmed provider credit can pay for sessions. Lifetime credits and spending remain separate from current operating exposure.

At $100,000/WBTC, an invented 0.1 WBTC fee batch allocates 0.07 WBTC to compute. The first eight-GPU target funds $434 and leaves 0.06566 WBTC in treasury. Later consumption triggers another bounded refill from those same funds; no new endowment is created. The 30% treasury remains untouched by compute spending.

## Persistence and exceptions

`continuous-funding.js` uses private `simulation-continuous-funding.sqlite`, explicitly marked simulation and rejecting unrelated schemas. Balances, job stages, receipts, dedupe and events commit in one SQLite transaction. Invariants check conservation of compute fees and USD credit, pending-job count and maximum exposure after each minute.

Stages: proposed/reserved → awaiting-chain → awaiting-card → awaiting-provider → complete. Synthetic receipts carry deterministic job/chain/card identities. Unknown transfer retains its one submission attempt and reservation. A mismatched provider-receipt fixture holds funds on the simulated card without crediting Runpod. Stale data and price-spike fixtures stop simulated sessions and require review. Resolve supplies **synthetic evidence only**, leaves the loop paused, and requires explicit resume. This does not implement real fraud detection or production receipt verification.

Worker runs one simulated minute per three real seconds only while the local Operator process is running. Manual six-hour advance performs the same minute-by-minute transitions. No catch-up spending is inferred while the process is offline. All fee/job records remain for dedupe; recent session detail is retained for rolling spend checks. The simulation stops adding jobs at 1,000 cycles. It is a bounded development simulator, not a production daemon.

Assumptions are fixed: $100,000/WBTC, $1/GPU-hour and zero fees. Production still needs executable quotes/net-credit attribution, real fee provenance after token launch, reviewed custody/signing, approved persistent limits, project-card acceptance/default billing and durable hosting. Existing read-only SolCard/Runpod feeds stay separate; their personal/unattributed balances cannot fund this simulation or become project credit.

## Prepaid credits

Runpod's [official billing policy](https://docs.runpod.io/accounts-billing/billing#refunds-and-credits), checked October 18, 2026, says deposited credits are non-refundable and cannot be withdrawn. This design treats purchased credit as committed compute expenditure, not a reversible treasury asset. The policy also describes native card auto-pay; this implementation does not enable or modify it.

## Verification

139/139 tests passed across continuous funding, fleet budget, funding jobs, automatic funding, funding records, restricted funding, treasury funding/accounting and Operator suites. Fourteen new tests cover shared repeated refills, conservation/caps, surplus retention, finite-income shrinkage, duplicate events, minimum batch, pauses, unknown/mismatched outcomes, price/stale anomalies, restart, transaction rollback and real-ledger isolation.

Local HTTP verification seeded one sample batch, completed two refills, held on a stale-data fixture, restarted the Operator, verified the hold survived, resolved/resumed, and confirmed continued sessions. At 23:06:28Z: 0.06278 WBTC retained, $722 cumulative synthetic credit, approximately $431.20 simulated spend and $290.80 provider balance. Real fee records, plans and project credit remained zero. Read-only providers remained connected. No public publication or deployment.

Private runtime outputs are retained locally and excluded from this repository. See the [public release record](../experiments/2026-10-18-treasury-funding.md) for reproducible validation.

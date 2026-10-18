# Fleet budget connection — simulation

Current integration: see [October 18 release](../experiments/2026-10-18-treasury-funding.md), [production observer](PRODUCTION-FUNDING.md) and [continuous shared simulation](CONTINUOUS-FUNDING.md). Earlier validation counts and pending-work notes below describe that component’s original implementation stage.

October 18, 2026. User wants eventual routine autonomy with exception review, and
considers $500–$1,000 normal operating scale. This is a product preference and
simulation target, not real spending authorization. Existing production Google
approval gates and paused GPU proposals are unchanged.

The local treasury console now connects completed simulated funding jobs to a
persistent autonomous fleet-budget planner. Pure rules in `fleet-budget.js`
calculate spendable project credit, subtract committed sessions and a reserve,
enforce hourly/session/rolling-day/GPU-count limits, and reserve an affordable
session. No per-session human approval is needed inside this simulation. When a
session ends the next affordable one is admitted automatically. Depleted budgets
create one recorded funding request; no replacement payment or credit is invented.
Connecting repeated replenishment against one shared treasury is still future work.

## Funding and operating examples

The UI has $500 and $1,000 operating-target presets. They create independent
simulation funding jobs using labelled invented fee batches of 0.01 and 0.02 WBTC.
They retain the 70/30 split, use an assumed $100,000/WBTC and zero conversion costs,
leave $25 on the simulated card, and fill the provider account to the chosen target.
The initial $10 non-project provider balance is excluded, leaving $490 or $990
of attributable simulated project credit. No live rule setting is changed.

The fleet manager imports only its bound completed simulation job's exact provider
receipt, once. Independent cases are never summed. Receipt changes/disappearance
hold the fleet. No real provider balance is promoted to project funding.

Default fleet policy: 8 simulated GPUs; invented $1 per GPU-hour; 6-hour sessions;
$100 per session; $12 hourly ceiling; $50 reserve; daily cap equal to the chosen
operating target; $2 per-GPU hourly ceiling and 20% maximum price increase from
the fixed simulated baseline. These are examples, not real Runpod quotes, capacity,
performance claims, production limits or evidence for more than the previously
tested two physical GPUs. Operating exposure and daily spend are separate fields.

## Autonomous execution and holds

`simulation-fleet-budget.sqlite` is simulation-only and rejects unrelated schemas.
One world binds to one funding job and immutable policy. A repeated preset reuses
that world. Active reservations survive restart and prevent another session from
being admitted against the same money. Integer micro-USD arithmetic rounds charges
up and caps actual simulated charges by admitted reservations. Budget state,
settlements, admissions and events commit together in a single transaction.

Each worker tick advances 60 simulated seconds, every 3 real seconds. Manual
advance adds up to 6 simulated hours and runs the same accounting. Downtime does
not imply simulated billing; the clock resumes from its saved value. Completed
sessions count against the daily cap for 24 simulated hours after ending, a
conservative window. Pause/anomaly stops the simulated session, charges only its
elapsed virtual time and releases the unused reservation. This is not an actual
Runpod shutdown or a proof of real shutdown billing accuracy.

Price-spike, balance-mismatch and stale-feed controls inject explicit synthetic
anomalies. Exposure/accounting and changed-receipt checks also hold admission.
A hold remains latched across restarts. Clearing the fault alone does not resume;
the operator must acknowledge/resume the simulation. Under ordinary conditions,
funding import, reservations, renewals and budget exhaustion need no clicks.

This is deterministic rule enforcement and a synthetic exception dashboard, not
AI anomaly detection, live fraud monitoring or external alert delivery. There are
no paid model calls, GPU/provider mutations, signing, broadcasting or card charges.
The real treasury database, previous funding evidence and production approval
mechanisms are not modified by this simulation.

## Validation

125 tests pass across ten funding/Operator suites, including 16 new fleet tests:
limits and reserve arithmetic, receipt attribution, both operating presets,
automatic renewal, daily reopening, low-budget funding request, pause/resume,
anomalies, restart, failed-storage rollback and real-ledger isolation. Price and
provider responses are synthetic. Full local HTTP checks exercise both presets,
a session renewal, a price-spike hold across an actual Operator restart, explicit
recovery and duplicate-preset reuse. No actual GPU experiment.

Outputs: `bithash-fleet-budget-tests.tap`, `bithash-fleet-budget-validation.json`,
`bithash-fleet-budget-console.png` in the October13 op chat outputs directory.

Future live design: approve an operating policy once, let routine actions run
inside it, and require review for changed destinations, increased authority,
unreconciled payments and abnormal activity. Enforce policy outside the language
model in the signer/executor. Production custody, real quotes/billing, continuous
replenishment, authenticated receipts, durable hosting and explicit live approval
remain required before activating that model.

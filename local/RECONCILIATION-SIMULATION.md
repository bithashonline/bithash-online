# Policy reconciliation and balance ledger — simulation

Implemented October 18, 2026. Open `/treasury#reconciliation-simulation` in the local Operator. This is a separate simulation, not a replacement for the real observe-only reconciler or permission to accept unverified live credit.

## Ledger and policy

Each independent case starts with invented 0.01 WBTC of project funds, $20 of excluded opening card funds and $10 of excluded opening provider funds. Cases never aggregate into one treasury. The assumed exchange rate is $100,000/WBTC. These amounts and rates do not come from the connected accounts.

The ledger tracks remaining project WBTC, project card funds, project provider credit, funds in transit, conversion/card/provider fees and provider usage. Opening personal funds remain excluded and cannot cover a project shortfall. Integer WBTC units and USD micro-units avoid floating-point accounting.

Every accepted observation checks wallet conservation and USD conservation: converted gross equals project card balance + project provider balance + funds in transit + fees + usage. Provider allocations also reconcile per job after usage and refunds. Expected total provider/card balances include the separately recorded opening funds; unexplained differences hold the case.

Version `simulation-v1` permits one pending job, a $500 batch, $1,000 per rolling simulated day and $10 total fees per job. Observations require a unique candidate, complete history, the expected simulated accounts and freshness within five simulated minutes. A stage without progress for 24 simulated hours holds. These are example simulation rules, not approved production spending limits.

Stages: awaiting-chain -> awaiting-card -> awaiting-charge -> awaiting-provider -> complete. A generated scenario supplies finalized-chain and settled provider observations; no cryptographic signing occurs in this module. Successful completion is labelled `policy-reconciled-simulation`, never independently verified provider-reference proof.

The normal $100 case credits $98 to the card after a $2 conversion fee, spends $90 plus a $1 card fee, and credits $89 to the provider after a $1 provider fee. Final project balances: $7 card, $89 provider, $4 fees. Opening $20/$10 remain separate. The rates and fees are invented, not SolCard/Runpod quotes.

## Holds, replay and refunds

Receipt IDs are deduplicated with their full content. An identical replay does nothing; changed content under the same ID latches review. A held job retains its identity and one simulated attempt; no retry or second job is generated. Corrected synthetic evidence must still pass validation and leaves the case paused until explicitly resumed.

Only settled paired provider reversals/card refund credits referring to the internally selected original charge are accepted in the simulation. Refund amounts cannot exceed that job's unspent, unrefunded provider credit. A full $89 refund returns the normal case to $96 project card funds and zero project provider credit; the $4 fees remain recorded. This is a generic accounting fixture, not a claim that Runpod offers refunds. A full refund after $5 usage stays held without borrowing opening personal funds. It has no automatic resolve control. Partial refunds are supported by the engine.

## Simulation boundaries

`reconciliation-simulation.js` imports only SQLite and hashing. It has no network, provider adapter, wallet key, signer, treasury-posting or GPU capability. Inputs must identify themselves as simulation. `simulation-reconciliation.sqlite` rejects unrelated table schemas and non-simulation mode. Frozen policy identity, balances, receipts, events and stage progression persist atomically; failed writes roll back together. Completed and held cases survive restart.

The fixture worker advances an active case by one simulated minute every three real seconds while the local process runs. Scenarios: normal, delayed, unknown transfer, ambiguous match, balance gap, refund and refund after spending. Cases are idempotently reopened instead of duplicating sample funds. The UI supports manual steps, pause, resume and corrected sample evidence for resolvable holds. Existing session/Origin/CSRF protections cover every action. No service or remote deployment was installed.

The `matches`, `completeHistory`, account identities, balances and internal invoice/charge assignments in these fixtures are test inputs. A future live adapter must derive and validate them from actual activity, pagination coverage, transaction status, timestamps and an approved dedicated-account baseline. The fixtures do not prove current SolCard/Runpod feeds supply sufficient evidence. Matching without shared references remains policy-based inference, with ambiguity and unexplained changes requiring review. Production credit acceptance, signing and broadcasting stay disabled.

## Validation

418 local tests pass, including 19 new tests for fee-aware balances, replay/conflicts, pending-job exclusion, freshness/history/account gates, delay/timeout, corrected late confirmation, partial/full refunds, spending shortfalls, cumulative fees, batch limits, database isolation, restart, failed-save rollback and real-ledger isolation.

Actual local HTTP checks exercised normal, unknown-transfer, refund and refund-after-spend cases, verified unauthorized action rejection, and repeated after restarting the Operator. Real fees/plans/production jobs/project credit remained zero; no key loaded and every real execution flag false. UI was visually verified. No real transfer, card charge, billing change, GPU experiment, public source push or remote deployment occurred.

Next possible work is shadow evaluation against read-only real records with explicit baseline and coverage controls. That would report proposed accounting without posting credit. Live activation remains a separate decision and is not enabled by this simulation.

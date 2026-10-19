# Runpod usage and reversal accounting

October 19, 2026: the authenticated read-only adapter is verified and all 464 local tests pass. The owner restarted the Operator successfully; live validation at 2026-10-19T04:28:15Z confirmed WATCHING, preserved original balances and all execution disabled. Restart persistence was independently verified at 2026-10-19T04:33:53Z after the owner restarted the Operator again. The launcher now uses an absolute PowerShell path and basic HTTP parsing to avoid ordinary-terminal startup issues.

## Read-only source

The existing fixed GraphQL query reads balance and bounded reload history. A same-credential read of `clientLifetimeSpend` returned Unauthorized, so the implementation does not request that field. Instead it reads account-level usage from the supported [Runpod REST v2 billing endpoint](https://api.runpod.io/v2/billing) using the same existing project credential. No permissions or account keys were broadened.

The server saves `runpodUsageStartTime` once in local treasury settings, aligned to UTC midnight. Every daily billing query starts at that same anchor; its end advances with time. Normalization validates the returned window, bucket identity and uniqueness, record count and aggregate total. The journal binds its counter to the source, anchor and bucket size, and rejects a changed window rather than interpreting it as a refund. Daily rows are context; only aggregate-counter changes enter accounting. This is account-level usage, not proof of spending by a specific Pod or project.

The actual read at 2026-10-19T04:24:09Z succeeded: balance 9,073,882 micro-USD, one historical reload, and zero usage/zero billing rows for October 19 UTC. This verifies access and normalization, not live spend or refund behavior. Usage increases, adjustments and reversals are fixture-tested; no real refund sample was generated. GraphQL types do not establish how every refund will appear.

Queries remain bounded: the fixed billing anchor expires after 365 days and the reload feed covers 90 days. Missing tracked history or an expired anchor holds for review. History archival/controlled rollover is future work; the system never silently resets the baseline.

## Shadow rules

`shadow-provider-accounting.js` is a pure accounting module with no network, signer, treasury posting, payment or GPU capability. The existing shadow observer invokes it and persists its results atomically with card/reload entries.

- A new usage baseline records the anchored billing counter without importing historical spend. Attaching it to an existing funding journal preserves the original card/Runpod balances and requires no unexplained provider balance change or new provider transaction in that attachment observation.
- An increased counter records usage. A decrease can reverse only usage tracked since attachment, and must agree with the provider balance. It is a **usage-counter reversal**, not proof of a refund to a card.
- Completed positive `CREDIT` records and `DEBIT` records are separate account adjustments. Debit type determines the outflow direction for either signed or magnitude-style amounts. They do not become token fees or inferred card-funded inflow. Unsupported types/media remain held.
- A previously accepted positive Stripe reload can decrease to a nonnegative amount only if its identity, date, medium, type and completion status stay unchanged. The difference is recorded as a **reload amount reduction**. Amount increases or other edits require review. An old journal without stored original record fields first needs an unchanged observation; a changed record is not silently adopted.
- Reductions of previously matched reloads reduce a separate matched-funding total. Gross proposed inflow remains visible. Reduced unmatched reloads cannot subsequently acquire a new funding match. No card refund or increased SolCard balance is synthesized.

Provider balance conservation is:

`opening balance + new reloads + credit adjustments - debit adjustments - reload reductions - usage + usage reversals + explicit rounding = observed balance`.

Provider floating values are truncated independently to integer microdollars. Residuals up to two microdollars per observation can enter an explicit rounding account, capped at 100 microdollars of cumulative absolute adjustments. Larger differences cannot be written off as rounding.

Balance/counter timing gaps hold all entries atomically for up to 15 minutes. A later consistent observation reconciles once; a persistent mismatch latches for review. Read outages do not reset that grace clock. Other unsupported or conflicting evidence holds immediately. Existing latched holds are not automatically cleared by this update.

Production requires the usage feed after restart. Missing usage cannot silently revert the running console to balance-only accounting. All SolCard funds remain designated for compute, their origin remains separate from token fees, and opening Runpod credit remains legacy. No production spending credit is posted.

## Validation and remaining work

All 464 local tests pass with test temporary files inside the authorized workspace. The first sandbox run passed 451 and failed 13 because Windows denied temporary-file renames; moving test files into the workspace resolved those failures without production changes. Tests cover usage and reversal conservation, changed anchors, malformed/partial billing windows, denied API access, original baseline preservation, stale reads, grace periods, rounding limits, replay and restart behavior.

Live adapter capability evidence: `outputs/bithash-runpod-usage-capability.json` in the October 13 Operator workspace. Full test log: `outputs/bithash-provider-accounting-full-workspace.tap`. The activation script is `outputs/activate-provider-accounting.ps1`; its verification writes `outputs/bithash-provider-accounting-validation.json`. Runtime and actual post-attachment restart verification passed. Original baseline, two journal entries and the anchored usage counters survived unchanged; repeat refreshes did not duplicate entries. The verifier waits for asynchronous startup reads to finish before asserting WATCHING.

All SolCard funds remain designated for compute use, without inventing token-fee origin. Opening Runpod credit stays legacy/unattributed. Signing, broadcasting, payments, GPU activity and real credit posting stay disabled. No public push or remote deployment occurred.

See [shadow funding](SHADOW-FUNDING.md) for the observer and [production funding](PRODUCTION-FUNDING.md) for the unchanged execution boundary.



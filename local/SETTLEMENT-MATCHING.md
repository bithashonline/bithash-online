# Settlement matching — read only

**Simulation follow-up:** [RECONCILIATION-SIMULATION.md](RECONCILIATION-SIMULATION.md) implements a separate policy-based balance ledger with excluded starting funds, fees, refunds and exception holds. The live matching/credit gates described here remain unchanged.

Implemented October 18, 2026. The local Operator exposes `/treasury#settlement-matching`. This joins provider records and reports possible cross-provider matches. It does **not** establish a complete verified funding chain or enable payments.

## Evidence path

1. The existing production reconciler verifies a finalized exact WBTC transfer before passing its job to `FundingRecords.readCardReceipt(job)`.
2. SolCard reads fetch bounded activity and deposit history (up to three pages of 100 each), then details for up to ten matching-card invoices appearing in activity. Existing scopes remain `cards:read activity:read invoices:read perma:read`. No invoice is created. Missing detail, pagination limits and read failures remain explicit.
3. Activity and deposit records join by identical invoice ID, with configured slot/funding-account/address identity checks. Positive completed USD activity supplies the provider-reported net card credit. `swapUsdAmount` is informational and is never used as net credit. The deposit list's `SUCCESS` and invoice detail's `PAID` are distinct status fields, verified against actual responses.
4. For finalized project jobs, an exact paid WBTC amount and configured deposit address can identify possible invoices. The inspected invoice detail does not supply the deposit signature, so even a unique candidate remains unverified. Refunded, unpaid, wrong-asset, mismatched and unavailable-detail records cannot produce this candidate.
5. Completed positive Stripe Runpod reloads are compared with completed negative SolCard activity whose description contains Runpod, using equal USD amounts and a three-day timestamp window. This is a review heuristic, not proof. Multiple possible debits or one debit matching multiple reloads are ambiguous. No allocation from an individual card top-up to a subsequent card debit is asserted.

`readCardReceipt` and `readProviderReceipt` still return `unavailable`, never a `credited` receipt. Matching diagnostics are saved on reconciliation jobs and carried into production-job status. The real reconciler's credit acceptance gate is unchanged. No amount/date/merchant match advances a job to completed or posts project credit. No manual override or approve-credit button was added.

## Persistence and freshness

`funding-records.sqlite` now includes `settlement_observations`. Matching snapshots are deduplicated by content and the latest 100 changes retained; the UI shows ten. Snapshots are private observations, not accounting entries. Restart restores the history; current matching re-evaluates freshness from the feeds, excluding stale or unavailable feeds. Polling remains every five minutes while the local process runs. It is not an installed service.

Observed record status/amount changes are re-evaluated. History remains available for review but does not reserve a receipt or authorize spending. There is no future execution authority implied by a historical match.

## External capability check and remaining gaps

The connected SolCard tools returned activity ID/type/description/amount/currency/status/date; invoice detail returned invoice ID, amount, currency, status, address, network, refund signature and payment amounts. A refund signature is not the incoming deposit signature. The inspected response had no incoming signature. See [SolCard MCP documentation](https://www.solcard.cc/uk/resources/mcp).

The current Runpod adapter reads reload ID, completion date, amount, medium and type. The [official GraphQL specification](https://graphql-spec.runpod.io/#definition-StripeReloadTransaction) also lists `mediumId` and `receiptLink`; neither establishes a cross-provider link to the fields currently returned by SolCard. This slice does not fetch private receipt URLs or infer payment identities from IDs. Authenticated schema introspection was unavailable; the published schema and connected reload feed were inspected instead. No claim is made that every possible provider export or support channel has been exhausted.

Before automatic credit acceptance: obtain an authenticated incoming-deposit signature binding, a reliable project-card charge/reload binding, and a reviewed allocation/reversal model for pooled card funds. A dedicated card and matching amounts alone do not supply those links. Missing evidence remains a blocker, not a passing test.

## Validation

399 local tests passed (14 new settlement tests). They cover net-credit vs conversion values, wrong chain terms/asset/amount/address, precision, refunds/pending states, invoice identity, ambiguous deposits and reloads, stale/partial reads, bounded pagination, errors, durable deduplication, HTML escaping and a synthetic finalized transfer that correctly remains awaiting-card. All transaction fixtures use generated test keys; no real signing key or transfer is used.

Actual read-only validation on October 18 Toronto time linked one existing SOL deposit invoice to its card credit. It did not attribute that deposit to project WBTC fees. The existing Runpod reload had no matching card activity. Both feeds were fresh; real fees/plans/jobs/project credit remained zero. Protected refresh rejected an unauthorized POST and accepted an authenticated one. Signing, broadcasting, payments, automatic credit posting and GPU actions remained disabled. Source is local only; no public publication or remote deployment in this slice.


## Dedicated compute card shadow observer
The owner has designated all SolCard funds for compute. [Shadow bookkeeping](SHADOW-FUNDING.md) now uses real read-only records to classify the opening card balance and propose unique later card/reload matches. Fund-use designation does not establish token-fee origin. Opening Runpod credit stays legacy. Shadow matches are policy inferences and cannot post production credit; the existing production evidence gates remain unchanged.

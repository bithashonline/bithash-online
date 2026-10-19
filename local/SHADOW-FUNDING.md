# Real funding records in shadow mode

Implemented locally, October 18, 2026. This observer reads the existing authenticated SolCard and Runpod funding feeds. It writes only a separate `shadow-funding.sqlite` journal. It cannot sign, broadcast, charge a card, post spendable treasury credit or operate GPUs. It does not require an AI model call.

## Owner designation and opening balances

The owner explicitly designated the entire connected SolCard for compute. The first complete, fresh snapshot records its balance as **opening compute funds, origin unverified**. Subsequent positive card activity is also for compute; it is not automatically token-fee income. Invoice-linked deposits and other positive adjustments are separate journal categories. No prior activity is replayed as new income.

The existing Runpod balance is a separate **legacy opening balance**. Its historical funding cannot be attributed to the project card from the available records. The card designation does not change the origin of this older provider credit.

Account identities, opening balances and record fingerprints persist across restart. SolCard's identity uses a hash of the already-validated funding account, slot and deposit address; Runpod uses its account hash. No account credential or card number is stored by the shadow module.

## Automatic bookkeeping

Existing read-only feeds refresh every five minutes while the local Operator runs. Shadow reconciliation checks every minute and through the protected **Refresh shadow bookkeeping** button. It does not install a background service or run when the local process is closed.

The shadow ledger requires authenticated feeds no older than six minutes, observation times within one minute of each other, the expected account identities, an active card and complete bounded card history. An in-progress refresh is not consumed as a coherent snapshot. Provider history is the existing 90-day Stripe reload feed, not all payment methods.

New completed card activity must exactly explain the change from the last accepted card balance. Positive invoice-linked amounts are deposits with unverified origin; other positive amounts are unclassified adjustments, which can include refunds. Negative amounts are card debits. Integer microdollars preserve the provider amounts; fees or spreads are never invented to make totals agree.

New positive Stripe reloads must explain the change in provider balance. One new reload can be proposed as card-funded only when exactly one accepted new card debit matches its amount, Runpod merchant label and date within three days. The shared matcher rejects debit reuse and ambiguous candidates. Multiple unresolved funding paths require review. A late reload can match a prior accepted debit. Opening reloads never become new funding.

Matches are labelled **policy-reconciled shadow only**. They are accounting inferences, not proof from a shared payment reference. The displayed proposed provider funding is cumulative matched inflow, not available provider credit. Production reconciliation still requires its existing evidence gates and receives no shadow credit.

## Holds and limits

Stale/unavailable feeds, partial card history and pending activities pause reconciliation until valid evidence returns. Account changes, changed or missing settled records, historical backfills, ambiguity, unsupported provider adjustments and unexplained balance changes persist a review hold. All new entries in a failed observation roll back together. There is no automatic baseline reset or button that invents a balancing adjustment.

Provider usage/cost accounting is not connected in this slice: a Runpod balance decrease cannot yet be reconciled automatically. Provider reversals and changes to settled records likewise require review. The journal is bounded to 1,000 entries; rolling history loss holds for review instead of being silently discarded. A future reviewed correction/history archival workflow is still needed for sustained production operation.

The previous bookkeeping simulator remains independent, with invented balances and its original example allocation policy. Its outputs are never imported into the real shadow journal.

## Validation

443 local tests passed, including 25 new shadow tests for baseline classification, unique/delayed matching, duplicates and unusual record IDs, legacy history exclusion, adjustments, stale/busy/partial inputs, pending records, account/history changes, ambiguity, provider balance gaps, atomic holds, disk reopen and escaped UI. Protected console checks verified session, origin and CSRF rejection paths. Actual read-only feeds, repeat refresh and an actual Operator restart were checked. No new real deposit or card-to-Runpod payment was made; those matching paths remain fixture-tested.

See [settlement matching](SETTLEMENT-MATCHING.md), [production funding](PRODUCTION-FUNDING.md) and [simulation bookkeeping](RECONCILIATION-SIMULATION.md) for their separate evidence and execution boundaries. This source slice is local only until separately published.


## October 19 source update, pending activation
[Runpod usage/reversal accounting](RUNPOD-SHADOW-ACCOUNTING.md) is now implemented and fixture-tested in local source. The running Operator has not been restarted: automatic command-approval review failed before live verification. The earlier deployed limitations above remain the runtime status until that check and restart succeed.

October19 follow-up: actual REST billing adapter verified and464tests pass. Supersedes the earlier unverified lifetime-query plan. Corrected local launcher awaits owner rerun after a missing PowerShell PATH startup failure; see RUNPOD-SHADOW-ACCOUNTING.md. No execution enabled.

October19 completion: RESTusage accounting active, actual ownerrestart persistence verified04:33:53Z; WATCHING with originalbalances and2entries, all executiondisabled. Supersedes pendinglaunch notes. See RUNPOD-SHADOW-ACCOUNTING.md.

# SolCard to Runpod: verified funding route

Verified October 19, 2026, using official documentation, the public Runpod REST v2 schema, the signed-in Runpod billing console and a read-only SolCard card query. No payment, card save, default-card change, auto-pay toggle, transfer or GPU action was performed.

## Recommended division of responsibility

Use Runpod's native auto-pay against the dedicated project SolCard. The Operator maintains a bounded card balance ahead of the provider's recharge threshold, then observes card charges and provider credits. Runpod initiates the card charge. The Operator does not need card-number or CVC access for this route.

Proposed future flow:

1. Observe finalized project distributions and keep surplus in the compute wallet.
2. Project Runpod runway from actual usage; decide whether a bounded WBTC-to-SolCard deposit is needed.
3. Wait for observed available USD card credit. Never assume an exchange quote or submitted deposit means usable card balance.
4. Once separately enabled by the owner, Runpod auto-pay charges its default saved card when credit nears the configured threshold.
5. Observe the card debit and Runpod reload. Preserve unknown, delayed, duplicate, reversal and mismatch states; do not initiate an extra payment because a record is late.
6. Use only the eventually approved credit-accounting policy to feed fleet spending. Current shadow proposals remain non-spendable.

## What is verified

- [Runpod billing](https://docs.runpod.io/accounts-billing/billing#auto-pay) documents a saved default card, configurable threshold and reload amount, with attempts limited to once per hour.
- [SolCard's Runpod guide](https://www.solcard.cc/merchants/hosting/runpod) explicitly describes SolCard fitting this card-based auto-pay route. This is a provider compatibility claim; this project's specific card has not completed a Runpod payment.
- [SolCard MCP documentation](https://www.solcard.cc/resources/mcp) exposes card/activity/deposit reads and optional invoice/address creation. It exposes no merchant-charge, send or withdrawal tool, and does not return full card numbers, CVC or expiry. The connected grant currently exposes only the six read tools.
- The live [Runpod REST v2 specification](https://api.runpod.io/v2/openapi.json), version 2.0.0 with 41 paths, exposes six GET billing paths and no documented card-charge or auto-pay configuration endpoint. This is scoped to the inspected public API, not a claim about private console internals or future support.
- The actual Runpod console showed auto-pay disabled and a saved default card different from the active SolCard. The account balance was positive and current spend zero. Sanitized account details and the screenshot are retained only in the task's local outputs.

## Implementation choices and limits

Use a fixed reload batch first, within the owner's proposed $100–$500 range. A $100 batch is an illustrative starting configuration, not an enabled or approved payment. Runpod recommends at least $100 per prepaid-card deposit; this is not proof of a universal enforced minimum. The current UI's disabled state did not expose editable auto-pay threshold/amount values, so their account-specific limits remain unverified. A Runpod funding blog additionally mentions a $100 active-balance eligibility condition; confirm eligibility in the console during a later authorized setup rather than assuming that the toggle alone proves it.

The Operator can vary when/how much it funds the card and how much compute it proposes. Dynamic editing of Runpod's reload amount is not verified through a supported API. A native reload setting is also not a daily budget: several reloads may occur over a day. The Operator needs separate rolling deposit/spend limits and must account for existing card/provider float. A local hold cannot be assumed to disable Runpod auto-pay; there is no verified remote disable control in the inspected public API. Do not rely on repeated card declines as the normal budget-control mechanism.

Choose the threshold and card-funding lead time from burn rate plus observed deposit, conversion and reload latency. Keep enough card balance for the configured reload before Runpod reaches its trigger, including any observed fees. [Runpod support](https://contact.runpod.io/hc/en-us/articles/50824823264275-Why-Auto-Pay-Gets-Disabled) says repeated declines eventually disable auto-pay. Card acceptance and any authentication challenges remain unproven until a later separately authorized payment.

The existing read-only feeds do not expose a verified default-card/auto-pay-settings observation. The initial console inspection is evidence at a point in time, not continuous monitoring. Supported settings visibility or an explicit owner-attested configuration will be needed for readiness checks. Exact cross-provider payment attribution remains unresolved; the dedicated-card shadow reconciliation policy does not change that fact.

## Implemented simulation — October 19

`runpod-autopay-simulation.js` now implements the pure `planAutoPay` policy and an isolated persistent `RunpodAutoPaySimulation`. The coordinator exposes a read-only balance forecast through `view.autopay`; it does not replace the existing production intent policy or create real plans. `/treasury#runpod-autopay` presents that forecast separately from seven invented simulation scenarios. Its protected controls use the existing loopback session, origin and CSRF checks.

Each simulated Runpod reload is exactly $100. Other settings are examples: $50 threshold, two hours of deposit lead time, $100 minimum card deposit, $500 combined float, $1,000 rolling-day deposit and reload limits, $100 retained WBTC value, 30-minute card settlement, two-minute ordinary reload settlement and one-hour attempt spacing. The simulated conversion assumes $100,000/WBTC and zero fees. These do not configure provider settings or establish owner spending authority.

Normal cases begin with invented 0.01 WBTC total fees, split 70/30, and $75 legacy provider credit. Assumed usage is $20/hour. Opening credit is consumed separately from matched sample funding; finite treasury/card/provider/in-transit/spent balances conserve the initial value. Each case has separate funds. The insufficient-treasury case starts with less WBTC; the daily-limit case assumes the day's allowance is already exhausted.

Pending deposits and reloads retain their IDs; duplicate receipt IDs cannot add credit twice. Delayed reloads wait; declined, unknown and mismatched reload outcomes hold local simulation and do not count as available funds. A held simulation freezes its virtual clock; this does not claim that real provider usage or auto-pay would stop. No provider retry/cancel API is connected. One simulated minute advances every three seconds while a case is running. Cases survive restart; reopening a case never resets funds. Validation leaves cases paused for inspection.

Storage is a separate `simulation-autopay.sqlite`, rejecting unrelated schemas. The simulator accepts no network/payment/wallet/GPU client. Sample receipts explicitly require a simulation source. Actual provider observations are used only by the coordinator's pure forecast and never imported as sample deposits. Zero planning burn gives an idle forecast; actual auto-pay can behave independently if later enabled outside this app. The forecast does not continuously verify default-card/settings, prove fee origin, or supersede the existing funding authorization gates.

Validation: 508 local regression tests pass, including 14 new policy/ledger/integration tests. The final UI adjustment passed the same 14 targeted tests. Local HTTP verification covers session/origin/CSRF, seven sample scenarios, real-ledger isolation and actual restart persistence. The first verifier compared the snapshot's changing read timestamp; that assertion was corrected to compare all remaining treasury fields. Final verification passed at 2026-10-19T06:28:10.759Z. Real Runpod billing was separately read in-browser and remained disabled. No transfers, card charges or GPU experiments occurred.

Evidence is in the October 13 task's local outputs: `bithash-autopay-full-tests.tap`, `bithash-autopay-ui-tests.tap`, `bithash-autopay-validation.json`, `bithash-autopay-console.png`, `verify-autopay-simulation.mjs` and `activate-autopay-simulation.ps1`. Source is local only, not a new public release.

## Remaining work

Before a live rollout, reconcile this native-reload policy with production funding intents and accepted settlement accounting, obtain authoritative settings visibility or reviewed owner configuration, and establish safe recovery for ambiguous payments. The $100 simulation does not enable either fee collection or SolCard deposits. Actual payment acceptance, settings eligibility and independently authorized custody/execution remain unverified.

Later setup requires the owner to save the project SolCard in Runpod, verify the intended primary card and personal-card separation, and separately authorize auto-pay settings and a bounded payment test. Do not enable auto-pay merely to inspect its form: the existing balance may already be below the proposed threshold.

## Same-day account follow-up
The owner subsequently added the project SolCard and removed the personal card. A read-only console check confirms the sole saved primary card matches SolCard and auto-pay remains disabled. This supersedes the earlier mismatch; payment acceptance and auto-pay settings remain untested.

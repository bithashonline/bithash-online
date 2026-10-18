# Direct WBTC funding — local preview and offline execution model

Current integration: see [October 18 release](../experiments/2026-10-18-treasury-funding.md), [production observer](PRODUCTION-FUNDING.md) and [continuous shared simulation](CONTINUOUS-FUNDING.md). Earlier validation counts and pending-work notes below describe that component’s original implementation stage.

Implemented October 18, 2026. This release sends no money and performs no GPU work.

Follow-up: [restricted offline signer and read-only background reconciliation](RESTRICTED-FUNDING.md)
are now implemented locally. The original preview/simulation below remains isolated;
production custody, card/provider receipt adapters and live payment execution remain
unconnected. Combined verification now passes 58 tests.

## Token verification

Pump's [supported pair list](https://pump.fun/docs/custom-pairs) and SolCard's
[September 24 token announcement](https://www.solcard.cc/blog/wbtc-weth-crypto-card)
both list Solana Portal WBTC mint
`3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh`.
SolCard says it converts confirmed deposits to USD card credit. A separate
WBTC-to-USDC swap is therefore unnecessary for this route. This verifies published
support, not a completed WBTC deposit or a guaranteed conversion rate.

The owner inspected the issued card's WBTC deposit screen and reported a minimum
of 0.0001 WBTC, maximum 1.2531 WBTC and no displayed fee. The supplied destination
matches the permanent Solana address returned by the authenticated SolCard MCP.
Limits and fee display are owner observations; an exchange-rate spread has not been
verified. Card/address/balance data stay in the private Operator directory.

## Implemented flow

`treasury-funding.js` provides a read-only preview and a durable offline funding
state machine. The Operator's `/treasury` page and session-protected
`/treasury/status` expose the preview. The preview checks:

- exact network, mint, decimals, card status and matching destination;
- fresh card and wallet observations (five minutes), card limits (24 hours);
- the existing 70% compute allocation and available observed WBTC;
- owner per-transfer and rolling 24-hour WBTC caps, counting completed transfers;
- a fresh SOL reserve observation and a configured network-fee allowance;
- unresolved prior direct-WBTC funding before preparing another top-up.

The real private profile deliberately leaves owner caps unset. Card limits do not
authorize spending. A `review-ready` preview still cannot send money. Requesting
a preview stores only its amount, never a real reservation or an invoice.

The isolated simulation progresses through:

`prepared -> awaiting-chain -> chain-confirmed -> card-credited -> complete`

Its SQLite plan persists exact terms and one submission attempt. Replays reuse the
same plan; changed terms conflict; an unknown result stays pending without another
send. A failed confirmation holds the reservation for reconciliation. Card credit
must follow confirmation; provider credit cannot exceed card funding. Partial net
provider credit is retained, and unrelated personal provider balances do not become
project funding. All executable simulation entry points reject owner-recorded
ledgers. No network adapter, wallet signer or payment client is accepted.

The console's offline rehearsal uses an independent in-memory simulation ledger.
Its invented exchange amounts are not a price quote. Only the labelled rehearsal
summary is stored in the main ledger settings; its financial balances remain zero.
The separate restart test uses a simulation-only database on disk.

## Manual accounting compatibility

New console plans use route `solcard-wbtc` and record:

`planned -> deposit-submitted (WBTC units) -> card-funded (USD micro-units)
 -> provider-credited (USD micro-units)`

These remain owner-recorded observations, not execution or independent transaction
verification. Submission invalidates the pre-payment wallet balance and prevents
casual cancellation. Older `solcard`, `kast` and `provider-checkout` plans retain
their original USDC conversion path. Nothing migrates or reinterprets old records.

## Private configuration

The Operator connection JSON accepts `fundingProfilePath`, pointing to a private
`bithash.solcard-profile.v1` observation file. It is validated and loaded on startup.
The current card read is a saved MCP observation, not backend OAuth or polling.
Expired observations hold the preview until refreshed. Do not copy Codex OAuth
tokens into the Operator or put private account data in source control.

## Before real activation

Remaining work: an independent authorized backend card reader, attributable fee
ingestion, a bounded transaction signer with transaction decoding and fresh
pre-submission checks, durable chain/credit reconciliation, owner spending policy,
and the actual project-card Runpod billing setup. SolCard's MCP cannot transfer
funds. Card acceptance/Runpod settlement is not established by the simulation.
No runtime switch in this release activates real execution. GPU proposals remain
hard-paused independently of treasury funding.

## Verification

45 tests passed across `treasury-funding.test.js`, `treasury.test.js`,
`operator-live.test.js`, `chatgpt-operator.test.js` and `operator-record.test.js`.
Tests include direct-route accounting, exact-token rejection, stale reads, missing
caps, gas reserve, daily limits, restart/unknown outcomes, replay conflicts,
simulation isolation and session/Origin/CSRF protections. Provider/model actions
are mocks; no GPU acceptance or live payment was used.

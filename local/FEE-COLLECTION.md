# Fee collection — read-only preview

Implemented October 18, 2026. Open `/treasury#fee-collection` in the local Operator. No token mint is configured yet; the observer returns `awaiting-token-launch` without RPC calls. Signing, broadcasting, payments, automatic credit posting and GPU actions are disabled.

## What is connected

`FeeCollection` reads finalized mainnet accounts, verifies the active immutable 70% compute / 30% other treasury routing, and totals WBTC pending on the curve, canonical migrated pool and creator vaults. It constructs only the necessary unsigned instructions: curve/pool sweep, PumpSwap vault transfer to Pump, then distribution. Funds are destined for the configured wallets, not SolCard.

The exact compiled message is reconstructed and checked before unsigned `simulateTransaction`. The preview reports SOL network fees and total simulated SOL cost, including account rent. No wire transaction or RPC logs are saved or exposed in the console. The read-only RPC adapter has a fixed endpoint, method allowlist, genesis pin, response/time bounds, slot floors and blockhash expiry checks. Observations expire after 60 seconds.

Optional private configuration `feeCollectionPolicy` requires positive decimal-string lamport values for `maxNetworkFeeLamports`, `maxTotalCostLamports` and `minSolReserveLamports`. Missing limits hold the result; simulation examples never become approved spending authority. A passing preview still cannot sign or broadcast.

The existing finalized fee-receipt observer now understands supported combined sweep/bridge/distribution transactions. It verifies canonical incoming transfers when reconciling the creator vault's net balance, and counts only the compute distribution once. Preview balances never become receipts, funds, production jobs or spendable credit. Existing dry-run decisions can use verified distribution receipts. Vault deposits can include donations, so this does not independently establish trading-fee provenance.

The separate private `fee-collection.sqlite` records observation changes and links to receipt-observer status. It rejects unrelated schemas, binds its token/wallet identity and deduplicates events across restarts. The worker refreshes every minute only while the local process runs; this is not a service or remote deployment. Refresh actions use the existing protected console session/Origin/CSRF checks.

## Supported protocol and limits

Account layouts and instruction metadata are pinned to official Pump public documentation commit `639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22`. The extracted subset is `fixtures/pump-collection-schema.json`; it contains public protocol metadata only.

- [Fee sweeps](https://github.com/pump-fun/pump-public-docs/blob/639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22/docs/instructions/SWEEP_FEES.md)
- [Creator fee sharing](https://github.com/pump-fun/pump-public-docs/blob/639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22/docs/instructions/CREATOR_FEE_SHARING.md)
- [Pump IDL](https://github.com/pump-fun/pump-public-docs/blob/639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22/idl/pump.json)
- [PumpSwap IDL](https://github.com/pump-fun/pump-public-docs/blob/639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22/idl/pump_amm.json)

Only the configured Portal WBTC mint, standard SPL token program, current supported curve/pool layouts and exact canonical accounts are accepted. Holder-reward modes, mutable/different routing, legacy or CPI distributions and incompatible layouts hold rather than being inferred. Upstream upgrades require review. The existing bounded public-RPC receipt scan does not prove complete historical coverage.

## Validation and remaining activation work

385 local tests pass. Coverage includes both sweep paths, unsigned message integrity, cost/expiry/network/account holds, receipt inflows without double counting, persistent journal behavior, protected console actions and disabled execution. Successful RPC/simulation paths use fixtures; this unlaunched project's collection has not been live validated.

Actual local console validation returned awaiting-token-launch, zero receipts/jobs/project credit and all execution flags false. An unauthorized refresh returned 403; an authenticated refresh returned 303. No wallet key, collection transaction, account creation, transfer, card charge, billing change or GPU experiment was performed.

After token creation, configure its public mint and validate actual routing/accounts. Separately authorized activation still needs independent custody/spending authority, approved cost limits and SOL availability, attributable chain/card/provider reconciliation, verified project billing and durable hosting. This module does not enable those capabilities.

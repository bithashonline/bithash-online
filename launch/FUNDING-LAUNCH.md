# Launch checklist — bounded scope

This release connects the funding observation lifecycle and unsigned holder-reward preparation. It does not claim autonomous live treasury operation.

## Complete in the disabled build

- Finalized distribution observation with the 70/30 recipient check; unsigned fee-collection preview.
- Persistent compute-funding intents, restricted transfer inspection, read-only mainnet preflight, $100 reload planning and production-job handoff.
- Dedicated-card SolCard/Runpod bookkeeping, usage and reversals. A uniquely matched funding cycle can close as a policy observation, retain consumed receipt allocations and permit the next dry-run intent. Uncertain outcomes wait; changed completion evidence holds.
- Complete holder snapshots, proportional WBTC manifests from half of the second treasury, separate development reserves, duplicate prevention and read-only payout reconciliation.
- Optional automatic unsigned reward-round preparation; all real execution stays disabled.

## Configuration needed before a test-token observation

1. Supply the token mint and verify the actual WBTC pair, supported Pump accounts and on-chain 70/30 recipients. A token launch itself is outside this build.
2. Set reviewed funding limits, refresh wallet/card observations, and provide a current conversion estimate. The coordinator still uses planning assumptions and has no live GPU quote.
3. Choose holder eligibility exclusions, cadence and payout limits. In particular, review liquidity/program accounts. The rewards example is deliberately inactive.

These steps permit read-only observation and unsigned preparation. They do not enable money movement.

## Remaining work before autonomous live operation

1. Connect the production jobs to a restricted custody/signing and submission service for fee collection, compute deposits and rewards. The runtime currently has no loaded wallet key or enabled submission path. Persist a signed attempt before submission and resolve uncertain outcomes before retrying.
2. Add live reward fee/rent preflight and execution checks for recipient account creation. Connect a current bounded deposit conversion quote/estimate; do not treat a hypothetical WBTC/USD price as a SolCard guarantee.
3. Explicitly activate the dedicated-card settlement policy and spendable-credit/fleet execution boundary. Current matches are policy inference, not exact cross-provider proof, and post zero spendable credit. Runpod's native auto-pay is separate from this service; a local hold cannot turn it off.
4. With separate authorization, run one small end-to-end money-flow acceptance test, including a test holder payment. Observe actual card/provider settlement and recovery before raising limits. A new GPU performance benchmark is not required for this funding test.

No real transfer, card charge, auto-pay change or GPU experiment is authorized or performed by this release. Native Runpod auto-pay stays off. Public source contains example configuration and fixture evidence only; private account records and databases are excluded.

## Reproduce this source release

Use Node.js 22.16 or newer. From the repository root, run `npm ci --prefix local` and `node --test local/*.test.js`. The isolated release passes 499 tests. The development workspace's additional existing tests bring its count to 538; these are distinct test inventories. No test requires actual wallet signing, card billing or a GPU rental. Some fixtures start localhost servers or child processes, which requires a local environment that permits those operations.

Publication review inspected intended files, all reachable Git history and embedded source archives. Pattern matches were rejection fixtures and synthetic test credentials; runtime credentials, account records, databases and browser/session exports are excluded.

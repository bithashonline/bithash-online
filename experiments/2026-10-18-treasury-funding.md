# Treasury funding integration — October 18, 2026

This source release adds the local treasury-to-Operator connection, read-only provider records, fee detection, restricted transaction inspection, persistent funding jobs, fleet budgets and continuous replenishment simulation. It does not enable real funding or GPU execution.

## Implemented and tested

- 70/30 compute/other treasury bookkeeping with integer amounts, duplicate detection and explicit owner-recorded provenance.
- Finalized Solana wallet reads and a narrow Pump fee-distribution observer. The project token is not yet configured; no live fee-origin claim is made.
- Authenticated SolCard and Runpod record readers. Credentials are private and encrypted; the client exposes reads only. Provider account balances remain separate from attributable project credit.
- Offline restricted signer tests and a keyless production inspection interface. Real signing, broadcasting and GPU proposals remain disabled.
- Durable simulated fee-to-card-to-provider jobs with interruption/replay tests. Independent legacy fixtures are separate from the continuous shared-treasury simulation.
- Continuous replenishment using $100–$500 example batches, retained WBTC reserves, bounded operating credit, fee-responsive fleet sizing and review holds. Rates, funds, receipts and compute consumption in that loop are synthetic.
- Production observe-only jobs bind existing owner-recorded plans to exact transfer terms and existing transaction signatures, then hand verified finalized transactions to the read-only reconciler. No automatic real credit posting occurs.

## Validation

The isolated publication checkout passed **294/294 local tests** after installing the committed lockfile with lifecycle scripts disabled:

```sh
npm ci --prefix local --ignore-scripts --no-audit --no-fund
npm --prefix local test
```

The targeted funding/Operator subset passed 158 tests before publication. These counts overlap. Tests use synthetic keys/receipts and mocked external effects; they do not transfer funds or rent GPUs. The actual local console was separately checked for fresh read-only provider connections, disabled execution, simulation/real-ledger separation and protected refresh routes. Its real ledger had no fees, funding plans or project credit. No sample plan was inserted into that real ledger to manufacture an end-to-end demonstration.

Runtime access to the encrypted funding credentials currently requires Windows and PowerShell 7 (`pwsh.exe`, or `BITHASH_POWERSHELL_PATH`). Platform-independent tests use injected fixtures. This is local software, not a continuously hosted funding service.

## Remaining gaps

SolCard records do not yet prove which chain transfer funded a card credit; Runpod reload records do not identify the project-card payment. Amount/time matching is insufficient, so real reconciliation holds instead of posting credit. Live account/fee preflight, production custody, independently enforced owner policy, fee claiming, verified project-card billing and durable hosting remain activation work.

The latest implementation contracts are [production observation](../local/PRODUCTION-FUNDING.md), [continuous simulation](../local/CONTINUOUS-FUNDING.md), [provider records](../local/FUNDING-RECORDS.md), [automatic rules](../local/AUTOMATIC-FUNDING.md), and [restricted signing](../local/RESTRICTED-FUNDING.md).

## Publication review

Reviewed current source plus 29 preceding public commits and 50 archived members. Pattern findings were nonfunctional rejection-test URLs, synthetic credentials and already-public historical local paths. No new credentials, runtime databases, session exports, private keys, account records or private configuration are included. This is a scoped publication review, not a security audit or a guarantee that all defects have been found. Existing source and historical evidence are preserved.

# Proposed architecture
October 3, 2026. Production architecture proposed; fixture-only local reference implementation exists in local/. See PROJECT.md and local/README.md for tested scope and limitations. No production financial/provider integration exists.

## Product promise
Participating coins contribute a disclosed share of creator fees to real GPU searches of intentionally public Bitcoin puzzles. Every displayed number identifies whether it is collected, reserved, billed, reported by a worker or independently checked. Never imply spending guarantees a solution.

## Flow
Wallet launch -> onchain fee-sharing configuration -> confirmed creator-fee receipts -> per-coin ledger -> pooled compute reserve -> approved provider job -> assigned range -> checkpoints/results -> evidence dashboard.

## Components
1. Launch builder/verifier: use current official protocol SDK/IDL; validate message, allowed programs, payer and configured fee recipient. Confirm atomic create/routing feasibility independently; Agency's claims are not proof.
2. Fee reconciler: receipts and exact integer amounts; unique signature/instruction keys; distinguish creator fees from gross volume, all trading fees and unrelated deposits.
3. Accounting: double-entry per-coin contributions, pooled cash, compute reserve, conversions, billing, gas and operation costs. Reconcile actual assets plus provider credit. Define contribution attribution before buying shared compute.
4. Treasury signer: no keys in browser or worker. Separate approval/controller and signing; hard destination/asset/spending limits. Disclose operator powers and distinguish software restrictions from onchain enforcement.
5. Payment adapter: provider APIs often use fiat/prepaid credit. Confirm accepted payment method, refund/credit terms and trusted conversion path. Never assume crypto fees automatically pay a rental invoice.
6. Job controller: approved solver image pinned by digest; non-overlapping leased ranges; idempotent provider job creation; fixed runtime/cost caps; independent budget monitor and shutdown; outstanding provider liabilities count as spent/reserved.
7. GPU worker: no treasury keys. Report device, solver version, exact half-open range, benchmark rate, checkpoints and termination cause. Restart with safe overlap/checkpoint rules; expired leases may cause duplicates, never silently count them twice.
8. Evidence dashboard: fee receipts, conversions, invoices/provider records, active jobs, distinct reported coverage and spot checks. Rental receipt is not proof every candidate was tested; sampled checks are not full cryptographic coverage proofs.
9. Candidate verifier: separate trusted process derives exact target address from any returned candidate. Treat a potential unsolved key as secret; never post it to logs/dashboard. Prize transaction/submission plan deferred pending explicit ownership decisions.

## Failure requirements
Reconcile ambiguous sends before retry. Provider timeouts after successful creation must not duplicate jobs. Pause new work on stale prices, solvency mismatch, provider billing uncertainty or invalid worker results. Stop or switch target under the agreed policy if chain state shows #71 solved. Keep shutdown controller independent of job worker.
Budget exhaustion must stop new jobs and terminate running jobs within defined provider latency; account for minimum charges and delayed billing.

## Realism
2^70 candidates ≈1.18e21. At illustrative1e9 candidates/s, full sweep≈37,400years; expected first match half that for uniformly located target and exhaustive no-overlap search. Not a hardware benchmark or success promise. For n unique uniformly chosen candidates, chance n/2^70 until full coverage. Refresh public-key status; exposed-key algorithm work/coverage is not equivalent to address-only brute-force counter.

## Agency comparison
Reuse architectural lessons: separate signer, accounting, confirmed receipts and policy rules. Replace minds/model credits with deterministic compute budgeting and job control. Do not copy private backend, claim equivalent tested security, or inherit the15%AGENCYburn/20USDwake/0.1SOLhalt economics unless user explicitly chooses analogous rules.

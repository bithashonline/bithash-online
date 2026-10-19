# Mainnet funding preflight — read only

Implemented locally October 18, 2026 (Toronto). Signing, broadcasting, payments, automatic credit posting and GPU actions remain disabled. No project wallet key is loaded.

## What is connected

`ReadOnlyFundingPreflight` connects existing owner-recorded production funding jobs to a fixed Solana mainnet RPC endpoint. It checks the full mainnet genesis hash, finalized mint/source/destination accounts, exact associated-token-account ownership, standard SPL Token program, eight decimals, initialized/unfrozen state, absence of delegate/close authority, and the fee payer's system account and SOL balance. Missing associated accounts hold the job; this slice never creates accounts or adds instructions to the restricted transfer.

It builds the existing single `TransferChecked`, inspects its exact compiled message, retrieves a fee for that message and simulates the serialized **unsigned** transaction with `sigVerify:false` and `replaceRecentBlockhash:false`. The live blockhash stays identical between the message, fee request and simulation; slot floors prevent responses from moving backward. Block height is checked afterward. No `sendTransaction` or signing interface exists in this adapter.

Configured per-transfer/rolling-day caps, network-fee cap, SOL reserve and retained WBTC reserve are checked. The optional profile-policy field `minRetainedWbtcUnits` must be explicitly set (including explicit zero) before preflight can pass; no simulation policy is promoted to real authority. Other unresolved plans block a clear result. Rolling commitments come from local owner-recorded plans, so they are **not an independent custody/spending authority**. Fee provenance, fresh card limits and provider attribution remain separate job gates.

Plans, destination and policy are rechecked after asynchronous reads. Results persist with the jobs, but expire after 60 seconds and never authorize signing. Only hashes, public account observations, bounded statuses and reason codes are stored; unsigned wire and provider simulation logs are excluded. RPC responses are size bounded, redirects rejected and each operation time bounded. This is a snapshot from one RPC provider, not independent chain attestation or a reservation of balances/blockhash lifetime. Any future execution requires fresh checks and separately implemented authority.

The protected console also offers **Check live wallet and destination · read only**. This inspects configured accounts without inventing an amount, creating a funding plan or running a transaction simulation. It works before token launch. Existing-signature reconciliation remains separate; preflight never posts credit. Background transaction checks run with existing jobs while the local Operator process is running; account-only diagnostics are manually refreshed. The browser shows the observation time and expiry; refresh to recompute freshness.

## Validation and actual observations

365/365 tests passed in the development checkout; 51 targeted signer/job/preflight tests pass after the final network identifier correction. Tests include exact unsigned RPC payloads, missing/wrong/frozen/delegated accounts, SOL/WBTC/retained-reserve shortages, fee/transfer/day caps, pending jobs, failed simulation, malformed/stale RPC responses, wrong cluster, blockhash expiry, concurrent plan changes, restart persistence and real-ledger isolation. External effects are mocked. Initial sandbox run had 18 existing temporary-file/loopback-access failures; rerun with local test permissions passed all 365.

Actual mainnet account read at 2026-10-19T00:08:29.265Z (October 18 Toronto), finalized slot 458628374: configured compute wallet has no system account and both derived WBTC associated accounts are missing. Console correctly shows held, SOL zero and account-missing reasons. Full live transaction simulation has **not** been demonstrated: no real plan exists and the accounts are not initialized. Successful simulation paths are fixture-tested, not claimed live-funded. First live verification caught a truncated CAIP-style network identifier; corrected to the full genesis hash returned by mainnet and repeated the check successfully.

Actual console verification confirmed the read-only adapter connected, no key loaded, all execution flags false, zero real fees/plans/jobs/project credit and rejection of unauthenticated refresh. Local Operator restart verified. No token launch, transfer, account creation, card charge, provider change, GPU experiment, remote deployment occurred during implementation. This source release publishes the implementation without enabling execution.

Private validation artifacts: `bithash-preflight-validation.json`, `bithash-preflight-all-tests.tap`, `bithash-preflight-targeted-tests.tap`, `bithash-preflight-console.png` and `verify-preflight.mjs` in this task's outputs folder. These are local records, not public evidence.

## Primary API references

- [Unsigned transaction simulation](https://solana.com/docs/rpc/http/simulatetransaction)
- [Message-specific network fee](https://solana.com/docs/rpc/http/getfeeformessage)
- [Account batch and context slot](https://solana.com/docs/rpc/http/getmultipleaccounts)

Next: attributable SolCard/Runpod settlement matching, production custody and independent policy enforcement, then durable hosting and separately authorized activation. No new GPU experiment is required for those development steps.

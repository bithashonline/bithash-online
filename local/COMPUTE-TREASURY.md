# Compute treasury and Operator connection

Current integration: see [October 18 release](../experiments/2026-10-18-treasury-funding.md), [production observer](PRODUCTION-FUNDING.md) and [continuous shared simulation](CONTINUOUS-FUNDING.md). Earlier validation counts and pending-work notes below describe that component’s original implementation stage.

Local implementation, October 18, 2026. No GPU experiments or live payments.

Update: the console now defaults to direct Portal WBTC deposits into SolCard,
which converts them to USD. See [Direct WBTC funding](DIRECT-WBTC-FUNDING.md) for
the verified mint, preview checks and isolated funding rehearsal. The USDC stages
below describe the retained legacy accounting route; existing plans are preserved.

The Operator console at `http://127.0.0.1:4185/treasury` now shares a persistent
`compute-treasury.sqlite` ledger with the fleet-review and proposal code. A separate
treasury-only console can run at port 4191 with the same directory. Do not put this
database, connection configuration, or account storage in the public repository.

## Funding policy

- 70% of recorded creator fees is allocated to compute.
- 30% is allocated to the second treasury: half development, half BTC holder rewards.
- The ledger uses integer token units and cumulative allocation to conserve rounding
  dust. The development half receives any indivisible remainder within the 30%.
- This accounting does not configure Pump fee sharing or verify that a deposit was a fee.
- Wallet holdings alone are never treated as fee income. Existing personal Runpod credit
  is not classified as project fee funding.

Exact Pump-supported asset: WBTC (Wormhole Portal), Solana mint
`3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh`, 8 decimals, original SPL Token program.
This differs from the separate native WBTC mint. Source checked October 18:
https://pump.fun/docs/custom-pairs .

## What works now

1. **Observe wallets.** A manual refresh reads the exact mint and token accounts from
   Solana's public mainnet RPC at finalized commitment. Wrong mint, owner, decimals,
   token program, frozen accounts and malformed responses fail closed. Refresh failures
   invalidate available funds instead of showing stale balances as spendable.
2. **Record fees.** Enter one received fee batch's total WBTC across both wallets and a
   unique reference. Repeat submissions with the same contents count once; conflicting
   references fail. This is explicitly owner-recorded, not independent provenance.
3. **Prepare a SolCard funding plan.** Its WBTC amount must fit both the recorded compute
   allocation and a fresh observed wallet balance. A plan reserves accounting funds only.
4. **Record settlement in order.** Record net USDC received from the manual swap, net USD
   actually received by the project card, then USD credits actually received by Runpod.
   These actions do not submit transfers or payments. A pre-swap wallet observation is
   invalidated after conversion. A planned transfer can be cancelled only with an explicit
   statement that no swap or transfer occurred. Post-conversion records are retained.
5. **Confirm Runpod's current balance.** Usable project budget is the smaller of remaining
   recorded project credit and the observed provider balance, less active reservations.
   This is owner-entered; no provider billing API is claimed connected. Both provider and
   wallet observations expire after five minutes. Missing/stale balances remain unknown.
6. **Operator funding evidence.** A requested fleet review receives a hashed
   evidence record containing the available budget, recorded spending and its owner-recorded
   provenance. The digest detects changes; it does not prove payment. Deterministic funding
   advice is available without a model call, with optional runway at an entered hourly cost.

## Pause and authorization boundary

The actual local Operator server hard-pauses `/live-plan` before any model, quote or
proposal call. There is no UI enable switch. No GPU experiments were performed.
The treasury console has no wallet signer, card details, payment API or rental execution
endpoint. Card creation, swaps, deposits and billing changes remain manual.

`draftTreasurySession` implements a future local proposal gate, tested only with mocks:
reserve the full exact cap before submission; persist reservations on unknown outcomes;
reuse the same ticket on reconciliation; reject smaller-cap substitutions on saved drafts;
release only a definite server hold. Simulation databases cannot be relabelled real.
Reservations require explicit reconciliation with actual spending before release. There
is deliberately no casual UI button that releases an unresolved rental's reservation.

This gate is local to the Operator. It does not replace the remote executor's approval,
deadline or shutdown controls and does not constrain separately submitted owner-console
proposals. A top-up does not authorize a rental or extend an existing deadline.

## Setup

Add this object to the private Operator connection JSON, then launch the existing
`chatgpt-operator-server.js PRIVATE_DIRECTORY CONNECTION_CONFIG` command:

```json
{
  "computeTreasury": {
    "computeWallet": "YOUR_PUBLIC_COMPUTE_WALLET",
    "otherWallet": "YOUR_PUBLIC_DEVELOPMENT_REWARDS_WALLET"
  }
}
```

Existing SSH and authentication settings stay in the private configuration. For a local
treasury-only console without the model or executor connection:

```powershell
node local/treasury-server.js PRIVATE_DIRECTORY PUBLIC_WALLET_CONFIG.json
```

The config can contain the object above or the two wallet keys at its top level. Wallet
configuration is locked after initialization to avoid silently mixing histories. The
console binds only `127.0.0.1`, checks Host, and requires a session, same-origin POST and
CSRF value for mutations. The localhost owner session is not a remotely deployable auth
system. Page views do not invoke the model or refresh external data automatically.

Back up the private directory with the process stopped, including its SQLite files.
Entries are append-only statements; erroneous settled records need a deliberate accounting
correction workflow before production automation, not deletion or relabelling as verified.

## SolCard route

The user intends a dedicated project card, replacing personal KAST as the future payment
source. Runpod billing settings have not been changed by this work. The current default
flow is WBTC -> Solana USDC -> project SolCard -> Runpod credits. Card fees and conversion
costs reduce the net provider credit; the ledger records received amounts instead of
assuming the nominal transfer was credited.

Official SolCard guidance checked October 18:
- AI & Ad Spend: $10 issuance and 5% each top-up, intended for AI/cloud merchants:
  https://www.solcard.cc/blog/virtual-for-ai-ad-spend
- Platinum: KYC and advertised 0% top-up, a separate product:
  https://www.solcard.cc/fees
- SolCard reports prior Runpod payments, but this does not verify the user's new card:
  https://www.solcard.cc/blog/how-developers-pay-for-cloud-with-crypto
- Current AI & Ad Spend documentation lists Solana wBTC. Exact mint compatibility has
  not been verified in the user's deposit screen; direct WBTC funding is not implemented.
- Runpod's prepaid/card guidance: https://docs.runpod.io/accounts-billing/billing

## Verification

```powershell
node --test local/treasury.test.js local/operator-live.test.js local/chatgpt-operator.test.js local/operator-record.test.js
```

All payments, GPU/model calls and wallet replies in these tests are fixtures. Coverage
includes integer conservation, duplicate receipts/submits, stale observations, exact mint
validation, funding transitions, persistence, competing budgets, lost submissions, pause
behavior, Operator report compatibility and local HTTP protections. The real public-wallet
refresh is separate from those fixtures and never writes fictional funds into the owner DB.

Pending: card creation and merchant acceptance, actual fee receipts, manual settlement,
provider billing automation, authorized swap/payment signer integration, holder payouts,
future activation and remote enforcement of funded GPU proposals. No public release of
this source or deployment of these treasury features is claimed yet.

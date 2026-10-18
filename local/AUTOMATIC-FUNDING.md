# Fee detection and automatic funding rules — dry run

Implemented locally October 18, 2026. Token not yet created (owner confirmed).
No token mint is guessed and no fee routing, wallet transfer, card charge, invoice,
Runpod billing setting or GPU operation is performed.

Open http://127.0.0.1:4185/treasury and use **Fee detection + funding rules**.
The 70% recipient remains the configured compute wallet, not SolCard. The other
30% remains the separate development/rewards treasury. The Operator evaluates
once a minute while its local process runs; it is not an installed background service.

## Boundaries and data

- `fee-detection.js`: public finalized RPC reads only. Derives the project's Pump
  sharing config, bonding curve, creator vault and WBTC ATAs. Requires active v2
  sharing config with revoked admin and the exact two recipients at 7000/3000 bps;
  requires the exact Portal WBTC quote mint. Supported receipt: one successful
  top-level `distribute_creator_fees_v2`, exact account order, two direct token
  transfers and matching vault/recipient net token changes. ATA initialization
  may occur in deeper calls. Repeated signature/instruction IDs count once.
- `automatic-funding.js`: separate private `automatic-funding.sqlite` evidence
  journal, persistent receipt identities, rule settings and last 500 changed
  decisions. Neither observations nor samples call `recordFees`, `plan`, signer,
  reconciliation posting or any provider write. Existing owner-recorded plans are
  conservatively deducted when considering new advice. The 70% receipt amount
  is used directly, never multiplied by 70% again.
- Manual rule/sample/recheck actions retain the existing loopback host, session,
  Origin and CSRF protections. Rechecks are rate limited to 30 seconds; overlapping
  scans share one promise. Closing waits for in-flight reads.
- SolCard and Runpod feeds refresh separately every five minutes. Their observed
  balances inform timing but do not prove project funding. Old personal reloads
  remain unattributed and cannot create project compute credits.

## Coverage limits

This is a deliberately narrow read-only adapter, validated with synthetic protocol
fixtures, not a live BitHash payout. It scans up to 75 recent sharing-config
transactions per refresh. An initial bounded window must reach its end; later
windows must reach the previously complete head or the end. Missing transactions,
RPC failure, unrecognized matching instructions or history gaps hold advice.
Failed transactions and unsupported nonmatching/CPI/legacy instructions are recorded
as excluded and never add eligible funds. More than 75 unseen records requires a
future archival backfill; no automatic skipping. A public RPC history end is not
proof of complete archival history.

These receipts establish distributions from the project's Pump creator vault;
they do not independently reconstruct every originating trade. Tokens deliberately
donated into that vault could also be distributed. Do not describe receipt totals
as independently audited trading fee revenue. Ordinary deposits to the compute
wallet are not included at all. No fee claiming/distribution transaction is sent.

After launch, configure `feeDetection.projectMint` in the existing private Operator
connection file and restart. This identifies a public token; it does not grant
spending authority. A configured observer database refuses a different identity
or accidental removal; use a separately reviewed migration for identity changes.
Keep configuration outside the public repository. No mint is configured today.

## Rules

Inputs must be fresh (five minutes), with complete supported fee observation,
verified routing, active card, recently confirmed card limits (24 hours), enough
SOL for the configured reserve plus fee allowance, and no pending funding plan.
Zero planned hourly cost means idle. Low provider balance or short runway triggers
an advisory calculation: provider target minus observed provider balance, plus
card buffer, less existing card balance. The assumed WBTC/USD price is explicitly
a simulation input, not a quote or prediction of net card credit.

Proposed amounts are bounded by observed eligible fees minus existing commitments,
wallet balance minus reserve, per-transfer limit, rolling 24-hour committed limit,
card deposit maximum and maximum card float. Below-minimum proposals wait; the
engine never rounds upward into extra spending. If the card already covers the
reload, it advises reviewing provider funding, with card linkage/autopay unverified.
It does not start an automatic reload.

Default examples: $25 provider threshold, $100 target, $5 card buffer, $150 card
float cap, 0.002 WBTC per proposal, 0.005 WBTC rolling-day cap, 0.0001 WBTC retained,
$100,000 assumed WBTC price, zero hourly burn, 24-hour desired runway. SOL reserve
0.005 plus 0.0001 fee allowance. These are editable simulation values, **not owner
spending approval or live provider/card settings**. Real card acceptance, fees,
reload minimums and actual exchange rate must be established separately.

Sample button uses invented 0.01 WBTC total receipts → 0.007 compute / 0.003 other,
$10 provider balance, $0 card and funded SOL reserve. It substitutes $1/hour when
the rule is idle, and labels that assumption. With defaults it proposes 0.00095
WBTC (estimated $95). It changes only the saved sample view. No funds are reserved
and repeating it creates no real accounting or project credit.

## Validation and next activation gates

Run `node --test local/automatic-funding.test.js` and existing funding/treasury/
Operator regression suites. Tests cover receipt identity, token/split mismatch,
ATA creation, duplicate/restarted reads, incomplete history, stale/error holds,
limits, no-launch/no-network behaviour and sample isolation.

Next after token creation: verify real sharing configuration and supported payout
receipts without transferring funds. Before any live funding: production isolated
custody, owner spending policy, actual quote/fees, chain-to-card-to-provider receipt
linkage, verified project-card billing and separately authorized execution. Existing
GPU acceptance remains sufficient for this slice; no GPU experiment is needed.

Protocol reference: https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/CREATOR_FEE_SHARING.md
IDL: https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump.json
Checked against official fee-sharing documentation October 18, 2026; fixed binary
layout/discriminators are intentionally fail-closed on unknown protocol versions.

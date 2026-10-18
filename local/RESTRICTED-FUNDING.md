# Restricted signing and background reconciliation

Current integration: see [October 18 release](../experiments/2026-10-18-treasury-funding.md), [production observer](PRODUCTION-FUNDING.md) and [continuous shared simulation](CONTINUOUS-FUNDING.md). Earlier validation counts and pending-work notes below describe that component’s original implementation stage.

Implemented locally October 18, 2026. No production key, transfer, card payment or
GPU experiment is enabled. This extends [the direct funding preview](DIRECT-WBTC-FUNDING.md).

Follow-up: [read-only provider funding records](FUNDING-RECORDS.md) now connects
account observations to the Operator. Receipt attribution and automatic credit
posting remain held; see that document for backend authorization and live-read status.

## Offline signer

`restricted-wallet-signer.js` uses pinned `@solana/web3.js` 1.98.4 and
`@solana/spl-token` 0.4.14. It generates an ephemeral test key internally and
accepts only simulation ledgers and a dummy blockhash. There is no private-key
import, network client or broadcaster; `signLive()` always rejects.

The signer compares the decoded transaction's compiled message with one canonical
SPL Token `TransferChecked`: Portal WBTC, eight decimals, the configured recipient,
the exact prepared amount and the test wallet as sole signer/fee payer. Both
associated token accounts must already exist. Extra instructions, altered accounts,
nonce operations, token approvals and priority-fee instructions are rejected.

Its immutable policy checks per-transfer and rolling 24-hour limits, policy expiry,
fresh account/fee evidence, token balances, account authority/frozen state and a
remaining SOL reserve. Evidence is explicitly synthetic. A private signer-owned
SQLite journal stores signatures and reservations atomically; replacing or clearing
the calling treasury cannot reset its caps. Repeating a plan returns the same result;
assigning identical transaction bytes to another plan is rejected. The journal defaults
to memory for ephemeral tests. `journalPath` can preserve public audit records on disk;
it never stores the test private key. A new signer always creates a new test wallet,
so this is not key recovery or resumable production custody.

This tests the policy boundary inside one process, not secure production isolation.
A live signer must independently obtain trusted observations and protect durable
policy/key storage from the caller, including restart and recovery paths.

## Reconciliation worker

`funding-reconciler.js` persists jobs and unique receipts in its own SQLite database.
The local Operator starts it in immutable `observe-only` mode, checks registered
jobs every 60 seconds and stops it with the server. Failed reads back off; overlapping
ticks are prevented. With no jobs, there are no external requests. This is an
application worker, not an installed Windows service or an always-on remote host.

The real chain adapter only calls finalized `getTransaction`. It checks signed
transaction bytes, exact expected signature/message hash and exact WBTC debit and
credit. A missing transaction stays pending; it never triggers a resend. Job terms
are immutable and a signature cannot be assigned to two jobs. Registration is a
code interface; live submission and automatic job registration are not connected.

Progression is `awaiting-chain -> awaiting-card -> awaiting-provider -> complete`.
Simulation tests cover all stages, restart recovery and duplicate receipt rejection.
Receipt insertion and job progression commit together. A failed write leaves the
job pending with no credit attached; retrying cannot resurrect rolled-back credit.
Production card/provider adapters remain unavailable. The inspected SolCard invoice
schema provides crypto amount and `swapUsdAmount`, but no transfer signature or
proven net card credit. Matching an amount or a balance increase is insufficient.
Production jobs therefore wait for attributable receipts. Observe-only mode rejects
synthetic credit receipts; neither mode posts credit into the real treasury ledger.

## Current operating state and next integration

The local console at http://127.0.0.1:4185/treasury displays worker status. Real
payments and GPU proposals remain disabled, owner spending caps are unset, and the
real registry is empty. Existing card/wallet snapshots expire normally. The assistant's
SolCard OAuth connection is not copied into the standalone backend.

Before real activation: independently reviewed production key custody and policy
storage, authenticated fresh account/fee reads, owner spending caps, attributable
fee ingestion, authenticated card/provider receipt adapters and the project-card
Runpod billing connection. A real submission interface and durable host also remain
separate work. No runtime toggle in this implementation activates live payments.

## Verification

62 tests passed across `restricted-funding.test.js`, `treasury-funding.test.js`,
`treasury.test.js`, `operator-live.test.js`, `chatgpt-operator.test.js` and
`operator-record.test.js`. New cases cover cryptographic signatures, transaction
tampering, freshness/authority checks, limits, restart recovery, unknown outcomes,
receipt attribution, duplicate protection, caller-ledger replacement, clock rollback,
injected database failures and worker lifecycle. All payment/GPU
test effects are simulated. Browser and HTTP checks confirm the local worker is
running with no jobs and no enabled payment authority. No public deployment made.

Protocol references: [Solana getTransaction](https://solana.com/docs/rpc/http/gettransaction)
and [SPL token transfers](https://solana.com/docs/tokens/basics/transfer-tokens).

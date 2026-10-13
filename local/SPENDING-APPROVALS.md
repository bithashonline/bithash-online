# Owner-approved spending prototype

Local simulation, October 12, 2026. No wallet, provider executor, live AI integration or hosted approval UI. All funds are synthetic integer microcredits. This module does not alter the existing controller ledger or authorize its provider runner.

Creator fees should accumulate in the treasury. Each proposed run specifies provider, destination alias, GPU model/count, duration, quote, overhead allowance, total cap and approval expiry. An owner Ed25519 signature binds all terms and the specific ledger. Approval reserves the full cap atomically; repeat approvals do not reserve twice. Changing terms requires a new proposal ID and signature. This is a local signing contract, not a connected wallet signature flow.

No mandatory 80% spend occurs. Whether an 80% long-term earmark remains is unresolved. Dashboard API and analyst evidence now describe owner-approved runs instead of asserting an approved fixed percentage. Older documents and the explicitly labeled legacy browser simulator may describe the previous policy.

Dispatch intent is persisted before simulated execution. After a restart, an unresolved intent cannot be blindly dispatched again. Expiry releases only undispatched reservations. A runtime deadline marks a stop request; it does not assert that a provider actually stopped billing. Active reservations remain held until synthetic settlement. A production adapter must reconcile provider resources, confirmed termination, storage charges and invoices before release. Real-world caps require independent enforcement; a local ledger is not a provider billing guarantee.

Trusted local owner code can cancel before dispatch. There are no mutation HTTP routes. The model must never receive direct database access, owner signing keys, credit/settlement methods or cancellation privileges. The demo creates an ephemeral owner key in memory and never saves it. A production signer, authenticated owner review screen, key rotation/recovery, verified fee ingestion, provider account binding and independent shutdown service are still required.

Reproduce from `local/` using Node 22:

```sh
node --experimental-sqlite --test spending-approvals.test.js
node --experimental-sqlite spending-demo.js
```

The demo uses invented prices: ten synthetic dollars received, two reserved for five simulated GPUs, 1.60 settled and 8.40 available afterward. It performs no network calls. The signature proves authorization under the configured key, not GPU activity or exhaustive puzzle search.

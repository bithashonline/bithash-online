# T01 allocation demonstrator — October 7, 2026

Implemented locally. Run `npm run allocation-demo` from local/. Tests: `npm test` (Node 22.16.0 with experimental SQLite); 27 local tests passed October 7, including 9 new policy/allocation tests. Launch code is unchanged; its 7-test result remains dated October 3.

policies.js extends the existing Controller transaction/post/balance implementation. Separate namespaced accounts prevent dummy asset allocations from entering the original synthetic micro-USD job budget. Persisted coin/mint identities, asset decimals, economic policy versions and target versions must match receipts. A mint cannot represent two registry coins; existing policy versions are immutable. New versions never recompute old events. Production policies reject unset shares; this module only allocates explicitly fixture receipts against fixture policies. No production policy is supplied.

Main categories: compute/rewards/treasury. Child categories: compute/rewards/burn. Exactly 10,000 basis points; nonnegative integer shares, including explicit zero shares. Unrecognized fields/categories reject. Fixture IDs are dummy identifiers, not validated Solana public keys; production identity and evidence adapters remain unbuilt.

Every positive receipt uses BigInt minor units. Round down each share, then assign remaining units by descending fractional remainder; ties use compute, rewards, treasury/burn order. Zero receipts reject. Rounding occurs per receipt and can favor compute for tiny repeated fees; batching/economic cost policy is a later decision. Test shares 61/23/16 are arbitrary examples, never owner-approved percentages.

Atomic transaction: fixture source credit → receipt clearing debit → category debits/clearing credits → immutable event record. An event ID is globally unique within this demonstrator. Changed amount, coin, policy, target, asset or custody on replay rejects. Actual subprocess exit after the second posting rolls back all postings and the event; restart/retry credits once. A committed replay changes nothing.

Reward balances remain per coin and asset across economic/target versions. Compute balances remain per coin/asset/target version; pooled totals are derived sums, not another spendable debit. A shared custody field never merges coin books. Report includes per-asset journal net. The shared dummy wallet is descriptive evidence only: no balance reconciliation or physical wallet access occurs.

Demo: main and child-a each allocate 10,001 dummy units as 6,101 compute / 2,300 rewards / 1,600 treasury or burn. child-b's one-unit receipt goes to compute. Aggregate compute 12,203; three events despite each being submitted twice; journal net zero. These are budgets, not delivered compute, paid rewards or burned tokens.

No fees received, real receipt attribution, conversion, purchases, provider funding, signer, launch or public deployment. Existing mock provider remains unchanged and unconnected to these budgets. Allocation API inputs are trusted local fixtures; production ingestion needs independent mint attribution and durable evidence in T05. Local SQLite/DB operator control is not custody enforcement or an independent security audit.

Next after T01 review: T03 unsigned launch form, following roadmap order. T02 durable production state remains a separate task.

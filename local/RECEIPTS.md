# Basic fee observer

October 3, 2026. First narrow step toward creator-fee ingestion; no money handling.

Run from local/:

```powershell
node --experimental-sqlite receipt-demo.js
node --experimental-sqlite --test
```

The default demo reads the archived real WWW sample from October 2. It recognizes one native SOL legacy Pump collect_creator_fee instruction, checks the expected creator/vault/system/event/program accounts, validates its direct inner system transfer and reconciles source and recipient balance changes. Result: 3,056,738 lamports (0.003056738 SOL), recorded once in a separate observation database even across restarts. It never credits the synthetic compute ledger or claims these third-party funds belong to this platform.

The instruction has no mint field. Coin-level attribution needs separately verified historical routing/registration evidence; mint remains null. The watched source/recipient pair is a configured research sample, not a production registry. Solana RPC response authenticity is trusted to the endpoint; a locally imported JSON file is archived evidence, not cryptographic transaction verification. Provenance labels are local metadata, not authentication.

Optional live command:

```powershell
node --experimental-sqlite receipt-demo.js https://solana-rpc.publicnode.com
```

This issues only getTransaction at finalized commitment and getSignatureStatuses with history search. Missing receipts, failed/pending status, inconsistent slots, RPC errors and timeouts abort without import. No send/sign operation exists. Endpoint origins are recorded without credential-bearing paths or query strings. On October 3, the actual read-only PublicNode request returned HTTP200 with result:null; no fresh transaction confirmation was obtained. Raw response saved in work/receipts/fresh-rpc.json. Default archived mode deliberately does not assert freshly verified finality.

Receipt file: fixtures/archived-fee-receipt.json, extracted and normalized from canonical evidence/cobweb-deeper-www-2026-10-02/sol-result.json. The matching instruction schema is vendored in fixtures/collect-creator-fee-schema.json with SHA256 provenance for the original saved official IDL. Current official source was opened October 3: https://raw.githubusercontent.com/pump-fun/pump-public-docs/main/idl/pump.json. Decoder supports only this pinned legacy instruction shape, not arbitrary future schemas or deployment correspondence.

Coverage: seven new tests plus the existing eleven pass. Tests include real archived transfer, wrong signatures/program/routes, ordinary-deposit rejection, failed receipts, unsafe integer amounts, mismatched balances, missing/duplicate inner evidence, persisted replay protection and conflicting replay rollback. Live adapter behavior is tested with explicit mocked RPC responses; the historical decoder uses the archived real response.

Limits: not a continuous scanner; no pagination/backfill cursor, v2 sharing/AMM/token-quote decoder, coin attribution, real contribution credit, pooling, provider payment or signing. Transactions with other balance activity fail closed instead of guessing attribution. Next: add the actual shared-fee distribution path and verified coin-to-recipient registration, followed by read-only scanning. Keep Part 2 incomplete until those gates pass.

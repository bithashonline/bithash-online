# Wallet approval and chain evidence adapters

October12, 2026. Local, unpublished.84/84 backend and14/14 frontend tests pass. No live wallet signature, chain receipt import, payment, rental or provider credit verification performed. Owner and treasury public addresses requested from user and still required.

Dashboard includes Phantom connect/signMessage approval. It recomputes the displayed proposal digest, checks the configured owner bytes before signing and after signing, verifies Ed25519 signature locally and submits to existing backend verification. No signTransaction/sendTransaction capability is used. Existing v1 signature message binds domain, ledger UUID and exact proposal digest; full terms are shown in the dashboard. Wallet popup displays the digest message, not all terms. Approval only reserves synthetic budget. A human-readable signed-terms protocol and hosted origin binding should precede production use.

Set BITHASH_OWNER_ADDRESS to the intended public Solana address instead of BITHASH_OWNER_PUBLIC_KEY_FILE. Server converts the public address to Ed25519 SPKI. Existing databases enforce immutable owner identity; do not silently replace their owner or delete their audit history. Use a deliberately initialized ledger for a newly selected owner. Backend configuration never accepts browser-selected owner enrollment.

Native SOL evidence import, from local directory:

node --experimental-sqlite import-chain-evidence.js DATABASE SIGNATURE SOURCE DESTINATION LAMPORTS

BITHASH_TREASURY_ADDRESS must be configured; source or destination must match it. The importer requests getTransaction from the fixed Solana mainnet endpoint with finalized commitment, rejects transaction errors, signature mismatch, missing records and non-unique or mismatched top-level native transfer instructions. Data is saved separately in chain_evidence and displayed through the approvals feed with a generated Solscan transaction URL. It never credits synthetic funds or assigns the receipt to a GPU run. Existing signatures cannot be relabeled with conflicting terms. Amounts must be exact safe integers; SPL-token/CPI transfers are out of scope.

This proves only a matched transfer as observed through one RPC provider. It does not prove fee provenance, treasury ownership, payment attribution, provider credit or useful GPU work. Local evidence can be modified by the database owner; Solscan permits independent inspection. No fake transaction links were added.

References: https://docs.phantom.com/solana/signing-a-message ; https://docs.phantom.com/solana/establishing-a-connection ; https://solana.com/docs/rpc/http/gettransaction .

Tests use a generated in-memory key and mocked wallet/RPC, covering owner mismatch, digest changes, signature verification, finalized request, transaction failure, amount mismatch and ambiguous matches. Browser visual/live wallet QA not performed; prior localhost security block remains respected. Next: user provides owner/treasury public addresses, configure ledger, user signs one no-transfer approval, then read and verify an actual attributable treasury transaction. Provider invoice attribution remains separate pending payment integration.

# Unsigned Pump launch preview

Run in this directory:

```powershell
npm.cmd ci --ignore-scripts --no-audit --no-fund
node --test
node preview.js
```

Installed dependencies are pinned in package-lock.json. Uses the official Pump SDK2.0.0 CommonJS entry and Solana web3.js1.98.4. The SDK ESM path currently fails on Node22.16 due to a transitive Anchor BN export; no dependency source patched. Pure-JavaScript bigint fallback is sufficient for this preview.

Default output: work/launch-preview.json. All public keys are generated fixtures, metadata URL is deliberately invalid, and100% is illustrative. No project treasury/split chosen. Nothing is signed or submitted; no wallet secret is stored. An optional JSON input path supplies preview fields only.

Required input fields: mode='unsigned-preview', name, symbol, uri, payer, mint, treasury, computeShareBps. Optional routingMode='fee-sharing' (default) or 'direct-creator'. The direct route requires computeShareBps=10000. Optional mode flags may only be false; initialBuyLamports may only be '0'. Unknown fields reject. Addresses must be valid; payer/mint must be on-curve signer public keys, and these roles must be distinct from treasury in this narrow preview. UTF-8 byte limits are conservatively enforced.

The builder produces real SDK create_v2 and, for sharing, create_fee_sharing_config/update_fee_shares_v2 instructions. It measures unsigned v0 wire size with signature slots and a provisional compute limit. A packet fitting is not proof of simulation success. No network client, wallet signer or transaction-sending path is implemented here.

Seven tests pass: encoded recipients and shares, creation flags, byte limits, invalid input, signer roles and direct routing. The sample combined shared route is1304bytes and exceeds1232; create/direct alone859 and separate configuration845 fit. Do not automatically split without an explicit recoverable setup design. Real chain simulation, account state validation, metadata publishing, signed wallet UX and cost quotes remain undone.

Detailed research: C:/Users/isaac/Documents/Codex/2026-09-29/what-x20/outputs/project-memory/projects/puzzle-pump-launch-basics-2026-10-03.md.

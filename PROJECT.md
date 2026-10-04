# Puzzle Compute Launchpad
Updated October 3, 2026, America/Toronto. Working name; final brand undecided.

## Current state
October 3 repository setup complete: private repository https://github.com/bithashpad/puzzle-compute-launchpad created, visibility verified through browser and authenticated API, and all 30 project files pushed to main. README, exclusions and GitHub Actions workflow included. Both local suites pass (18 + 7); first GitHub Actions run succeeded: https://github.com/bithashpad/puzzle-compute-launchpad/actions/runs/37166766302 (source commit b01be289d9be10b48b94f49b2f588889b1a61c5a). Local origin tracks main; account no-reply identity uses verified public GitHub ID 227065956. User explicitly approved GitHub CLI workflow scope after automatic approval review requested authorization; device authorization completed. Official portable gh2.102.0 checksum verified, executable at C:/Users/isaac/Documents/Codex/2026-10-03/resume-prompt-for-a-new-chat/work/github-cli/unpacked/bin/gh.exe. GitHub plugin installed but its account tools were unavailable in this chat. No public release, launch or spending authorized.

Dedicated project established at C:/Users/isaac/Documents/Codex/crypto-workspace/projects/puzzle-compute-launchpad.
Stage: tested local demonstrator. Original fixture-only CPU solver, SQLite job/range/lease/checkpoint controller, exact synthetic double-entry accounting and explicit mocked provider now exist in local/. No deployed contracts, live fee collection, signer or GPU workers exist. Nothing published; no token launched; no provider account connected or rental purchased. Spending remains disabled with no enable switch.
User wants to work seriously on a Solana launchpad where participating coins' creator fees fund pooled compute for the intentionally public Bitcoin Puzzle #71 challenge.

## Accepted direction
- Solana launchpad inspired by Agency Pad's public architecture, with original implementation.
- Creator-fee revenue pays for actual GPU search work. AI is optional commentary/research, not required for search.
- Success means real, measurable search funded by fees, not guaranteed discovery.
- Use existing token launch infrastructure where appropriate.
- Preserve continuity for the next chat; do not ask the user to repeat this concept.
- October 3 clarification: the core purpose is pooled creator fees funding #71 search. An Agency-like AI hybrid was discussed as a possibility, then deferred while starting with the most basic functionality. No agent implementation or AI fee split accepted.

## Proposed first milestone
Prove one local fee-accounting-to-compute lifecycle before a multi-coin launchpad: validated solver on an already-solved small puzzle, range scheduling, checkpoints, conservative spending controls, truthful dashboard.
The October 3 user steering prioritizes researching Pump launch fundamentals and building an understandable unsigned launch flow now. A paid compute pilot remains gated on budget/account; launch previews can proceed independently.

## Source and records
Working root: C:/Users/isaac/Documents/Codex/crypto-workspace/projects/puzzle-compute-launchpad
Architecture: ARCHITECTURE.md
Task queue: TASKS.md
Sequential build roadmap: BUILD-PLAN.md (ten parts with deliverables, dependencies and completion tests).
Chat handoff: HANDOFF.md
Canonical concept: C:/Users/isaac/Documents/Codex/2026-09-29/what-x20/outputs/project-memory/projects/puzzle-compute-launchpad.md
Agency notes: same canonical projects directory /agencypad.md.
Sources: https://www.agencypad.fun/docs and https://btcpuzzle.info/puzzle.

## Current target
Puzzle #71 address: 1PWo3JeB9jrGwfHDNpdGK54CRas7fsVzXU.
Range: [2^70, 2^71), exactly 2^70 candidates.
Session tracker reported 7.1019168 BTC and unsolved; this is dated third-party evidence, not independently checked live chain state. Public-key availability must be refreshed before choosing algorithm.
This is bounded private-key puzzle search, not Bitcoin proof-of-work mining. ASIC mining hardware is not a substitute for a compatible GPU key-search solver.

## Open decisions
Final name/brand; fee allocation and operating reserve; custody architecture; GPU provider and fiat payment route; spending budget; whether platform token exists; recovered-prize ownership/distribution; target change policy if #71 is solved; source/publication policy.
No decisions above are implicitly approved. No budget authorized.

## October 3 build roadmap

User requested a plan that can be tackled one part at a time. BUILD-PLAN.md is the detailed working roadmap; user-facing snapshot is C:/Users/isaac/Documents/Codex/2026-10-03/resume-prompt-for-a-new-chat/outputs/launchpad-build-plan.md. Proposed initial scope uses one provider/solver/target and a single pilot coin before multiple coins. Platform token and extra mechanics are recommended deferrals, not accepted decisions. Proposed beta gate (three coins, seven monitored days, reconciled balances and passed recovery/security checks) remains subject to agreement. Planning does not authorize purchases, launches or publication.

The original Part 2-first sequence is superseded by the user's request to research Pump launch fundamentals and continue the launch flow. The roadmap remains a dependency reference; the current local demonstrator is not completion of production components.

## Next action
Build a simple create-coin form against the new official-SDK unsigned preview in launch/. Establish the selected direct-creator versus fee-sharing route with chain simulation/configuration checks before wallet signing. Actual fee policy and treasury remain undecided. Receipt scanning and provider execution remain later integration work.

## October 3 Pump launch fundamentals

User explicitly asked to research the basics of a Pump.fun launchpad before continuing. Official creation, sharing, fee-program and Solana transaction docs inspected; published SDK2.0.0 source/package inspected and pinned with web3.js1.98.4 in launch/. Seven launch tests pass; prior local suite has18passing tests. No AI features added. Node22.16 uses the SDK CommonJS entry because its ESM dependency path fails; install scripts disabled and JS bigint fallback works.

Real SDK preview constructs regular SOL create_v2 plus optional sharing setup/final-share instructions, validates inputs/recipients and measures packet size. Fixture shared route1304bytes exceeds1232; separate create859/setup845 fit. Alternative direct-creator-to-treasury route is859bytes, conditional on100%creator-fee allocation, not an accepted policy. No per-mint sharing lock on direct route; attribution/admin behavior still need verification. All outputs are unsigned/unsubmitted/unsimulated with fixture addresses and nonexistent metadata. No live mint or financial action.

Read-only finalized RPC independently found executable Pump/PumpFees accounts and Pump-owned Global on mainnet453090912 and devnet507175519. Presence is not source correspondence or successful launch verification. Canonical research: projects/puzzle-pump-launch-basics-2026-10-03.md in project-memory. User output: C:/Users/isaac/Documents/Codex/2026-10-03/resume-prompt-for-a-new-chat/outputs/pump-launchpad-research.md. Package lock, SDK preview and tests in launch/; raw deployment checks in launch/work/.

## October 3 basic receipt milestone

Implemented local/receipts.js, receipts.test.js, receipt-demo.js and RECEIPTS.md. Decodes the pinned legacy native SOL Pump collect_creator_fee shape for a configured public research sample; validates program/instruction/accounts, inner transfer and exact source/recipient balance changes. Archived real sample matches3,056,738lamports. Observation database persists/deduplicates across restart and rejects conflicting replays. No mint attribution is inferred from a creator-wallet claim; no platform funds credited. Separate from synthetic compute accounting.

All18tests pass (11existing+7new). Actual PublicNode finalized getTransaction request returned HTTP200/result:null; no fresh confirmation. Live adapter's finalized/status/error behavior is tested using explicitly mocked responses. Archived receipt provenance and schema snapshot retained in local/fixtures/. Demo rerun inserted0rows. Human-readable result: C:/Users/isaac/Documents/Codex/2026-10-03/resume-prompt-for-a-new-chat/outputs/basic-fee-reader.md. No continuous scanner, shared-fee-v2/AMM decoder, real pool funding, AI agents or spending added. Part2 remains in progress.

## Validation
Project context saved; full Agency docs read previously, backend/source/security unverified. Published Puzzle #1 match reproduced locally. No unsolved search started.

## October 3 local implementation milestone

- Source: C:/Users/isaac/Documents/Codex/crypto-workspace/projects/puzzle-compute-launchpad/local/ (README.md, solver.js, controller.js, controller.test.js, demo.js, package.json).
- Environment: Node22.16.0 / OpenSSL3.0.16 / SQLite3.49.1 works without npm packages; SQLite module experimental. CUDA tooling absent from PATH; CIM GPU inventory denied, so local GPU identity remains unknown.
- Validated solved public #1–3 compressed address vectors and full seven-candidate fixture ranges. CPU reference uses OpenSSL curve arithmetic; no GPU solver selected/validated. Initial #3 fixture address error was caught by tests and corrected against public corpus.
- SQLite WAL/FULL immediate transactions persist contributions/reserves/invoices, nonoverlapping ranges, lease epochs and contiguous checkpoints. Mock accepted-create timeout pauses with retained reserve, then reconciles without duplicate creation. Actual subprocess exit mid-transaction rolls back on reopen.
- Eleven real tests passed; demo executed four #3 candidates and settled synthetic10s×7microUSD/s=70, leaving930available/0reserved from1000synthetic credits. Demo rerun validation is recorded in local README and output report. Synthetic invoice duration is not measured CPU time or actual provider billing.
- Demo persisted state: local/work/demo/state.sqlite and report.json. User-facing snapshot: C:/Users/isaac/Documents/Codex/2026-10-03/resume-prompt-for-a-new-chat/outputs/local-slice-report.md and demo-report.json.
- Inspection: INTEGRATIONS-2026-10-03.md. Current official Pump v2 sharing instructions and Runpod/Vast API/billing documentation inspected only. No account/payment connection, live receipts, transfers or purchases. #71 chain-data requests failed; historical target status/funding not promoted to current verification.
- Limits: trusted local checkpoint input, unmeasured lost work before checkpoints, no remote worker authentication, GPU orchestration, independent paid-job watchdog, SOL/USD conversion, expense apportionment or tamper-proof accounting. Local reservation/bill caps do not enforce external-provider spending. Agency/Cobweb/WWW comparison lessons retained. No project score assigned to a build milestone.

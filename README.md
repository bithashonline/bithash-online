# Puzzle Compute Launchpad

An early Solana launchpad project: participating coins would route a disclosed share of creator fees into pooled rented GPU compute searching the intentionally public Bitcoin Puzzle #71. The goal is measurable search work, with no promise of solving it. This is bounded key search, not Bitcoin mining.

## What works locally

- `local/`: CPU solver restricted to solved public fixtures, persistent job/range/checkpoint management, exact synthetic accounting, and an explicit mock provider.
- `local/receipts.js`: strict observation of a saved native-SOL Pump creator-fee receipt, with duplicate/conflict protection. This does not credit project funds.
- `launch/`: official Pump SDK unsigned launch previews, input validation and transaction-size checks. No signing or submission.

There is no usable launch website, live GPU search, connected provider, treasury signer or deployed financial backend. No token has been launched. Spending is disabled. AI agents are deferred.

## Run the checks

Use Node.js 22.16.0 and npm. SQLite is experimental in this Node version.

```sh
cd local
npm test
cd ../launch
npm ci --ignore-scripts --no-audit --no-fund
npm test
```

Run `npm run demo` inside `local/` for the solved-fixture mock lifecycle, or `npm run preview` inside `launch/` for an unsigned preview with fixture addresses. Generated state stays in ignored `work/` directories. SDK native bigint bindings fall back to JavaScript when install scripts are disabled.

## Build order and decisions

See [PROJECT.md](PROJECT.md) for current state, [TASKS.md](TASKS.md) for the queue, [BUILD-PLAN.md](BUILD-PLAN.md) for the roadmap, and [ARCHITECTURE.md](ARCHITECTURE.md) for the proposed production design.

Next product slice: a simple create-coin form backed by the unsigned preview, followed by simulation and configuration checks. Fee split, custody, provider/payment budget, prize ownership and target-change policy remain open. Sample allocations are fixtures, not accepted financial policy.

Project records contain links to the owner's local research archive; those external files are not bundled in this repository. The intended GitHub visibility is private. Never commit wallet secrets, provider credentials, local databases or dependency/cache directories.

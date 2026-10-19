# Wallet execution and payout preflight

The Operator connects fee collection, coordinator-backed compute deposits and holder payouts to a separate durable wallet-execution journal. **The production factory hard-disables signing and broadcasting, supplies no key loader, and ignores external activation fields.** Browser routes cannot enable it. No real transfer, card charge or GPU operation is part of this implementation.

## Execution implementation

`WalletExecution` builds only canonical Pump collection, single WBTC compute transfer or ATA-plus-WBTC reward messages. It compares the exact compiled message with the fresh preflight hash, validates the original source intent again after asynchronous checks, and enforces a separate immutable authority policy. Per-owner rules bind permitted operations, the compute deposit address, collection token/recipient identities, approved holder eligibility-policy hashes, per-transfer limits, daily WBTC/cost caps and expiry. Approved reward policy hashes allow successive rounds without a new approval for each recipient; manifests remain bound to the trusted holder ledger and each individual payout. This is application-level enforcement, not a separate hardware or on-chain signer.

Before signing, the independent SQLite journal reserves the allowed attempt budget. Signed bytes and signature persist before submission starts. Submission is marked uncertain before the network request, with RPC retries disabled. A timeout, crash or unconfirmed signature never triggers an automatic replacement or resend. Recovery checks the original signed transaction at finalized commitment; downstream funding/reward managers still verify their token deltas and settlement evidence before claiming payment or credit. Definitive failure is retained and requires reviewed retry handling; it does not create a fresh payment automatically. A crash after reservation but before signed-byte persistence requires review.

The custody adapter validates the canonical message again, loads a key only when explicitly enabled, verifies the owner, signs with the established Solana library and clears temporary secret buffers. No production key loader is installed by this release. Signed bytes stay in the private journal and are removed from status responses. The broadcaster is implemented but independently disabled; its transport is exercised only with fake responses. The disabled production factory cannot be promoted by an environment variable or browser/config toggle. Authorized activation requires a reviewed custody deployment and a new execution journal/policy; a disabled journal cannot silently become an enabled one.

The collection draft includes its observed distribution epoch, so an identical future fee amount can become a new job after the previous distribution is observed. Blockhash refresh alone cannot create another job. The current fee-collection wallet comparison now correctly checks the wallet addresses without rejecting the existing asset metadata.

## Live payout checks

`RewardPreflight` checks mainnet identity, finalized WBTC mint and token accounts, source balance, destination ownership/state, SOL reserve, current blockhash and expiry. It retrieves the exact serialized message fee and current rent for a missing standard SPL token account. It simulates the unsigned canonical transaction and checks the payer's simulated cost against the fee/rent budget. Existing recipient accounts do not add rent. Development reserves and all other unpaid holder liabilities remain protected when checking an individual payout.

The live result is stored with the payout and expires after 60 seconds. Changes to a payout manifest or eligibility policy invalidate it. Only a fresh successful check can reach the execution gate; passing never grants spending authority. The holder console exposes read-only checks; the background execution service also invokes them for eligible jobs. There is no invented live holder before token launch.

Sources: [message-specific fee](https://solana.com/docs/rpc/http/getfeeformessage), [rent-exempt balance](https://solana.com/docs/rpc/http/getminimumbalanceforrentexemption), [unsigned simulation](https://solana.com/docs/rpc/http/simulatetransaction).

## Validation and activation boundary

Tests use generated temporary keys and fake broadcasters/RPC responses. They cover persisted unknown outcomes, restart, no resubmission, incorrect messages/keys/destinations/policies, reserved daily budgets, per-owner pending locks, account creation/rent, SOL and WBTC reserves, stale/invalid RPC data, and disabled production wiring.

A mainnet read-only diagnostic on October 19 returned a 5,000-lamport network fee and 1,488,440-lamport missing-account rent. It held on absent payer/source accounts, missing limits and insufficient WBTC. Simulation was not run and no payout job was created. These are dated observations, not promised future costs. Private validation retained the account-level record locally.

Before live activation, configure the actual token/routing, payout eligibility and cost limits, funded SOL/WBTC accounts, and a secure custody loader for the intended wallets. Review the authority policy and deployment, then authorize a small end-to-end acceptance test. Production funds, card charging, spendable-credit policy and GPU execution remain disabled and are not proven by offline signing tests.

Final validation for this wallet update: 560 development-workspace tests and 521 isolated-release tests passed. The local Operator passed two restarts with zero execution jobs, no key loader and disabled signing/broadcasting. The mainnet diagnostic was read-only and held; successful payout simulation and submission recovery were exercised with fixtures, not funded production wallets. Example cost settings are inactive and must be reviewed before activation.

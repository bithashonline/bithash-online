# BitHash owner-controlled search product

The existing engine runs one session at a time with one or two GPUs. A two-GPU fleet uses two separate one-GPU rentals and distinct assignments from our own public Puzzle #71 ledger. Real two-GPU execution passed the published October 14 acceptance. No additional GPU experiment is required for this product release.

## Use

Open the public dashboard to read current executor state, accepted checkpoint totals, provider observations, signed reports and archived session evidence. The public site cannot draft, approve or stop rentals. Old proposals and individual machine records are available in expandable history. Unavailable or stale observations retain saved evidence without claiming current activity.

The local owner console is the control surface. Sign in with the configured Google owner account in Chrome or Edge. Open the local Operator connection to request a session draft, or expand the manual quote form. Choose one or two GPUs, a five to fifteen minute rental limit and a total USD cap. Drafting never starts a rental. Review exact hardware, public ranges, starting checkpoints, prices, runtime and cap, then approve that exact digest. New proposals allow one hour for review; a fresh price and range check still happens before creation.

Cancellation before dispatch prevents a rental. Stop on an active independent session is durable across restart and blocks further worker enrollment. If a create response is unknown, the slot stays reserved until an exact rental is reconciled; there is no replacement POST. A fleet stops known members together and retains unresolved members for review. A stop request is not proof of deletion: wait for the independent shutdown observation. The cap is operational rather than a provider-enforced hard cap; final billing remains separate.

## Operations and limits

The always-on executor manages an approved session after dispatch, including checkpoints, shutdown and evidence retention. The local Operator drafts on request and publishes explanations; old reports remain visible if it is offline. A historical report is clearly timestamped. Model advice cannot approve spending. Existing pinned worker artifacts and solver are unchanged by this release.

The ledger counts signed, accepted receipts once. It does not import third-party searched-range claims. Signatures authenticate workers; they do not independently attest exhaustive GPU coverage. The three completed assignments total 3,145,728 accepted candidates from bounded acceptance work, not a sustained search benchmark or a promise of finding a key.

The UI separates simulation tools from real operations. There is no connected token treasury, wallet-fee routing, automatic provider top-up or perpetual unattended fleet. Owner-funded provider credit and exact approval remain required. More than two GPUs and longer sessions are outside this release. No new rental or proposal was created to verify it.

See ops/live-executor/RECOVERY.md for the verified private snapshot procedure and the Windows profile dependency of the encrypted desktop backup. Read-only checks, mocked provider tests and saved signed evidence validate this release without paid GPU execution.

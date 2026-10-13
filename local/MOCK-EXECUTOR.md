# Automatic mock executor

`mock-executor-cli.js` polls the approval SQLite ledger every second in a separate Node process. It only handles provider `mock`, destination `local-simulation`. Proposed runs cannot start. Approved reservations dispatch, run until their persisted wall-clock deadline, then stop and settle using integer synthetic time-based pricing. No network, GPU, wallet or provider adapter is present.

Set `BITHASH_GOOGLE_SETUP_FILE` to the existing private setup file and `BITHASH_APPROVAL_DB` to the same private ledger as the dashboard. Run `node --experimental-sqlite mock-executor-cli.js` from local/. No secret values go in command arguments or logs. A verified saved owner is required.

Each tick is a SQLite write transaction. Two connections serialize, preventing duplicate dispatch and billing. Reopening the ledger preserves the original deadline; missed deadlines settle on the next tick, charging at most the approved duration. This is simulation behavior, not proof of timely shutdown on real hardware. Early stop events bill their elapsed duration. Expired unstarted proposals release their reservation. Invalid state/clock/integrity halts the process, with no real actions possible.

Every transition appends an evidence record marked automatic-mock-executor; settlement includes billed seconds and exact synthetic charge. The dashboard uses existing evidence links and shows six-decimal cost caps and settlement amounts.

The process must remain running. It is not an installed Windows service and does not auto-start after reboot. Restarting it resumes the ledger. Real provider execution, independent shutdown, provider billing, treasury access and AI model integration remain outside this implementation.

Validation:98 backend tests and14 frontend tests pass, including restart, competing connections, unsigned/expired/live-provider exclusions, early stop, clock rollback, altered terms and duplicate settlement.

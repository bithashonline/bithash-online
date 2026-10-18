# Read-only SolCard and Runpod funding records

Implemented locally October 18, 2026. No transfer, invoice creation, card charge,
payment-method change, GPU rental or public deployment is part of this connection.

## Sources and boundaries

`funding-solcard.js` connects directly to the official SolCard MCP using a separate
native OAuth client, PKCE S256 and a ten-minute, single-use callback state bound to
the local Operator session. The requested scopes are exactly `cards:read`,
`activity:read`, `invoices:read` and `perma:read`. The existing Codex grant is not
exported or reused. Native application metadata is required by SolCard for the
127.0.0.1 callback. The console permits redirects to the two exact SolCard origins.

The HTTP wrapper only permits official discovery, registration/token endpoints and
read-only MCP calls. Other tool names, destinations and redirect responses are
rejected. Registration/consent can change authorization, but cannot initiate a
payment. Credentials remain in `solcard-backend-oauth.dpapi` in the private runtime
directory, encrypted for the current Windows user. `funding-secret.ps1` is launched
through PowerShell 7 (`pwsh.exe`, or `BITHASH_POWERSHELL_PATH`) with no policy bypass;
secret material passes through process pipes, never command-line arguments or logs.

SolCard reads the pinned card, its permanent addresses, activity and deposit invoices.
It checks slot, last four digits, funding-account identity and exact Solana deposit
address. Shared funding accounts are rejected. An invoice is joined to activity only
when its ID, slot and current deposit address match. This excludes previous cards
that reused a slot. Reads currently request the first 100 activity/invoice records;
pagination flags indicate incomplete history. No unrequested cards are retained.

`funding-runpod.js` uses the existing encrypted project credential for one fixed
GraphQL query: account ID, credit balance and the last 90 days of Stripe reload
history (ID, completed time, amount, medium and type). No receipt URLs, payment
credentials, emails or GPU data are requested. Errors are reduced to fixed codes.
The underlying key's provider-side permissions have not been narrowed or changed;
the new client exposes only this read. Returned account identity is hashed and
locked to the first successful account to detect subsequent switches.

REST v2 and the Runpod MCP billing tools expose usage costs, not account reload
receipts. The public GraphQL schema is the source for this supplemental read. A
separate MCP billing read worked during implementation; it is not treated as proof
of a project-funded top-up. The reload query does not cover every payment rail.

## Operator integration

The local Operator owns a `FundingRecords` service and a separate SQLite evidence
database, `funding-records.sqlite`, in its private runtime directory. It reads both
providers at startup and every five minutes while the process runs. Manual refresh
is rate-limited and overlapping refreshes are skipped. Successful reads update the
card observation and current total Runpod balance used as a budget ceiling; they do
not increase recorded project credits. A failed Runpod refresh clears the usable
balance observation. A failed card refresh holds the funding preview.

The `/treasury` view shows provider balances, record IDs, amounts, dates, status,
freshness and errors. `/treasury/status` is session-protected. Failed reads retain
prior evidence with an unavailable/stale label, never a fresh zero balance. Amounts
use integer USD micro-units, truncating fractional micro-units. API text is escaped.
The records are private; they are not included in the public report publisher.

Configure `fundingRecords.runpodCredentialPath` and
`fundingRecords.solcard.{slotNumber,last4,fundingAccountId,depositAddress}` in the
private Operator connection file. These are separate from spending policy. Use
**Connect SolCard · read only** on the console to authorize the backend. When using
Chrome/Edge, start from the localhost console in that browser so the callback has
its session cookie. Restarting during consent invalidates the pending attempt.

## Attribution remains held

All imported historical records are labelled **unattributed**. SolCard activity can
show the reported USD top-up separately from an invoice's `swapUsdAmount`, but the
inspected records do not supply the originating chain signature. Runpod reloads do
not identify the matching SolCard transaction. Matching amounts/timestamps or an
increased balance therefore do not create a verified project funding receipt.

The reconciliation worker is connected to this evidence service and returns explicit
missing-link reasons. Automatic credit posting remains disabled. Existing personal
Runpod funding does not become fee income or spendable project credit. Live signing,
transfers, billing changes and GPU actions remain disabled independently.

## Validation

73 tests passed across the funding-records, restricted-funding, treasury-funding,
treasury, operator-live, chatgpt-operator and operator-record suites. New tests cover
fixed read queries, exact card/account identity, old-card exclusion, duplicate rows,
precision, partial windows, stale/error handling, account changes, OAuth scope and
callback checks, write-tool rejection and escaped UI text. Windows DPAPI round-trip
and internal existing-credential reads were verified without printing credentials.
Runpod balance and a historical reload were verified through the live backend and UI.
At 21:30Z October 18, the approved SolCard backend successfully read the pinned card,
activity and matching invoice, alongside the connected Runpod feed. However, the
callback's encrypted credential save had failed: only the running process retained
the grant. This is not a durable connection. Token state now updates only after a
successful encrypted save, and the helper permits 30 seconds for Windows startup.
A regression test verifies failed saves never report authorization, a local save
retry needs no new code exchange, and persisted approval reloads correctly. A normal
OAuth response awaiting save is retained in memory for at most 15 minutes and retried
by the read poll/manual refresh; no token is used before storage succeeds. The UI
labels this pending state. No credential recovery through a debugger was executed.

Normal consent then completed successfully. At 21:52:39Z, after restarting the local
Operator, encrypted credentials loaded and both feeds returned fresh live records.
No consent or credential save remained pending. This verifies persistence across
that restart, not future availability or automatic funding. Imported records remain
unattributed, project credit is zero, and payments/GPU actions remain disabled.

References: [SolCard MCP](https://www.solcard.cc/resources/mcp),
[Runpod GraphQL schema](https://graphql-spec.dev.runpod.io/),
[Runpod billing](https://docs.runpod.io/accounts-billing/billing).

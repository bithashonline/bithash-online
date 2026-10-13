# ChatGPT-plan operator

The laptop operator produces owner-triggered, read-only fleet assessments using a signed-in ChatGPT plan. A completed report and its captured evidence are cached locally and synchronized to the independent server every 20 seconds. Synchronization does not run inference. The dashboard separates laptop heartbeat from report freshness and retains reports while the laptop is offline.

## Run locally

Use Node 22.16+ and `npm ci --ignore-scripts` in this directory. Keep the runtime directory and connection configuration outside this repository. Start with:

```sh
node chatgpt-operator-server.js PRIVATE_DIRECTORY CONNECTION_CONFIG
```

Open http://127.0.0.1:4185, sign in, load your available models and choose **Review current fleet**. Account allowance and app-credit settings apply; disable extra credit spending in ChatGPT if only plan allowance is authorized. There is no API-key fallback or inference scheduler.

The private connection JSON contains `keyFile`, `knownHostsFile`, and optional `publishReports: true`. Configure the SSH alias `bithash-control` in your own SSH configuration with your control host and user. Pin and independently verify its host key in `knownHostsFile`. The alias replaces the installation-specific address in the deployed source; commands and security checks are unchanged. The current deployed transport uses root SSH, which remains a hardening limitation; a restricted publisher account is not implemented.

The server must already provide the collector read bridge and report ingestion described in [operator reporting](../ops/operator-reporting/README.md). Never publish connection files, SSH keys, OAuth tokens, account IDs, or runtime directories.

## Boundaries

OAuth uses PKCE/state/nonce, JWT verification, explicit plan scopes and serialized refreshes. The private store uses Windows owner ACLs or Unix 0700/0600 permissions. The model receives allowlisted evidence and no execution tools. Completed streaming output must pass the strict advice schema and evidence-reference checks before acceptance. Suggestions are not executable spending proposals.

The local portal is separate from Google sign-in for spending approvals. Neither the model nor the hosted dashboard can rent GPUs or transfer funds. Heartbeats show the local synchronization process, not a guarantee of current inference eligibility.

## Evidence and limits

The first accepted report is [archived here](../experiments/evidence/2026-10-12-chatgpt-operator-report.json); [integration findings](../experiments/2026-10-12-hosted-operator.md) include earlier failed requests and verification limits. Several allowance-backed diagnostic requests preceded acceptance. Records capture application observations, not independent attestation of model execution or exhaustive GPU search.

Run `node --test chatgpt-operator.test.js operator.test.js operator-record.test.js` for the targeted checks. Automated tests use synthetic credentials and mocked inference; they do not spend allowance or rent GPUs.

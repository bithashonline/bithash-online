# Cached operator report service

The laptop validates a completed model report, sends it through pinned SSH to a fixed ingestion command, and refreshes its heartbeat every 20 seconds. The public schema excludes credentials. Reports are archived under their SHA-256 digest; an atomic pointer identifies the latest report and heartbeat.

Install `operator-ingest.mjs` as `/opt/bithash-operator/ingest.mjs`, and the remaining JavaScript modules beside it. The supplied systemd unit runs `operator-reader.mjs` as `nobody` on loopback port 8791. The reader needs read access to `/var/lib/bithash-operator`; the SSH ingestion user needs write access. No model or provider credential is loaded by the reader.

`enable-operator-reader.py` is an installation helper for an existing BitHash nginx read bridge. It reads the existing server-only bearer token, adds GET-only routes, validates nginx and reloads it. It assumes the existing `bithash_read` rate-limit zone, fleet route and HTTPS configuration. Review and back up your configuration before running it as administrator; this is not standalone provisioning.

Routes: `/api/operator` and `/api/operator-proof/<64-character lowercase digest>`. The hosted Worker proxies only these fixed read routes using its server-side environment. POST and query strings are rejected. Browser cookies and credentials are not forwarded to the collector.

The archive stops accepting new unique reports at 1,000 records. Retention, restricted SSH publishing, durable usage budgets and high availability remain unfinished. Server administrators can modify storage; content addressing is not independent timestamping or proof of model/hardware execution.

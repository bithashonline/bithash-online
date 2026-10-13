# Shared control host

Collector and shutdown run as separate systemd services on a 1 CPU/1 GiB Linux host. See ../../local/REMOTE-PROGRESS.md for current deployment and limits.

The supplied base collector unit binds development loopback HTTP. Remote mode requires Environment=BITHASH_COLLECTOR_TLS=1 and systemd LoadCredential entries named tls-key and tls-cert, sourced from root-only private files. Remote mode binds 0.0.0.0:8443; no host/port environment overrides exist. Firewall and disk isolation are deployment configuration. Preserve certificate and hostname verification.

A single host is a shared failure domain. The 100,000-row telemetry ceiling rejects new reports at capacity, about 27.8 hours for ten workers every ten seconds. Archive/retention and alerts remain prerequisites for sustained use. No provider key is delivered to the collector.

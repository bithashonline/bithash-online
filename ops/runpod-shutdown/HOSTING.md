# Current deployment status

The independent Linux shutdown service is deployed. Live deadline stop/delete, absence and process crash recovery passed; see ../../experiments/2026-10-12-live-shutdown.md. Final billing and host reboot recovery are not established by that test. The installation notes below retain their original preparation context.

# Independent controller hosting

Prepared October 12, 2026. **Not deployed.** User requested a paid-server proposal before purchase. Suggested: DigitalOcean Basic Regular, 1 vCPU, 1 GiB RAM, 25 GiB SSD, $0.00893/hour capped at $6/month before tax and optional extras. This is a catalog price, not a checked account checkout. No account access, server purchase, SSH key upload or credential transfer performed.

Use a separate Linux host with systemd 247+ and Node 22.16+ at `/usr/bin/node`. Ubuntu 24.04 LTS is the intended base; its default Node package may be too old. Verify the installed version and `node --experimental-sqlite -e "require('node:sqlite')"` before starting. Install Node from its official distribution using verified checksums. This host performs control requests; it does not run the GPU workload. No inbound application port is needed. Use SSH key access and firewall-limited administrative access.

## Prepared service

`bithash-shutdown.service` uses a dedicated unprivileged account, a durable private state directory, read-only application code and systemd credential delivery. It restarts the persistent `serve` command after failure. Unlike the finite `watch` command, `serve` stays alive with zero leases and can observe later registrations in the same database. Both commands latch stop on graceful termination; a deliberate service restart can stop active registered runs. A crash does not grant a new deadline.

`LoadCredential` reads `/etc/bithash-shutdown/runpod-key`, owned by root with mode0600, into systemd's service credential directory. Never put the value in a unit, command argument, cloud-init, repository, screenshot or journal. The application rejects simultaneous file and environment credentials. Root and the service identity remain trusted. Existing local Windows-encrypted credentials cannot simply be copied to Linux; a separately authorized secure transfer/provisioning step is needed.

## Installation sequence after host approval

1. Verify the SSH host fingerprint through the provider console. Confirm the host is independent of the GPU and will remain running.
2. Create the system account `bithash-shutdown`, with no login shell. Install `cli.mjs`, `controller.mjs`, `provider.mjs`, and `credential.mjs` root-owned, mode0644, into `/opt/bithash-shutdown` (directory mode0755).
3. Prepare `/etc/bithash-shutdown` root-owned mode0700 and securely provision its credential file. Do not use a GPU's own scoped key. GET permission alone does not establish stop/delete authorization.
4. Install the unit into `/etc/systemd/system/bithash-shutdown.service`. Run `systemd-analyze verify` before `systemctl daemon-reload` and `systemctl enable --now bithash-shutdown`.
5. Inspect `systemctl status bithash-shutdown` and the private journal. Confirm at least two timestamped empty-ledger records, no errors, `permitsNewRental:false`, and private state ownership. Register no fabricated production Pod leases.
6. With no active leases, kill the service's main process and verify systemd starts a new PID and resumes heartbeats. Reboot and verify boot startup. These host acceptance steps are not yet performed.
7. Use the same service identity for `cli.mjs register /var/lib/bithash-shutdown/state.sqlite LEASE.json`. Registration does not need the provider key. SQLite state is trusted input and must remain private. Do not expose a registration HTTP port in this step.

## Acceptance boundary

October 12 deployment: 28 local controller tests pass, plus 6 transport fixture tests on the Linux host. Collector and shutdown services are active; supervisor recovery was verified. Shutdown GET, stop and delete now use REST v2, with observed lifecycle status and conservative mount parsing. Read-only v2 account access succeeds. Actual provider stop/delete permissions, GPU deadline shutdown and host reboot recovery still require acceptance testing. No new rental is permitted by these checks.

After host acceptance, separately approve a small disposable-GPU test with a spending cap. Verify original billing start, all-in rate, lease registration, identity observation, deadline stop/delete, provider audit and billing. Keep manual console recovery available. A running service/heartbeat is not evidence that it can stop a GPU. This is one host, not high availability; provider or host outages can still defeat shutdown. External alert delivery and automatic creator-fee funding remain pending.

References: [DigitalOcean prices](https://www.digitalocean.com/pricing/droplets), [systemd credential mechanism](https://github.com/systemd/systemd/blob/main/docs/CREDENTIALS.md).

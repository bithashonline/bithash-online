#!/bin/bash
set -euo pipefail
test "$(id -u)" = 0
cd /root/bithash-executor-deploy
sha256sum -c SHA256SUMS
systemctl is-active --quiet bithash-shutdown bithash-collector
install -d -m 755 /opt/bithash-executor/ops/live-executor /opt/bithash-executor/ops/runpod-shutdown /opt/bithash-executor/local
install -m 644 ops/live-executor/*.mjs ops/live-executor/bootstrap.py /opt/bithash-executor/ops/live-executor/
install -m 644 ops/runpod-shutdown/credential.mjs /opt/bithash-executor/ops/runpod-shutdown/
install -m 644 local/runpod-v2.js local/package.json /opt/bithash-executor/local/
install -m 644 worker.tar.gz /opt/bithash-executor/
install -d -m 700 /etc/bithash-executor
install -m 600 config.json /etc/bithash-executor/config.json
# Preserve the independently running watchdog; no restart needed for CLI additions.
install -m 644 ops/runpod-shutdown/controller.mjs ops/runpod-shutdown/cli.mjs /opt/bithash-shutdown/
install -m 644 local/telemetry-enroll.js /opt/bithash/local/
install -m 644 ops/live-executor/bithash-executor.service /etc/systemd/system/
systemd-analyze verify /etc/systemd/system/bithash-executor.service
systemctl daemon-reload
systemctl enable --now bithash-executor
python3 ops/live-executor/nginx.py
systemctl is-active bithash-executor bithash-shutdown bithash-collector
curl --fail --silent http://127.0.0.1:8793/api/executor/status

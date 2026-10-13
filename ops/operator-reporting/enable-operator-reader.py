from pathlib import Path
import subprocess
p=Path('/etc/nginx/sites-available/bithash-telemetry')
text=p.read_text()
token=Path('/etc/bithash-collector/dashboard-read-token').read_text().strip()
assert len(token)==64 and all(c in '0123456789abcdef' for c in token)
route=''' location ~ "^/api/(operator|operator-proof/[a-f0-9]{64})$" {
  if ($request_method != GET) { return 405; }
  if ($args != "") { return 400; }
  if ($http_authorization != "Bearer TOKEN") { return 401; }
  limit_req zone=bithash_read burst=20 nodelay;
  proxy_pass http://127.0.0.1:8791;
  proxy_set_header Authorization "";
  proxy_set_header Cookie "";
  proxy_connect_timeout 3s;
  proxy_read_timeout 5s;
  add_header Cache-Control "private, no-store" always;
 }
'''.replace('TOKEN',token)
if 'operator-proof/' not in text:
 marker=' location = /api/fleet-status'
 assert text.count(marker)==1
 p.write_text(text.replace(marker,route+marker));p.chmod(0o600)
 if subprocess.run(['nginx','-t']).returncode:
  p.write_text(text)
  raise SystemExit('nginx check failed; restored')
subprocess.run(['systemctl','daemon-reload'],check=True)
subprocess.run(['systemctl','enable','--now','bithash-operator-reader'],check=True)
subprocess.run(['systemctl','reload','nginx'],check=True)
print('operator_reader_enabled')

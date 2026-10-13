from pathlib import Path
import subprocess
p=Path('/etc/nginx/sites-available/bithash-telemetry')
original=p.read_text()
if '# BitHash executor routes' in original:
    raise SystemExit('executor routes already installed')
token=Path('/etc/bithash-collector/dashboard-read-token').read_text().strip()
assert len(token)==64 and all(c in '0123456789abcdef' for c in token)
routes='''
 # BitHash executor routes
 location ~ "^/api/executor/(status|proof/[a-f0-9]{64})$" {
  if ($request_method != GET) { return 405; }
  if ($args != "") { return 400; }
  if ($http_authorization != "Bearer TOKEN") { return 401; }
  limit_req zone=bithash_read burst=20 nodelay;
  proxy_pass http://127.0.0.1:8793;
  proxy_set_header Authorization "";
  proxy_set_header Cookie "";
  proxy_read_timeout 5s;
 }
 location ~ "^/api/executor/(enroll|complete)$" {
  if ($request_method != POST) { return 405; }
  if ($args != "") { return 400; }
  client_max_body_size 8k;
  limit_req zone=bithash_read burst=10 nodelay;
  proxy_pass http://127.0.0.1:8793;
  proxy_set_header Cookie "";
  proxy_read_timeout 15s;
 }
 location = /api/executor/artifact/598d0d4acf2b22139e2968eafd610a9912465abdb60a42660c8dda86eea5da63 {
  if ($request_method != GET) { return 405; }
  if ($args != "") { return 400; }
  limit_req zone=bithash_read burst=5 nodelay;
  proxy_pass http://127.0.0.1:8793;
  proxy_set_header Authorization "";
  proxy_set_header Cookie "";
 }
'''.replace('TOKEN',token)
at=original.rfind(' location / { return 404; }')
assert at!=-1 and 'listen 443 ssl' in original[:at]
p.write_text(original[:at]+routes+original[at:]);p.chmod(0o600)
if subprocess.run(['nginx','-t']).returncode:
    p.write_text(original)
    raise SystemExit('nginx validation failed; restored')
subprocess.run(['systemctl','reload','nginx'],check=True)
print('executor routes enabled; owner commands remain socket-only')

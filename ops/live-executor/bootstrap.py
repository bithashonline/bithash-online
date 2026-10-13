"""Fixed benchmark bootstrap. No provider/account key ever enters this container."""
import os, json, hashlib, urllib.request, subprocess, time, tarfile, pathlib
os.umask(0o077)
ROOT = pathlib.Path('/bithash-private')
ROOT.mkdir(mode=0o700, exist_ok=True)
# Exclusive marker: container restarts cannot repeat an already-started benchmark.
with open(ROOT / 'started', 'x') as marker:
    marker.write('single-use\n')
base = 'https://telemetry.bithash.online/api/executor'
token = os.environ.pop('BITHASH_BOOTSTRAP_TOKEN')
run = os.environ.pop('BITHASH_RUN_ID')
pod = os.environ['RUNPOD_POD_ID']
def download(url, name, digest, limit):
    path = ROOT / name
    with urllib.request.urlopen(url, timeout=30) as response, open(path, 'wb') as out:
        size = 0
        while True:
            b = response.read(65536)
            if not b: break
            size += len(b)
            if size > limit: raise RuntimeError('artifact_size')
            out.write(b)
    if hashlib.sha256(path.read_bytes()).hexdigest() != digest: raise RuntimeError('artifact_hash')
    return path
def extract(path, dest):
    dest.mkdir(mode=0o700, exist_ok=True)
    with tarfile.open(path) as archive:
        # Hashes pin both archives. Still disallow traversal, links and devices.
        for m in archive.getmembers():
            if m.name.startswith('/') or '..' in pathlib.PurePosixPath(m.name).parts or not (m.isfile() or m.isdir()):
                raise RuntimeError('archive_member')
        archive.extractall(dest, filter='data')
node_archive = download('https://nodejs.org/dist/v22.23.3/node-v22.23.3-linux-x64.tar.xz', 'node.tar.xz',
 'df450af89261115ef9f9e3830c3eeb2cc9213b63c720b1af623cb5dcbe2e02de', 40000000)
# Official Node archive has symlinks; extract only the required executable.
with tarfile.open(node_archive) as archive:
    member = archive.getmember('node-v22.23.3-linux-x64/bin/node')
    if not member.isfile(): raise RuntimeError('node_member')
    (ROOT / 'node').write_bytes(archive.extractfile(member).read())
os.chmod(ROOT / 'node', 0o700)
bundle = download(base+'/artifact/c940e364673f2b52f5cd4345c20e36e711519b04abe2b9516a1214197c2358ac', 'worker.tar.gz',
 'c940e364673f2b52f5cd4345c20e36e711519b04abe2b9516a1214197c2358ac', 5000000)
extract(bundle, ROOT / 'worker')
node = str(ROOT / 'node')
public_key = subprocess.check_output([node, '-e', "const f=require('fs'),c=require('crypto'),p=c.generateKeyPairSync('ed25519');f.writeFileSync('/bithash-private/key.pem',p.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});process.stdout.write(p.publicKey.export({type:'spki',format:'pem'}));"], timeout=10).decode()
def post(path, data):
    req = urllib.request.Request(base+path, data=json.dumps(data).encode(), headers={'Content-Type':'application/json','Authorization':'Bearer '+token})
    with urllib.request.urlopen(req, timeout=10) as response:
        return json.load(response)
cfg = None
for _ in range(30):
    try:
        cfg = post('/enroll', {'id':run,'podId':pod,'publicKey':public_key})
        break
    except Exception:
        time.sleep(2)
if cfg is None: raise RuntimeError('enrollment_unavailable')
(ROOT / 'collector-ca.pem').write_text(cfg.pop('ca'))
(ROOT / 'config.json').write_text(json.dumps(cfg))
os.chmod(ROOT / 'config.json', 0o600)
result = subprocess.run([node, '--experimental-sqlite', str(ROOT/'worker/worker.mjs'), str(ROOT/'config.json')], timeout=920, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
# Upload only the fixed worker's structured benchmark results, not environment,
# credentials or arbitrary diagnostics. Never delay completion indefinitely.
try:
    result_file = ROOT/'worker-state'/cfg['lease']/'result.json'
    if result_file.stat().st_size > 400000: raise RuntimeError('result_size')
    worker_result = json.loads(result_file.read_text())
    archive_payload = {'schema':'bithash.worker-archive.v1','id':run,'podId':pod,'lease':cfg['lease'],'build':cfg['build'],'result':worker_result}
    envelope = json.loads(subprocess.check_output([node, '-e', "const c=require('crypto'),f=require('fs');let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>{const payload=JSON.stringify(JSON.parse(s));process.stdout.write(JSON.stringify({payload,signature:c.sign(null,Buffer.from('bithash.worker-archive.v1\\n'+payload),f.readFileSync('/bithash-private/key.pem')).toString('base64')}));});"], input=json.dumps(archive_payload).encode(), timeout=10))
    for attempt in range(3):
        try:
            post('/archive', envelope)
            break
        except Exception:
            if attempt < 2: time.sleep(2)
except Exception:
    pass  # Completion/deadline still triggers shutdown if archival fails.
# Signed completion is an authenticated worker claim, not a provider invoice.
payload = {'schema':'bithash.executor-completion.v1','id':run,'podId':pod,'lease':cfg['lease'],'status':'passed' if result.returncode==0 else 'failed'}
serialized = json.dumps(payload, separators=(',',':'))
signature = subprocess.check_output([node,'-e',"const c=require('crypto'),f=require('fs');let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>process.stdout.write(c.sign(null,Buffer.from('bithash.executor-completion.v1\\n'+s),f.readFileSync('/bithash-private/key.pem')).toString('base64')));"], input=serialized.encode(), timeout=10).decode()
for _ in range(3):
    try:
        post('/complete', {'payload':payload,'signature':signature})
        break
    except Exception: time.sleep(2)

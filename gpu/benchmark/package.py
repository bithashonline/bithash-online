"""Assemble the reviewed benchmark into an explicit, small artifact allowlist."""
import pathlib,shutil,hashlib,json,sys
here=pathlib.Path(__file__).resolve().parent
out=pathlib.Path(sys.argv[1]);original=pathlib.Path(sys.argv[2])
out.mkdir(parents=True,exist_ok=True);(out/'lib').mkdir(exist_ok=True)
for name in ['run.py','vectors.json']:
    shutil.copyfile(here/name,out/name)
shutil.copyfile(original/'lib/libcudart.so.12',out/'lib/libcudart.so.12')
for p in original.iterdir():
    if p.is_file() and ('LICENSE' in p.name.upper() or 'EULA' in p.name.upper()):shutil.copyfile(p,out/p.name)
files={p.relative_to(out).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in out.rglob('*') if p.is_file() and p.name!='package-manifest.json'}
sources={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in here.iterdir() if p.is_file()}
(out/'package-manifest.json').write_text(json.dumps({'schema':'bithash.benchmark-package.v1','files':files,'sourceHashes':sources,'upstreamCommit':'6bf8059ef075eb1622298395866b0bd02375e1d9'},indent=2)+'\n')
print(json.dumps({'files':list(files),'binarySha256':files['bithash-benchmark']},indent=2))

"""Allowlisted reproducible runtime bundle for EXP-006."""
import pathlib,shutil,hashlib,json,sys,tarfile
here=pathlib.Path(__file__).resolve().parent
out=pathlib.Path(sys.argv[1]);old=pathlib.Path(sys.argv[2]);archive=pathlib.Path(sys.argv[3])
out.mkdir(parents=True,exist_ok=True);(out/'lib').mkdir(exist_ok=True)
for name in ['run.py','stop-watchdog.py','vectors.json']:
    shutil.copyfile(here/name,out/name)
for name in ['lib/libcudart.so.12','BITCRACK-LICENSE.MIT','CUDA-LICENSE']:
    shutil.copyfile(old/name,out/name)
allowed={'bithash-benchmark','run.py','stop-watchdog.py','vectors.json','lib/libcudart.so.12','BITCRACK-LICENSE.MIT','CUDA-LICENSE'}
files={name:hashlib.sha256((out/name).read_bytes()).hexdigest() for name in sorted(allowed)}
sources={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in here.iterdir() if p.is_file()}
(out/'package-manifest.json').write_text(json.dumps({'schema':'bithash.comparison-package.v1','files':files,'sourceHashes':sources,'upstreamCommit':'6bf8059ef075eb1622298395866b0bd02375e1d9','cudaTargets':['sm_86','sm_89','compute_89 PTX']},indent=2)+'\n')
with tarfile.open(archive,'w:gz') as t:
    for name in sorted(allowed|{'package-manifest.json'}):t.add(out/name,arcname=name,recursive=False)
print(json.dumps({'binarySha256':files['bithash-benchmark'],'archiveSha256':hashlib.sha256(archive.read_bytes()).hexdigest()},indent=2))

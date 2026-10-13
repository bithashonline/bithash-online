"""Run all bounded fixture vectors against a compiled binary. Never emit raw worker errors."""
import datetime, hashlib, json, pathlib, subprocess, sys, time

here=pathlib.Path(__file__).resolve().parent
binary=pathlib.Path(sys.argv[1]).resolve() if len(sys.argv)>1 else here/'bithash-fixture'
began=time.monotonic()
report={'schema':'bithash.cuda-validation.v1','observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'gpuValidated':False,'results':[],'billingEvidence':'not-observed'}
try:
    report['binarySha256']=hashlib.sha256(binary.read_bytes()).hexdigest()
    if report['binarySha256'] != '4148dce03b6a5a0f7e688b77dc9b00f77190bb2902c1c37b7cb19835368febe6': raise ValueError('Unexpected binary')
    hardware=subprocess.run(['nvidia-smi','--query-gpu=name,driver_version','--format=csv,noheader'],capture_output=True,timeout=10)
    if hardware.returncode or len(hardware.stdout)>4096: raise ValueError('GPU inventory unavailable')
    lines=hardware.stdout.decode('utf-8').strip().splitlines()
    if len(lines)!=1: raise ValueError('Expected one GPU')
    model,driver=[x.strip() for x in lines[0].split(',')]
    if model != 'NVIDIA GeForce RTX 4090': raise ValueError('Unexpected GPU model')
    report['hardware']={'source':'host-reported nvidia-smi','model':model,'driverVersion':driver}
    vectors=(here/'reference-vectors.json').read_bytes()
    if hashlib.sha256(vectors).hexdigest() != '8f47d3b3ce110e3776978eb45261a613e6c74af0b62e1204ed89da5e26d1045e': raise ValueError('Changed fixture corpus')
    cases=json.loads(vectors)
    if len(cases)!=14: raise ValueError('Incomplete fixture corpus')
    for case in cases:
        p=subprocess.run([str(binary),case['fixture'],case['start'],case['end']],capture_output=True,timeout=60,env={'PATH':'/usr/bin:/bin'})
        if p.returncode or p.stderr or len(p.stdout)>4096: raise ValueError('Worker failed')
        got=json.loads(p.stdout)
        if not isinstance(got,dict) or type(got.get('matched')) is not bool or got != {'backend':'bitcrack-cuda-bounded-fixture','attempted':case['attempted'],'matched':case['matched']}: raise ValueError('Reference mismatch')
        report['results'].append(dict(case,agreesWithCpu=True))
    report['gpuValidated']=True
except Exception:
    report['error']='GPU fixture validation did not complete; no live readiness established'
report['validationWallSeconds']=round(time.monotonic()-began,3)
print(json.dumps(report,indent=2))
sys.exit(0 if report['gpuValidated'] else 1)

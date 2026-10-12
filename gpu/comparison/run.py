"""Fixed synthetic benchmark, bounded runtime, host telemetry and resumable evidence file."""
import datetime,hashlib,json,math,pathlib,subprocess,threading,time,sys
here=pathlib.Path(__file__).resolve().parent
def utc():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
report={'schema':'bithash.gpu-comparison.v1','startedAt':utc(),'status':'running','cases':[],
 'evidence':'host-reported GPU execution and device counter; not remote attestation',
 'workload':'fixed synthetic public known-answer ranges; no funded target',
 'puzzle71Candidates':'0','billingEvidence':'collected separately from provider',
 'limitations':['Repeated profiles scan overlapping synthetic ranges; totals are not unique puzzle coverage',
 'Device counter and boundary matches detect some errors, not a proof of every cryptographic calculation']}
def save():
    text=json.dumps(report,indent=2)+'\n'
    temp=here/'benchmark-report.tmp';temp.write_text(text);temp.replace(here/'benchmark-report.json')
    (here/'benchmark-report.txt').write_text(text)
stop=threading.Event();samples=[]
def telemetry():
    while not stop.is_set():
        try:
            r=subprocess.run(['nvidia-smi','--query-gpu=utilization.gpu,temperature.gpu,power.draw,clocks.sm,memory.used','--format=csv,noheader,nounits'],capture_output=True,text=True,timeout=5)
            values=[float(v.strip()) for v in r.stdout.strip().split(',')]
            if r.returncode==0 and len(values)==5 and all(math.isfinite(v) for v in values):
                samples.append(dict(zip(['gpuUtilizationPercent','temperatureC','powerW','smClockMHz','memoryMiB'],values),observedAt=utc()))
        except Exception:pass
        stop.wait(2)
began=time.monotonic();thread=None
try:
    manifest=json.loads((here/'package-manifest.json').read_text())
    for name,expected in manifest['files'].items():
        if pathlib.Path(name).is_absolute() or '..' in pathlib.Path(name).parts or digest(here/name)!=expected:raise ValueError('Package mismatch')
    report['packageManifestSha256']=digest(here/'package-manifest.json')
    report['binarySha256']=digest(here/'bithash-benchmark')
    report['vectorsSha256']=digest(here/'vectors.json')
    hw=subprocess.run(['nvidia-smi','--query-gpu=name,driver_version','--format=csv,noheader'],capture_output=True,text=True,timeout=10)
    lines=hw.stdout.strip().splitlines()
    if hw.returncode or len(lines)!=1:raise ValueError('Expected one GPU')
    model,driver=[s.strip() for s in lines[0].split(',')]
    allowed={'a5000':'NVIDIA RTX A5000','3090':'NVIDIA GeForce RTX 3090','4090':'NVIDIA GeForce RTX 4090','5090':'NVIDIA GeForce RTX 5090'}
    if len(sys.argv)!=2 or sys.argv[1] not in allowed or model!=allowed[sys.argv[1]]:raise ValueError('Unexpected GPU')
    report['hardware']={'source':'host-reported nvidia-smi','model':model,'driver':driver}
    vectors=json.loads((here/'vectors.json').read_text())['profiles']
    thread=threading.Thread(target=telemetry,daemon=True);thread.start();save()
    # Validate every configuration before running any long timing pass.
    schedule=[('validate',0,['small','medium','large'])]
    schedule += [('benchmark',i+1,order) for i,order in enumerate([['small','medium','large'],['medium','large','small'],['large','small','medium']])]
    for mode,repeat,order in schedule:
        for profile in order:
            if time.monotonic()-began>950:raise ValueError('Suite deadline reached')
            v=next(x for x in vectors if x['id']==profile and x['mode']==mode)
            entry={'profile':profile,'mode':mode,'repeat':repeat,'startedAt':utc(),'status':'running'}
            report['cases'].append(entry);save();print(f'START {mode} {profile} repeat={repeat}',flush=True)
            r=subprocess.run([str(here/'bithash-benchmark'),profile,mode],capture_output=True,text=True,timeout=190)
            if r.returncode or r.stderr or len(r.stdout)>4096:raise ValueError('Worker failed')
            got=json.loads(r.stdout)
            fields={'schema','profile','mode','start','end','attempted','expectedMatches','matches','correct','initializationSeconds','scanSeconds','candidatesPerSecond'}
            if set(got)!=fields or got['schema']!='bithash.gpu-benchmark-case.v1' or got['profile']!=profile or got['mode']!=mode:raise ValueError('Invalid result schema')
            for key in ['start','end']:
                if got[key]!=v[key]:raise ValueError('Range mismatch')
            expected=sum(t['expectedMatch'] for t in v['targets'])
            if got['attempted']!=v['count'] or got['matches']!=expected or got['expectedMatches']!=expected or got['correct'] is not True:raise ValueError('Correctness mismatch')
            for key in ['scanSeconds','initializationSeconds','candidatesPerSecond']:
                if type(got[key]) not in [int,float] or not math.isfinite(got[key]) or got[key]<=0:raise ValueError('Invalid timing')
            calculated=int(v['count'])/got['scanSeconds']
            if abs(calculated-got['candidatesPerSecond'])/calculated>1e-6:raise ValueError('Timing mismatch')
            entry.update(status='passed',completedAt=utc(),result=got);save()
            print(f'PASS {mode} {profile}: {got["candidatesPerSecond"]/1e6:.3f} M candidates/s; init {got["initializationSeconds"]:.3f}s',flush=True)
    report['status']='passed'
except Exception as error:
    report['status']='failed';report['errorType']=type(error).__name__
    report['error']='Benchmark did not complete; retain partial results and investigate before making performance claims'
finally:
    stop.set()
    if thread:thread.join(timeout=6)
    report['completedAt']=utc();report['wallSeconds']=round(time.monotonic()-began,6);report['telemetrySamples']=samples
    save();print('REPORT benchmark-report.json STATUS '+report['status'],flush=True)
    print('REPORT_SHA256 '+digest(here/'benchmark-report.json'),flush=True)
sys.exit(0 if report['status']=='passed' else 1)

import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {performance} from 'node:perf_hooks';
const execute = promisify(execFile);
export const models = {a5000:'NVIDIA RTX A5000','3090':'NVIDIA GeForce RTX 3090','4090':'NVIDIA GeForce RTX 4090','5090':'NVIDIA GeForce RTX 5090'};
const fields = ['schema','profile','mode','start','end','attempted','expectedMatches','matches','correct','initializationSeconds','scanSeconds','candidatesPerSecond'].sort().join();

export function validateResult(raw, vector) {
  if (Buffer.byteLength(raw)>4096) throw Error('invalid_result');
  const r=JSON.parse(raw), matches=vector.targets.filter(t=>t.expectedMatch).length;
  if (!r || Object.keys(r).sort().join()!==fields || r.schema!=='bithash.gpu-benchmark-case.v1' ||
      r.profile!==vector.id || r.mode!==vector.mode || r.start!==vector.start || r.end!==vector.end ||
      r.attempted!==vector.count || r.matches!==matches || r.expectedMatches!==matches || r.correct!==true)
    throw Error('invalid_result');
  for (const k of ['initializationSeconds','scanSeconds','candidatesPerSecond'])
    if (typeof r[k]!=='number' || !Number.isFinite(r[k]) || r[k]<=0) throw Error('invalid_timing');
  const rate=Number(vector.count)/r.scanSeconds;
  if (Math.abs(rate-r.candidatesPerSecond)/rate>1e-6) throw Error('invalid_rate');
  return r;
}

// Fixed executable/argument array; no shell, inherited credentials, or raw diagnostics.
export async function executeCase(binary, vector, timeout, signal) {
  const r=await execute(binary,[vector.id,vector.mode],{timeout,signal,killSignal:'SIGKILL',
    maxBuffer:8192,encoding:'utf8',env:{PATH:'/usr/bin:/bin'}});
  if(r.stderr) throw Error('worker_diagnostic');
  return validateResult(r.stdout,vector);
}

export async function hardwareSample(expected, signal) {
  const r=await execute('nvidia-smi',['--query-gpu=name,utilization.gpu','--format=csv,noheader,nounits'],
    {timeout:3000,signal,killSignal:'SIGKILL',maxBuffer:4096,encoding:'utf8',env:{PATH:'/usr/bin:/bin'}});
  const lines=r.stdout.trim().split(/\r?\n/),parts=lines[0].split(',').map(s=>s.trim());
  if(r.stderr || lines.length!==1 || parts.length!==2 || parts[0]!==models[expected] ||
    !/^\d{1,3}$/.test(parts[1]) || Number(parts[1])>100) throw Error('gpu_inventory_failed');
  return Number(parts[1]);
}

// Reports credit only fully completed, known-answer-validated cases. An interrupted
// case contributes zero; repeated cases are NOT unique range coverage.
export async function runWorker(config, deps) {
  const now=deps.now??Date.now, monotonic=deps.monotonic??(()=>performance.now());
  const started=monotonic(), budget=Math.min(config.durationSeconds*1000,config.expiresAt-now());
  if(budget<=0) throw Error('expired_run');
  const controller=new AbortController();
  const abort=()=>controller.abort();
  deps.signal?.addEventListener('abort',abort,{once:true});
  if(deps.signal?.aborted) abort();
  const deadline=setTimeout(abort,budget);
  let active=false,checked=0n,rate=null,failed=false,finished=false,deliveryFailed=false;
  let busy=null;
  const results=[];
  const remaining=()=>Math.floor(Math.min(budget-(monotonic()-started),config.expiresAt-now()));
  const sample=async(state)=>{
    if(remaining()<=0) {abort();return;}
    let utilizationPercent=null;
    try {utilizationPercent=await deps.hardware(controller.signal);} catch {failed=true;abort();state='error';}
    if(now()>=config.expiresAt)return;
    const m={schema:'bithash.scanner-metrics.v1',lease:config.lease,observedAt:now(),
      workload:'fixed-synthetic-known-answer',state:failed?'error':state,
      candidatesChecked:checked.toString(),candidatesPerSecond:failed?null:rate,
      utilizationPercent,puzzle71Candidates:'0',uniqueCoverageVerified:false};
    await deps.saveMetrics(m);
    try {await deps.report(m);} catch {deliveryFailed=true;failed=true;abort();}
  };
  const tick=state=>{
    if(busy) return busy;
    busy=sample(state).finally(()=>{busy=null;});return busy;
  };
  const timer=setInterval(()=>{
    if(!finished) void tick(active?'computing':'idle').catch(()=>{failed=true;abort();});
  },deps.intervalMs??10000);
  try {
    await tick('idle');
    // Repeats are synthetic work, never unique puzzle coverage. Finish the last
    // case; the independent hard runtime and lease deadline still apply.
    let caseIndex=0;
    while(caseIndex<2 || (config.sustainSeconds && monotonic()-started<config.sustainSeconds*1000)) {
      const mode=caseIndex===0?'validate':'benchmark';
      if(controller.signal.aborted) throw Error('run_stopped');
      const vector=deps.vectors.find(v=>v.id==='small'&&v.mode===mode);
      if(!vector || remaining()<=0) throw Error('run_stopped');
      active=true;rate=null;
      await tick('computing');
      if(controller.signal.aborted || remaining()<=0) throw Error('run_stopped');
      const result=await deps.scan(vector,Math.min(190000,remaining()),controller.signal);
      if(controller.signal.aborted || remaining()<=0) throw Error('run_stopped');
      // Validate again at the boundary even if a scanner adapter did so already.
      validateResult(JSON.stringify(result),vector);
      checked+=BigInt(result.attempted);rate=String(Math.floor(result.candidatesPerSecond));
      results.push(result);active=false;
      await deps.saveResults(results);
      await tick('idle');
      caseIndex++;
    }
    if(controller.signal.aborted || failed) throw Error('run_stopped');
  } catch {failed=true;}
  finally {
    finished=true;clearInterval(timer);clearTimeout(deadline);
    if(busy) {try{await busy;}catch{failed=true;}}
    if(failed) rate=null;
    if(remaining()>0 && !deliveryFailed) {try{await tick(failed?'error':'idle');}catch{failed=true;}}
    deps.signal?.removeEventListener('abort',abort);
  }
  return {schema:'bithash.supervised-worker-result.v1',status:failed?'failed':'passed',
    workload:'fixed-synthetic-known-answer',completedCases:results.length,
    candidatesChecked:checked.toString(),puzzle71Candidates:'0',
    uniqueCoverageVerified:false,deliveryFailed,results};
}

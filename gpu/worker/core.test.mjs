import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPairSync,verify,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {runWorker,validateResult,executeCase} from './core.mjs';
import {sha,bundleFiles,verifyBundle,claimLease,validateConfig} from './runtime.mjs';
import {GpuTelemetry,signTelemetry,telemetryDomain} from '../../local/gpu-telemetry.js';
const vectors=JSON.parse(readFileSync(new URL('../comparison/vectors.json',import.meta.url))).profiles;
test('five-minute synthetic mode repeats complete cases, retains monotonic counts and stops at target',async()=>{
 let elapsed=0;const modes=[];
 const s=setup({monotonic:()=>elapsed,scan:async v=>{modes.push(v.mode);elapsed+=26000;return result(v);}});
 s.config.durationSeconds=390;s.config.sustainSeconds=300;s.config.expiresAt=Date.now()+600000;
 const r=await runWorker(s.config,s.deps);
 assert.equal(r.status,'passed');assert.equal(modes.length,12);assert.equal(elapsed,312000);
 assert.equal(modes[0],'validate');assert(modes.slice(1).every(m=>'benchmark'));
 assert.equal(r.candidatesChecked,String(2097152n+11n*34359738368n));assert.equal(r.puzzle71Candidates,'0');
 assert(s.reports.every((m,i)=>i===0||BigInt(m.candidatesChecked)>=BigInt(s.reports[i-1].candidatesChecked)));
});
const result=v=>({schema:'bithash.gpu-benchmark-case.v1',profile:v.id,mode:v.mode,start:v.start,end:v.end,
 attempted:v.count,expectedMatches:v.targets.filter(t=>t.expectedMatch).length,matches:v.targets.filter(t=>t.expectedMatch).length,
 correct:true,initializationSeconds:1,scanSeconds:2,candidatesPerSecond:Number(v.count)/2});
function setup(overrides={}){
 const samples=[],reports=[],saved=[];const config={lease:'a'.repeat(32),durationSeconds:2,expiresAt:Date.now()+10000};
 const deps={vectors,hardware:async()=>80,scan:async v=>result(v),
  saveMetrics:async m=>samples.push({...m}),report:async m=>reports.push({...m}),saveResults:async r=>saved.push([...r]),...overrides};
 return {config,deps,samples,reports,saved};
}
test('validated cases feed real collector signatures and independently verifiable proofs',async()=>{
 const db=new DatabaseSync(':memory:'),collector=new GpuTelemetry(db),keys=generateKeyPairSync('ed25519');
 const s=setup();const e={id:s.config.lease,publicKey:keys.publicKey.export({format:'pem',type:'spki'}),
  build:'sha256:'+'b'.repeat(64),providerPodId:'localfixture001',kind:'gpu',expiresAt:s.config.expiresAt};collector.enroll(e);
 let sequence=0;const proofs=[];
 s.deps.report=async m=>{
  const envelope=signTelemetry({schema:'bithash.gpu-telemetry.v1',lease:e.id,sequence:++sequence,state:m.state,
   device:'nvidia-gpu',utilizationPercent:m.utilizationPercent,candidatesPerSecond:m.candidatesPerSecond,candidatesChecked:m.candidatesChecked},keys.privateKey);
  const receipt=collector.accept(envelope);proofs.push(collector.proof(receipt.digest));
 };
 try {
  const r=await runWorker(s.config,s.deps);assert.equal(r.status,'passed');assert.equal(r.completedCases,2);
  assert.equal(r.candidatesChecked,String(2097152n+34359738368n));assert.equal(r.puzzle71Candidates,'0');
  for(const p of proofs){const bytes=Buffer.from(telemetryDomain+JSON.stringify(p.envelope.payload));
   assert(verify(null,bytes,p.enrollment.publicKey,Buffer.from(p.envelope.signature,'base64')));
   assert.equal(createHash('sha256').update(bytes).digest('hex'),p.digest);assert.equal(p.coverageVerified,false);}
  assert.equal(collector.snapshot().items[0].reported.candidatesChecked,r.candidatesChecked);
 }finally{db.close();}
});
test('active case reports do not interpolate counts or repeat a previous case rate',async()=>{
 const s=setup({intervalMs:5,scan:async v=>{await delay(25);return result(v);}});
 const r=await runWorker(s.config,s.deps);assert.equal(r.status,'passed');
 const active=s.reports.filter(m=>m.state==='computing');assert(active.length>=4);
 assert(active.every(m=>m.candidatesPerSecond===null));assert(active.every(m=>['0','2097152'].includes(m.candidatesChecked)));
});
test('wrong counts, matches, extra secret fields and nonfinite timing cannot be credited',async()=>{
 const v=vectors[0];for(const patch of [{attempted:'999'},{matches:99},{secret:'must-not-leak'},{scanSeconds:Infinity},{candidatesPerSecond:1}])
  assert.throws(()=>validateResult(JSON.stringify({...result(v),...patch}),v));
 const s=setup({scan:async v=>({...result(v),attempted:'999'})});
 const r=await runWorker(s.config,s.deps);assert.equal(r.status,'failed');assert.equal(r.candidatesChecked,'0');assert.equal(s.reports.at(-1).state,'error');
});
test('delivery failure stops before any scanner launch',async()=>{
 let launches=0;const s=setup({report:async()=>{throw Error('private-response');},scan:async v=>{launches++;return result(v);}});
 const r=await runWorker(s.config,s.deps);assert.equal(launches,0);assert.equal(r.deliveryFailed,true);
 assert(!JSON.stringify(r).includes('private-response'));
});
test('hardware failure stops before scanning and produces null utilization',async()=>{
 let launches=0;const s=setup({hardware:async()=>{throw Error('missing_gpu');},scan:async v=>{launches++;return result(v);}});
 const r=await runWorker(s.config,s.deps);assert.equal(launches,0);assert.equal(r.status,'failed');assert.equal(s.reports[0].utilizationPercent,null);
});
test('monotonic deadline aborts in-flight scanner and never credits partial work',async()=>{
 let cancelled=false;const s=setup({scan:async(v,timeout,signal)=>{try{await delay(10000,null,{signal});}catch{cancelled=true;throw Error('aborted');}return result(v);}});
 s.config.durationSeconds=.03;const r=await runWorker(s.config,s.deps);
 assert(cancelled);assert.equal(r.status,'failed');assert.equal(r.candidatesChecked,'0');
});
test('expiry and operator interruption prevent further work',async()=>{
 const s=setup();s.config.expiresAt=Date.now()-1;await assert.rejects(runWorker(s.config,s.deps),/expired/);
 const signal=new AbortController();signal.abort();const t=setup({signal:signal.signal,scan:async()=>{assert.fail('must not launch');}});
 assert.equal((await runWorker(t.config,t.deps)).status,'failed');
});
test('real subprocess with malformed output cannot become accepted work',async()=>{
 await assert.rejects(executeCase(process.execPath,vectors[0],1000,new AbortController().signal));
});
test('real hanging subprocess is killed by both timeout and abort',async()=>{
 const v={...vectors[0],id:fileURLToPath(new URL('./fixtures/hanging-child.mjs',import.meta.url))};
 await assert.rejects(executeCase(process.execPath,v,50,new AbortController().signal));
 const c=new AbortController(),pending=executeCase(process.execPath,v,10000,c.signal);
 setTimeout(()=>c.abort(),30);await assert.rejects(pending);
});
test('manifest digest, changed binary and omitted required file fail closed',()=>{
 const dir=mkdtempSync(join(tmpdir(),'bithash-package-test-'));mkdirSync(join(dir,'lib'));
 const files={};for(const name of bundleFiles){writeFileSync(join(dir,name),name);files[name]=sha(name);}
 const bytes=JSON.stringify({schema:'bithash.supervised-worker-package.v1',files});writeFileSync(join(dir,'manifest.json'),bytes);
 const build='sha256:'+sha(bytes);verifyBundle(dir,build);
 assert.throws(()=>verifyBundle(dir,'sha256:'+'0'.repeat(64)),/build_mismatch/);
 writeFileSync(join(dir,'bithash-benchmark'),'changed');assert.throws(()=>verifyBundle(dir,build),/package_mismatch/);
 delete files['bithash-benchmark'];const missing=JSON.stringify({schema:'bithash.supervised-worker-package.v1',files});
 writeFileSync(join(dir,'manifest.json'),missing);assert.throws(()=>verifyBundle(dir,'sha256:'+sha(missing)),/manifest_schema/);
});
test('exclusive start marker rejects a second process and restart of the same lease',()=>{
 const dir=mkdtempSync(join(tmpdir(),'bithash-lease-test-')),lease='c'.repeat(32);
 assert.equal(claimLease(dir,lease),join(dir,lease));assert.throws(()=>claimLease(dir,lease),{code:'EEXIST'});
 assert.throws(()=>claimLease(dir,'../escape'),/invalid_lease/);
});
test('config disallows unlimited runtime, funded target fields and insecure collector origins',()=>{
 const c={origin:'https://collector.example.invalid',caFile:resolve('fixture-ca'),keyFile:resolve('fixture-key'),
  lease:'a'.repeat(32),expiresAt:2000,build:'sha256:'+'b'.repeat(64),gpu:'a5000',durationSeconds:60,stateDir:resolve('fixture-state')};
 validateConfig(c,1000);
 for(const patch of [{durationSeconds:901},{durationSeconds:0},{expiresAt:999},{target:'puzzle-71'},
   {origin:'http://collector.example.invalid'},{origin:'https://user:secret@example.invalid'},{gpu:'unknown'}])
  assert.throws(()=>validateConfig({...c,...patch},1000));
});

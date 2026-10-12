import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
const bytes=p=>readFileSync(new URL(p,root));
const json=p=>JSON.parse(bytes(p).toString('utf8').replace(/^\uFEFF/,''));
const hash=b=>createHash('sha256').update(b).digest('hex');
assert.equal(hash(bytes('experiments/artifacts/bithash-comparison-package.tar.gz')),'dfe1255f3809c20bac939b91656f45d719bde0d982a7ef6cb7ffbbd071c96e17');
const manifestBytes=bytes('experiments/artifacts/bithash-comparison-package-manifest.json');
const manifest=JSON.parse(manifestBytes);
const vectorBytes=bytes('gpu/comparison/vectors.json');
const vectors=JSON.parse(vectorBytes).profiles;
const models={a5000:'NVIDIA RTX A5000','3090':'NVIDIA GeForce RTX 3090','4090':'NVIDIA GeForce RTX 4090','5090':'NVIDIA GeForce RTX 5090'};
const rows=[];const missing=[];
for(const [id,model] of Object.entries(models)){
  const file=`experiments/results/2026-10-12-comparison/${id}-report.json`;
  if(!existsSync(new URL(file,root))){missing.push(id);continue;}
  const report=json(file);
  assert.equal(report.schema,'bithash.gpu-comparison.v1');assert.equal(report.status,'passed');
  assert.equal(report.binarySha256,manifest.files['bithash-benchmark']);
  assert.equal(report.packageManifestSha256,hash(manifestBytes));assert.equal(report.vectorsSha256,hash(vectorBytes));
  assert.equal(report.hardware.model,model);assert.equal(report.puzzle71Candidates,'0');assert.equal(report.cases.length,12);
  const seen=new Set();
  for(const entry of report.cases){
    const key=`${entry.mode}/${entry.profile}/${entry.repeat}`;assert(!seen.has(key));seen.add(key);
    const v=vectors.find(v=>v.id===entry.profile&&v.mode===entry.mode);assert(v);
    assert.equal(entry.status,'passed');assert(entry.mode==='validate'?entry.repeat===0:[1,2,3].includes(entry.repeat));
    const r=entry.result;assert.equal(r.profile,entry.profile);assert.equal(r.mode,entry.mode);
    assert.equal(r.start,v.start);assert.equal(r.end,v.end);assert.equal(r.attempted,v.count);
    assert.equal(BigInt(r.end)-BigInt(r.start),BigInt(r.attempted));
    assert.equal(r.matches,v.targets.filter(t=>t.expectedMatch).length);assert.equal(r.expectedMatches,r.matches);assert.equal(r.correct,true);
    for(const k of ['scanSeconds','initializationSeconds','candidatesPerSecond'])assert(Number.isFinite(r[k])&&r[k]>0);
    assert(Math.abs(Number(r.attempted)/r.scanSeconds/r.candidatesPerSecond-1)<1e-6);
  }
  assert(report.telemetrySamples.length>0);
  const provider=json(`experiments/results/2026-10-12-comparison/${id}-provider.json`);
  assert(provider.hourlyComputeUsd>0&&provider.hourlyStorageUsd>=0);assert.equal(provider.status,'deleted');
  assert.equal(provider.gpu,id);
  assert(Date.parse(provider.stoppedAt)>Date.parse(provider.createdAt));
  assert(Date.parse(provider.deletedAt)>=Date.parse(provider.stoppedAt));
  assert(Date.parse(provider.deletedAt)-Date.parse(provider.createdAt)<=30*60*1000);
  const hourly=provider.hourlyComputeUsd+provider.hourlyStorageUsd;
  const profiles=['small','medium','large'].map(profile=>{
    const runs=report.cases.filter(c=>c.mode==='benchmark'&&c.profile===profile).map(c=>c.result);
    assert.equal(runs.length,3);
    const rates=runs.map(r=>r.candidatesPerSecond).sort((a,b)=>a-b);
    const withInit=runs.map(r=>Number(r.attempted)/(r.scanSeconds+r.initializationSeconds)).sort((a,b)=>a-b);
    return {profile,minCandidatesPerSecond:rates[0],medianCandidatesPerSecond:rates[1],maxCandidatesPerSecond:rates[2],medianIncludingInit:withInit[1],trillionCandidatesPerDollar:rates[1]*3600/hourly/1e12};
  }).sort((a,b)=>b.trillionCandidatesPerDollar-a.trillionCandidatesPerDollar);
  const totalAttempts=report.cases.reduce((a,c)=>a+BigInt(c.result.attempted),0n);
  const estimatedRentalUsd=(Date.parse(provider.stoppedAt)-Date.parse(provider.createdAt))/3600000*hourly;
  assert(estimatedRentalUsd>0);
  rows.push({gpu:id,reportSha256:hash(bytes(file)),hourlyUsd:hourly,best:profiles[0],profiles,wallSeconds:report.wallSeconds,estimatedRentalUsd,experimentTrillionAttemptsPerDollar:Number(totalAttempts)/estimatedRentalUsd/1e12});
}
rows.sort((a,b)=>b.best.trillionCandidatesPerDollar-a.best.trillionCandidatesPerDollar);
assert(rows.reduce((total,row)=>total+row.estimatedRentalUsd,0)<=2);
console.log(JSON.stringify({status:missing.length?'partial':'complete',missing,ranking:rows,limitations:'Host-reported controlled workload, repeated overlapping ranges, sampled correctness; not remote attestation or actual puzzle71 coverage. Scan-only projection and measured short-run overhead are distinct. Prices and availability can change.'},null,2));

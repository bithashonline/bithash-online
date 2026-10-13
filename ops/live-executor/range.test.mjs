import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {generateKeyPairSync,sign} from 'node:crypto';
import {Executor,hash} from './executor.mjs';
import {LOWER,PROBE_KEY,signRangeReceipt} from '../../local/own-range-protocol.js';
function setup(t){let now=1900000000000,posts=0;const dir=mkdtempSync(join(tmpdir(),'range-executor-'));
 const recovery=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
 const range={jobId:'range-'+'1'.repeat(24),start:String(LOWER),end:String(LOWER+8n),solverSha256:'a'.repeat(64),archiveSha256:'b'.repeat(64),build:'sha256:'+'c'.repeat(64),image:'runpod/base@sha256:'+'d'.repeat(64),bootstrap:'range bootstrap',recoveryPublicKey:recovery.publicKey,origin:'https://telemetry.bithash.online',chunkSize:'4'};
 const config={image:'runpod/base@sha256:'+'e'.repeat(64),build:'sha256:'+'f'.repeat(64),bootstrap:'benchmark bootstrap',archiveSha256:'0'.repeat(64),ca:'public-cert',collectorOrigin:'https://collector.example',range};
 const lease=[];const provider={catalog:async()=>({stale:false,record:{rows:[{gpu:'rtx-4090',availability:'HIGH',hourlyPerGpuMicrousd:'500000'}]},sha256:'1'.repeat(64)}),inventory:async()=>[],create:async q=>{posts++;return {...q,id:'abcdefghijklm',status:'PROVISIONING'};}};
 const deps={provider,config,clock:()=>now,telemetry:{enroll:async()=>{}},guard:{ready:async()=>{},register:async p=>{lease.push({...p,phase:'registered'})},status:async()=>lease,stop:async()=>{}}};
 let x=new Executor(join(dir,'state.sqlite'),deps);t.after(()=>{x.close();rmSync(dir,{recursive:true,force:true})});
 return {get x(){return x},provider,config,range,get posts(){return posts},advance:n=>now+=n,restart:()=>{x.close();x=new Executor(join(dir,'state.sqlite'),deps);}};
}
const propose=f=>f.x.proposeRange({gpu:'rtx-4090',durationSeconds:300,capMicrousd:'300000',jobId:f.range.jobId});
test('AI planning binds its saved ticket and model choice to the same range without approving or renting',async t=>{
 const f=setup(t);f.provider.catalog=async()=>{const record={observedAt:new Date(f.x.clock()).toISOString(),filters:{count:1,cloud:'SECURE',minCudaVersion:'12.8'},rows:[{gpu:'rtx-4090',availability:'HIGH',hourlyPerGpuMicrousd:'500000'}]};return {record,sha256:hash(record),stale:false};};
 const ticket=await f.x.planningRangeQuote({jobId:f.range.jobId,limits:{maxDurationSeconds:300,capMicrousd:'300000'}});
 assert.equal(ticket.options.length,1);assert.equal(ticket.options[0].input.jobId,f.range.jobId);
 const choice={schema:'bithash.live-choice.v1',model:'gpt-6.1-sol',responseId:'resp_range_fixture',generatedAt:new Date(f.x.clock()).toISOString(),optionId:ticket.options[0].id,reason:'Smallest exact range acceptance.'};
 const p=await f.x.proposeAi({ticketId:ticket.id,choice});assert.equal(p.terms.workload,'fixed-public-puzzle-range');assert.equal(p.terms.rangeMission.jobId,f.range.jobId);assert.equal(p.terms.planner.choice.responseId,choice.responseId);
 assert.equal((await f.x.proposeAi({ticketId:ticket.id,choice})).id,p.id);await f.x.tick();assert.equal(f.posts,0);assert.equal(p.state,'proposed');
});
async function start(f){const p=await propose(f);f.x.approve(p.id,p.digest);await f.x.tick();const r=f.x.row(p.id),key=generateKeyPairSync('ed25519',{publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
 const enrollment={id:r.id,podId:r.pod,publicKey:key.publicKey};const cfg=await f.x.enroll(enrollment,r.token);return {p,r,key,cfg,enrollment};}
function archive(f,run){const spans=[[PROBE_KEY,PROBE_KEY+1n],[PROBE_KEY-1n,PROBE_KEY],[LOWER,PROBE_KEY+1n]];
 return {schema:'bithash.worker-archive.v1',id:run.r.id,podId:run.r.pod,lease:run.r.lease,build:run.p.terms.build,result:{schema:'bithash.owned-range-result.v1',status:'completed',jobId:f.range.jobId,solverSha256:f.range.solverSha256,hardwareChecked:true,uniqueCoverageVerified:false,
  qualification:{schema:'bithash.range-gpu-qualification.v1',solverSha256:f.range.solverSha256,evidence:'synthetic test fixture; no GPU executed',results:spans.map(([start,end],i)=>({schema:'bithash.native-range.v1',targetId:'range-probe-71',start:String(start),end:String(end),attempted:String(end-start),status:'completed',matched:i!==1,elapsedNanoseconds:'1'}))}}};}
test('range proposal binds exact mission, recipient and artifacts; approval precedes create',async t=>{
 const f=setup(t),p=await propose(f);assert.equal(p.terms.workload,'fixed-public-puzzle-range');assert.equal(p.terms.puzzle71Candidates,'8');assert.equal(p.terms.image,f.range.image);assert.equal(p.terms.build,f.range.build);
 await f.x.tick();assert.equal(f.posts,0);assert.equal(f.x.ranges.summary().puzzle71CheckpointedCandidates,'0');
 f.x.approve(p.id,p.digest);f.range.bootstrap='changed';await f.x.tick();assert.equal(f.posts,0);assert.equal(f.x.view(p.id).state,'rejected');
});
test('enrollment retry and service restart preserve the same scoped capability and epoch without exposing secrets',async t=>{
 const f=setup(t),s=await start(f);const again=await f.x.enroll(s.enrollment,s.r.token);assert.deepEqual(again.range,s.cfg.range);assert.equal(s.cfg.range.epoch,1);assert.equal(f.posts,1);
 const publicView=JSON.stringify(f.x.snapshot());assert(!publicView.includes(s.cfg.range.capability));assert(!publicView.includes(s.r.token));
 f.restart();const resumed=await f.x.enroll(s.enrollment,s.r.token);assert.deepEqual(resumed.range,s.cfg.range);assert.equal(f.x.ranges.summary().puzzle71CheckpointedCandidates,'0');
});
test('only ledger-completed chunks and three correct qualification cases permit a passed range archive/completion',async t=>{
 const f=setup(t),s=await start(f),ledger=f.x.ranges.ledger,c=s.cfg.range;
 const completion={schema:'bithash.executor-completion.v1',id:s.r.id,podId:s.r.pod,lease:s.r.lease,status:'passed'};
 const signedCompletion={payload:completion,signature:sign(null,Buffer.from('bithash.executor-completion.v1\n'+JSON.stringify(completion)),s.key.privateKey).toString('base64')};
 assert.throws(()=>f.x.complete(signedCompletion,s.r.token),/range_archive_required/);
 const value=archive(f,s),envelope=v=>{const payload=JSON.stringify(v);return {payload,signature:sign(null,Buffer.from('bithash.worker-archive.v1\n'+payload),s.key.privateKey).toString('base64')}};
 assert.throws(()=>f.x.archive(envelope(value),s.r.token),/invalid_range_archive/);
 for(let n=0;n<2;n++){const request=ledger.next(c.jobId,c.epoch,c.capability,c.chunkSize,f.x.clock());
  const result={schema:'bithash.native-range.v1',targetId:request.targetId,start:request.start,end:request.end,attempted:'4',status:'completed',matched:false,elapsedNanoseconds:'1'};
  const receipt=signRangeReceipt({schema:'bithash.own-range-receipt.v1',request,backend:'bitcrack-cuda-exact-range',result,sealedCandidate:null},s.key.privateKey);
  ledger.accept(c.jobId,c.epoch,c.capability,receipt,f.x.clock());ledger.accept(c.jobId,c.epoch,c.capability,receipt,f.x.clock());}
 assert.equal(ledger.row(c.jobId).next,f.range.end);assert.equal(f.x.ranges.summary().puzzle71CheckpointedCandidates,'8');
 const invalid=structuredClone(value);invalid.result.qualification.results[1].matched=true;assert.throws(()=>f.x.archive(envelope(invalid),s.r.token));
 const accepted=f.x.archive(envelope(value),s.r.token);assert.equal(accepted.accepted,true);assert.equal(f.x.complete(signedCompletion,s.r.token).accepted,true);
 assert.equal(f.x.view(s.r.id).proofs.find(e=>e.kind==='worker_logs_archived').data.puzzle71Candidates,'8');
 await assert.rejects(()=>propose(f),/range_job_unavailable/);
});
test('range mission cannot substitute job, recovery key or solver, and expired work is fenced',async t=>{
 const f=setup(t);await assert.rejects(()=>f.x.proposeRange({gpu:'rtx-4090',durationSeconds:300,capMicrousd:'300000',jobId:'range-'+'9'.repeat(24)}));
 const s=await start(f);const altered={...s.p.terms,rangeMission:{...s.p.terms.rangeMission,end:String(LOWER+9n)}};assert.throws(()=>f.x.ranges.artifacts(altered));
 f.advance(210000);assert.throws(()=>f.x.ranges.ledger.next(s.cfg.range.jobId,s.cfg.range.epoch,s.cfg.range.capability,'4',f.x.clock()),/lease_expired/);
 assert.equal(f.x.ranges.summary().puzzle71CheckpointedCandidates,'0');
});

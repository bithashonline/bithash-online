import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {generateKeyPairSync,sign} from 'node:crypto';
import {Executor,hash} from './executor.mjs';import {LOWER,PROBE_KEY,signRangeReceipt} from '../../local/own-range-protocol.js';
function setup(t){let now=1900000000000,posts=0,inventory=[];const dir=mkdtempSync(join(tmpdir(),'fleet-executor-'));
 const recovery=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'}});
 const range={jobId:'range-'+'1'.repeat(24),start:String(LOWER),end:String(LOWER+8n),solverSha256:'a'.repeat(64),archiveSha256:'b'.repeat(64),build:'sha256:'+'c'.repeat(64),image:'runpod/base@sha256:'+'d'.repeat(64),bootstrap:'fixture range bootstrap',recoveryPublicKey:recovery.publicKey,origin:'https://telemetry.bithash.online',chunkSize:'4'};
 const config={image:'runpod/base@sha256:'+'e'.repeat(64),build:'sha256:'+'f'.repeat(64),bootstrap:'fixture benchmark bootstrap',archiveSha256:'0'.repeat(64),ca:'public-test-cert',collectorOrigin:'https://collector.example',range};
 const leases=[],stops=[];const provider={catalog:async()=>{const record={schema:'bithash.runpod-catalog.v1',observedAt:new Date(now).toISOString(),filters:{count:1,cloud:'SECURE',minCudaVersion:'12.8'},rows:[{gpu:'rtx-a5000',availability:'NONE',hourlyPerGpuMicrousd:'270000'},{gpu:'rtx-4090',availability:'HIGH',hourlyPerGpuMicrousd:'500000'},{gpu:'rtx-5090',availability:'HIGH',hourlyPerGpuMicrousd:'900000'}]};return {record,sha256:hash(record),stale:false};},inventory:async()=>inventory,create:async request=>{posts++;const p={...request,id:'pod'+String(posts).padStart(10,'0'),status:'PROVISIONING'};inventory.push(p);return p;}};
 const guard={ready:async(allowed=[])=>{if(leases.some(l=>l.phase!=='absence_observed'&&!allowed.includes(l.podId)))throw Error('shutdown_has_unresolved_pods');},register:async p=>{if(!leases.some(l=>l.podId===p.podId))leases.push({...p,phase:'registered'});},status:async()=>leases,stop:async id=>{stops.push(id);}};
 const deps={provider,guard,telemetry:{enroll:async()=>{}},config,clock:()=>now};let x=new Executor(join(dir,'state.sqlite'),deps);t.after(()=>{x.close();rmSync(dir,{recursive:true,force:true});});
 return {get x(){return x},provider,guard,config,range,leases,stops,get posts(){return posts},get inventory(){return inventory},set inventory(v){inventory=v},advance:n=>now+=n,absent:()=>{for(const l of leases)l.phase='absence_observed';inventory=[];},restart:()=>{x.close();x=new Executor(join(dir,'state.sqlite'),deps);}};
}
const input={gpu:'rtx-4090',count:2,durationSeconds:300,capMicrousd:'300001'};
const draft=f=>f.x.fleets.propose({...input});
async function start(f){const p=await draft(f);f.x.fleets.approve(p.id,p.digest);await f.x.tick();await f.x.tick();await f.x.tick();return f.x.fleets.view(p.id);}
async function worker(f,id){const r=f.x.row(id),pair=generateKeyPairSync('ed25519',{publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}}),body={id:r.id,podId:r.pod,publicKey:pair.publicKey};return {r,pair,body,cfg:await f.x.enroll(body,r.token)};}
function complete(f,w){const c=w.cfg.range,ledger=f.x.ranges.ledger;
 let final;for(let n=0;n<2;n++){const request=ledger.next(c.jobId,c.epoch,c.capability,c.chunkSize,f.x.clock());if(!request)break;
  const result={schema:'bithash.native-range.v1',targetId:request.targetId,start:request.start,end:request.end,attempted:String(BigInt(request.end)-BigInt(request.start)),status:'completed',matched:false,elapsedNanoseconds:'1'};
  const envelope=signRangeReceipt({schema:'bithash.own-range-receipt.v1',request,backend:'bitcrack-cuda-exact-range',result,sealedCandidate:null},w.pair.privateKey);final={envelope,ack:ledger.accept(c.jobId,c.epoch,c.capability,envelope,f.x.clock())};}
 const spans=[[PROBE_KEY,PROBE_KEY+1n],[PROBE_KEY-1n,PROBE_KEY],[LOWER,PROBE_KEY+1n]];
 const result={schema:'bithash.owned-range-result.v1',status:'completed',jobId:c.jobId,solverSha256:c.solverSha256,hardwareChecked:true,uniqueCoverageVerified:false,qualification:{schema:'bithash.range-gpu-qualification.v1',solverSha256:c.solverSha256,evidence:'signed test fixtures; no physical GPU executed',results:spans.map(([s,e],i)=>({schema:'bithash.native-range.v1',targetId:'range-probe-71',start:String(s),end:String(e),attempted:String(e-s),status:'completed',matched:i!==1,elapsedNanoseconds:'1'}))}};
 const payload=JSON.stringify({schema:'bithash.worker-archive.v1',id:w.r.id,podId:w.r.pod,lease:w.r.lease,build:w.cfg.build,result});f.x.archive({payload,signature:sign(null,Buffer.from('bithash.worker-archive.v1\n'+payload),w.pair.privateKey).toString('base64')},w.r.token);
 const value={schema:'bithash.executor-completion.v1',id:w.r.id,podId:w.r.pod,lease:w.r.lease,status:'passed'};f.x.complete({payload:value,signature:sign(null,Buffer.from('bithash.executor-completion.v1\n'+JSON.stringify(value)),w.pair.privateKey).toString('base64')},w.r.token);return final;
}
test('one exact fleet approval binds two disjoint jobs, equal budget slices and a common deadline',async t=>{
 const f=setup(t),p=await draft(f);assert.equal(p.state,'proposed');assert.equal(p.terms.count,2);assert.equal(p.terms.perPodCapMicrousd,'150000');assert.equal(p.terms.members.length,2);
 const [a,b]=p.terms.members.map(m=>m.terms.rangeMission);assert.notEqual(a.jobId,b.jobId);assert.equal(a.end,b.start);
 assert(BigInt(p.terms.members[0].terms.capMicrousd)*2n<=BigInt(p.terms.capMicrousd));assert.equal(f.posts,0);await f.x.tick();assert.equal(f.posts,0);
 assert.throws(()=>f.x.approve(p.members[0].id,p.terms.members[0].digest),/fleet_approval_required/);assert.throws(()=>f.x.fleets.approve(p.id,'f'.repeat(64)),/digest_mismatch/);
 f.x.fleets.approve(p.id,p.digest);await f.x.tick();await f.x.tick();assert.equal(f.posts,2);const rows=f.x.fleets.runs(p.id);assert.equal(rows[0].started,rows[1].started);assert.equal(rows[0].deadline,rows[1].deadline);assert.equal(f.leases.length,2);assert.equal(new Set(f.inventory.map(p=>p.env.BITHASH_BOOTSTRAP_TOKEN)).size,2);
});
test('both separately signed workers checkpoint once and archive independently; the fleet closes only after both deletions',async t=>{
 const f=setup(t),p=await start(f),a=await worker(f,p.members[0].id),b=await worker(f,p.members[1].id);const receipt=complete(f,a);complete(f,b);
 f.x.ranges.ledger.accept(a.cfg.range.jobId,a.cfg.range.epoch,a.cfg.range.capability,receipt.envelope,f.x.clock());assert.equal(f.x.ranges.summary().puzzle71CheckpointedCandidates,'16');
 const snapshot=JSON.stringify(f.x.snapshot());assert(!snapshot.includes(a.r.token));assert(!snapshot.includes(a.cfg.range.capability));assert(!snapshot.includes(b.cfg.range.capability));
 await f.x.tick();assert.equal(new Set(f.stops).size,2);f.absent();await f.x.tick();await f.x.tick();assert.equal(f.x.fleets.view(p.id).state,'completed');assert.equal(f.x.fleets.view(p.id).billingFinalized,false);
 f.restart();assert.equal(f.x.fleets.view(p.id).state,'completed');assert.equal(f.x.ranges.summary().puzzle71CheckpointedCandidates,'16');
});
test('a repeated unapproved fleet draft reuses the same proposal, jobs and child records',async t=>{
 const f=setup(t),p=await draft(f);assert.equal((await draft(f)).id,p.id);f.restart();assert.equal((await draft(f)).id,p.id);assert.equal(f.x.db.prepare('SELECT count(*) n FROM own_range_jobs').get().n,2);assert.equal(f.x.db.prepare('SELECT count(*) n FROM live_runs').get().n,2);assert.equal(f.posts,0);
 await assert.rejects(()=>f.x.proposeRange({gpu:'rtx-4090',durationSeconds:300,capMicrousd:'300000'}),/fleet_in_progress/);
});
test('a rejected second create stops the first Pod without retrying or issuing a replacement',async t=>{
 const f=setup(t),create=f.provider.create;f.provider.create=async q=>{if(f.posts===1)throw Error('provider_http_402');return create(q);};
 const p=await draft(f);f.x.fleets.approve(p.id,p.digest);await f.x.tick();await f.x.tick();await f.x.tick();assert.equal(f.posts,1);assert(f.stops.includes(f.inventory[0].id));
 f.absent();await f.x.tick();await f.x.tick();assert.equal(f.x.fleets.view(p.id).state,'failed');assert.equal(f.posts,1);
});
test('an ambiguous empty create remains reserved across restart and is never POSTed again',async t=>{
 const f=setup(t);let calls=0;f.provider.create=async()=>{calls++;throw Error('provider_outcome_unknown');};
 const p=await draft(f);f.x.fleets.approve(p.id,p.digest);await f.x.tick();assert.equal(f.x.fleets.view(p.id).state,'unresolved');f.restart();f.advance(600000);await f.x.tick();await f.x.tick();assert.equal(calls,1);assert.equal(f.x.fleets.view(p.id).state,'unresolved');assert(f.x.fleets.view(p.id).requiresAttention);await assert.rejects(()=>draft(f),/fleet_in_progress/);
});
test('a lost create response with a later exact inventory match is adopted for cleanup, without starting the sibling',async t=>{
 const f=setup(t),create=f.provider.create;f.provider.create=async q=>{await create(q);throw Error('provider_outcome_unknown');};
 const p=await draft(f);f.x.fleets.approve(p.id,p.digest);await f.x.tick();f.restart();await f.x.tick();assert.equal(f.posts,1);assert.equal(f.leases.length,1);assert(f.stops.includes(f.inventory[0].id));f.absent();await f.x.tick();await f.x.tick();assert.equal(f.x.fleets.view(p.id).state,'failed');
});
test('unrelated account Pods block creation and are never stopped or adopted',async t=>{
 const f=setup(t);f.inventory=[{id:'unrelated0001',name:'personal-project'}];const p=await draft(f);f.x.fleets.approve(p.id,p.digest);await f.x.tick();await f.x.tick();assert.equal(f.posts,0);assert.deepEqual(f.stops,[]);assert.equal(f.x.fleets.view(p.id).state,'failed');
});
test('changed member terms or resume checkpoints invalidate the whole fleet approval before any rental',async t=>{
 const f=setup(t),p=await draft(f),r=f.x.row(p.members[0].id),terms=JSON.parse(r.terms);terms.capMicrousd='999999';f.x.db.prepare('UPDATE live_runs SET terms=? WHERE id=?').run(JSON.stringify(terms),r.id);assert.throws(()=>f.x.fleets.approve(p.id,p.digest),/fleet_member_binding_changed/);assert.equal(f.posts,0);
 f.x.db.prepare('UPDATE live_runs SET terms=? WHERE id=?').run(JSON.stringify(p.terms.members[0].terms),r.id);f.x.db.prepare('UPDATE own_range_jobs SET next=? WHERE id=?').run(String(LOWER+4n),terms.rangeMission.jobId);assert.throws(()=>f.x.fleets.approve(p.id,p.digest),/range_checkpoint_changed/);assert.equal(f.posts,0);
});
test('owner cancellation before creation and during asynchronous preflight cannot start another machine',async t=>{
 const f=setup(t),p=await draft(f);f.x.fleets.approve(p.id,p.digest);const catalog=f.provider.catalog;f.provider.catalog=async()=>{const q=await catalog();f.x.fleets.cancel(p.id,p.digest);return q;};await f.x.tick();assert.equal(f.posts,0);assert.equal(f.x.fleets.view(p.id).state,'cancelled');
});
test('fleet AI quote and lost submission recovery bind one choice and exactly two immutable assignments',async t=>{
 const f=setup(t),ticket=await f.x.fleets.quote({count:2,limits:{maxDurationSeconds:300,capMicrousd:'300000'}});assert.equal(ticket.options.length,1);assert.equal(ticket.options[0].input.count,2);assert.equal(ticket.options[0].input.gpu,'rtx-4090');
 const choice={schema:'bithash.live-choice.v1',model:'gpt-6.1-sol',responseId:'resp_fleet_fixture',generatedAt:new Date(f.x.clock()).toISOString(),optionId:ticket.options[0].id,reason:'Only supplied two-Pod option.'};
 const [a,b]=await Promise.all([f.x.proposeAi({ticketId:ticket.id,choice}),f.x.proposeAi({ticketId:ticket.id,choice})]);assert.equal(a.id,b.id);f.restart();assert.equal((await f.x.proposeAi({ticketId:ticket.id,choice})).id,a.id);assert.equal(f.x.snapshot().fleets.length,1);assert.equal(f.posts,0);
});
test('excess count, inadequate total cap and expired fleet terms never rent',async t=>{
 const f=setup(t);await assert.rejects(()=>f.x.fleets.propose({...input,count:3}),/invalid_fleet_terms/);await assert.rejects(()=>f.x.fleets.propose({...input,capMicrousd:'20000'}),/cap_too_small/);
 const p=await draft(f);f.advance(600001);assert.throws(()=>f.x.fleets.approve(p.id,p.digest),/proposal_expired/);await f.x.tick();assert.equal(f.x.fleets.view(p.id).state,'expired');assert.equal(f.posts,0);
});

test('a second-Pod price change drains the first and never allocates another budget slice',async t=>{
 const f=setup(t),p=await draft(f);f.x.fleets.approve(p.id,p.digest);await f.x.tick();const catalog=f.provider.catalog;f.provider.catalog=async()=>{const q=await catalog();q.record.rows.find(r=>r.gpu==='rtx-4090').hourlyPerGpuMicrousd='999999';q.sha256=hash(q.record);return q;};await f.x.tick();await f.x.tick();assert.equal(f.posts,1);assert(f.stops.includes(f.inventory[0].id));f.absent();await f.x.tick();await f.x.tick();assert.equal(f.x.fleets.view(p.id).state,'failed');
});
test('worker signing identities cannot submit a sibling range receipt',async t=>{
 const f=setup(t),p=await start(f),a=await worker(f,p.members[0].id),b=await worker(f,p.members[1].id),c=b.cfg.range,ledger=f.x.ranges.ledger,request=ledger.next(c.jobId,c.epoch,c.capability,c.chunkSize,f.x.clock());
 const result={schema:'bithash.native-range.v1',targetId:request.targetId,start:request.start,end:request.end,attempted:'4',status:'completed',matched:false,elapsedNanoseconds:'1'},envelope=signRangeReceipt({schema:'bithash.own-range-receipt.v1',request,backend:'bitcrack-cuda-exact-range',result,sealedCandidate:null},a.pair.privateKey);
 assert.throws(()=>ledger.accept(c.jobId,c.epoch,c.capability,envelope,f.x.clock()));assert.equal(f.x.ranges.summary().puzzle71CheckpointedCandidates,'0');f.advance(210001);await f.x.tick();assert.equal(new Set(f.stops).size,2);assert.equal(f.posts,2);
});

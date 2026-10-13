import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {generateKeyPairSync,sign} from 'node:crypto';
import {Executor,hash} from './executor.mjs';import {RunpodExecutorApi} from './provider.mjs';
function setup(t){let now=1900000000000,posts=0,inventory=[],stop=[],leases=[],enrolled=[],fail=false;const dir=mkdtempSync(join(tmpdir(),'executor-'));
 const provider={catalog:async()=>({stale:false,sha256:'a'.repeat(64),record:{observedAt:new Date(now).toISOString(),rows:[{gpu:'rtx-4090',availability:'HIGH',hourlyPerGpuMicrousd:'500000'}]}}),inventory:async()=>inventory,create:async request=>{posts++;const p={...request,id:'abcdefghijklm',status:'PROVISIONING',cost:0.5};inventory=[p];if(fail)throw Error('timeout');return p;}};
 const guard={ready:async()=>{},register:async p=>{if(!leases.some(x=>x.podId===p.podId))leases.push({...p,phase:'registered'});},status:async()=>leases,stop:async id=>stop.push(id)};
 const config={image:'runpod/base@sha256:'+'b'.repeat(64),bootstrap:'print(1)',build:'sha256:'+'c'.repeat(64),archiveSha256:'d'.repeat(64),ca:'public-cert',collectorOrigin:'https://collector.example'};
 const deps={provider,guard,telemetry:{enroll:async p=>enrolled.push(p)},config,clock:()=>now};let x=new Executor(join(dir,'state.sqlite'),deps);t.after(()=>{x.close();rmSync(dir,{recursive:true,force:true});});
 return {get x(){return x},provider,guard,config,get posts(){return posts},get inventory(){return inventory},set inventory(v){inventory=v},get enrolled(){return enrolled},stop,leases,advance:n=>now+=n,fail:()=>fail=true,restart:()=>{x.close();x=new Executor(join(dir,'state.sqlite'),deps);}};
}
const draft=f=>f.x.propose({gpu:'rtx-4090',durationSeconds:600,capMicrousd:'100000'});
test('sustained workload is approval-bound and rejects insufficient rental headroom',async t=>{
 const f=setup(t),input={gpu:'rtx-4090',durationSeconds:600,capMicrousd:'100000',sustainSeconds:300};
 await assert.rejects(f.x.propose({...input,durationSeconds:300}),/invalid_sustained_terms/);
 await assert.rejects(f.x.propose({...input,sustainSeconds:301}),/invalid_sustained_terms/);
 const p=await f.x.propose(input);assert.equal(p.terms.sustainSeconds,300);assert.equal(p.terms.workerSeconds,390);
 f.x.approve(p.id,p.digest);await f.x.tick();const r=f.x.row(p.id),pair=generateKeyPairSync('ed25519');
 const cfg=await f.x.enroll({id:p.id,podId:r.pod,publicKey:pair.publicKey.export({format:'pem',type:'spki'})},r.token);
 assert.equal(cfg.sustainSeconds,300);assert.equal(cfg.durationSeconds,390);
});
test('only explicit digest-bound approval creates; completion deletes without simulated funds',async t=>{const f=setup(t),p=await draft(f);await f.x.tick();assert.equal(f.posts,0);assert.throws(()=>f.x.approve(p.id,'0'.repeat(64)));f.x.approve(p.id,p.digest);await f.x.tick();assert.equal(f.posts,1);assert.equal(f.leases.length,1);const pair=generateKeyPairSync('ed25519'),r=f.x.row(p.id);const cfg=await f.x.enroll({id:p.id,podId:r.pod,publicKey:pair.publicKey.export({format:'pem',type:'spki'})},r.token);assert.equal(cfg.build,f.config.build);assert.equal(f.enrolled[0].providerPodId,r.pod);
 const payload={schema:'bithash.executor-completion.v1',id:p.id,podId:r.pod,lease:r.lease,status:'passed'};const signature=sign(null,Buffer.from('bithash.executor-completion.v1\n'+JSON.stringify(payload)),pair.privateKey).toString('base64');f.x.complete({payload,signature},r.token);await f.x.tick();assert.deepEqual(f.stop,[r.pod]);f.leases[0].phase='absence_observed';await f.x.tick();assert.equal(f.x.view(p.id).state,'deleted');assert.equal(f.x.view(p.id).billingFinalized,false);});
test('lost create response reconciles exact token and never duplicates after restart',async t=>{const f=setup(t),p=await draft(f);f.x.approve(p.id,p.digest);f.fail();await f.x.tick();f.restart();await f.x.tick();assert.equal(f.posts,1);assert.equal(f.x.view(p.id).podId,'abcdefghijklm');});
test('empty ambiguous create remains reserved across restart; no re-POST',async t=>{const f=setup(t),p=await draft(f);f.provider.create=async()=>{throw Error('unknown')};f.x.approve(p.id,p.digest);await f.x.tick();assert.equal(f.x.view(p.id).state,'creating');f.restart();await f.x.tick();assert.equal(f.x.view(p.id).state,'creating');const q=await draft(f);assert.throws(()=>f.x.approve(q.id,q.digest),/unresolved/);});
test('same-name foreign pod is never adopted or shut down',async t=>{const f=setup(t),p=await draft(f);f.provider.create=async r=>{f.inventory=[{...r,id:'abcdefghijklm',env:{}}];throw Error('timeout');};f.x.approve(p.id,p.digest);await f.x.tick();assert.equal(f.leases.length,0);assert.equal(f.x.view(p.id).podId,null);});
test('expiry, existing resources, cap, changed artifact and price fail before create',async t=>{const f=setup(t);await assert.rejects(()=>f.x.propose({gpu:'rtx-4090',durationSeconds:900,capMicrousd:'10000'}));let p=await draft(f);f.advance(600001);assert.throws(()=>f.x.approve(p.id,p.digest));await f.x.tick();assert.equal(f.x.view(p.id).state,'expired');p=await draft(f);f.x.approve(p.id,p.digest);f.config.bootstrap='changed';await f.x.tick();assert.equal(f.posts,0);assert.equal(f.x.view(p.id).state,'rejected');p=await draft(f);f.x.approve(p.id,p.digest);f.inventory=[{id:'unrelatedpod'}];await f.x.tick();assert.equal(f.posts,0);});
test('lost registration is retried after restart without a second rental',async t=>{const f=setup(t),p=await draft(f),register=f.guard.register;let fail=true;f.guard.register=async v=>{if(fail)throw Error('offline');return register(v)};f.x.approve(p.id,p.digest);await f.x.tick();assert.equal(f.x.view(p.id).state,'registering');fail=false;f.restart();await f.x.tick();assert.equal(f.posts,1);assert.equal(f.leases.length,1);});
test('enrollment cannot change public key or cross-bind a pod; expired bootstrap rejected',async t=>{const f=setup(t),p=await draft(f);f.x.approve(p.id,p.digest);await f.x.tick();const r=f.x.row(p.id),key=()=>generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'});await assert.rejects(()=>f.x.enroll({id:p.id,podId:'wrongpodid00',publicKey:key()},r.token));await f.x.enroll({id:p.id,podId:r.pod,publicKey:key()},r.token);await assert.rejects(()=>f.x.enroll({id:p.id,podId:r.pod,publicKey:key()},r.token));f.advance(600000);await assert.rejects(()=>f.x.enroll({id:p.id,podId:r.pod,publicKey:key()},r.token));});
test('bootstrap timeout latches targeted shutdown and public proof excludes capability',async t=>{const f=setup(t),p=await draft(f);f.x.approve(p.id,p.digest);await f.x.tick();f.advance(300001);await f.x.tick();assert.equal(f.stop.length,1);const r=f.x.row(p.id),s=JSON.stringify(f.x.snapshot());assert.ok(!s.includes(r.token));assert.ok(f.x.view(p.id).proofs.length>=4);for(const e of f.x.view(p.id).proofs){const proof=f.x.proof(e.digest);assert.equal(hash(JSON.stringify(proof.record)),proof.digest);}});
test('provider inventory follows pagination even when a page is empty; invalid cursor fails',async()=>{const responses=[{pods:[],pagination:{hasNextPage:true,nextCursor:'x'}},{pods:[{id:'abcdefghijklm'}],pagination:{hasNextPage:false}}],paths=[];const api=new RunpodExecutorApi({apiKey:'fixture',fetchImpl:async url=>{paths.push(url);return {ok:true,json:async()=>responses.shift()};}});assert.equal((await api.inventory()).length,1);assert.ok(paths[1].includes('cursor=x'));api.fetchImpl=async()=>({ok:true,json:async()=>({pods:[],pagination:{hasNextPage:true,nextCursor:null}})});await assert.rejects(()=>api.inventory());});
test('duplicate approvals, cancellation and a provider balance rejection cannot produce retries',async t=>{const f=setup(t);let p=await draft(f);f.x.approve(p.id,p.digest);f.x.approve(p.id,p.digest);f.x.cancel(p.id,p.digest);await f.x.tick();assert.equal(f.posts,0);p=await draft(f);f.x.approve(p.id,p.digest);let calls=0;f.provider.create=async()=>{calls++;throw Error('provider_http_402')};await f.x.tick();f.restart();await f.x.tick();assert.equal(calls,1);assert.equal(f.x.view(p.id).state,'rejected');assert.equal(f.x.view(p.id).error,'provider_http_402');});
test('price increase beyond approved ceiling rejects before creation',async t=>{const f=setup(t),p=await draft(f);f.x.approve(p.id,p.digest);const original=f.provider.catalog;f.provider.catalog=async()=>{const q=await original();q.record.rows[0].hourlyPerGpuMicrousd='900000';return q;};await f.x.tick();assert.equal(f.posts,0);assert.equal(f.x.view(p.id).error,'quote_changed_or_unavailable');});
test('unsigned or cross-pod completion cannot stop an enrolled run',async t=>{const f=setup(t),p=await draft(f);f.x.approve(p.id,p.digest);await f.x.tick();const r=f.x.row(p.id),pair=generateKeyPairSync('ed25519');await f.x.enroll({id:p.id,podId:r.pod,publicKey:pair.publicKey.export({type:'spki',format:'pem'})},r.token);const payload={schema:'bithash.executor-completion.v1',id:p.id,podId:r.pod,lease:r.lease,status:'passed'};assert.throws(()=>f.x.complete({payload,signature:'a'.repeat(88)},r.token));assert.equal(f.x.row(p.id).completion,null);await f.x.tick();assert.equal(f.stop.length,0);});

function aiQuote(f,availability='HIGH'){
 f.provider.catalog=async()=>{const record={observedAt:new Date(f.x.clock()).toISOString(),filters:{count:1,cloud:'SECURE',minCudaVersion:'12.8'},rows:[{gpu:'rtx-a5000',availability,hourlyPerGpuMicrousd:'270000'}]};return {record,sha256:hash(record),stale:false};};
}
function liveChoice(f,ticket){return {schema:'bithash.live-choice.v1',optionId:ticket.options[0].id,model:'gpt-6.1-sol',responseId:'resp_fixture',generatedAt:new Date(f.x.clock()).toISOString(),reason:'Small bounded A5000 benchmark.'};}
test('AI draft is unapproved, A5000-preferred, digest-bound, and reconciles duplicate submissions after restart',async t=>{
 const f=setup(t);aiQuote(f);const ticket=await f.x.planningQuote({maxDurationSeconds:600,capMicrousd:'100000'}),choice=liveChoice(f,ticket);
 const p=await f.x.proposeAi({ticketId:ticket.id,choice});await f.x.tick();assert.equal(f.posts,0);assert.equal(p.state,'proposed');assert.equal(p.terms.gpu,'rtx-a5000');assert.equal(p.terms.planner.choiceDigest,hash(choice));
 f.restart();assert.equal((await f.x.proposeAi({ticketId:ticket.id,choice})).id,p.id);assert.equal(f.x.snapshot().runs.length,1);
 await assert.rejects(f.x.proposeAi({ticketId:ticket.id,choice:{...choice,reason:'changed'}}),/conflict/);
 f.x.approve(p.id,p.digest);await f.x.tick();assert.equal(f.posts,1);assert.equal(f.inventory[0].gpu.id,'NVIDIA RTX A5000');
});
test('unavailable, unaffordable, expired and forged AI options never create rentals or fallback proposals',async t=>{
 const f=setup(t);aiQuote(f,'NONE');assert.equal((await f.x.planningQuote({maxDurationSeconds:600,capMicrousd:'100000'})).options.length,0);
 aiQuote(f);assert.equal((await f.x.planningQuote({maxDurationSeconds:900,capMicrousd:'10000'})).options.length,0);
 const ticket=await f.x.planningQuote({maxDurationSeconds:600,capMicrousd:'100000'}),choice=liveChoice(f,ticket);
 await assert.rejects(f.x.proposeAi({ticketId:ticket.id,choice:{...choice,optionId:'option-'+'f'.repeat(16)}}));
 f.advance(180001);await assert.rejects(f.x.proposeAi({ticketId:ticket.id,choice}));assert.equal(f.posts,0);
});
test('concurrent AI submission creates one proposal even across asynchronous catalog reads',async t=>{
 const f=setup(t);aiQuote(f);const ticket=await f.x.planningQuote({maxDurationSeconds:600,capMicrousd:'100000'}),choice=liveChoice(f,ticket);
 const [a,b]=await Promise.all([f.x.proposeAi({ticketId:ticket.id,choice}),f.x.proposeAi({ticketId:ticket.id,choice})]);assert.equal(a.id,b.id);assert.equal(f.x.snapshot().runs.length,1);
});
test('signed full benchmark results persist after restart/deletion; tampering and secrets rejected',async t=>{
 const f=setup(t),p=await draft(f);f.x.approve(p.id,p.digest);await f.x.tick();const r=f.x.row(p.id),pair=generateKeyPairSync('ed25519');await f.x.enroll({id:p.id,podId:r.pod,publicKey:pair.publicKey.export({format:'pem',type:'spki'})},r.token);
 const vectors=JSON.parse(readFileSync(new URL('../../gpu/comparison/vectors.json',import.meta.url))).profiles.filter(v=>v.id==='small');
 const results=vectors.map(v=>({schema:'bithash.gpu-benchmark-case.v1',profile:v.id,mode:v.mode,start:v.start,end:v.end,attempted:v.count,expectedMatches:v.targets.filter(t=>t.expectedMatch).length,matches:v.targets.filter(t=>t.expectedMatch).length,correct:true,initializationSeconds:0.1,scanSeconds:1,candidatesPerSecond:Number(v.count)}));
 const result={schema:'bithash.supervised-worker-result.v1',status:'passed',workload:'fixed-synthetic-known-answer',completedCases:2,candidatesChecked:String(results.reduce((n,v)=>n+BigInt(v.attempted),0n)),puzzle71Candidates:'0',uniqueCoverageVerified:false,deliveryFailed:false,results,build:f.config.build};
 const payload=JSON.stringify({schema:'bithash.worker-archive.v1',id:p.id,podId:r.pod,lease:r.lease,build:f.config.build,result}),signature=sign(null,Buffer.from('bithash.worker-archive.v1\n'+payload),pair.privateKey).toString('base64'),body={payload,signature};
 assert.throws(()=>f.x.archive({...body,payload:payload.replace('passed','failed')},r.token));assert.throws(()=>f.x.archive({...body,payload:payload.replace('"correct":true','"correct":false')},r.token));
 const accepted=f.x.archive(body,r.token);assert.equal(f.x.archive(body,r.token).digest,accepted.digest);f.restart();assert.equal(f.x.archivedLog(accepted.digest).envelope.payload,payload);
 f.x.set(p.id,'deleted');assert.equal(f.x.archivedLog(accepted.digest).digest,accepted.digest);assert.throws(()=>f.x.archive(body,r.token));assert.ok(!JSON.stringify(f.x.archivedLog(accepted.digest)).includes(r.token));
});

test('model hold is retained and cannot be replaced by a racing spending choice',async t=>{
 const f=setup(t);aiQuote(f);const ticket=await f.x.planningQuote({maxDurationSeconds:600,capMicrousd:'100000'}),choice={...liveChoice(f,ticket),optionId:'hold'};
 assert.equal((await f.x.proposeAi({ticketId:ticket.id,choice})).state,'held');f.restart();assert.equal((await f.x.proposeAi({ticketId:ticket.id,choice})).state,'held');assert.equal(f.x.snapshot().latestPlanning.state,'held_by_operator');await assert.rejects(f.x.proposeAi({ticketId:ticket.id,choice:liveChoice(f,ticket)}),/conflict/);assert.equal(f.posts,0);
});

 test('4090 fallback is approval-bound; losing capacity after approval never substitutes hardware',async t=>{
 const f=setup(t);let unavailable=false;
 f.provider.catalog=async()=>{const record={observedAt:new Date(f.x.clock()).toISOString(),filters:{count:1,cloud:'SECURE',minCudaVersion:'12.8'},rows:[{gpu:'rtx-a5000',availability:'NONE',hourlyPerGpuMicrousd:'270000'},{gpu:'rtx-4090',availability:unavailable?'NONE':'HIGH',hourlyPerGpuMicrousd:'500000'},{gpu:'rtx-5090',availability:'HIGH',hourlyPerGpuMicrousd:'900000'}]};return {record,sha256:hash(record),stale:false};};
 const ticket=await f.x.planningQuote({maxDurationSeconds:600,capMicrousd:'300000'}),p=await f.x.proposeAi({ticketId:ticket.id,choice:liveChoice(f,ticket)});
 assert.equal(p.terms.gpu,'rtx-4090');await f.x.tick();assert.equal(f.posts,0);
 f.x.approve(p.id,p.digest);unavailable=true;await f.x.tick();assert.equal(f.posts,0);assert.equal(f.x.view(p.id).state,'rejected');
 });

import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,publicEncrypt} from 'node:crypto';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {Controller} from './controller.js';
import {OwnRangeLedger,ownRangeSummary} from './own-range-ledger.js';
import {RANGE_TARGETS,LOWER,PROBE_KEY,rangeRequest,nativeResult,signRangeReceipt,digest,recoveryPublic} from './own-range-protocol.js';
import {addressFor} from './solver.js';
import {cpuRangeProbe,cudaOwnRange} from './own-range-backend.js';
import {createOwnRangeServer} from './own-range-server.js';
import {rangeClient} from './own-range-client.js';
import {runOwnRangeWorker} from './own-range-runtime.js';
import {approvedRangeMission} from './own-range-approval.js';
import {coverageSummary} from './coverage.js';
import {dashboardSnapshot} from './dashboard-api.js';
const sha='a'.repeat(64),id=n=>'range-'+String(n).padStart(24,'0');
const keys=()=>generateKeyPairSync('ed25519',{publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
function setup(t){const dir=mkdtempSync(join(tmpdir(),'own-range-')),path=join(dir,'state.sqlite');const c=new Controller(path);const l=new OwnRangeLedger(c);
 t.after(()=>{c.close();rmSync(dir,{recursive:true,force:true});});return {dir,path,c,l};}
function enrollment(l,job,key=keys(),now=Date.now(),duration=120000){const r=l.row(job);const approval={state:r.target==='puzzle-71'?'google-owner-approved':'local-validation',
 workload:'fixed-public-puzzle-range',jobId:job,targetId:r.target,start:r.start,end:r.end,solverSha256:r.solver,providerPodId:'local-probe',expiresAt:now+duration,digest:'b'.repeat(64),validationOnly:r.target==='range-probe-71'};
 return {key,approval,options:{publicKey:key.publicKey,providerPodId:'local-probe',expiresAt:now+duration,approval}};}
const receipt=async(request,key,patch={})=>{const scan=await cpuRangeProbe(request);return signRangeReceipt({schema:'bithash.own-range-receipt.v1',request,backend:'node-openssl-range-probe',...scan,...patch},key.privateKey);};
const config=(lease,key,origin,dir)=>({schema:'bithash.own-range-worker-config.v1',backend:'node-openssl-range-probe',origin,capability:lease.capability,
 caFile:null,stateDirectory:join(dir,'worker'),keyFile:join(dir,'key.pem'),jobId:lease.jobId,epoch:lease.epoch,providerPodId:'local-probe',expiresAt:lease.expiresAt,
 chunkSize:'3',solverSha256:sha,binaryPath:null,recoveryPublicKey:null,validationOnly:true});
async function serve(t,l){const s=createOwnRangeServer(l);s.listen(0,'127.0.0.1');await once(s,'listening');t.after(()=>s.close());return {s,origin:'http://127.0.0.1:'+s.address().port};}
async function child(script,cfg){return new Promise((resolve,reject)=>{const p=spawn(process.execPath,[script,cfg],{env:{},stdio:['ignore','pipe','pipe'],windowsHide:true});let out='';
 const timer=setTimeout(()=>{p.kill();reject(Error('child timeout'));},15000);p.stdout.on('data',b=>out+=b.toString());p.stderr.resume();p.on('error',reject);p.on('close',code=>{clearTimeout(timer);resolve({code,out})});});}

test('fixed 71-bit target/probe identity and arbitrary subranges retain BigInt precision',()=>{
 assert.equal(addressFor(PROBE_KEY),RANGE_TARGETS['range-probe-71'].address);
 const q=rangeRequest({schema:'bithash.own-range-request.v1',jobId:id(1),epoch:1,targetId:'range-probe-71',start:String(PROBE_KEY),end:String(PROBE_KEY+1n),solverSha256:sha,providerPodId:'local-probe',expiresAt:1000,recoveryKeyId:null});
 for(const patch of [{start:Number(PROBE_KEY)},{targetId:'arbitrary-wallet'},{end:String((1n<<71n)+1n)},{epoch:0},{solverSha256:'bad'},{secret:'never'}])assert.throws(()=>rangeRequest({...q,...patch}));
 assert.throws(()=>nativeResult(q,{schema:'bithash.native-range.v1',targetId:q.targetId,start:q.start,end:q.end,attempted:'0',status:'completed',matched:false,elapsedNanoseconds:'1'}));
});
test('separate controllers reserve disjoint ranges and own coverage uses actual puzzle jobs only',t=>{
 const {c,l,path}=setup(t);const other=new Controller(path);try{
  const a=l.reserve(id(1),'puzzle-71','10',sha),b=new OwnRangeLedger(other).reserve(id(2),'puzzle-71','10',sha);
  assert.equal(a.start,String(LOWER));assert.equal(b.start,a.end);assert.deepEqual(l.reserve(id(1),'puzzle-71','10',sha),a);
  assert.throws(()=>l.reserve(id(1),'puzzle-71','11',sha));l.reserve(id(3),'range-probe-71','10',sha);
  assert.equal(coverageSummary(c.db,'puzzle-71').ownAllocatedCandidates,'20');assert.equal(coverageSummary(c.db,'puzzle-71').ownCheckpointedCandidates,'0');
  assert.equal(ownRangeSummary(c.db).puzzle71CheckpointedCandidates,'0');assert.equal(dashboardSnapshot(path).ownRanges.items.length,3);
  assert.equal(ownRangeSummary(c.db).items[0].evidence,'reserved-no-completed-work');
 }finally{other.close();}
});
test('only exact assigned signed receipts advance the cursor; replay cannot add credit',async t=>{
 const {l,c}=setup(t);l.reserve(id(1),'range-probe-71','8',sha);const e=enrollment(l,id(1),keys(),1000);const lease=l.lease(id(1),e.options,1000);
 const q=l.next(id(1),lease.epoch,lease.capability,'3',1001);assert.deepEqual(l.next(id(1),lease.epoch,lease.capability,'1',1002),q);
 const signed=await receipt(q,e.key);assert.throws(()=>l.accept(id(1),lease.epoch,lease.capability,{...signed,signature:randomBytes(64).toString('base64')},1002));
 assert.equal(l.row(id(1)).next,q.start);const first=l.accept(id(1),lease.epoch,lease.capability,signed,1003);assert.equal(first.duplicate,false);
 assert.equal(l.accept(id(1),lease.epoch,lease.capability,signed,200000).duplicate,true);
 assert.equal(l.row(id(1)).next,q.end);assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM own_range_receipts').get().n,1);
});
test('expired and replaced leases cannot commit late work; resumed job begins at last accepted cursor',async t=>{
 const {l,path}=setup(t);l.reserve(id(1),'range-probe-71','8',sha);const e=enrollment(l,id(1),keys(),1000,100);const lease=l.lease(id(1),e.options,1000);
 const q=l.next(id(1),lease.epoch,lease.capability,'3',1001),signed=await receipt(q,e.key);
 assert.throws(()=>l.accept(id(1),lease.epoch,lease.capability,signed,1100),/lease_expired/);assert.equal(l.row(id(1)).next,q.start);
 const other=new Controller(path);try{const nextLedger=new OwnRangeLedger(other),e2=enrollment(nextLedger,id(1),keys(),1101,100);
  const newer=nextLedger.lease(id(1),e2.options,1101);assert.equal(newer.epoch,2);assert.throws(()=>l.accept(id(1),lease.epoch,lease.capability,signed,1102),/lease_fenced/);
  assert.equal(nextLedger.next(id(1),newer.epoch,newer.capability,'3',1102).start,q.start);
 }finally{other.close();}
});
test('production enrollment refuses old benchmark approvals and unverified owner flags',t=>{
 const {l}=setup(t);l.reserve(id(1),'puzzle-71','8',sha);const e=enrollment(l,id(1));
 assert.throws(()=>l.lease(id(1),e.options),/range_approval_unverified/);
 assert.throws(()=>l.lease(id(1),{...e.options,approval:{...e.approval,expiresAt:undefined}}),/range_approval_required/);
 assert.throws(()=>l.lease(id(1),{...e.options,approval:{...e.approval,workload:'fixed-synthetic-known-answer'}}),/range_approval_required/);
 assert.throws(()=>approvedRangeMission({schema:'bithash.live-executor.v1',mode:'real-provider',runs:[]},l.row(id(1))),/range_approval_unverified/);
});
test('native failures cannot silently fall back to CPU or accept incomplete work',async t=>{
 const {l}=setup(t);l.reserve(id(1),'range-probe-71','8',sha);const e=enrollment(l,id(1)),lease=l.lease(id(1),e.options),q=l.next(id(1),lease.epoch,lease.capability,'3');
 await assert.rejects(cudaOwnRange(q,{binaryPath:'not-an-absolute-path'}),/cuda_unavailable/);
 await assert.rejects(cpuRangeProbe({...q,targetId:'puzzle-71',recoveryKeyId:'c'.repeat(64)}),/cpu_probe_only/);
 await assert.rejects(cpuRangeProbe(q,{signal:AbortSignal.abort()}),/interrupted/);assert.equal(l.row(id(1)).next,q.start);
});
test('real loopback transport and separate CPU worker process complete a known 71-bit probe without puzzle credit',async t=>{
 const {l,c,dir}=setup(t);l.reserve(id(1),'range-probe-71','9',sha);const e=enrollment(l,id(1)),lease=l.lease(id(1),e.options),{origin}=await serve(t,l);
 const cfg=config(lease,e.key,origin,dir);writeFileSync(cfg.keyFile,e.key.privateKey);const filename=join(dir,'worker.json');writeFileSync(filename,JSON.stringify(cfg));
 const result=await child(new URL('../gpu/range/worker.mjs',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'),filename);
 assert.equal(result.code,0);assert.equal(l.row(id(1)).state,'completed');assert.equal(l.row(id(1)).next,l.row(id(1)).end);
 assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM own_range_receipts').get().n,3);assert.equal(ownRangeSummary(c.db).puzzle71CheckpointedCandidates,'0');
});
test('actual process crash after computation restores pending receipt and dead lock; no chunk scanned twice',async t=>{
 const {l,c,dir}=setup(t);l.reserve(id(1),'range-probe-71','6',sha);const e=enrollment(l,id(1)),lease=l.lease(id(1),e.options),{origin}=await serve(t,l);
 const cfg=config(lease,e.key,origin,dir);writeFileSync(cfg.keyFile,e.key.privateKey);const filename=join(dir,'worker.json');writeFileSync(filename,JSON.stringify(cfg));
 const crash=await child(new URL('./fixtures/own-range-crash.mjs',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'),filename);
 assert.equal(crash.code,77);assert.equal(l.row(id(1)).next,l.row(id(1)).start);assert(existsSync(join(cfg.stateDirectory,'pending-receipt.json')));
 const pending=JSON.parse(readFileSync(join(cfg.stateDirectory,'pending-receipt.json')));
 const next=await child(new URL('../gpu/range/worker.mjs',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'),filename);
 assert.equal(next.code,0);assert.equal(l.row(id(1)).state,'completed');assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM own_range_receipts').get().n,2);
 assert(c.db.prepare('SELECT digest FROM own_range_receipts WHERE digest=?').get(digest(pending.envelope.payload)));
});
test('response loss after commit resends the same signed receipt instead of recomputing',async t=>{
 const {l,c,dir}=setup(t);l.reserve(id(1),'range-probe-71','3',sha);const e=enrollment(l,id(1)),lease=l.lease(id(1),e.options),{origin}=await serve(t,l);
 const cfg=config(lease,e.key,origin,dir),transport=rangeClient(cfg);let fail=true,scans=0;
 const client=async(path,input)=>{const result=await transport(path,input);if(path.endsWith('/receipt')&&fail){fail=false;throw Error('lost response');}return result;};
 const execute=async(...args)=>{scans++;return cpuRangeProbe(...args);};
 await assert.rejects(runOwnRangeWorker(cfg,{client,directory:cfg.stateDirectory,privateKey:e.key.privateKey,execute}));
 const resumed=await runOwnRangeWorker(cfg,{client,directory:cfg.stateDirectory,privateKey:e.key.privateKey,execute});
 assert.equal(resumed.status,'completed');assert.equal(scans,1);assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM own_range_receipts').get().n,1);
});
test('HTTP rejects missing credentials, arbitrary routes and compressed bodies',async t=>{
 const {l}=setup(t);l.reserve(id(1),'range-probe-71','3',sha);const {origin}=await serve(t,l);
 const r=await fetch(origin+'/worker/range/task',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jobId:id(1),epoch:1,chunkSize:'3'})});assert.equal(r.status,409);
 assert.equal((await fetch(origin+'/worker/enroll',{method:'POST'})).status,404);
 assert.equal((await fetch(origin+'/worker/range/task',{method:'POST',headers:{'Content-Type':'application/json','Content-Encoding':'gzip'},body:'{}'})).status,415);
 assert.throws(()=>rangeClient({origin:'http://example.com',capability:'a'.repeat(64),validationOnly:true}));
});

test('private candidate reports pause the target, preserve encrypted evidence and never credit or expose the chunk',t=>{
 const {c,path}=setup(t),l=new OwnRangeLedger(c,{authorizeApproval:()=>true});l.reserve(id(1),'puzzle-71','8',sha);
 const rsa=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
 const recipient=recoveryPublic(rsa.publicKey),e=enrollment(l,id(1));e.options.recoveryPublicKey=rsa.publicKey;e.approval.recoveryKeyId=recipient.keyId;
 const lease=l.lease(id(1),e.options),q=l.next(id(1),lease.epoch,lease.capability,'8');
 // Opaque synthetic ciphertext exercises private storage, not a discovered key.
 const sealed={algorithm:'rsa-oaep-sha256',keyId:recipient.keyId,ciphertext:publicEncrypt({key:rsa.publicKey,oaepHash:'sha256'},Buffer.alloc(32)).toString('base64')};
 const result={schema:'bithash.native-range.v1',targetId:q.targetId,start:q.start,end:q.end,attempted:'2',status:'candidate',matched:true,elapsedNanoseconds:'1'};
 const payload={schema:'bithash.own-range-receipt.v1',request:q,backend:'bitcrack-cuda-exact-range',result,sealedCandidate:sealed};
 assert.throws(()=>signRangeReceipt({...payload,sealedCandidate:null},e.key.privateKey));
 const envelope=signRangeReceipt(payload,e.key.privateKey),ack=l.accept(id(1),lease.epoch,lease.capability,envelope);assert.equal(ack.privateReview,true);
 assert.equal(l.row(id(1)).next,l.row(id(1)).start);assert.equal(coverageSummary(c.db,'puzzle-71').ownCheckpointedCandidates,'0');
 assert.throws(()=>l.reserve(id(2),'puzzle-71','8',sha),/target_paused/);
 const publicView=JSON.stringify(dashboardSnapshot(path));assert.equal(publicView.includes(sealed.ciphertext),false);assert.equal(publicView.includes('privateKey'),false);
 assert.equal(c.db.prepare('SELECT private FROM own_range_receipts').get().private,1);
});

test('approval bridge requires the exact range mission, hash and Google owner record',t=>{
 const {l}=setup(t);const job=l.reserve(id(1),'puzzle-71','8',sha),now=Date.now();
 const terms={workload:'fixed-public-puzzle-range',rangeMission:{jobId:job.id,targetId:job.target,start:job.start,end:job.end,solverSha256:job.solver,recoveryKeyId:'c'.repeat(64)}};
 const run={id:'run-1',state:'running',terms,digest:digest(terms),podId:'pod-1',deadline:new Date(now+100000).toISOString(),proofs:[{id:'run-1',kind:'google_owner_approval'}]};
 const feed={schema:'bithash.live-executor.v1',mode:'real-provider',runs:[run]};
 assert.equal(approvedRangeMission(feed,job,now).jobId,job.id);
 assert.throws(()=>approvedRangeMission({...feed,runs:[{...run,proofs:[]}]},job,now));
 assert.throws(()=>approvedRangeMission({...feed,runs:[{...run,digest:'0'.repeat(64)}]},job,now));
 assert.throws(()=>approvedRangeMission(feed,{...job,end:String(BigInt(job.end)+1n)},now));
 assert.throws(()=>approvedRangeMission(feed,job,now+100001));
});

test('live worker lock prevents concurrent execution and clock rollback cannot extend a range lease',async t=>{
 const {l,dir}=setup(t);l.reserve(id(1),'range-probe-71','3',sha);const e=enrollment(l,id(1)),lease=l.lease(id(1),e.options),{origin}=await serve(t,l);
 assert.throws(()=>l.next(id(1),lease.epoch,lease.capability,'3',Date.now()-10000),/clock_rollback/);
 const cfg=config(lease,e.key,origin,dir),transport=rangeClient(cfg);let release;const wait=new Promise(r=>{release=r;});
 const first=runOwnRangeWorker(cfg,{client:async(...args)=>{await wait;return transport(...args);},directory:cfg.stateDirectory,privateKey:e.key.privateKey});
 // Wait for lock creation without using a timing assumption.
 for(let n=0;n<100&&!existsSync(join(cfg.stateDirectory,'worker.lock'));n++)await new Promise(r=>setTimeout(r,5));
 await assert.rejects(runOwnRangeWorker(cfg,{client:transport,directory:cfg.stateDirectory,privateKey:e.key.privateKey}),/worker_already_running/);
 release();assert.equal((await first).status,'completed');
});

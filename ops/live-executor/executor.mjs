import {DatabaseSync} from 'node:sqlite';
import {createHash,randomBytes,createPublicKey,verify,timingSafeEqual} from 'node:crypto';
import {GPU_IDS} from './provider.mjs';
import {liveOptions,validateLiveChoice} from './planning.mjs';
import {validateArchive} from './worker-archive.mjs';
import {RangeBridge} from './range.mjs';
export const hash=x=>createHash('sha256').update(typeof x==='string'||Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
const exact=(o,keys)=>o&&Object.keys(o).sort().join()===keys.split(',').sort().join();
const terminal=new Set(['expired','rejected','cancelled','deleted']);
const safePod=p=>({id:p.id,name:p.name,image:p.image,gpu:p.gpu,cloud:p.cloud,dataCenterId:p.dataCenterId??null,status:p.status,cost:p.cost??null,createdAt:p.createdAt??null,disk:p.disk});
export class Executor {
 constructor(path,{provider,guard,telemetry,config,clock=Date.now,random=n=>randomBytes(n).toString('hex')}){
  Object.assign(this,{provider,guard,telemetry,config,clock,random});this.busy=false;
  this.db=new DatabaseSync(path);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS live_runs(id TEXT PRIMARY KEY,terms TEXT NOT NULL,digest TEXT NOT NULL,state TEXT NOT NULL,token TEXT NOT NULL,pod TEXT,started INTEGER,deadline INTEGER,public_key TEXT,lease TEXT NOT NULL,completion TEXT,error TEXT);
   CREATE TABLE IF NOT EXISTS live_events(seq INTEGER PRIMARY KEY,id TEXT NOT NULL,record TEXT NOT NULL,digest TEXT NOT NULL UNIQUE);
   CREATE TABLE IF NOT EXISTS live_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS live_plans(id TEXT PRIMARY KEY,ticket TEXT NOT NULL,choice TEXT,run_id TEXT);
   CREATE TABLE IF NOT EXISTS live_archives(id TEXT PRIMARY KEY,digest TEXT NOT NULL UNIQUE,envelope TEXT NOT NULL);`);
  this.ranges=config.range?new RangeBridge(this,config.range):null;
 }
 close(){this.db.close();}
 tx(fn){this.db.exec('BEGIN IMMEDIATE');try{const v=fn();this.db.exec('COMMIT');return v;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 now(){const wall=this.clock(),old=Number(this.db.prepare("SELECT value FROM live_meta WHERE key='clock'").get()?.value??0);if(!Number.isSafeInteger(wall)||wall<old)throw Error('clock_rollback');this.db.prepare("INSERT OR REPLACE INTO live_meta VALUES('clock',?)").run(String(wall));return wall;}
 row(id){const r=this.db.prepare('SELECT * FROM live_runs WHERE id=?').get(id);if(!r)throw Error('unknown_proposal');return r;}
 event(id,kind,data={}){const prior=this.db.prepare('SELECT digest FROM live_events ORDER BY seq DESC LIMIT 1').get()?.digest??null;const record={schema:'bithash.live-executor-event.v1',id,at:new Date(this.clock()).toISOString(),kind,data,previousDigest:prior,evidence:'server-observation',coverageVerified:false};const text=JSON.stringify(record);this.db.prepare('INSERT INTO live_events(id,record,digest) VALUES(?,?,?)').run(id,text,hash(text));}
 set(id,state,error=null){this.db.prepare('UPDATE live_runs SET state=?,error=? WHERE id=?').run(state,error,id);this.event(id,state,error?{code:error}:{});}
 async planningRangeQuote(input){if(!exact(input,'jobId,limits')||!this.ranges||input.jobId!==this.ranges.config.jobId)throw Error('invalid_range_terms');return this.planningQuote(input.limits,this.ranges.mission());}
 async planningQuote(limits,rangeMission=null){
  const quote=await this.provider.catalog(1),now=this.now();
  const ticket={schema:'bithash.live-planning-ticket.v1',id:'plan-'+this.random(12),observedAt:new Date(now).toISOString(),expiresAt:now+180000,limits,quote:{record:quote.record,sha256:quote.sha256},options:liveOptions(quote,limits,now,rangeMission),...(rangeMission?{rangeMission}:{}),approvalRequired:true,executionEnabled:false};
  this.tx(()=>{if(this.db.prepare('SELECT count(*) n FROM live_plans').get().n>=1000)throw Error('planning_retention_limit');this.db.prepare('INSERT INTO live_plans(id,ticket) VALUES(?,?)').run(ticket.id,JSON.stringify(ticket));});return ticket;
 }
 async proposeAi(body){
  if(!exact(body,'ticketId,choice'))throw Error('invalid_live_choice');validateLiveChoice(body.choice);
  const saved=this.db.prepare('SELECT * FROM live_plans WHERE id=?').get(body.ticketId);
  if(!saved)throw Error('unknown_planning_ticket');const choice=JSON.stringify(body.choice);
  if(saved.run_id){if(saved.choice!==choice)throw Error('planning_choice_conflict');return this.view(saved.run_id);}
  if(saved.choice){if(saved.choice!==choice)throw Error('planning_choice_conflict');return {state:'held',ticketId:saved.id,choice:body.choice};}
  const ticket=JSON.parse(saved.ticket),now=this.now(),option=ticket.options.find(o=>o.id===body.choice.optionId);
  if(ticket.expiresAt<=now||Date.parse(body.choice.generatedAt)<Date.parse(ticket.observedAt)-5000||Date.parse(body.choice.generatedAt)>now+5000)throw Error('planning_choice_expired_or_invalid');
  if(body.choice.optionId==='hold'){return this.tx(()=>{const old=this.db.prepare('SELECT * FROM live_plans WHERE id=?').get(saved.id);if(old.choice&&old.choice!==choice)throw Error('planning_choice_conflict');this.db.prepare('UPDATE live_plans SET choice=? WHERE id=?').run(choice,saved.id);return {state:'held',ticketId:saved.id,choice:body.choice};});}
  if(!option)throw Error('planning_choice_expired_or_invalid');
  const planner={schema:'bithash.live-proposal-planner.v1',ticketId:ticket.id,quoteDigest:ticket.quote.sha256,sourceQuote:ticket.quote.record,limits:ticket.limits,option,choice:body.choice,choiceDigest:hash(body.choice),approvalRequired:true};
  if(ticket.rangeMission){const mission=this.ranges.mission();if(hash(mission)!==hash(ticket.rangeMission)||option.input.jobId!==mission.jobId)throw Error('range_plan_conflict');return this.propose({gpu:option.input.gpu,durationSeconds:option.input.durationSeconds,capMicrousd:option.input.capMicrousd},{planner,ticketId:ticket.id,choice,rangeMission:mission});}
  return this.propose(option.input,{planner,ticketId:ticket.id,choice});
 }
 async proposeRange(input){if(!this.ranges)throw Error('range_deployment_unavailable');return this.ranges.propose(input);}
 artifacts(t){if(t.workload==='fixed-public-puzzle-range'){if(!this.ranges)throw Error('range_deployment_unavailable');return this.ranges.artifacts(t);}return this.config;}
 async propose(input,context=null){
  const sustained=input?.sustainSeconds===300;
  if(input && Object.hasOwn(input,'sustainSeconds')) {
   if(!sustained || !exact(input,'gpu,durationSeconds,capMicrousd,sustainSeconds') || input.durationSeconds<600)throw Error('invalid_sustained_terms');
   input={gpu:input.gpu,durationSeconds:input.durationSeconds,capMicrousd:input.capMicrousd};
  }
  if(!exact(input,'gpu,durationSeconds,capMicrousd')||!GPU_IDS[input.gpu]||!Number.isInteger(input.durationSeconds)||input.durationSeconds<300||input.durationSeconds>900||typeof input.capMicrousd!=='string'||!/^\d{1,7}$/.test(input.capMicrousd)||BigInt(input.capMicrousd)<10000n||BigInt(input.capMicrousd)>1000000n)throw Error('invalid_live_terms');
  const q=await this.provider.catalog(1),now=this.now(),r=q.record.rows.find(x=>x.gpu===input.gpu);
  if(q.stale||!r||r.availability==='NONE')throw Error('gpu_unavailable');
  const ceiling=(BigInt(r.hourlyPerGpuMicrousd)*105n+99n)/100n+10000n;
  const estimated=(ceiling*BigInt(input.durationSeconds)+3599n)/3600n;
  if(estimated>BigInt(input.capMicrousd))throw Error('cap_too_small');
  const id='live-'+this.random(12),token=this.random(32),lease=this.random(16);
  const artifact=context?.rangeMission?this.ranges.config:this.config;
  const terms={schema:'bithash.live-run-terms.v1',id,provider:'runpod',gpu:input.gpu,count:1,durationSeconds:input.durationSeconds,capMicrousd:input.capMicrousd,hourlyCeilingMicrousd:String(ceiling),estimatedMaximumMicrousd:String(estimated),quote:q.record,quoteDigest:q.sha256,expiresAt:now+600000,image:artifact.image,bootstrapSha256:hash(artifact.bootstrap),build:artifact.build,archiveSha256:artifact.archiveSha256,workload:'fixed-synthetic-known-answer',puzzle71Candidates:'0',diskGb:20,shutdownHeadroomSeconds:90,workerSeconds:sustained?390:120,...(sustained?{sustainSeconds:300}:{}),bootstrapDeadlineSeconds:300,deleteDisposablePod:true,creditBalanceVerified:false,billingFinalized:false,limitations:'Per-run operational ceiling, not a provider-enforced hard cap. API or host outages can delay deletion. Catalog compute plus 5% and $0.01/hour storage allowance; final invoice remains separate.'};
  if(context?.planner)terms.planner=context.planner;
  if(context?.rangeMission){terms.rangeMission=context.rangeMission;terms.workload='fixed-public-puzzle-range';terms.puzzle71Candidates=String(BigInt(terms.rangeMission.end)-BigInt(terms.rangeMission.start));terms.workerSeconds=120;}
  let created=id;
  this.tx(()=>{if(context?.ticketId){const p=this.db.prepare('SELECT * FROM live_plans WHERE id=?').get(context.ticketId);if(p.run_id){if(p.choice!==context.choice)throw Error('planning_choice_conflict');created=p.run_id;return;}if(p.choice&&p.choice!==context.choice)throw Error('planning_choice_conflict');if(this.now()>=JSON.parse(p.ticket).expiresAt)throw Error('planning_choice_expired_or_invalid');}
   if(this.db.prepare("SELECT count(*) n FROM live_runs WHERE state='proposed'").get().n>=10)throw Error('too_many_proposals');this.db.prepare('INSERT INTO live_runs(id,terms,digest,state,token,lease) VALUES(?,?,?,?,?,?)').run(id,JSON.stringify(terms),hash(terms),'proposed',token,lease);this.event(id,'proposed',{terms,digest:hash(terms)});
   if(context?.ticketId)this.db.prepare('UPDATE live_plans SET choice=?,run_id=? WHERE id=?').run(context.choice,id,context.ticketId);
  });return this.view(created);
 }
 approve(id,digest){return this.tx(()=>{const r=this.row(id),now=this.now();if(r.digest!==digest)throw Error('digest_mismatch');if(r.state!=='proposed'){if(r.state==='approved')return this.view(id);throw Error('not_approvable');}if(now>=JSON.parse(r.terms).expiresAt)throw Error('proposal_expired');if(this.db.prepare("SELECT count(*) n FROM live_runs WHERE state NOT IN ('proposed','expired','rejected','cancelled','deleted')").get().n)throw Error('another_run_unresolved');this.set(id,'approved');this.event(id,'google_owner_approval',{digest,authentication:'local-owner-session-via-pinned-ssh'});return this.view(id);});}
 cancel(id,digest){return this.tx(()=>{const r=this.row(id);if(r.digest!==digest||!['proposed','approved'].includes(r.state))throw Error('cannot_cancel');this.set(id,'cancelled');return this.view(id);});}
 view(id){const r=this.row(id);return {id:r.id,digest:r.digest,terms:JSON.parse(r.terms),state:r.state,podId:r.pod,startedAt:r.started?new Date(r.started).toISOString():null,deadline:r.deadline?new Date(r.deadline).toISOString():null,error:r.error,billingFinalized:false,proofs:this.db.prepare('SELECT digest,record FROM live_events WHERE id=? ORDER BY seq').all(id).map(e=>({digest:e.digest,...JSON.parse(e.record),proofUrl:'/api/executor/proof/'+e.digest}))};}
 snapshot(){const saved=this.db.prepare('SELECT * FROM live_plans ORDER BY rowid DESC LIMIT 1').get(),ticket=saved?JSON.parse(saved.ticket):null;return {schema:'bithash.live-executor.v1',observedAt:new Date(this.clock()).toISOString(),mode:'real-provider',maximumConcurrentRentals:1,...(this.ranges?{ownRanges:this.ranges.summary()}:{}),latestPlanning:ticket?{id:ticket.id,observedAt:ticket.observedAt,quoteDigest:ticket.quote.sha256,quote:ticket.quote.record,limits:ticket.limits,choice:saved.choice?JSON.parse(saved.choice):null,state:saved.run_id?'proposed':saved.choice?'held_by_operator':!ticket.options.length?'held_no_capacity_or_budget':'awaiting_model_choice',runId:saved.run_id??null}:null,runs:this.db.prepare('SELECT id FROM live_runs ORDER BY rowid DESC LIMIT 100').all().map(r=>this.view(r.id))};}
 proof(digest){const r=this.db.prepare('SELECT record FROM live_events WHERE digest=?').get(digest);return r?{digest,record:JSON.parse(r.record)}:null;}
 request(r){const t=JSON.parse(r.terms),artifact=this.artifacts(t);if(t.image!==artifact.image||t.bootstrapSha256!==hash(artifact.bootstrap)||t.build!==artifact.build||t.archiveSha256!==artifact.archiveSha256)throw Error('deployment_changed_reapproval_required');return {name:'bithash-'+r.id,image:t.image,cloud:'SECURE',gpu:{id:GPU_IDS[t.gpu],count:1,minCudaVersion:'12.8'},disk:20,mounts:{},ports:[],startSsh:false,startJupyter:false,globalNetworking:false,entrypoint:['python3'],cmd:['-c',artifact.bootstrap],env:{BITHASH_RUN_ID:r.id,BITHASH_BOOTSTRAP_TOKEN:r.token}};}
 matches(p,r){const t=JSON.parse(r.terms);return p?.name==='bithash-'+r.id&&p.image===t.image&&p.gpu?.id===GPU_IDS[t.gpu]&&p.gpu.count===1&&p.cloud==='SECURE'&&p.disk===20&&p.env?.BITHASH_RUN_ID===r.id&&p.env?.BITHASH_BOOTSTRAP_TOKEN===r.token&&p.mounts&&Object.keys(p.mounts).length===0&&/^[a-z0-9]{10,32}$/.test(p.id);}
 async tick(){if(this.busy)return;this.busy=true;try{
  const now=this.now();for(const {id} of this.db.prepare("SELECT id FROM live_runs WHERE state NOT IN ('expired','rejected','cancelled','deleted')").all()){
   let r=this.row(id),t=JSON.parse(r.terms);
   try{
    if(['proposed','approved'].includes(r.state)&&now>=t.expiresAt){this.set(id,'expired');continue;}
    if(r.state==='proposed')continue;
    if(r.state==='approved'){
     await this.guard.ready();const inventory=await this.provider.inventory();if(inventory.length)throw Error('account_has_existing_pods');
     const q=await this.provider.catalog(1),price=q.record.rows.find(x=>x.gpu===t.gpu);
     if(q.stale||!price||price.availability==='NONE'||BigInt(price.hourlyPerGpuMicrousd)+10000n>BigInt(t.hourlyCeilingMicrousd))throw Error('quote_changed_or_unavailable');
     const request=this.request(r);const started=this.now();if(started>=t.expiresAt)throw Error('proposal_expired');
     // Commit BEFORE the first and only POST. A lost response never becomes a retry.
     this.tx(()=>{this.db.prepare('UPDATE live_runs SET started=?,deadline=? WHERE id=?').run(started,started+t.durationSeconds*1000,id);this.set(id,'creating');});
     r=this.row(id);
     try{const p=await this.provider.create(request);await this.adopt(r,p);}catch(e){
      if(/^provider_http_(400|401|402|403|413|422)$/.test(e.message)&&this.row(id).state==='creating')this.set(id,'rejected',e.message);
      else{this.db.prepare('UPDATE live_runs SET error=? WHERE id=?').run('create_outcome_requires_reconciliation',id);this.event(id,'create_response_uncertain');}
     }
    }
    r=this.row(id);
    if(r.state==='creating'){
     const matches=(await this.provider.inventory()).filter(p=>this.matches(p,r));
     if(matches.length===1)await this.adopt(r,matches[0]);
     else if(matches.length>1)throw Error('multiple_matching_pods');
     // Zero matches is not proof that the POST was rejected. Never re-POST.
    }
    r=this.row(id);
    if(r.pod&&!terminal.has(r.state)){
     await this.guard.register(this.lease(r));
     const states=await this.guard.status(),s=states.find(x=>x.podId===r.pod);
     if(s?.phase==='absence_observed'){this.set(id,'deleted');this.event(id,'billing_pending',{invoiceFinalized:false});continue;}
     if(r.completion||now>=r.deadline-90000||(!r.public_key&&now-r.started>=t.bootstrapDeadlineSeconds*1000)){
      await this.guard.stop(r.pod);if(r.state!=='stopping')this.set(id,'stopping');
     }
    }
   }catch(e){const code=/^[a-z_]{1,80}$/.test(e.message)?e.message:'executor_step_failed';this.db.prepare('UPDATE live_runs SET error=? WHERE id=?').run(code,id);if(r.state==='approved')this.set(id,'rejected',code);}
  }
 }finally{this.busy=false;}}
 lease(r){const t=JSON.parse(r.terms);return {schema:'bithash.shutdown-lease.v1',podId:r.pod,expectedName:'bithash-'+r.id,startedAt:new Date(r.started).toISOString(),notAfter:new Date(r.deadline).toISOString(),maxSpendMicrousd:t.capMicrousd,hourlyCeilingMicrousd:t.hourlyCeilingMicrousd,shutdownHeadroomSeconds:90,deleteDisposablePod:true};}
 async adopt(r,p){if(!this.matches(p,r))throw Error('provider_identity_mismatch');this.tx(()=>{const current=this.row(r.id);if(current.pod&&current.pod!==p.id)throw Error('pod_conflict');this.db.prepare('UPDATE live_runs SET pod=? WHERE id=?').run(p.id,r.id);this.set(r.id,'registering');this.event(r.id,'provider_created',{provider:safePod(p)});});await this.guard.register(this.lease(this.row(r.id)));this.set(r.id,'bootstrapping');}
 authenticate(id,token){const r=this.row(id),now=this.now();if(typeof token!=='string'||token.length!==64||!timingSafeEqual(Buffer.from(token),Buffer.from(r.token))||!r.pod||!r.deadline||now>=r.deadline-90000||terminal.has(r.state)||r.state==='stopping')throw Error('worker_unauthorized');return r;}
 async enroll(body,token){
  if(!exact(body,'id,podId,publicKey')||typeof body.publicKey!=='string'||body.publicKey.length>200)throw Error('invalid_enrollment');
  const r=this.authenticate(body.id,token);if(body.podId!==r.pod||createPublicKey(body.publicKey).asymmetricKeyType!=='ed25519'||(r.public_key&&r.public_key!==body.publicKey))throw Error('enrollment_conflict');
  const state=(await this.guard.status()).find(x=>x.podId===r.pod);if(!state||state.reason||state.phase==='absence_observed')throw Error('shutdown_not_ready');
  const t=JSON.parse(r.terms),expiresAt=r.deadline-90000;
  // Persist binding before enrollment. Crash retries must present the same key.
  this.tx(()=>{const latest=this.row(r.id);if(latest.public_key&&latest.public_key!==body.publicKey)throw Error('enrollment_conflict');if(!latest.public_key){this.db.prepare('UPDATE live_runs SET public_key=? WHERE id=?').run(body.publicKey,r.id);this.event(r.id,'worker_key_bound',{lease:r.lease,publicKey:body.publicKey});}});
  await this.telemetry.enroll({id:r.lease,publicKey:body.publicKey,build:t.build,providerPodId:r.pod,kind:'gpu',expiresAt});
  this.authenticate(r.id,token);
  const range=t.workload==='fixed-public-puzzle-range'?this.ranges.enroll(this.row(r.id),body.publicKey):null;
  if(this.row(r.id).state!=='worker_enrolled')this.set(r.id,'worker_enrolled');
  return {origin:this.config.collectorOrigin,ca:this.config.ca,caFile:'/bithash-private/collector-ca.pem',keyFile:'/bithash-private/key.pem',lease:r.lease,expiresAt,build:t.build,gpu:t.gpu.replace('rtx-',''),durationSeconds:t.workerSeconds,...(t.sustainSeconds?{sustainSeconds:t.sustainSeconds}:{}),stateDir:'/bithash-private/worker-state',...(range?{range}:{} )};
 }
 complete(body,token){
  if(!exact(body,'payload,signature')||!exact(body.payload,'schema,id,podId,lease,status'))throw Error('invalid_completion');
  const p=body.payload,r=this.authenticate(p.id,token);if(!r.public_key||p.schema!=='bithash.executor-completion.v1'||p.podId!==r.pod||p.lease!==r.lease||!['passed','failed'].includes(p.status)||typeof body.signature!=='string'||!verify(null,Buffer.from('bithash.executor-completion.v1\n'+JSON.stringify(p)),r.public_key,Buffer.from(body.signature,'base64')))throw Error('completion_rejected');
  if(JSON.parse(r.terms).workload==='fixed-public-puzzle-range'&&p.status==='passed'&&!this.db.prepare('SELECT id FROM live_archives WHERE id=?').get(r.id))throw Error('range_archive_required');
  const text=JSON.stringify(body);this.tx(()=>{const old=this.row(r.id).completion;if(old&&old!==text)throw Error('completion_conflict');if(!old){this.db.prepare('UPDATE live_runs SET completion=? WHERE id=?').run(text,r.id);this.event(r.id,'worker_completed',{...body,archiveDigest:this.db.prepare('SELECT digest FROM live_archives WHERE id=?').get(r.id)?.digest??null,evidence:'authenticated-worker-claim'});}});return {accepted:true};
 }
 archive(body,token){
  if(!exact(body,'payload,signature')||typeof body.payload!=='string'||Buffer.byteLength(body.payload)>500000||typeof body.signature!=='string'||! /^[A-Za-z0-9+/]{86}==$/.test(body.signature))throw Error('invalid_worker_archive');
  const p=JSON.parse(body.payload),r=this.authenticate(p.id,token),t=JSON.parse(r.terms);
  if(t.workload==='fixed-public-puzzle-range')this.ranges.validateArchive(p,t,r);else validateArchive(p,t,r);
  if(body.payload!==JSON.stringify(p)||!r.public_key||!verify(null,Buffer.from('bithash.worker-archive.v1\n'+body.payload),r.public_key,Buffer.from(body.signature,'base64')))throw Error('archive_signature_rejected');
  const text=JSON.stringify(body),digest=hash(text);
  this.tx(()=>{const old=this.db.prepare('SELECT * FROM live_archives WHERE id=?').get(r.id);if(old){if(old.digest!==digest)throw Error('archive_conflict');return;}
   if(r.completion)throw Error('archive_after_completion');this.db.prepare('INSERT INTO live_archives VALUES(?,?,?)').run(r.id,digest,text);this.event(r.id,'worker_logs_archived',{digest,proofUrl:'/api/executor/log/'+digest,completedCases:p.result.completedCases??3,status:p.result.status,build:t.build,evidence:'authenticated-worker-claim',puzzle71Candidates:t.workload==='fixed-public-puzzle-range'?this.ranges.checked(r):'0'});
  });return {accepted:true,digest};
 }
 archivedLog(digest){const r=this.db.prepare('SELECT envelope FROM live_archives WHERE digest=?').get(digest);return r?{digest,envelope:JSON.parse(r.envelope),evidence:'authenticated-worker-claim',coverageVerified:false}:null;}
}

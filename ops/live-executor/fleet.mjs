import {digest} from '../../local/own-range-protocol.js';import {GPU_IDS} from './provider.mjs';
import {fleetInput,fleetMissions,fleetOptions,fleetClosed,FLEET_COUNT} from './fleet-terms.mjs';
const shape=(v,fields)=>v&&Object.keys(v).sort().join()===fields.split(',').sort().join();
const REVIEW_MS=60*60*1000;
const terminal=state=>['deleted','rejected','cancelled','expired'].includes(state);
export class Fleet {
 constructor(executor){this.x=executor;executor.db.exec(`
  CREATE TABLE IF NOT EXISTS live_fleets(id TEXT PRIMARY KEY,terms TEXT NOT NULL,digest TEXT NOT NULL,state TEXT NOT NULL,started INTEGER,deadline INTEGER,error TEXT);
  CREATE TABLE IF NOT EXISTS live_fleet_members(fleet TEXT NOT NULL,run_id TEXT NOT NULL UNIQUE,ordinal INTEGER NOT NULL,PRIMARY KEY(fleet,ordinal));`);}
 row(id){const r=this.x.db.prepare('SELECT * FROM live_fleets WHERE id=?').get(id);if(!r)throw Error('unknown_fleet');return r;}
 member(id){return this.x.db.prepare('SELECT fleet FROM live_fleet_members WHERE run_id=?').get(id)?.fleet??null;}
 runs(id){return this.x.db.prepare('SELECT run_id FROM live_fleet_members WHERE fleet=? ORDER BY ordinal').all(id).map(r=>this.x.row(r.run_id));}
 locked(){return this.x.db.prepare("SELECT id FROM live_fleets WHERE state NOT IN ('completed','failed','cancelled','expired','rejected') LIMIT 1").get()??null;}
 set(id,state,error=null){this.x.db.prepare('UPDATE live_fleets SET state=?,error=? WHERE id=?').run(state,error,id);this.x.event(id,'fleet_'+state,error?{code:error}:{});}
 view(id){const f=this.row(id),terms=JSON.parse(f.terms),runs=this.runs(id);return {id:f.id,digest:f.digest,terms,state:f.state,startedAt:f.started?new Date(f.started).toISOString():null,deadline:f.deadline?new Date(f.deadline).toISOString():null,error:f.error,billingFinalized:false,
  members:runs.map(r=>({id:r.id,podId:r.pod,state:r.state,error:r.error,completedCandidates:this.x.ranges.checked(r)})),proofs:this.x.proofs(id),requiresAttention:f.state==='unresolved'||f.state==='review_required'};}
 summary(){return this.x.db.prepare('SELECT id FROM live_fleets ORDER BY rowid DESC LIMIT 10').all().map(r=>this.view(r.id));}
 async quote(input){if(!shape(input,'limits,count')||input.count!==FLEET_COUNT||!this.x.ranges)throw Error('invalid_fleet_terms');
  const missions=this.x.ranges.fleetMissions(),q=await this.x.provider.catalog(1),now=this.x.now();
  const ticket={schema:'bithash.live-planning-ticket.v1',id:'plan-'+this.x.random(12),observedAt:new Date(now).toISOString(),expiresAt:now+180000,limits:input.limits,quote:{record:q.record,sha256:q.sha256},options:fleetOptions(q,input.limits,now,missions),fleetMissions:missions,approvalRequired:true,executionEnabled:false};
  this.x.tx(()=>{if(this.x.db.prepare('SELECT count(*) n FROM live_plans').get().n>=1000)throw Error('planning_retention_limit');this.x.db.prepare('INSERT INTO live_plans(id,ticket) VALUES(?,?)').run(ticket.id,JSON.stringify(ticket));});return ticket;}
 async propose(input,context=null){fleetInput(input);const x=this.x;
  if(!x.ranges)throw Error('range_deployment_unavailable');
  if(context?.ticketId){const p=x.db.prepare('SELECT * FROM live_plans WHERE id=?').get(context.ticketId);if(p?.run_id){if(p.choice!==context.choice)throw Error('planning_choice_conflict');return this.view(p.run_id);}}
  const pending=this.locked();if(pending){const f=this.row(pending.id),t=JSON.parse(f.terms);if(!context&&f.state==='proposed'&&x.clock()<t.expiresAt&&['gpu','count','durationSeconds','capMicrousd'].every(k=>t[k]===input[k]))return this.view(f.id);throw Error('fleet_in_progress');}
  const missions=fleetMissions(context?.missions??x.ranges.fleetMissions());
  const q=await x.provider.catalog(1),now=x.now(),limits={maxDurationSeconds:input.durationSeconds,capMicrousd:input.capMicrousd};
  // Validate the fresh quote using the same bounded per-Pod catalog contract.
  fleetOptions(q,limits,now,missions);const row=q.record.rows.find(r=>r.gpu===input.gpu);
  if(q.stale||!row||row.availability==='NONE')throw Error('gpu_unavailable');
  const ceiling=(BigInt(row.hourlyPerGpuMicrousd)*105n+99n)/100n+10000n,each=(ceiling*BigInt(input.durationSeconds)+3599n)/3600n,cap=BigInt(input.capMicrousd)/2n;
  if(each>cap)throw Error('cap_too_small');
  const id='fleet-'+x.random(12),artifact=x.ranges.config;
  const privateMembers=missions.map(m=>({id:'live-'+x.random(12),token:x.random(32),lease:x.random(16),mission:m}));
  const members=privateMembers.map(r=>{const terms={schema:'bithash.live-run-terms.v1',id:r.id,provider:'runpod',fleetId:id,gpu:input.gpu,count:1,durationSeconds:input.durationSeconds,capMicrousd:String(cap),hourlyCeilingMicrousd:String(ceiling),estimatedMaximumMicrousd:String(each),quote:q.record,quoteDigest:q.sha256,expiresAt:now+REVIEW_MS,image:artifact.image,bootstrapSha256:digest(artifact.bootstrap),build:artifact.build,archiveSha256:artifact.archiveSha256,workload:'fixed-public-puzzle-range',rangeMission:r.mission,puzzle71Candidates:String(BigInt(r.mission.end)-BigInt(r.mission.resumeFrom??r.mission.start)),diskGb:20,shutdownHeadroomSeconds:90,workerSeconds:120,bootstrapDeadlineSeconds:300,deleteDisposablePod:true,creditBalanceVerified:false,billingFinalized:false,limitations:'Fleet member budget slice; shared fleet deadline. API outages can delay deletion. Worker claims do not attest exhaustive coverage.'};return {id:r.id,digest:digest(terms),terms};});
  const terms={schema:'bithash.live-fleet-terms.v1',id,provider:'runpod',gpu:input.gpu,count:FLEET_COUNT,pods:FLEET_COUNT,gpusPerPod:1,durationSeconds:input.durationSeconds,capMicrousd:input.capMicrousd,perPodCapMicrousd:String(cap),hourlyCeilingMicrousd:String(ceiling*2n),estimatedMaximumMicrousd:String(each*2n),expiresAt:now+REVIEW_MS,workload:'fixed-public-puzzle-fleet',members,deleteDisposablePods:true,creditBalanceVerified:false,billingFinalized:false,partialFailurePolicy:'stop-known-members-and-reconcile-no-replacement',limitations:'Operational fleet ceiling, not a provider-enforced hard cap. Availability is not a reservation. Final billing is separate; API outages can delay deletion.',...(context?.planner?{planner:context.planner}:{})};
  return x.tx(()=>{
   if(context?.ticketId){const p=x.db.prepare('SELECT * FROM live_plans WHERE id=?').get(context.ticketId);if(p?.run_id){if(p.choice!==context.choice)throw Error('planning_choice_conflict');return this.view(p.run_id);}if(!p||p.choice&&p.choice!==context.choice||JSON.parse(p.ticket).expiresAt<=x.now())throw Error('planning_choice_expired_or_invalid');}
   x.ranges.idle();if(x.db.prepare('SELECT count(*) n FROM live_fleets').get().n>=1000)throw Error('fleet_retention_limit');
   for(const m of members)x.ranges.assertRunnable(m.terms);
   x.db.prepare('INSERT INTO live_fleets(id,terms,digest,state) VALUES(?,?,?,?)').run(id,JSON.stringify(terms),digest(terms),'proposed');
   members.forEach((m,i)=>{const p=privateMembers[i];x.db.prepare('INSERT INTO live_runs(id,terms,digest,state,token,lease) VALUES(?,?,?,?,?,?)').run(m.id,JSON.stringify(m.terms),m.digest,'fleet_pending',p.token,p.lease);x.db.prepare('INSERT INTO live_fleet_members(fleet,run_id,ordinal) VALUES(?,?,?)').run(id,m.id,i);x.event(m.id,'fleet_member_proposed',{fleetId:id,terms:m.terms,digest:m.digest});});
   x.event(id,'fleet_proposed',{terms,digest:digest(terms)});if(context?.ticketId)x.db.prepare('UPDATE live_plans SET choice=?,run_id=? WHERE id=?').run(context.choice,id,context.ticketId);return this.view(id);
  });}
 bound(f,r){const t=JSON.parse(f.terms),member=t.members.find(m=>m.id===r.id);if(digest(t)!==f.digest||!member||member.digest!==r.digest||digest(JSON.parse(r.terms))!==r.digest||JSON.parse(r.terms).fleetId!==f.id)throw Error('fleet_member_binding_changed');return t;}
 approve(id,hash){const x=this.x;return x.tx(()=>{const f=this.row(id),t=JSON.parse(f.terms),now=x.now();if(hash!==f.digest)throw Error('digest_mismatch');if(f.state!=='proposed'){if(f.state==='approved')return this.view(id);throw Error('not_approvable');}if(now>=t.expiresAt)throw Error('proposal_expired');
   if(x.db.prepare("SELECT id FROM live_runs WHERE state NOT IN ('proposed','fleet_pending','expired','rejected','cancelled','deleted') LIMIT 1").get()||x.db.prepare("SELECT id FROM live_fleets WHERE id!=? AND state NOT IN ('completed','failed','cancelled','expired','rejected') LIMIT 1").get(id))throw Error('another_run_unresolved');
   const runs=this.runs(id);for(const r of runs){this.bound(f,r);x.ranges.assertRunnable(JSON.parse(r.terms));if(r.state!=='fleet_pending')throw Error('fleet_member_binding_changed');}
   this.set(id,'approved');x.event(id,'google_owner_fleet_approval',{digest:hash,authentication:'local-owner-session-via-pinned-ssh'});
   for(const r of runs){x.set(r.id,'fleet_ready');x.event(r.id,'google_owner_approval',{digest:r.digest,fleetId:id,fleetDigest:hash,authentication:'inherited-exact-google-owner-fleet-approval'});}return this.view(id);});}
 cancel(id,hash){const x=this.x;return x.tx(()=>{const f=this.row(id);if(f.digest!==hash||fleetClosed(f.state))throw Error('cannot_cancel');
   const runs=this.runs(id);for(const r of runs)if(['fleet_pending','fleet_ready'].includes(r.state))x.set(r.id,'cancelled');
   this.set(id,runs.every(r=>!r.started)?'cancelled':'draining','owner_stop_requested');return this.view(id);});}
 drain(id,code,uncertain=false){const f=this.row(id);if(fleetClosed(f.state))return;const runs=this.runs(id);uncertain||=runs.some(r=>r.state==='creating'&&!r.pod);for(const r of runs)if(['fleet_pending','fleet_ready'].includes(r.state))this.x.set(r.id,'cancelled');if(f.state!==(uncertain?'unresolved':'draining')||f.error!==code)this.set(id,uncertain?'unresolved':'draining',code);}
 async tick(){const x=this.x;for(const {id}of x.db.prepare("SELECT id FROM live_fleets WHERE state NOT IN ('completed','failed','cancelled','expired','rejected')").all()){
   try{let f=this.row(id),t=JSON.parse(f.terms),now=x.now();
    if(['proposed','approved'].includes(f.state)&&now>=t.expiresAt){for(const r of this.runs(id))if(!r.started)x.set(r.id,'expired');this.set(id,'expired');continue;}if(['proposed','review_required'].includes(f.state))continue;
    if(f.state==='approved'){x.tx(()=>{for(const r of this.runs(id)){this.bound(f,r);x.ranges.assertRunnable(JSON.parse(r.terms));}x.db.prepare('UPDATE live_fleets SET started=?,deadline=? WHERE id=?').run(now,now+t.durationSeconds*1000,id);this.set(id,'dispatching');});f=this.row(id);}
    for(const r of this.runs(id).filter(r=>r.state==='creating')){const matches=(await x.provider.inventory()).filter(p=>x.matches(p,r));if(matches.length===1){await x.adopt(r,matches[0]);if(f.state==='unresolved')this.drain(id,'create_reconciled_after_uncertainty');}else if(matches.length>1)this.drain(id,'multiple_matching_pods',true);}
    let runs=this.runs(id);f=this.row(id);now=x.now();
    if(runs.some(r=>r.completion&&JSON.parse(r.completion).payload.status==='failed'))this.drain(id,'worker_failed');
    if(runs.some(r=>x.ranges.ledger.row(JSON.parse(r.terms).rangeMission.jobId).state==='private-review'))this.drain(id,'private_candidate_review');
    if(now>=f.deadline-90000)this.drain(id,'fleet_deadline');
    f=this.row(id);runs=this.runs(id);
    if(['draining','unresolved','review_required'].includes(f.state)){for(const r of runs.filter(r=>r.pod&&!terminal(r.state))){await x.guard.register(x.lease(r));await x.guard.stop(r.pod);if(r.state!=='stopping')x.set(r.id,'stopping');}}
    else if(f.state==='dispatching'&&!runs.some(r=>r.state==='creating')){
     const r=runs.find(r=>r.state==='fleet_ready');
     if(r){const known=runs.filter(r=>r.pod).map(r=>r.pod);await x.guard.ready(known);const inventory=await x.provider.inventory();
      if(inventory.some(p=>!runs.some(member=>member.pod===p.id&&x.matches(p,member))))throw Error('account_has_unrelated_pods');
      const q=await x.provider.catalog(1),price=q.record.rows.find(p=>p.gpu===t.gpu),terms=JSON.parse(r.terms);
      if(q.stale||!price||price.availability==='NONE'||BigInt(price.hourlyPerGpuMicrousd)+10000n>BigInt(terms.hourlyCeilingMicrousd))throw Error('quote_changed_or_unavailable');
      const request=x.request(r);x.tx(()=>{const latest=this.row(id);if(latest.state!=='dispatching'||x.now()>=latest.deadline-90000||x.row(r.id).state!=='fleet_ready')throw Error('fleet_dispatch_cancelled');this.bound(latest,x.row(r.id));x.ranges.assertRunnable(terms);x.db.prepare('UPDATE live_runs SET started=?,deadline=? WHERE id=?').run(latest.started,latest.deadline,r.id);x.set(r.id,'creating');});
      try{await x.adopt(x.row(r.id),await x.provider.create(request));}catch(e){const current=x.row(r.id);if(/^provider_http_(400|401|402|403|413|422)$/.test(e.message)&&current.state==='creating'){x.set(r.id,'rejected',e.message);this.drain(id,'fleet_member_create_rejected');}else if(current.pod)this.drain(id,'fleet_member_registration_failed');else {x.db.prepare('UPDATE live_runs SET error=? WHERE id=?').run('create_outcome_requires_reconciliation',r.id);this.drain(id,'create_outcome_requires_reconciliation',true);}}
     }else this.set(id,'running');
    }
    runs=this.runs(id);if(runs.every(r=>terminal(r.state))){const privateReview=runs.some(r=>x.ranges.ledger.row(JSON.parse(r.terms).rangeMission.jobId).state==='private-review');const passed=runs.every(r=>r.state==='deleted'&&r.completion&&JSON.parse(r.completion).payload.status==='passed');this.set(id,privateReview?'review_required':passed?'completed':'failed',privateReview?'private_candidate_review':passed?null:this.row(id).error??'incomplete_fleet');x.event(id,'fleet_billing_pending',{invoiceFinalized:false});}
   }catch(e){this.drain(id,/^[a-z_]{1,80}$/.test(e.message)?e.message:'fleet_step_failed',this.runs(id).some(r=>r.state==='creating'&&!r.pod));}
  }}
}

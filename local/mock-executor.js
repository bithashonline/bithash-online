import {proposalDigest} from './spending-approvals.js';

// Atomic local simulation only. No provider, wallet, shell or network interface.
export function tickMockExecutor(store, now=Math.floor(Date.now()/1000)) {
 return store.tx(()=>{
  store.clock(now);
  const changed=[];
  const emit=(id,kind)=>{store.event(id,now,kind,null,{actor:'automatic-mock-executor',simulation:true});changed.push({id,kind});};
  const rows=store.db.prepare("SELECT * FROM spending_proposals WHERE state IN ('proposed','reserved','dispatching','running','stop_requested') ORDER BY id").all();
  for(const row of rows){
   const t=JSON.parse(row.terms);
   if(t.provider!=='mock'||t.destination!=='local-simulation')continue;
   if(proposalDigest(t)!==row.digest)throw Error('proposal_integrity_failed');
   if(['proposed','reserved'].includes(row.state)&&now>=t.expiresAt){
    store.db.prepare("UPDATE spending_proposals SET state='expired' WHERE id=?").run(row.id);emit(row.id,'expired_before_dispatch');continue;
   }
   if(row.state==='proposed')continue;
   if(!Number.isSafeInteger(row.approved_at))throw Error('approval_missing');
   if(row.state==='reserved'){
    row.started_at=now;row.deadline=now+t.durationSeconds;
    store.db.prepare("UPDATE spending_proposals SET state='dispatching',started_at=?,deadline=? WHERE id=?").run(row.started_at,row.deadline,row.id);
    emit(row.id,'simulation_dispatch_intent');row.state='dispatching';
   }
   if(!Number.isSafeInteger(row.started_at)||!Number.isSafeInteger(row.deadline)||row.deadline!==row.started_at+t.durationSeconds||now<row.started_at)throw Error('invalid_run_clock');
   if(row.state==='dispatching'&&now<row.deadline){
    store.db.prepare("UPDATE spending_proposals SET state='running' WHERE id=?").run(row.id);emit(row.id,'simulation_running');row.state='running';
   }
   if(['running','dispatching'].includes(row.state)&&now>=row.deadline){
    store.db.prepare("UPDATE spending_proposals SET state='stop_requested' WHERE id=?").run(row.id);emit(row.id,'simulation_deadline_stop_requested');row.state='stop_requested';
   }
   if(row.state==='stop_requested'){
    const stop=store.db.prepare("SELECT MIN(at) AS at FROM spending_events WHERE proposal=? AND kind IN ('simulation_stop_requested','simulation_deadline_stop_requested')").get(row.id).at;
    if(!Number.isSafeInteger(stop))throw Error('stop_evidence_missing');
    const seconds=Math.max(0,Math.min(t.durationSeconds,stop-row.started_at));
    const actual=(BigInt(t.hourlyPerGpuMicrousd)*BigInt(t.count)*BigInt(seconds)+3599n)/3600n+BigInt(t.overheadMicrousd);
    if(actual>BigInt(t.capMicrousd))throw Error('cap_exceeded');
    store.db.prepare("UPDATE spending_proposals SET state='settled',actual=? WHERE id=?").run(actual.toString(),row.id);
    store.event(row.id,now,'simulation_absence_and_invoice_confirmed',null,{actor:'automatic-mock-executor',simulation:true,billedSeconds:seconds,actualMicrousd:actual.toString(),limitations:'Synthetic time-based accounting only. No external machine, invoice or absence check.'});changed.push({id:row.id,kind:'simulation_absence_and_invoice_confirmed'});
   }
  }
  return changed;
 });
}

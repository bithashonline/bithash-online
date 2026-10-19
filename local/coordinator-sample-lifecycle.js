// Fixture-only job outcomes. Never accepted by the real-record coordinator.
// Completion means an invented, explicitly matched deposit and $100 reload;
// balance changes alone never close a job or release a pending allocation.
import {createHash} from 'node:crypto';
import {AUTOPAY_POLICY} from './runpod-autopay-simulation.js';
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const ref=v=>typeof v==='string'&&/^sample-[a-z0-9-]{1,100}$/.test(v);
export const sampleTerminal=j=>['sample-complete','sample-cancelled'].includes(j.state);
export const allocationHeld=j=>j.state!=='sample-cancelled';

export function applySampleOutcome(w,id,e,now){
 if(w.evidenceKind!=='sample-fixtures')throw Error('coordinator_sample_only');
 const j=w.jobs.find(j=>j.id===id);
 if(!j||e?.source!=='sample-fixtures'||!ref(e.eventId)||!['unknown','deposit-confirmed','reload-declined','complete','failed-before-deposit'].includes(e.kind))throw Error('coordinator_sample_evidence_invalid');
 const encoded=digest({jobId:id,e});w.sampleEvents??={};
 if(w.sampleEvents[e.eventId]){if(w.sampleEvents[e.eventId]!==encoded)throw Error('coordinator_sample_event_changed');return false;}
 if(w.hold||!w.lastCheck||now<Date.parse(w.lastCheck)||now-Date.parse(w.lastCheck)>300000)throw Error('coordinator_sample_observation_unready');
 if(sampleTerminal(j))throw Error('coordinator_sample_job_terminal');
 if(Object.keys(w.sampleEvents).length>=10000)throw Error('coordinator_sample_history_full');
 if(e.kind==='deposit-confirmed'){
  if(j.sampleDeposit||!ref(e.depositId)||e.amountWbtcUnits!==j.amount||e.cardCreditMicrousd!==j.estimatedUsdMicros)throw Error('coordinator_sample_deposit_mismatch');
  if(w.jobs.some(x=>x.sampleDeposit?.id===e.depositId))throw Error('coordinator_sample_evidence_reused');
  j.sampleDeposit={id:e.depositId,amount:e.amountWbtcUnits,cardCreditMicrousd:e.cardCreditMicrousd};
  j.state='sample-awaiting-reload';
 }else if(e.kind==='complete'){
  if(!j.sampleDeposit||e.depositId!==j.sampleDeposit.id||!ref(e.reloadId)||e.cardDebitMicrousd!==AUTOPAY_POLICY.reloadMicrousd||e.providerCreditMicrousd!==AUTOPAY_POLICY.reloadMicrousd)throw Error('coordinator_sample_settlement_mismatch');
  if(w.jobs.some(x=>x.sampleReloadId===e.reloadId))throw Error('coordinator_sample_evidence_reused');
  j.sampleReloadId=e.reloadId;j.state='sample-complete';j.completedAt=new Date(now).toISOString();
 }else if(e.kind==='failed-before-deposit'){
  if(j.sampleDeposit||j.signature||e.evidence!=='confirmed-no-transfer-no-card-credit')throw Error('coordinator_sample_release_not_proven');
  j.state='sample-cancelled';j.completedAt=new Date(now).toISOString();
 }else{
  if(e.kind==='reload-declined'&&!j.sampleDeposit)throw Error('coordinator_sample_deposit_required');
  j.state=e.kind==='unknown'?'sample-unknown':'sample-reload-declined';
 }
 j.sampleLifecycle=true;j.reasons=[j.state.replaceAll('-','_')];
 j.events.push({at:new Date(now).toISOString(),kind:e.kind,eventId:e.eventId,evidenceKind:'sample-fixtures'});
 w.sampleEvents[e.eventId]=encoded;
 return true;
}

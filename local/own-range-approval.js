import {digest,rangeFail} from './own-range-protocol.js';
// The caller must obtain this snapshot from its authenticated private executor
// transport. Do not accept a worker-supplied "approved" flag or benchmark grant.
export function approvedRangeMission(snapshot,job,now=Date.now()){
 if(snapshot?.schema!=='bithash.live-executor.v1'||snapshot.mode!=='real-provider'||!Array.isArray(snapshot.runs))throw rangeFail('invalid_executor_snapshot');
 const run=snapshot.runs.find(r=>r.terms?.rangeMission?.jobId===job.id&&['bootstrapping','worker_enrolled','running'].includes(r.state)&&r.proofs?.some(e=>e.kind==='google_owner_approval'&&e.id===r.id)),t=run?.terms,m=t?.rangeMission;
 if(!run||!['bootstrapping','worker_enrolled','running'].includes(run.state)||t.workload!=='fixed-public-puzzle-range'||digest(t)!==run.digest||
  m.targetId!==job.target||m.start!==job.start||m.end!==job.end||m.solverSha256!==job.solver||!run.podId||
  !Number.isFinite(Date.parse(run.deadline))||Date.parse(run.deadline)<=now||typeof m.recoveryKeyId!=='string'||! /^[a-f0-9]{64}$/.test(m.recoveryKeyId)||
  !run.proofs.some(e=>e.kind==='google_owner_approval'&&e.id===run.id))throw rangeFail('range_approval_unverified');
 return {state:'google-owner-approved',workload:t.workload,jobId:job.id,targetId:job.target,start:job.start,end:job.end,
  solverSha256:job.solver,providerPodId:run.podId,expiresAt:Date.parse(run.deadline),digest:run.digest,validationOnly:false,recoveryKeyId:m.recoveryKeyId};
}

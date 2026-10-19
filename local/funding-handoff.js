import {WBTC} from './treasury-compute.js';
import {decode58} from './solana-evidence.js';
import {fundingUnits,sha256} from './restricted-wallet-signer.js';

export const HANDOFF_ORIGIN='coordinator-dry-run';
export const handoffTransient=new Set(['coordinator_handoff_unavailable','coordinator_handoff_stale','coordinator_handoff_waiting']);
export function handoffEnvelope(s,now){
 if(!s)throw Error('coordinator_handoff_unavailable');
 if(s.schema!=='bithash.coordinator-handoff.v1'||s.mode!=='dry-run'||s.evidenceKind!=='real-records'||!Array.isArray(s.jobs)||s.jobs.length>1000||s.jobs.some(j=>j.sampleLifecycle)||s.jobs.filter(j=>!['policy-complete-observation','finalized-transfer-failed'].includes(j.state)).length>1)throw Error('coordinator_handoff_source_invalid');
 for(const k of ['signingEnabled','broadcastEnabled','paymentsEnabled','rentalExecutionEnabled','gpuExperimentsEnabled','automaticCreditPosting'])if(s[k]!==false)throw Error('coordinator_handoff_execution_enabled');
 if(s.hold?.latched)throw Error('coordinator_handoff_source_held');
 if(s.hold)throw Error('coordinator_handoff_waiting');
 const age=now-Date.parse(s.checkedAt);
 if(s.stale||!Number.isFinite(age)||age<0||age>300000)throw Error('coordinator_handoff_stale');
 return s;
}
// A frozen observation source, never a treasury plan or permission to spend.
export function handoffPlan(s,id,now){
 handoffEnvelope(s,now);
 const j=s.jobs.find(j=>j.id===id);if(!j)throw Error('coordinator_handoff_intent_missing');
 if(!/^coord-[a-f0-9]{24}$/.test(j.id)||j.mode!=='dry-run'||j.mint!==WBTC.mint||!fundingUnits(j.amount)||!s.identity||j.owner!==s.identity.computeWallet)throw Error('coordinator_handoff_intent_invalid');
 for(const address of [j.owner,j.recipient,s.identity.computeWallet,s.identity.otherWallet,s.identity.projectMint])decode58(address,32);
 const created=Date.parse(j.createdAt);if(!Number.isFinite(created)||created>now)throw Error('coordinator_handoff_clock_invalid');
 if(!/^[a-f0-9]{64}$/.test(j.policyHash)||!/^[a-f0-9]{64}$/.test(j.fundingPolicyHash)||!Array.isArray(j.allocations)||!j.allocations.length)throw Error('coordinator_handoff_terms_invalid');
 const seen=new Set();let total=0n;const receipts=[];
 for(const a of j.allocations){
  const r=s.receipts?.['receipt-'+a.receiptId];
  if(seen.has(a.receiptId)||!r||r.id!==a.receiptId||!/^[a-f0-9]{64}$/.test(r.hash)||!fundingUnits(a.units)||fundingUnits(a.units)>fundingUnits(r.units))throw Error('coordinator_handoff_allocation_invalid');
  seen.add(a.receiptId);total+=fundingUnits(a.units);receipts.push({id:r.id,hash:r.hash,units:r.units});
 }
 if(total!==fundingUnits(j.amount))throw Error('coordinator_handoff_allocation_invalid');
 const frozen={id:j.id,createdAt:j.createdAt,owner:j.owner,recipient:j.recipient,mint:j.mint,amount:j.amount,identity:s.identity,policyHash:j.policyHash,fundingPolicyHash:j.fundingPolicyHash,allocations:j.allocations,receipts};
 return {id:j.id,amount:j.amount,createdAt:j.createdAt,route:'solcard-wbtc',source:HANDOFF_ORIGIN,state:'planned',handoff:frozen,handoffHash:sha256(JSON.stringify(frozen))};
}

import {createHash} from 'node:crypto';
import {matchSettlements} from './settlement-matching.js';
import {WBTC} from './treasury-compute.js';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const completedObservation=j=>j.state==='policy-complete-observation';
export const releasedObservation=j=>j.state==='finalized-transfer-failed';
export function fundingRecordBaseline(records){
 const f=records?.feeds;
 if(!['solcard','runpod'].every(p=>f?.[p]?.data?.connection==='authenticated-api'&&/^[a-f0-9]{64}$/.test(f[p].data.accountRef??'')&&Array.isArray(f[p].data.records)))return null;
 return Object.fromEntries(['solcard','runpod'].map(p=>[p,{accountRef:f[p].data.accountRef,ids:f[p].data.records.map(r=>r.id).sort()}]));
}
// Dedicated-card policy inference only, never exact provider-reference proof
// and never spendable treasury credit. Re-evaluate completed links for reversals.
export function assessFundingCompletion(j,s,allJobs,now){
 const b=j.recordBaseline,chain=j.chainObservation;
 if(!b||chain?.state!=='finalized'||chain.signature!==j.signature||chain.amount!==j.amount)return null;
 const f=s.records.feeds,w=s.shadow.ledger;
 if(s.shadow.state!=='watching'||s.shadow.currentReason||w.hold||!w.baseline)return null;
 for(const p of ['solcard','runpod']){
  const d=f[p]?.data,at=Date.parse(d?.observedAt);
  if(f[p]?.state!=='connected'||!f[p].fresh||d?.connection!=='authenticated-api'||d.accountRef!==b[p].accountRef||d.accountRef!==w.baseline[p]?.accountRef||!Number.isFinite(at)||at>now||now-at>300000)return null;
 }
 if(f.solcard.data.coverage?.invoiceDetailsIncomplete!==false)return null;
 const proof=matchSettlements(f,{chain,terms:{mint:WBTC.mint,slotNumber:1,recipient:j.recipient,amount:j.amount}});
 const after=(r,p)=>r&&!b[p].ids.includes(r.id)&&Date.parse(r.occurredAt)>=Date.parse(j.createdAt)&&Date.parse(r.occurredAt)<=now;
 const candidates=proof.depositCandidates.filter(c=>after(f.solcard.data.records.find(r=>r.id===c.cardActivityId),'solcard'));
 if(candidates.length>1)throw Error('coordinator_completion_ambiguous');
 if(candidates.length!==1)return null;
 const deposit=candidates[0],credit=f.solcard.data.records.find(r=>r.id===deposit.cardActivityId);
 // Do not guess between concurrent/manual deposits or reuse an earlier invoice.
 if(allJobs.some(x=>x.id!==j.id&&x.completion?.cardCreditId===credit.id))throw Error('coordinator_completion_reused');
 if((s.treasury.plans??[]).some(p=>p.state!=='cancelled'&&p.state!=='provider-credited'))return null;
 const pairs=(w.pairs??[]).filter(p=>{
  const debit=f.solcard.data.records.find(r=>r.id===p.cardId),reload=f.runpod.data.records.find(r=>r.id===p.reloadId);
  return p.amount==='100000000'&&BigInt(deposit.netMicrousd)>=BigInt(p.amount)&&after(debit,'solcard')&&after(reload,'runpod')&&Date.parse(debit.occurredAt)>=Date.parse(credit.occurredAt)&&!w.providerAccounting?.reducedReloads?.['record-'+p.reloadId];
 });
 if(pairs.length>1)throw Error('coordinator_completion_ambiguous');
 if(pairs.length!==1)return null;
 const pair=pairs[0];
 if(allJobs.some(x=>x.id!==j.id&&(x.completion?.reloadId===pair.reloadId||x.completion?.cardDebitId===pair.cardId)))throw Error('coordinator_completion_reused');
 const candidate=proof.reloadCandidates.find(r=>r.reloadId===pair.reloadId);
 if(candidate?.state!=='possible-match'||candidate.cardActivityIds.length!==1||candidate.cardActivityIds[0]!==pair.cardId)return null;
 const rows=[credit,f.solcard.data.records.find(r=>r.id===pair.cardId),f.runpod.data.records.find(r=>r.id===pair.reloadId)];
 const terms={basis:'dedicated-card-policy-observation-v1',signature:j.signature,cardCreditId:credit.id,invoiceId:deposit.invoiceId,cardDebitId:pair.cardId,reloadId:pair.reloadId,cardCreditMicrousd:deposit.netMicrousd,providerCreditMicrousd:pair.amount,accountRefs:[b.solcard.accountRef,b.runpod.accountRef],recordHashes:rows.map(r=>hash({id:r.id,amount:r.amountMicrousd,at:r.occurredAt,status:r.status}))};
 return {...terms,digest:hash(terms),exactCrossProviderProof:false,spendableCreditMicrousd:'0'};
}

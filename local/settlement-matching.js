// Evidence matching only. This module cannot return a spendable credit receipt.
// Amount/time candidates deliberately remain unverified, including unique ones.
const DAY=86400000;
const amount=v=>{if(typeof v!=='string'||!/^\d{1,12}(\.\d{1,8})?$/.test(v))return null;const [w,f='']=v.split('.');return (BigInt(w)*100000000n+BigInt(f.padEnd(8,'0'))).toString();};
const time=v=>typeof v==='string'?Date.parse(v):NaN;
const shape=items=>items.length===0?'no-candidate':items.length===1?'possible-match':'ambiguous';
export function matchSettlements(feeds,job=null){
 const s=feeds.solcard,p=feeds.runpod,card=s?.fresh?s.data:null,provider=p?.fresh?p.data:null;
 const out={mode:'read-only',state:'review-required',automaticCreditPosting:false,signingEnabled:false,broadcastEnabled:false,
  invoiceCredits:[],reloadCandidates:[],depositCandidates:[],reasons:[],projectCreditMicrousd:'0'};
 if(!card)out.reasons.push('card_records_unavailable_or_stale');
 if(!provider)out.reasons.push('provider_records_unavailable_or_stale');
 if(card?.coverage?.activityHasMore||card?.coverage?.depositsHasMore||card?.coverage?.invoiceDetailsIncomplete)out.reasons.push('card_history_partial');
 for(const r of card?.records??[]){
  const i=r.invoice;
  if(!i||r.status!=='COMPLETED'||BigInt(r.amountMicrousd)<=0n||i.status!=='SUCCESS'||i.paymentStatus!=='PAID')continue;
  // The authenticated activity's invoice ID is a direct provider-internal join.
  // swapUsdAmount is a conversion value, never a substitute for this credit.
  const d=i.detail,refunded=d?.refundPresent===true;
  if(d?.state==='read'&&d.status!=='PAID')continue;
  out.invoiceCredits.push({invoiceId:i.id,cardActivityId:r.id,netMicrousd:r.amountMicrousd,asset:i.asset,
   state:refunded?'refund-review':'provider-linked',basis:'same-invoice-id',projectAttributed:false,
   occurredAt:r.occurredAt,detailState:d?.state??'unavailable'});
  if(job?.chain?.state==='finalized'&&job.terms?.mint===card.assetMint&&job.terms?.slotNumber===1&&d?.state==='read'&&!refunded&&i.asset==='WBTC'&&d.network==='SOLANA'&&d.address===job.terms.recipient&&d.status==='PAID'&&amount(d.paidAmount)===job.terms.amount){
   out.depositCandidates.push({invoiceId:i.id,cardActivityId:r.id,netMicrousd:r.amountMicrousd,state:'possible-match',basis:'same-deposit-address-and-paid-wbtc',signatureVerified:false});
  }
 }
 // A merchant label is a search aid, not a processor reference or identity proof.
 for(const r of provider?.records??[]){
  if(r.status!=='provider-reported-completed'||r.type!=='RELOAD'||r.medium!=='STRIPE'||BigInt(r.amountMicrousd)<=0n)continue;
  const candidates=(card?.records??[]).filter(c=>!c.invoice&&c.status==='COMPLETED'&&BigInt(c.amountMicrousd)<0n&&-BigInt(c.amountMicrousd)===BigInt(r.amountMicrousd)&&/\brunpod\b/i.test(c.description)&&Number.isFinite(time(c.occurredAt))&&Number.isFinite(time(r.occurredAt))&&Math.abs(time(c.occurredAt)-time(r.occurredAt))<=3*DAY);
  out.reloadCandidates.push({reloadId:r.id,amountMicrousd:r.amountMicrousd,state:shape(candidates),cardActivityIds:candidates.map(c=>c.id),basis:'merchant-label-amount-and-time',paymentReferenceVerified:false});
 }
 // One debit cannot identify multiple provider reloads, even when each is unique locally.
 const uses=new Map();for(const r of out.reloadCandidates)for(const id of r.cardActivityIds)uses.set(id,(uses.get(id)??0)+1);
 for(const r of out.reloadCandidates)if(r.cardActivityIds.some(id=>uses.get(id)>1))r.state='ambiguous';
 out.depositState=job?.chain?.state==='finalized'?shape(out.depositCandidates):'awaiting-finalized-transfer';
 out.reasons.push('card_invoice_lacks_deposit_signature','provider_reload_lacks_card_payment_link','card_funds_not_allocated_to_project');
 if(out.depositCandidates.length>1)out.reasons.push('ambiguous_card_deposit');
 if(out.reloadCandidates.some(r=>r.state==='ambiguous'))out.reasons.push('ambiguous_provider_reload');
 return out;
}

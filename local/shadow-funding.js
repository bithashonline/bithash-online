import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {matchSettlements} from './settlement-matching.js';
import {PROVIDER_ACCOUNTING_POLICY,usageCounter,openingProviderAccounting,reconcileProviderAccounting} from './shadow-provider-accounting.js';

const clone=x=>JSON.parse(JSON.stringify(x));
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const signed=v=>{if(typeof v!=='string'||! /^-?(0|[1-9][0-9]{0,17})$/.test(v))throw Error('shadow_invalid_amount');return BigInt(v);};
const nonnegative=v=>{const n=signed(v);if(n<0n)throw Error('shadow_negative_balance');return n;};
const flags={signingEnabled:false,broadcastEnabled:false,paymentsEnabled:false,gpuExperimentsEnabled:false,automaticCreditPosting:false};
export const SHADOW_POLICY=Object.freeze({version:'dedicated-compute-card-shadow-v1',cardUse:'all-funds-for-compute-owner-declared',openingCardOrigin:'opening-compute-funds-origin-unverified',openingRunpod:'excluded-legacy-credit',maxAgeMs:360000,maxFeedSkewMs:60000,acceptance:'policy-reconciled-shadow-only'});
const empty=()=>({mode:'shadow',policy:clone(SHADOW_POLICY),baseline:null,cardRecords:{},providerRecords:{},entries:[],pairs:[],
 cardDeposits:'0',cardAdjustments:'0',cardDebits:'0',providerReloads:'0',proposedProviderFunding:'0',tokenFeeIncome:'0',providerAccounting:null,hold:null,lastCheck:null,observation:null});
const economic=(r,provider)=>provider==='solcard'?{id:r.id,amount:r.amountMicrousd,status:r.status,at:r.occurredAt,description:r.description,invoice:r.invoice?{id:r.invoice.id,asset:r.invoice.asset,amount:r.invoice.amount,status:r.invoice.status,paymentStatus:r.invoice.paymentStatus,refund:r.invoice.detail?.refundPresent??false}:null}:{id:r.id,amount:r.amountMicrousd,status:r.status,at:r.occurredAt,medium:r.medium,type:r.type};
const complete=(r,p)=>r.status===(p==='solcard'?'COMPLETED':'provider-reported-completed');
function feedData(status,now,requireUsage=false){
 if(status?.mode!=='read-only')throw Error('shadow_read_only_records_required');
 if(status.busy)throw Error('shadow_records_unavailable_or_stale');
 const out={};for(const p of ['solcard','runpod']){
  const f=status.feeds?.[p],d=f?.data,at=Date.parse(d?.observedAt);
  if(f?.state!=='connected'||f.fresh!==true||d?.connection!=='authenticated-api'||d.provider!==p||!Number.isFinite(at)||at>now||now-at>SHADOW_POLICY.maxAgeMs)throw Error('shadow_records_unavailable_or_stale');
  if(!/^[a-f0-9]{64}$/.test(d.accountRef??''))throw Error('shadow_account_identity_missing');
  nonnegative(d.balanceMicrousd);if(!Array.isArray(d.records)||d.records.length>1000)throw Error('shadow_history_limit');
  const seen=new Set();for(const r of d.records){if(typeof r.id!=='string'||! /^[a-zA-Z0-9_-]{1,128}$/.test(r.id)||seen.has(r.id))throw Error('shadow_record_identity_invalid');seen.add(r.id);signed(r.amountMicrousd);if(r.occurredAt!==null&&!Number.isFinite(Date.parse(r.occurredAt)))throw Error('shadow_invalid_record_date');}
  out[p]=d;
 }
 if(Math.abs(Date.parse(out.solcard.observedAt)-Date.parse(out.runpod.observedAt))>SHADOW_POLICY.maxFeedSkewMs)throw Error('shadow_feed_time_skew');
 if(out.solcard.cardStatus!=='ACTIVE')throw Error('shadow_card_not_active');
 if(out.solcard.coverage?.activityHasMore!==false||out.solcard.coverage?.depositsHasMore!==false)throw Error('shadow_card_history_partial');
 const start=Date.parse(out.runpod.coverage?.start),end=Date.parse(out.runpod.coverage?.end);
 if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end||end>Date.parse(out.runpod.observedAt)||Date.parse(out.runpod.observedAt)-end>60000)throw Error('shadow_provider_window_missing');
 if(requireUsage)usageCounter(out.runpod);
 return out;
}
function nextRecords(w,d,provider){
 const key=provider==='solcard'?'cardRecords':'providerRecords',old=w[key],next={},newCompleted=[],revisions=[];
 for(const r of d.records){
  const value=economic(r,provider),digest=hash(value),recordKey='record-'+r.id,prior=old[recordKey];
  if(prior?.completed&&prior.digest!==digest){
   const oldValue=prior.value;
   if(provider!=='runpod'||!w.providerAccounting||!oldValue||oldValue.type!=='RELOAD'||oldValue.medium!=='STRIPE'||value.type!==oldValue.type||value.medium!==oldValue.medium||value.status!==oldValue.status||value.at!==oldValue.at||signed(value.amount)<0n||signed(value.amount)>=signed(oldValue.amount))throw Error('shadow_settled_record_changed');
   revisions.push({id:r.id,reduction:String(signed(oldValue.amount)-signed(value.amount)),previousAmount:oldValue.amount,nextAmount:value.amount});
  }
  if(!prior&&Date.parse(r.occurredAt)<=Date.parse(w.baseline[provider].observedAt))throw Error('shadow_history_backfill');
  if(complete(r,provider)&&!prior?.completed){if(!Number.isFinite(Date.parse(r.occurredAt))||Date.parse(r.occurredAt)>Date.parse(d.observedAt))throw Error('shadow_record_after_observation');newCompleted.push(r);}
  next[recordKey]={digest,completed:complete(r,provider),occurredAt:r.occurredAt,...(provider==='runpod'?{value}:{})};
 }
 for(const [id,prior] of Object.entries(old))if(!next[id]){
  // A rolling provider window may remove old entries; losing any tracked history
  // requires review instead of silently assuming it cannot contain reversals.
  throw Error('shadow_tracked_record_missing');
 }
 return {key,next,newCompleted,revisions};
}
function evaluate(w,status,now,requireUsage=false){
 const d=feedData(status,now,requireUsage||!!w.providerAccounting);
 if(w.lastCheck&&now<Date.parse(w.lastCheck))throw Error('shadow_clock_rollback');
 const observed={at:new Date(now).toISOString(),cardBalance:d.solcard.balanceMicrousd,providerBalance:d.runpod.balanceMicrousd,cardObservedAt:d.solcard.observedAt,providerObservedAt:d.runpod.observedAt};
 if(!w.baseline){
  if(d.solcard.records.some(r=>!complete(r,'solcard'))||d.runpod.records.some(r=>!complete(r,'runpod')))throw Error('shadow_pending_records_at_baseline');
  w.baseline=Object.fromEntries(['solcard','runpod'].map(p=>[p,{accountRef:d[p].accountRef,balance:d[p].balanceMicrousd,observedAt:d[p].observedAt}]));
  for(const [p,key] of [['solcard','cardRecords'],['runpod','providerRecords']])for(const r of d[p].records){if(!r.occurredAt||Date.parse(r.occurredAt)>Date.parse(d[p].observedAt))throw Error('shadow_record_after_observation');w[key]['record-'+r.id]={digest:hash(economic(r,p)),completed:true,occurredAt:r.occurredAt,...(p==='runpod'?{value:economic(r,p)}:{})};}
  w.entries.push({id:'opening-baseline',kind:'owner-designated-compute-baseline',at:observed.at,cardAmount:d.solcard.balanceMicrousd,excludedProviderAmount:d.runpod.balanceMicrousd,tokenFeeIncome:'0'});
  if(d.runpod.usage)w.providerAccounting=openingProviderAccounting(d.runpod,observed.at);
 }else{
  for(const p of ['solcard','runpod']){if(d[p].accountRef!==w.baseline[p].accountRef)throw Error('shadow_account_changed');if(Date.parse(d[p].observedAt)<Date.parse(w.observation[p==='solcard'?'cardObservedAt':'providerObservedAt']))throw Error('shadow_observation_regressed');}
  const card=nextRecords(w,d.solcard,'solcard'),provider=nextRecords(w,d.runpod,'runpod');
  if(d.solcard.records.some(r=>!complete(r,'solcard'))||d.runpod.records.some(r=>!complete(r,'runpod')))throw Error('shadow_unsettled_activity');
  const delta=card.newCompleted.reduce((a,r)=>a+signed(r.amountMicrousd),0n);
  const expectedCard=nonnegative(w.observation.cardBalance)+delta;
  if(expectedCard!==nonnegative(d.solcard.balanceMicrousd))throw Error('shadow_card_balance_mismatch');
  let providerEvents;
  if(!w.providerAccounting&&d.runpod.usage){
   if(provider.newCompleted.length||provider.revisions.length||w.observation.providerBalance!==d.runpod.balanceMicrousd)throw Error('shadow_provider_usage_baseline_needs_review');
   w.providerAccounting=openingProviderAccounting(d.runpod,observed.at);
   w.entries.push({id:'provider-usage-baseline',kind:'provider-usage-counter-baseline',amount:'0',at:observed.at});
  }
  if(w.providerAccounting)providerEvents=reconcileProviderAccounting(w,d.runpod,provider.newCompleted,provider.revisions,observed.at);
  else{
   const deltaProvider=provider.newCompleted.reduce((a,r)=>{if(r.type!=='RELOAD'||r.medium!=='STRIPE'||signed(r.amountMicrousd)<=0n)throw Error('shadow_provider_adjustment_needs_review');return a+signed(r.amountMicrousd);},0n);
   if(nonnegative(w.observation.providerBalance)+deltaProvider!==nonnegative(d.runpod.balanceMicrousd))throw Error('shadow_provider_usage_or_adjustment_unexplained');
   providerEvents=provider.newCompleted.map(r=>({id:'provider-'+r.id,recordId:r.id,kind:'provider-reload-unattributed',amount:r.amountMicrousd,at:r.occurredAt}));
  }
  if(w.entries.length+card.newCompleted.length+providerEvents.length>1000)throw Error('shadow_history_limit');
  for(const r of card.newCompleted){
   const n=signed(r.amountMicrousd),kind=n>0n&&r.invoice?'compute-deposit-origin-unverified':n>0n?'compute-positive-adjustment-unclassified':n<0n?'compute-card-debit':'zero-activity';
   if(n>0n&&r.invoice)w.cardDeposits=String(nonnegative(w.cardDeposits)+n);else if(n>0n)w.cardAdjustments=String(nonnegative(w.cardAdjustments)+n);else w.cardDebits=String(nonnegative(w.cardDebits)-n);
   w.entries.push({id:'card-'+r.id,recordId:r.id,kind,amount:r.amountMicrousd,at:r.occurredAt,source:'authenticated-card-record',tokenFeeIncome:'0'});
  }
  for(const e of providerEvents){if(e.kind==='provider-reload-unattributed')w.providerReloads=String(nonnegative(w.providerReloads)+signed(e.amount));w.entries.push(e);}
  w[card.key]=card.next;w[provider.key]=provider.next;
  // Consider only activity accepted after this shadow baseline. Opening reloads
  // never become new project income. This is policy inference, not a shared ID.
  const matches=matchSettlements(status.feeds),used=new Set(w.pairs.map(p=>p.cardId));
  const eligible=matches.reloadCandidates.filter(r=>!w.providerAccounting?.reducedReloads['record-'+r.reloadId]&&!w.pairs.some(p=>p.reloadId===r.reloadId)&&w.entries.some(e=>e.id==='provider-'+r.reloadId));
  if(eligible.some(r=>r.state==='ambiguous'))throw Error('shadow_ambiguous_reload');
  const unresolved=eligible.filter(r=>r.state==='possible-match'&&r.cardActivityIds.length===1&&w.entries.some(e=>e.id==='card-'+r.cardActivityIds[0]));
  if(unresolved.length>1)throw Error('shadow_multiple_funding_paths');
  for(const r of unresolved){const cardId=r.cardActivityIds[0];if(used.has(cardId))throw Error('shadow_card_debit_reused');used.add(cardId);w.pairs.push({reloadId:r.reloadId,cardId,amount:r.amountMicrousd,proof:SHADOW_POLICY.acceptance,at:observed.at});w.proposedProviderFunding=String(nonnegative(w.proposedProviderFunding)+nonnegative(r.amountMicrousd));}
 }
 w.observation=observed;w.lastCheck=observed.at;
 const balance=nonnegative(w.baseline.solcard.balance)+nonnegative(w.cardDeposits)+nonnegative(w.cardAdjustments)-nonnegative(w.cardDebits);
 if(balance!==nonnegative(observed.cardBalance))throw Error('shadow_card_conservation');
 if(w.providerAccounting){const p=w.providerAccounting,expected=nonnegative(w.baseline.runpod.balance)+nonnegative(w.providerReloads)+nonnegative(p.creditAdjustments)-nonnegative(p.debitAdjustments)-nonnegative(p.reloadReversals)-nonnegative(p.usage)+nonnegative(p.usageReversals)+signed(p.rounding);if(expected!==nonnegative(observed.providerBalance))throw Error('shadow_provider_conservation');}
}

// Shadow ledger has no reference to the real treasury, signer or provider writes.
export class ShadowFunding{
 #db;#records;#clock;#timer=null;#requireUsage;
 constructor(path,{records,clock=Date.now,requireUsage=false}={}){
  this.#requireUsage=requireUsage;
  if(!records?.status)throw Error('shadow_records_required');this.#records=records;this.#clock=clock;
  this.#db=new DatabaseSync(path);const tables=this.#db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();if(tables.some(t=>t.name!=='shadow_funding_state')){this.#db.close();throw Error('shadow_database_required');}
  this.#db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS shadow_funding_state(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL);');
  this.#db.prepare('INSERT OR IGNORE INTO shadow_funding_state VALUES(1,?)').run(JSON.stringify(empty()));const w=this.get();if(w.mode!=='shadow'||hash(w.policy)!==hash(SHADOW_POLICY)){this.#db.close();throw Error('shadow_policy_mismatch');}
 }
 get(){return JSON.parse(this.#db.prepare('SELECT body FROM shadow_funding_state WHERE id=1').get().body);}
 refresh(){
  this.#db.exec('BEGIN IMMEDIATE');try{
   const saved=this.get(),now=this.#clock();let w=clone(saved);
   if(!saved.hold?.latched){try{if(saved.providerGapSince&&now<Date.parse(saved.providerGapSince))throw Error('shadow_clock_rollback');evaluate(w,this.#records.status(),now,this.#requireUsage);w.hold=null;w.providerGapSince=null;}catch(e){w=clone(saved);const reason=/^shadow_[a-z_]+$/.test(e.message)?e.message:'shadow_observation_failed';const transient=['shadow_records_unavailable_or_stale','shadow_feed_time_skew','shadow_card_history_partial','shadow_unsettled_activity','shadow_pending_records_at_baseline','shadow_account_identity_missing','shadow_provider_usage_unavailable'];const pending=reason==='shadow_provider_balance_pending',since=pending?(saved.providerGapSince??new Date(now).toISOString()):new Date(now).toISOString();if(pending)w.providerGapSince=since;w.hold={reason,latched:pending?now-Date.parse(since)>=PROVIDER_ACCOUNTING_POLICY.balanceGraceMs:!transient.includes(reason),at:since};}}
   this.#db.prepare('UPDATE shadow_funding_state SET body=? WHERE id=1').run(JSON.stringify(w));this.#db.exec('COMMIT');return this.status();
  }catch(e){this.#db.exec('ROLLBACK');throw e;}
 }
 status(){const w=this.get();let currentReason=null;try{feedData(this.#records.status(),this.#clock(),this.#requireUsage||!!w.providerAccounting);}catch(e){currentReason=/^shadow_[a-z_]+$/.test(e.message)?e.message:'shadow_observation_failed';}
  return {mode:'shadow',running:!!this.#timer,...flags,policy:w.policy,state:w.hold||currentReason?'held':w.baseline?'watching':'awaiting-baseline',currentReason,ledger:w,proposedSpendableCredit:'0',tokenFeeIncome:'0'};
 }
 start(){if(this.#timer)return;this.refresh();this.#timer=setInterval(()=>{try{this.refresh();}catch{}},60000);this.#timer.unref();}
 close(){clearInterval(this.#timer);this.#timer=null;this.#db.close();}
}

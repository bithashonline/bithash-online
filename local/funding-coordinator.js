import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {decideCoordinatorFunding} from './coordinator-reload-policy.js';
import {applySampleOutcome,sampleTerminal,allocationHeld} from './coordinator-sample-lifecycle.js';
import {fundingRecordBaseline,assessFundingCompletion,completedObservation,releasedObservation} from './funding-completion.js';
import {planFleetBudget,FLEET_POLICY} from './fleet-budget.js';
import {WBTC,feeAllocation} from './treasury-compute.js';
import {DisabledRestrictedFundingSigner} from './restricted-wallet-signer.js';
import {decode58} from './solana-evidence.js';
import {autoPayObservation,AUTOPAY_POLICY} from './runpod-autopay-simulation.js';

const clone=v=>structuredClone(v),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const n=v=>{if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,23})$/.test(v))throw Error('coordinator_invalid_amount');return BigInt(v);};
const fresh=(at,now)=>Number.isFinite(Date.parse(at))&&now>=Date.parse(at)&&now-Date.parse(at)<=300000;
const max0=v=>v>0n?v:0n,min=(a,b)=>a<b?a:b;
const terminal=j=>sampleTerminal(j)||completedObservation(j)||releasedObservation(j);
const heldAllocation=j=>allocationHeld(j)&&!releasedObservation(j);
export const COORDINATOR_FLAGS=Object.freeze({signingEnabled:false,broadcastEnabled:false,paymentsEnabled:false,rentalExecutionEnabled:false,gpuExperimentsEnabled:false,automaticCreditPosting:false});
const empty=kind=>({version:1,evidenceKind:kind,identity:null,receipts:{},jobs:[],hold:null,view:null,events:[],lastCheck:null});
const transient=new Set(['coordinator_observers_busy','coordinator_records_stale','coordinator_shadow_not_ready','coordinator_fee_history_unready']);
function stage(id,state,detail){return {id,state,detail};}
function validateSources(s,kind){
 if(s.evidenceKind!==kind||s.treasury?.mode!=='owner-recorded'||s.automatic?.mode!=='dry-run'||s.collection?.mode!=='read-only'||s.records?.mode!=='read-only'||s.production?.mode!=='observe-only'||s.shadow?.mode!=='shadow')throw Error('coordinator_source_mode_mismatch');
 for(const source of [s.automatic,s.collection,s.production,s.shadow])for(const flag of Object.keys(COORDINATOR_FLAGS))if(source[flag]===true)throw Error('coordinator_execution_enabled');
 if(s.production.signer?.keyLoaded||s.production.signer?.signingEnabled||s.production.signer?.broadcastEnabled)throw Error('coordinator_execution_enabled');
}
function importReceipts(w,a){
 if(!Array.isArray(a.receipts)||a.receipts.length>10000||a.receiptCount!==a.receipts.length)throw Error('coordinator_receipt_coverage_mismatch');
 const seen=new Set();let total=0n;
 for(const r of a.receipts){
  if(typeof r.id!=='string'||!/^[1-9A-HJ-NP-Za-km-z]{64,88}:\d{1,3}$/.test(r.id)||r.id!==r.signature+':'+r.instructionIndex||seen.has(r.id)||r.source!=='finalized-pump-v2'||r.projectMint!==a.configuration.projectMint||r.quoteMint!==WBTC.mint||r.computeWallet!==a.configuration.computeWallet||r.otherWallet!==a.configuration.otherWallet||!Number.isSafeInteger(r.slot)||r.slot<=0)throw Error('coordinator_receipt_identity_invalid');
  seen.add(r.id);const allocation=feeAllocation(r.totalUnits);
  decode58(r.signature,64);
  if(allocation.compute!==r.computeUnits||allocation.other!==r.otherUnits||!n(r.computeUnits))throw Error('coordinator_receipt_allocation_invalid');
  const key='receipt-'+r.id,encoded=hash(r);if(w.receipts[key]&&w.receipts[key].hash!==encoded)throw Error('coordinator_receipt_changed');
  w.receipts[key]={hash:encoded,id:r.id,units:r.computeUnits};total+=n(r.computeUnits);
 }
 for(const receipt of Object.values(w.receipts))if(!seen.has(receipt.id))throw Error('coordinator_receipt_disappeared');
 if(total!==n(a.detectedComputeUnits)||total!==n(a.input.feeComputeUnits))throw Error('coordinator_receipt_total_mismatch');
 return total;
}
function projectedBudget(s,now){
 const w=s.shadow.ledger,p=w.providerAccounting,provider=s.records.feeds.runpod.data;
 if(!p)throw Error('coordinator_usage_accounting_missing');
 // Conservative pooled compute projection: exclude opening credit and positive
 // provider adjustments; subtract ALL account usage/debits, never invent origin.
 let credit=max0(n(w.proposedProviderFunding)-n(p.matchedReloadReversals)-max0(n(p.usage)-n(p.usageReversals))-n(p.debitAdjustments));
 credit=min(credit,n(provider.balanceMicrousd));
 const quote=s.quote,quoteOK=quote&&quote.source==='provider-read-only'&&fresh(quote.observedAt,now);
 const result=planFleetBudget({creditMicrousd:String(credit),spentMicrousd:'0',reservedMicrousd:s.treasury.reservedMicrousd,dayCommittedMicrousd:s.treasury.reservedMicrousd,activeSession:(s.treasury.reservations??[]).some(r=>r.state==='reserved'),gpuHourlyMicrousd:quoteOK?quote.hourlyMicrousd:'0',baselineHourlyMicrousd:quoteOK?quote.baselineMicrousd:'0',fundingVerified:credit>0n,feedFresh:!!quoteOK,balanceConsistent:true},FLEET_POLICY);
 if(n(s.treasury.spentMicrousd??'0')>0n){result.action='hold';result.gpuCount=0;result.reservationMicrousd='0';result.reasons.push('rolling_fleet_commitments_unavailable');}
 return {...result,mode:'dry-run',action:result.action==='start-simulated-session'?'would-propose-fleet':result.action,reasons:[...result.reasons,...(!quoteOK?['read_only_gpu_quote_not_connected']:[])],projectedCreditMicrousd:String(credit),spendableCreditMicrousd:'0',basis:'policy-inferred pooled compute funds; fee-to-payment attribution remains unverified',quoteSource:quote?.source??null,...COORDINATOR_FLAGS};
}
function evaluate(w,s,now){
 validateSources(s,w.evidenceKind);
 const a=s.automatic,c=a.configuration,at=new Date(now).toISOString();
 const stages=[stage('collection',s.collection.observation?.state??'awaiting-token-launch','Read-only fee collection preview; never claims fees.')];
 const view={state:'awaiting-token-launch',evaluatedAt:at,stages,decision:null,budget:null,autopay:autoPayObservation(s.records,s.planningHourlyMicrousd??a.policy?.hourlyMicrousd??'0',now),reasons:[],detectedComputeUnits:'0',dryReservedWbtcUnits:String(w.jobs.reduce((v,j)=>v+n(j.amount),0n))};
 if(!c){if(w.identity)throw Error('coordinator_configuration_removed');view.reasons=['awaiting_project_token_mint'];stages.push(stage('fees','awaiting-token-launch','No token mint configured; no receipt or funding job invented.'));return view;}
 if(hash(c)!==hash(s.collection.configuration)||c.computeWallet!==s.treasury.wallets?.computeWallet||c.otherWallet!==s.treasury.wallets?.otherWallet||a.input?.projectMint!==c.projectMint)throw Error('coordinator_configuration_mismatch');
 if(w.identity&&hash(c)!==hash(w.identity))throw Error('coordinator_identity_changed');
 if(a.busy||s.records.busy||s.production.busy)throw Error('coordinator_observers_busy');
 if(s.production.lastError&&!['coordinator_handoff_unavailable','coordinator_handoff_stale','coordinator_handoff_waiting'].includes(s.production.lastError))throw Error('coordinator_production_import_error');
 if(a.feeError||!a.feeObservation?.complete||!a.feeObservation.routingVerified||!fresh(a.feeObservation.observedAt,now))throw Error('coordinator_fee_history_unready');
 if(!Object.values(s.records.feeds).every(f=>f.state==='connected'&&f.fresh&&fresh(f.data?.observedAt,now)))throw Error('coordinator_records_stale');
 if(s.shadow.state!=='watching'||s.shadow.currentReason||s.shadow.ledger.hold||!fresh(s.shadow.ledger.lastCheck,now))throw Error('coordinator_shadow_not_ready');
 w.identity=clone(c);view.detectedComputeUnits=String(importReceipts(w,a));
 stages.push(stage('fees','observed',a.receiptCount+' finalized distributions; trading-fee origin is not independently proven.'));
 const profile=s.profile,effectivePolicy={...a.policy,hourlyMicrousd:s.planningHourlyMicrousd??a.policy.hourlyMicrousd},policyHash=hash({version:2,policy:effectivePolicy,reload:AUTOPAY_POLICY});
 if(w.jobs.some(j=>j.owner!==c.computeWallet||j.recipient!==profile?.depositAddress||j.policyHash!==policyHash))throw Error('coordinator_job_terms_changed');
 const active=w.jobs.filter(j=>!terminal(j)),committed=w.jobs.filter(heldAllocation).reduce((sum,j)=>sum+n(j.amount),0n),dayJobs=w.jobs.filter(j=>now-Date.parse(j.createdAt)<=86400000),day=dayJobs.reduce((sum,j)=>sum+n(j.amount),0n);
 const input={...a.input,sample:false,committedUnits:String(n(a.input.committedUnits)+committed),dailyCommittedUnits:String(n(a.input.dailyCommittedUnits)+day),pendingFunding:a.input.pendingFunding||active.length>0};
 const decision=decideCoordinatorFunding(input,effectivePolicy,now,{dailyDepositMicrousd:String(dayJobs.reduce((v,j)=>v+n(j.estimatedUsdMicros),0n))});view.decision=decision;
 if(decision.action==='would_top_up_solcard'&&!active.length){
  if(w.jobs.length>=1000)throw Error('coordinator_history_full');
  if(n(a.input.committedUnits)>0n)throw Error('coordinator_manual_commitments_need_attribution');
  if(!profile?.depositAddress||!profile.policy) {view.reasons.push('owner_funding_limits_not_configured');}
  else {
   const amount=decision.amountWbtcUnits,allocations=[];let left=n(amount);
   for(const r of Object.values(w.receipts).sort((x,y)=>x.id.localeCompare(y.id))){
    const used=w.jobs.filter(heldAllocation).flatMap(j=>j.allocations).filter(x=>x.receiptId===r.id).reduce((v,x)=>v+n(x.units),0n);
    if(used>n(r.units))throw Error('coordinator_receipt_reservation_shortfall');
    const take=min(left,n(r.units)-used);if(take)allocations.push({receiptId:r.id,units:String(take),startUnits:String(used)});left-=take;if(!left)break;
   }
   if(left)throw Error('coordinator_receipt_reservation_shortfall');
   const id='coord-'+hash({identity:c,allocations,amount,recipient:profile.depositAddress,policyHash,sequence:w.jobs.length}).slice(0,24);
   const terms={owner:c.computeWallet,recipient:profile.depositAddress,amount,policy:clone(profile.policy)};
   const inspection=new DisabledRestrictedFundingSigner().inspect(terms);
   if(inspection.reasons.length||n(amount)+day+n(a.input.dailyCommittedUnits)>n(profile.policy.maxDailyWbtcUnits))throw Error('coordinator_owner_limit_exceeded');
   w.jobs.push({id,mode:'dry-run',createdAt:at,amount,estimatedUsdMicros:decision.estimatedUsdMicros,owner:terms.owner,recipient:terms.recipient,mint:WBTC.mint,policyHash,fundingPolicyHash:hash(profile.policy),allocations,inspection,state:'signing-disabled',signature:null,productionJobId:null,reasons:['signing_disabled','broadcast_disabled'],events:[{at,kind:'dry-funding-intent-created'}]});
   w.jobs.at(-1).recordBaseline=fundingRecordBaseline(s.records);
  }
 }
 for(const j of w.jobs){
  if(j.fundingPolicyHash!==hash(profile.policy))throw Error('coordinator_job_terms_changed');
  if(j.sampleLifecycle){if(w.evidenceKind!=='sample-fixtures')throw Error('coordinator_source_mode_mismatch');continue;}
  const linked=s.production.jobs.filter(p=>p.planId===j.id);
  if(linked.length>1)throw Error('coordinator_job_link_ambiguous');
  if(j.productionJobId&&!linked.length)throw Error('coordinator_production_job_disappeared');
  if(linked.length){
   const p=linked[0];if(p.terms.owner!==j.owner||p.terms.recipient!==j.recipient||p.terms.amount!==j.amount||p.terms.mint!==j.mint||p.mode!=='observe-only')throw Error('coordinator_production_terms_mismatch');
   if(p.signature)decode58(p.signature,64);
   if(j.signature&&p.signature!==j.signature)throw Error('coordinator_signature_changed');
   j.productionJobId=p.id;j.signature=p.signature;
   j.chainObservation=p.reconciliation?.chain??null;
   j.state=p.reconciliation?.chain?.state==='finalized'?'awaiting-settlement-attribution':p.signature?'awaiting-chain':'signing-disabled';
   j.reasons=p.reconciliation?.chain?.state==='finalized'?['card_credit_signature_binding_missing','runpod_payment_link_missing']:['signing_disabled','broadcast_disabled'];
   if(p.origin==='coordinator-dry-run'&&!p.signature){j.state=p.state;j.reasons=[...p.reasons];}
   if(p.state==='chain-failed'&&j.chainObservation?.state==='failed'&&p.signature){j.state='finalized-transfer-failed';j.reasons=['finalized_failed_transfer_releases_wbtc_only'];}
   else if(['chain-failed','review-required','complete'].includes(p.state))throw Error('coordinator_production_requires_review');
   const completion=assessFundingCompletion(j,s,w.jobs,now);
   if(j.completion&&completion?.digest!==j.completion.digest)throw Error('coordinator_completion_changed');
   if(completion){j.completion=completion;j.state='policy-complete-observation';j.reasons=['dedicated_card_policy_observation_only','no_spendable_credit_posted'];}
  }
 }
 const pending=w.jobs.filter(j=>!terminal(j));
 view.dryReservedWbtcUnits=String(pending.reduce((v,j)=>v+n(j.amount),0n));
 view.sampleConsumedWbtcUnits=String(w.jobs.filter(j=>j.state==='sample-complete').reduce((v,j)=>v+n(j.amount),0n));
 stages.push(stage('funding',pending.length?'intent-recorded':decision.action,pending.length?'One persistent pending dry-run intent. No real treasury plan or reservation written.':decision.reasons.join(', ')));
 stages.push(stage('transfer',pending[0]?.state??'not-requested','Restricted inspection only; no signing key, transaction submission or fabricated signature.'));
 stages.push(stage('settlement','policy-projection-only','Read-only card and Runpod ledger connected. No per-job deposit/payment binding or production credit acceptance.'));
 view.budget=projectedBudget(s,now);stages.push(stage('fleet',view.budget.action,view.budget.basis));
 view.state=pending.length?'intent-recorded':'observing';view.reasons.push(...decision.reasons);return view;
}

// Receives one snapshot function, never treasury mutations, signer keys, payment
// clients or rental executors. Durable intent is NOT an authorization to spend.
export class FundingCoordinator {
 #db;#observe;#clock;#timer=null;#kind;
 constructor(path,{observe,clock=Date.now,evidenceKind='real-records'}={}){
  if(typeof observe!=='function'||!['real-records','sample-fixtures'].includes(evidenceKind))throw Error('coordinator_configuration_invalid');
  this.#observe=observe;this.#clock=clock;this.#kind=evidenceKind;this.#db=new DatabaseSync(path);
  const tables=this.#db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  if(tables.some(t=>t.name!=='funding_coordinator')){this.#db.close();throw Error('coordinator_separate_database_required');}
  this.#db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS funding_coordinator(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL);');
  this.#db.prepare('INSERT OR IGNORE INTO funding_coordinator VALUES(1,?)').run(JSON.stringify(empty(evidenceKind)));
  if(this.get().evidenceKind!==evidenceKind||this.get().version!==1){this.#db.close();throw Error('coordinator_database_mode_mismatch');}
 }
 get(){return JSON.parse(this.#db.prepare('SELECT body FROM funding_coordinator WHERE id=1').get().body);}
 handoffSnapshot(){const w=this.get();return {...this.status(),schema:'bithash.coordinator-handoff.v1',checkedAt:w.lastCheck,identity:w.identity,receipts:w.receipts};}
 applySampleOutcome(id,evidence){
  if(this.#kind!=='sample-fixtures')throw Error('coordinator_sample_only');
  this.#db.exec('BEGIN IMMEDIATE');try{
   const next=this.get(),changed=applySampleOutcome(next,id,evidence,this.#clock());
   // Do not create the next intent until a subsequent observation tick.
   if(changed){next.view=null;this.#db.prepare('UPDATE funding_coordinator SET body=? WHERE id=1').run(JSON.stringify(next));}
   this.#db.exec('COMMIT');return this.status();
  }catch(e){this.#db.exec('ROLLBACK');throw e;}
 }
 tick(){
  this.#db.exec('BEGIN IMMEDIATE');try{
   const old=this.get();let next=clone(old);const now=this.#clock();
   if(!old.hold?.latched){try{if(old.lastCheck&&now<Date.parse(old.lastCheck))throw Error('coordinator_clock_rollback');next.view=evaluate(next,this.#observe(),now);next.hold=null;next.lastCheck=new Date(now).toISOString();}
    catch(e){next=clone(old);const reason=/^coordinator_[a-z_]+$/.test(e.message)?e.message:'coordinator_observation_invalid';next.hold={reason,latched:!transient.has(reason),at:new Date(now).toISOString()};}
    const change=hash({view:next.view?{...next.view,evaluatedAt:null}:null,hold:next.hold?.reason,jobs:next.jobs});
    if(next.events.at(-1)?.digest!==change){next.events.push({at:new Date(now).toISOString(),digest:change,state:next.hold?'held':next.view.state,reason:next.hold?.reason??null});next.events=next.events.slice(-100);}
   }
   this.#db.prepare('UPDATE funding_coordinator SET body=? WHERE id=1').run(JSON.stringify(next));this.#db.exec('COMMIT');return this.status();
  }catch(e){this.#db.exec('ROLLBACK');throw e;}
 }
 status(){const w=this.get(),stale=!fresh(w.lastCheck,this.#clock()),view=clone(w.view);
  if((w.hold||stale)&&view){const reason=w.hold?.reason??'coordinator_view_stale';if(view.autopay)view.autopay={...view.autopay,action:'hold',reason,cardFundingMicrousd:'0'};if(view.decision)view.decision={...view.decision,action:'hold',amountWbtcUnits:'0',reasons:[reason]};if(view.budget)view.budget={...view.budget,action:'hold',gpuCount:0,reservationMicrousd:'0',reasons:[reason]};}
  return {mode:'dry-run',evidenceKind:this.#kind,running:!!this.#timer,...COORDINATOR_FLAGS,state:w.hold?'held':w.view?.state??'awaiting-observation',hold:w.hold,stale,view,jobs:w.jobs,receiptCount:Object.keys(w.receipts).length,history:w.events.slice(-10),realPlansCreated:0,realCreditPostedMicrousd:'0'};
 }
 start(){if(this.#timer)return;this.tick();this.#timer=setInterval(()=>{try{this.tick();}catch{}},60000);this.#timer.unref();}
 close(){clearInterval(this.#timer);this.#timer=null;this.#db.close();}
}

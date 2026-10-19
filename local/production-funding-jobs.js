import {DatabaseSync} from 'node:sqlite';
import {Transaction} from '@solana/web3.js';
import {WBTC} from './treasury-compute.js';
import {validateFundingProfile} from './treasury-funding.js';
import {decode58} from './solana-evidence.js';
import {DisabledRestrictedFundingSigner,inspectRestrictedTransfer,sha256,fundingUnits} from './restricted-wallet-signer.js';
import {readFundingTransactionBySignature,verifyFundingTransaction} from './funding-reconciler.js';
import {preflightView} from './funding-preflight.js';
import {HANDOFF_ORIGIN,handoffEnvelope,handoffPlan,handoffTransient} from './funding-handoff.js';

const clone=v=>JSON.parse(JSON.stringify(v));
const hash=v=>sha256(JSON.stringify(v));
const safeError=e=>/^[a-z_]{1,80}$/.test(e?.message)?e.message:'funding_observation_unavailable';
const sourceTerms=p=>({id:p.id,amount:p.amount,route:p.route,source:p.source,createdAt:p.createdAt});
const fresh=(at,now)=>Number.isFinite(Date.parse(at))&&now>=Date.parse(at)&&now-Date.parse(at)<=300000;

// Observe-only jobs over owner-recorded plans and coordinator dry-run intents.
// No ledger mutation, signer key, payment client or GPU executor is used here.
export class ProductionFundingJobs {
 #db;#treasury;#records;#reconciler;#preflight;#coordinator;#signer=new DisabledRestrictedFundingSigner();#read;#clock;#timer=null;#busy=false;#stopped=true;
 constructor(path,{treasury,records,reconciler,preflight=null,coordinator=null,readTransaction=readFundingTransactionBySignature,clock=Date.now}={}){
  if(treasury?.mode!=='owner-recorded'||reconciler?.status().mode!=='observe-only')throw Error('real_observe_only_dependencies_required');
  this.#treasury=treasury;this.#records=records;this.#reconciler=reconciler;this.#read=readTransaction;this.#clock=clock;
  this.#preflight=preflight;
  if(coordinator!==null&&typeof coordinator!=='function')throw Error('coordinator_callback_required');this.#coordinator=coordinator;
  this.#db=new DatabaseSync(path);
  const tables=this.#db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  if(tables.some(t=>!['production_funding_meta','production_funding_jobs'].includes(t.name))){this.#db.close();throw Error('production_observer_database_required');}
  this.#db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS production_funding_meta(k TEXT PRIMARY KEY,v TEXT NOT NULL); CREATE TABLE IF NOT EXISTS production_funding_jobs(id TEXT PRIMARY KEY,plan TEXT UNIQUE NOT NULL,signature TEXT UNIQUE,body TEXT NOT NULL);');
  const mode=this.#meta('mode');if(mode&&mode!=='observe-only'){this.#db.close();throw Error('production_observer_mode_mismatch');}this.#setMeta('mode','observe-only');
 }
 #meta(k){const row=this.#db.prepare('SELECT v FROM production_funding_meta WHERE k=?').get(k);return row?JSON.parse(row.v):null;}
 #setMeta(k,v){this.#db.prepare('INSERT INTO production_funding_meta VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k,JSON.stringify(v));}
 get(id){const r=this.#db.prepare('SELECT body FROM production_funding_jobs WHERE id=?').get(id);return r?JSON.parse(r.body):null;}
 #save(j){this.#db.prepare('UPDATE production_funding_jobs SET signature=?,body=? WHERE id=?').run(j.signature??null,JSON.stringify(j),j.id);}
 #event(j,kind){j.events.push({at:new Date(this.#clock()).toISOString(),kind});j.events=j.events.slice(-100);}
 #binding(plan){
  if(plan?.source===HANDOFF_ORIGIN){
   if(this.#treasury.getPlan(plan.id))throw Error('coordinator_handoff_plan_collision');
   const profile=validateFundingProfile(this.#treasury.setting('fundingProfile')),wallets=this.#treasury.setting('wallets'),h=plan.handoff;
   if(wallets?.computeWallet!==h.owner||wallets?.otherWallet!==h.identity.otherWallet||profile.depositAddress!==h.recipient||hash(profile.policy)!==h.fundingPolicyHash)throw Error('funding_destination_or_policy_changed');
   return {planId:plan.id,owner:h.owner,recipient:h.recipient,amount:h.amount,mint:WBTC.mint,network:'solana-mainnet',slotNumber:1,policy:profile.policy};
  }
  if(plan?.source!=='owner-recorded'||plan.route!=='solcard-wbtc'||plan.funding?.terms?.network==='simulation')throw Error('owner_recorded_funding_plan_required');
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(plan.id)||!fundingUnits(plan.amount))throw Error('invalid_funding_plan');
  const profile=validateFundingProfile(this.#treasury.setting('fundingProfile'));
  const owner=this.#treasury.setting('wallets')?.computeWallet;decode58(owner,32);
  return {planId:plan.id,owner,recipient:profile.depositAddress,amount:plan.amount,mint:WBTC.mint,network:'solana-mainnet',slotNumber:1,policy:profile.policy??null};
 }
 #import(){
  for(const p of this.#treasury.snapshot().plans){
   if(p.source!=='owner-recorded'||p.route!=='solcard-wbtc'||p.state==='cancelled')continue;
   const id='funding-'+hash(p.id).slice(0,24);if(this.get(id))continue;
   if(this.#db.prepare('SELECT count(*) AS n FROM production_funding_jobs').get().n>=1000)throw Error('funding_observer_job_limit');
   const terms=this.#binding(p),job={id,planId:p.id,mode:'observe-only',terms,termsHash:hash(terms),sourceHash:hash(sourceTerms(p)),state:'inspection-pending',signature:null,inspection:null,reconciliation:null,reasons:[],events:[],createdAt:new Date(this.#clock()).toISOString()};
   this.#event(job,'owner-recorded-plan-linked');
   this.#db.prepare('INSERT INTO production_funding_jobs VALUES (?,?,NULL,?)').run(id,p.id,JSON.stringify(job));
  }
  if(this.#coordinator){
   const source=this.#coordinator();
   if(!source)return;
   // Existing jobs are revalidated individually below, including stale/held sources.
   if(!Array.isArray(source.jobs))throw Error('coordinator_handoff_source_invalid');
   for(const intent of source.jobs){
    const id='funding-'+hash(intent.id).slice(0,24),old=this.get(id);
    if(old){if(old.origin!==HANDOFF_ORIGIN)throw Error('coordinator_handoff_plan_collision');continue;}
    handoffEnvelope(source,this.#clock());
    if(this.#db.prepare('SELECT count(*) AS n FROM production_funding_jobs').get().n>=1000)throw Error('funding_observer_job_limit');
    const p=handoffPlan(source,intent.id,this.#clock()),terms=this.#binding(p);
    const job={id,planId:p.id,mode:'observe-only',origin:HANDOFF_ORIGIN,reservation:'dry-run-only',terms,termsHash:hash(terms),sourceHash:p.handoffHash,state:'inspection-pending',signature:null,inspection:null,reconciliation:null,reasons:[],events:[],createdAt:new Date(this.#clock()).toISOString()};
    this.#event(job,'coordinator-intent-linked');
    this.#db.prepare('INSERT INTO production_funding_jobs VALUES (?,?,NULL,?)').run(id,p.id,JSON.stringify(job));
   }
  }
 }
 #assertBinding(j){
  if(j.origin===HANDOFF_ORIGIN){
   const p=handoffPlan(this.#coordinator?.(),j.planId,this.#clock());
   if(p.handoffHash!==j.sourceHash)throw Error('coordinator_handoff_intent_changed');
   if(hash(this.#binding(p))!==j.termsHash)throw Error('funding_destination_or_policy_changed');
   return p;
  }
  const p=this.#treasury.getPlan(j.planId);
  if(!p||hash(sourceTerms(p))!==j.sourceHash)throw Error('funding_source_plan_changed');
  if(hash(this.#binding(p))!==j.termsHash)throw Error('funding_destination_or_policy_changed');
  if(p.state==='cancelled')throw Error('funding_source_plan_cancelled');
  return p;
 }
 #bindSignature(j,signature){
  decode58(signature,64);
  if(j.signature){if(j.signature!==signature)throw Error('funding_signature_locked');return;}
  if(this.#db.prepare('SELECT id FROM production_funding_jobs WHERE signature=?').get(signature))throw Error('funding_signature_reused');
  j.signature=signature;j.state='awaiting-chain';j.reasons=['existing_signature_not_yet_verified'];this.#event(j,'existing-signature-attached');this.#save(j);
 }
 attachSignature(id,signature){
  if(this.#busy)throw Error('funding_observer_busy');
  const j=this.get(id);if(!j)throw Error('unknown_production_funding_job');if(j.reviewLatched)throw Error('funding_job_review_required');this.#assertBinding(j);this.#bindSignature(j,signature);return j;
 }
 async #inspect(j){
  j.inspection=this.#signer.inspect(j.terms);
  const s=this.#treasury.snapshot(),profile=this.#treasury.setting('fundingProfile'),now=this.#clock();
  const reasons=[...j.inspection.reasons];
  if(!s.walletFresh)reasons.push('refresh_wallet_observation');
  if(!fresh(profile.observedAt,now)||this.#treasury.setting('solcardBackendError'))reasons.push('refresh_solcard_observation');
  if(!profile.cardLimits||!fresh(profile.cardLimits.observedAt,now))reasons.push('refresh_card_limits');
  else if(BigInt(j.terms.amount)<BigInt(profile.cardLimits.minWbtcUnits)||BigInt(j.terms.amount)>BigInt(profile.cardLimits.maxWbtcUnits))reasons.push('outside_card_limits');
  if(s.walletObservation&&BigInt(j.terms.amount)>BigInt(s.walletObservation.computeAmount))reasons.push('insufficient_observed_wbtc');
  // Manual accounting never establishes authenticated fee provenance or spending authority.
  reasons.push(j.origin===HANDOFF_ORIGIN?'coordinator_dry_run_not_spending_authority':'owner_recorded_fee_origin_unverified','independent_daily_spending_authority_required','signing_disabled','broadcast_disabled');
  if(this.#preflight&&!j.signature){
   const coordinatorJobs=this.#db.prepare('SELECT body FROM production_funding_jobs').all().map(r=>JSON.parse(r.body)).filter(x=>x.origin===HANDOFF_ORIGIN).map(x=>({id:x.planId,amount:x.terms.amount,createdAt:x.createdAt,state:['policy-complete-observation','chain-failed'].includes(x.state)?'provider-credited':'planned'}));
   const others=[...s.plans,...coordinatorJobs].filter(p=>p.id!==j.planId&&p.state!=='cancelled');
   if(others.some(p=>!Number.isFinite(Date.parse(p.createdAt))||Date.parse(p.createdAt)>now))throw Error('funding_plan_clock_invalid');
   const rolling24hOtherWbtcUnits=others.filter(p=>Date.parse(p.createdAt)>=now-86400000||p['deposit-submitted']&&Date.parse(p['deposit-submitted'].at)>=now-86400000).reduce((sum,p)=>sum+fundingUnits(p.amount),0n).toString();
   const plansHash=hash(s.plans);
   j.preflight=await this.#preflight.check(j.terms,{otherPending:others.some(p=>p.state!=='provider-credited'),rolling24hOtherWbtcUnits});
   this.#assertBinding(j);
   if(hash(this.#treasury.snapshot().plans)!==plansHash)throw Error('funding_plans_changed_during_preflight');
   reasons.push(...j.preflight.reasons);
  }else if(!this.#preflight)reasons.push('live_preflight_not_connected');
  j.reasons=reasons;j.state='signing-disabled';
 }
 async refreshAccounts(){
  if(!this.#preflight)throw Error('live_preflight_not_connected');
  if(this.#busy)throw Error('funding_observer_busy');this.#busy=true;
  try{
   this.#setMeta('accountPreflight',null);
   const p=validateFundingProfile(this.#treasury.setting('fundingProfile')),owner=this.#treasury.setting('wallets')?.computeWallet;
   const result=await this.#preflight.accounts({owner,recipient:p.depositAddress});
   const current=this.#treasury.setting('fundingProfile');
   if(current?.depositAddress!==p.depositAddress||this.#treasury.setting('wallets')?.computeWallet!==owner)throw Error('funding_destination_or_policy_changed');
   this.#setMeta('accountPreflight',result);return result;
  }finally{this.#busy=false;}
 }
 #deriveReconciliation(j,result){
  if(!Array.isArray(result?.transaction)||result.transaction[1]!=='base64'||typeof result.transaction[0]!=='string'||result.transaction[0].length>1700)throw Error('invalid_chain_evidence');
  const wire=Buffer.from(result.transaction[0],'base64'),tx=Transaction.from(wire);
  const checked=inspectRestrictedTransfer(wire,{owner:j.terms.owner,recipient:j.terms.recipient,amount:j.terms.amount,blockhash:tx.recentBlockhash});
  const terms={id:j.id,signature:j.signature,owner:j.terms.owner,recipient:j.terms.recipient,amount:j.terms.amount,mint:WBTC.mint,slotNumber:1,blockhash:tx.recentBlockhash,messageHash:checked.messageHash};
  verifyFundingTransaction(terms,result); // Exact message, signatures and token deltas before registration.
  return terms;
 }
 async tick(){
  if(this.#busy)return {skipped:'busy'};this.#busy=true;
  let errors=0,checked=0;
  try{
   this.#import();
   const jobs=this.#db.prepare("SELECT body FROM production_funding_jobs ORDER BY COALESCE(json_extract(body,'$.checkedAt'),''),rowid LIMIT 20").all().map(r=>JSON.parse(r.body));
   for(const j of jobs){
    if(j.origin===HANDOFF_ORIGIN&&j.reviewLatched)continue;
    try{
     checked++;j.checkedAt=new Date(this.#clock()).toISOString();j.preflight=null;
     const plan=this.#assertBinding(j);
     const intent=j.origin===HANDOFF_ORIGIN?this.#coordinator?.().jobs.find(x=>x.id===j.planId):null;
     if(intent?.state==='policy-complete-observation'&&intent.completion?.signature===j.signature&&j.reconciliation?.chain?.state==='finalized'){
      j.state='policy-complete-observation';j.completion=intent.completion;j.reasons=['dedicated_card_policy_observation_only','no_spendable_credit_posted'];this.#save(j);continue;
     }
     if(j.reconciliation?.chain?.state==='failed'){j.state='chain-failed';this.#save(j);continue;}
     await this.#inspect(j);
     const reference=plan['deposit-submitted']?.reference;
     if(reference){try{decode58(reference,64);}catch{j.reasons.push('recorded_transfer_reference_not_a_signature');}
      if(!j.reasons.includes('recorded_transfer_reference_not_a_signature'))this.#bindSignature(j,reference);}
     if(j.signature){
      j.state='awaiting-chain';j.reasons=['transaction_not_finalized_or_not_found'];
      if(!j.reconciliationTerms){
       const result=await this.#read(j.signature,j.id);this.#assertBinding(j);
       if(result!==null){j.reconciliationTerms=this.#deriveReconciliation(j,result);this.#event(j,'exact-chain-message-verified');this.#save(j);}
      }
      if(j.reconciliationTerms){
       // Persisted registration intent makes a crash between the two databases replayable.
       this.#reconciler.register(j.reconciliationTerms);
       const observed=this.#reconciler.get(j.id);j.reconciliation={state:observed.state,reason:observed.reason??null,checks:observed.checks,chain:observed.chain??null,settlement:observed.settlement??null};
       j.state=observed.state;j.reasons=[observed.reason??'awaiting_read_only_reconciliation'];
       if(observed.state==='complete')throw Error('unexpected_automatic_credit_completion');
      }
     }
     this.#save(j);
    }catch(e){errors++;j.preflight=null;const transient=j.origin===HANDOFF_ORIGIN&&handoffTransient.has(e.message);j.state=transient?'handoff-waiting':'review-required';j.reasons=[safeError(e)];if(j.origin===HANDOFF_ORIGIN&&!transient)j.reviewLatched=true;this.#save(j);}
   }
   const result={at:new Date(this.#clock()).toISOString(),checked,errors};this.#setMeta('lastTick',result);this.#setMeta('lastError',null);return result;
  }catch(e){this.#setMeta('lastError',safeError(e));throw e;}
  finally{this.#busy=false;}
 }
 status(){
  const feeds=this.#records.status().feeds,profile=this.#treasury.setting('fundingProfile');
  return {mode:'observe-only',running:!this.#stopped,busy:this.#busy,lastTick:this.#meta('lastTick'),lastError:this.#meta('lastError'),
   signer:{mode:'inspect-only',keyLoaded:false,signingEnabled:false,broadcastEnabled:false},automaticCreditPosting:false,paymentsEnabled:false,gpuExperimentsEnabled:false,
   connections:{solcard:{state:feeds.solcard.state,fresh:feeds.solcard.fresh,attribution:'transfer_signature_missing'},runpod:{state:feeds.runpod.state,fresh:feeds.runpod.fresh,attribution:'project_card_link_missing'},reconciler:this.#reconciler.status().mode},
   handoff:{connected:!!this.#coordinator,mode:'observe-only',realReservationsEnabled:false},readiness:{ownerLimitsConfigured:!!profile?.policy,livePreflightConnected:!!this.#preflight,livePreflightVerified:false,feeOriginVerified:false},accountPreflight:preflightView(this.#meta('accountPreflight'),this.#clock()),jobs:this.#db.prepare('SELECT body FROM production_funding_jobs ORDER BY rowid DESC').all().map(r=>{const j=JSON.parse(r.body);return {...j,preflight:preflightView(this.#meta('lastError')?null:j.preflight,this.#clock())};})};
 }
 executionIntents(){
  if(this.#busy)return [];
  return this.status().jobs.filter(j=>j.origin===HANDOFF_ORIGIN&&!j.signature&&!j.reviewLatched&&j.state==='signing-disabled').map(j=>{
   this.#assertBinding(j);return {id:j.id,kind:'funding',owner:j.terms.owner,recipient:j.terms.recipient,amount:j.terms.amount,sourceHash:j.sourceHash,termsHash:j.termsHash};
  });
 }
 async executionPreflight(id){
  const j=this.get(id);if(!j||j.signature||j.origin!==HANDOFF_ORIGIN||j.reviewLatched)throw Error('wallet_funding_source_unready');
  this.#assertBinding(j);if(!this.#preflight)throw Error('live_preflight_not_connected');
  if(this.#busy)throw Error('funding_observer_busy');this.#busy=true;
  try{await this.#inspect(j);this.#assertBinding(j);this.#save(j);return j.preflight;}finally{this.#busy=false;}
 }
 start(){if(!this.#stopped)return;this.#stopped=false;const loop=async()=>{try{await this.tick();}catch{}if(!this.#stopped){this.#timer=setTimeout(loop,60000);this.#timer.unref();}};void loop();}
 async close(){this.#stopped=true;clearTimeout(this.#timer);while(this.#busy)await new Promise(r=>setTimeout(r,10));this.#db.close();}
}

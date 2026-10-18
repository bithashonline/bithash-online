import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {decideFunding,validateDryRules} from './automatic-funding.js';
import {feeAllocation} from './treasury-compute.js';

export const SIMULATION_CASES=Object.freeze({success:'Normal funding', 'transfer-unknown':'Transfer response lost', 'chain-failed':'Chain confirmation fails', 'card-delayed':'Card credit delayed', 'card-mismatch':'Wrong card receipt', 'provider-delayed':'Runpod credit delayed', 'provider-mismatch':'Wrong Runpod receipt'});
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const units=v=>{if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,23})$/.test(v))throw Error('invalid_simulation_amount');return BigInt(v);};
const clone=v=>JSON.parse(JSON.stringify(v));
const terminal=j=>['complete','cancelled','failed','held'].includes(j.state);
const min=(a,b)=>a<b?a:b;

// No adapter, key, URL or production ledger is accepted. Every case owns an
// independent invented balance sheet in this simulation-only database.
export class SimulationFundingJobs {
 #db;#clock;#timer=null;
 constructor(path,{clock=Date.now}={}){
  this.#clock=clock;this.#db=new DatabaseSync(path);
  const tables=this.#db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  if(tables.some(t=>!['sim_job_meta','sim_funding_jobs','sim_job_events','sim_job_receipts'].includes(t.name))){this.#db.close();throw Error('simulation_database_required');}
  this.#db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS sim_job_meta(k TEXT PRIMARY KEY,v TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS sim_funding_jobs(id TEXT PRIMARY KEY,terms_hash TEXT UNIQUE NOT NULL,body TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS sim_job_events(id INTEGER PRIMARY KEY,job TEXT NOT NULL,at TEXT NOT NULL,body TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS sim_job_receipts(id TEXT PRIMARY KEY,job TEXT NOT NULL,stage TEXT NOT NULL,body TEXT NOT NULL);`);
  const mode=this.#db.prepare("SELECT v FROM sim_job_meta WHERE k='mode'").get();
  if(mode&&mode.v!=='simulation'){this.#db.close();throw Error('simulation_database_required');}
  this.#db.prepare("INSERT OR IGNORE INTO sim_job_meta VALUES ('mode','simulation')").run();
 }
 #transaction(fn){this.#db.exec('BEGIN IMMEDIATE');try{const value=fn();this.#db.exec('COMMIT');return value;}catch(e){this.#db.exec('ROLLBACK');throw e;}}
 #time(){const now=this.#clock();const old=this.#db.prepare("SELECT v FROM sim_job_meta WHERE k='clock'").get();if(!Number.isSafeInteger(now)||old&&now<Number(old.v))throw Error('simulation_clock_rollback');this.#db.prepare("INSERT INTO sim_job_meta VALUES ('clock',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(String(now));return new Date(now).toISOString();}
 #save(j){this.#db.prepare('UPDATE sim_funding_jobs SET body=? WHERE id=?').run(JSON.stringify(j),j.id);}
 #event(j,kind,detail={}){const at=this.#time();this.#db.prepare('INSERT INTO sim_job_events(job,at,body) VALUES (?,?,?)').run(j.id,at,JSON.stringify({kind,source:'simulation',...detail}));j.updatedAt=at;}
 get(id){const row=this.#db.prepare('SELECT body FROM sim_funding_jobs WHERE id=?').get(id);return row?JSON.parse(row.body):null;}
 create(policy,scenario='success',{fixture='fee-batch-v1'}={}){
  if(!Object.hasOwn(SIMULATION_CASES,scenario))throw Error('unknown_simulation_case');
  const fixtures={'fee-batch-v1':'1000000','operating-500-v1':'1000000','operating-1000-v1':'2000000'};
  if(!Object.hasOwn(fixtures,fixture))throw Error('unknown_simulation_fixture');
  const p=validateDryRules(policy),terms={schema:'bithash.simulation-job.v1',scenario,policy:p,fixture,totalFeeUnits:fixtures[fixture],initialProviderMicrousd:'10000000',destination:'SIMULATED_SOLCARD_ONLY'};
  const termsHash=hash(terms),id='sim-'+termsHash.slice(0,28);
  return this.#transaction(()=>{
   const old=this.get(id);if(old){if(old.termsHash!==termsHash)throw Error('simulation_terms_conflict');return old;}
   if(this.#db.prepare('SELECT count(*) AS n FROM sim_funding_jobs').get().n>=100)throw Error('simulation_case_limit');
   const at=this.#time(),j={id,mode:'simulation',termsHash,terms,state:'awaiting-fees',paused:false,resolved:false,reason:null,createdAt:at,updatedAt:at,transferAttempts:0,providerReloadAttempts:0,
    balances:{computeUnits:'0',otherUnits:'0',reservedUnits:'0',cardMicrousd:'0',providerMicrousd:'10000000',projectProviderMicrousd:'0'}};
   this.#db.prepare('INSERT INTO sim_funding_jobs VALUES (?,?,?)').run(id,termsHash,JSON.stringify(j));this.#event(j,'created',{scenario});this.#save(j);return j;
  });
 }
 #decision(j,at){
  const p=j.terms.policy,b=j.balances;
  return decideFunding({sample:true,projectMint:'SIMULATION_ONLY',routingVerified:true,historyComplete:true,feeObservedAt:at,feeComputeUnits:b.computeUnits,committedUnits:'0',dailyCommittedUnits:'0',pendingFunding:false,
   wallet:{observedAt:at,amountUnits:b.computeUnits},card:{observedAt:at,balanceMicrousd:b.cardMicrousd,status:'ACTIVE'},provider:{observedAt:at,balanceMicrousd:b.providerMicrousd},gas:{observedAt:at,lamports:String(units(p.minSolLamports)+units(p.maxFeeLamports)+1000000n)},cardLimits:{observedAt:at,minUnits:'10000',maxUnits:'125310000'}},p,Date.parse(at));
 }
 #receipt(j,stage,r){
  if(r?.source!=='simulation'||r.jobId!==j.id||r.transferReference!==j.transferReference||r.destination!==j.terms.destination||r.wbtcUnits!==j.amountUnits||r.currency!=='USD'||r.id!=='sim-'+stage+'-'+j.id||!units(r.netMicrousd))throw Error('simulation_receipt_mismatch');
  if(stage==='provider'&&(r.cardReceiptId!==j.cardReceipt?.id||units(r.netMicrousd)>units(j.balances.cardMicrousd)))throw Error('simulation_provider_link_mismatch');
  const encoded=JSON.stringify(r),old=this.#db.prepare('SELECT * FROM sim_job_receipts WHERE id=?').get(r.id);
  if(old){if(old.job!==j.id||old.stage!==stage||old.body!==encoded)throw Error('simulation_receipt_conflict');return false;}
  this.#db.prepare('INSERT INTO sim_job_receipts VALUES (?,?,?,?)').run(r.id,j.id,stage,encoded);return true;
 }
 #mockReceipt(j,stage){
  const r={id:'sim-'+stage+'-'+j.id,source:'simulation',jobId:j.id,transferReference:j.transferReference,destination:j.terms.destination,wbtcUnits:j.amountUnits,currency:'USD',netMicrousd:stage==='card'?j.decision.estimatedUsdMicros:j.reloadMicrousd};
  if(stage==='provider')r.cardReceiptId=j.cardReceipt.id;
  if(!j.resolved&&j.terms.scenario===stage+'-mismatch')r.jobId='wrong-simulated-job';
  return r;
 }
 step(id){return this.#transaction(()=>{
  const j=this.get(id);if(!j)throw Error('unknown_simulation_job');if(j.paused||terminal(j))return j;const at=this.#time();
  if(j.state==='awaiting-fees'){
   const split=feeAllocation(j.terms.totalFeeUnits);j.balances.computeUnits=split.compute;j.balances.otherUnits=split.other;
   this.#event(j,'fee-distribution',{totalUnits:j.terms.totalFeeUnits,computeUnits:split.compute,otherUnits:split.other});
   j.decision=this.#decision(j,at);
   if(j.decision.action!=='would_top_up_solcard'){j.state='held';j.reason=j.decision.reasons.join('; ');}
   else {j.amountUnits=j.decision.amountWbtcUnits;j.balances.reservedUnits=j.amountUnits;j.state='proposed';}
   this.#event(j,'decision',{action:j.decision.action,amountUnits:j.amountUnits??'0'});
  }else if(j.state==='proposed'){
   j.transferReference='sim-chain-'+j.id;j.transferAttempts=1;j.state='awaiting-chain';
   this.#event(j,'simulated-transfer-request',{reference:j.transferReference,attempts:1});
   if(j.terms.scenario==='transfer-unknown'&&!j.resolved)j.reason='transfer_outcome_unknown_no_resubmit';
  }else if(j.state==='awaiting-chain'){
   if(j.terms.scenario==='transfer-unknown'&&!j.resolved)return j;
   if(j.terms.scenario==='chain-failed'){j.state='failed';j.reason='chain_failed_reservation_retained';this.#event(j,'chain-failed');}
   else {j.balances.computeUnits=String(units(j.balances.computeUnits)-units(j.amountUnits));j.balances.reservedUnits='0';j.state='awaiting-card';j.reason=null;this.#event(j,'chain-confirmed',{reference:j.transferReference});}
  }else if(j.state==='awaiting-card'||j.state==='awaiting-provider'){
   const stage=j.state==='awaiting-card'?'card':'provider';
   if(j.terms.scenario===stage+'-delayed'&&!j.resolved){if(j.reason==='waiting_for_'+stage+'_receipt')return j;j.reason='waiting_for_'+stage+'_receipt';this.#event(j,'receipt-pending',{stage});}
   else {
    const r=this.#mockReceipt(j,stage);
    try{if(!this.#receipt(j,stage,r))throw Error('simulation_receipt_already_posted');}catch(e){
     // Only a typed evidence mismatch becomes a hold. Database failures roll back.
     if(!['simulation_receipt_mismatch','simulation_provider_link_mismatch'].includes(e.message))throw e;
     if(j.reason===e.message)return j;j.reason=e.message;this.#event(j,'receipt-rejected',{stage,reason:e.message});this.#save(j);return j;
    }
    j.reason=null;
    if(stage==='card'){
     j.cardReceipt=r;j.balances.cardMicrousd=String(units(j.balances.cardMicrousd)+units(r.netMicrousd));
     const gap=units(j.terms.policy.providerTargetMicrousd)-units(j.balances.providerMicrousd),usable=units(j.balances.cardMicrousd)-min(units(j.balances.cardMicrousd),units(j.terms.policy.cardBufferMicrousd));
     const reload=min(gap>0n?gap:0n,usable);
     if(!reload){j.state='held';j.reason='card_credit_below_reload_buffer';}
     else{j.reloadMicrousd=String(reload);j.state='awaiting-provider';j.providerReloadAttempts=1;}
    }else{
     j.providerReceipt=r;j.balances.cardMicrousd=String(units(j.balances.cardMicrousd)-units(r.netMicrousd));j.balances.providerMicrousd=String(units(j.balances.providerMicrousd)+units(r.netMicrousd));j.balances.projectProviderMicrousd=String(units(j.balances.projectProviderMicrousd)+units(r.netMicrousd));j.state='complete';
    }
    this.#event(j,stage+'-credited',{receiptId:r.id,netMicrousd:r.netMicrousd});
   }
  }else throw Error('invalid_simulation_state');
  this.#save(j);return j;
 });}
 control(id,action){return this.#transaction(()=>{
  const j=this.get(id);if(!j)throw Error('unknown_simulation_job');
  if(action==='pause'||action==='resume'){
   if(terminal(j))throw Error('simulation_job_terminal');const paused=action==='pause';if(j.paused===paused)return j;j.paused=paused;
  }else if(action==='cancel'){
   if(j.state==='cancelled')return j;if(!['awaiting-fees','proposed'].includes(j.state)||j.transferAttempts)throw Error('cannot_cancel_submitted_simulation');j.state='cancelled';j.balances.reservedUnits='0';
  }else if(action==='resolve'){
   if(j.resolved)return j;
   const expected={'transfer-unknown':'awaiting-chain','card-delayed':'awaiting-card','card-mismatch':'awaiting-card','provider-delayed':'awaiting-provider','provider-mismatch':'awaiting-provider'};
   if(expected[j.terms.scenario]!==j.state)throw Error('simulation_not_resolvable');j.resolved=true;j.reason=null;
  }else throw Error('unknown_simulation_control');
  this.#event(j,action);this.#save(j);return j;
 });}
 tick(){for(const row of this.#db.prepare('SELECT id FROM sim_funding_jobs ORDER BY rowid').all())this.step(row.id);}
 status(){const jobs=this.#db.prepare('SELECT body FROM sim_funding_jobs ORDER BY rowid DESC').all().map(r=>JSON.parse(r.body));return {mode:'simulation',running:!!this.#timer,paymentsEnabled:false,signingEnabled:false,broadcastEnabled:false,gpuExperimentsEnabled:false,realCreditPosting:false,jobs:jobs.map(j=>({...j,events:this.#db.prepare('SELECT at,body FROM sim_job_events WHERE job=? ORDER BY id').all(j.id).map(e=>({at:e.at,...JSON.parse(e.body)}))})),workerError:this.#db.prepare("SELECT v FROM sim_job_meta WHERE k='worker-error'").get()?.v??null};}
 start(){if(this.#timer)return;this.#timer=setInterval(()=>{try{this.tick();this.#db.prepare("DELETE FROM sim_job_meta WHERE k='worker-error'").run();}catch{this.#db.prepare("INSERT INTO sim_job_meta VALUES ('worker-error','simulation_worker_held') ON CONFLICT(k) DO UPDATE SET v=excluded.v").run();}},3000);this.#timer.unref();}
 close(){clearInterval(this.#timer);this.#timer=null;this.#db.close();}
}

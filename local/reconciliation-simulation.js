import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';

const clone=x=>JSON.parse(JSON.stringify(x));
const n=x=>{if(typeof x!=='string'||!/^(0|[1-9][0-9]{0,15})$/.test(x))throw Error('invalid_simulated_amount');return BigInt(x);};
const id=x=>{if(typeof x!=='string'||!/^sim-[a-z0-9-]{1,60}$/.test(x))throw Error('simulation_id_required');return x;};
const usd=1000000n;
export const RECONCILIATION_POLICY=Object.freeze({version:'simulation-v1',maxPending:1,maxBatchMicrousd:'500000000',maxDailyMicrousd:'1000000000',maxFeesMicrousd:'10000000',freshSeconds:300,timeoutSeconds:86400,allocation:'project-only; opening funds excluded',proof:'policy-reconciled-simulation'});
export const RECONCILIATION_CASES=['normal','delayed','unknown-transfer','ambiguous','balance-gap','refund','refund-after-spend'];
const fresh=caseId=>({mode:'simulation',caseId,time:0,paused:false,hold:null,policy:clone(RECONCILIATION_POLICY),
 opening:{walletUnits:'1000000',cardMicrousd:'20000000',providerMicrousd:'10000000'},walletUnits:'1000000',
 cardProject:'0',providerProject:'0',inTransit:'0',grossConverted:'0',conversionFees:'0',cardFees:'0',providerFees:'0',spent:'0',
 jobs:[],receipts:[],events:[],fixtureStep:0,fixtureResolved:false});
function check(w){
 const converted=w.jobs.filter(j=>j.chain).reduce((s,j)=>s+n(j.units),0n);
 if(n(w.opening.walletUnits)!==n(w.walletUnits)+converted)throw Error('sim_wallet_conservation');
 if(n(w.grossConverted)!==['cardProject','providerProject','inTransit','conversionFees','cardFees','providerFees','spent'].reduce((s,k)=>s+n(w[k]),0n))throw Error('sim_usd_conservation');
 if(w.jobs.filter(j=>!['complete','refunded'].includes(j.state)).length>1)throw Error('sim_multiple_pending');
 if(n(w.providerProject)!==w.jobs.reduce((s,j)=>s+n(j.providerNet??'0')-n(j.spent??'0')-n(j.refunded??'0'),0n))throw Error('sim_provider_allocation');
}
const change=(w,key,delta)=>{const next=n(w[key])+delta;if(next<0n)throw Error('sim_project_funds_shortfall');w[key]=String(next);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function evidence(w,e){
 if(e?.source!=='simulation')throw Error('real_evidence_forbidden');id(e.id);id(e.jobId);
 if(!Number.isInteger(e.at)||e.at<0||e.at>w.time||w.time-e.at>w.policy.freshSeconds)throw Error('sim_stale_or_future_evidence');
 if(e.completeHistory!==true)throw Error('sim_history_gap');
 if(e.matches!==1)throw Error('sim_ambiguous_evidence');
 if(e.card!=='sim-project-card'||e.provider!=='sim-project-runpod')throw Error('sim_account_mismatch');
 const j=w.jobs.find(j=>j.id===e.jobId);if(!j)throw Error('sim_unknown_job');
 return j;
}
function apply(w,e){
 const j=evidence(w,e),p=w.policy;
 const stage={chain:'awaiting-chain',card:'awaiting-card',charge:'awaiting-charge',provider:'awaiting-provider'}[e.kind];
 if(stage&&j.state!==stage)throw Error('sim_wrong_stage');
 const closing=(name,expected)=>{if(n(e[name])!==expected)throw Error('sim_balance_mismatch');};
 const fee=v=>{const f=n(v),total=n(j.fees??'0')+f;if(total>n(p.maxFeesMicrousd))throw Error('sim_fee_limit');j.fees=String(total);return f;};
 if(e.kind==='chain'){
  if(e.finalized!==true||e.signature!=='sim-signature-'+j.id||e.units!==j.units)throw Error('sim_chain_unconfirmed');
  closing('walletUnits',n(w.walletUnits)-n(j.units));change(w,'walletUnits',-n(j.units));change(w,'grossConverted',n(j.gross));change(w,'inTransit',n(j.gross));j.chain=e.signature;j.state='awaiting-card';
 }else if(e.kind==='card'){
  if(e.invoiceId!=='sim-invoice-'+j.id||e.paidUnits!==j.units||e.status!=='settled'||n(e.net)<=0n||n(e.net)+fee(e.fee)!==n(j.gross))throw Error('sim_card_credit_mismatch');
  closing('cardBalance',n(w.opening.cardMicrousd)+n(w.cardProject)+n(e.net));change(w,'cardProject',n(e.net));change(w,'conversionFees',n(e.fee));change(w,'inTransit',-n(j.gross));j.cardNet=e.net;j.state='awaiting-charge';
 }else if(e.kind==='charge'){
  if(e.status!=='settled'||e.merchant!=='RUNPOD'||n(e.principal)<=0n||n(e.principal)+fee(e.fee)>n(w.cardProject))throw Error('sim_card_charge_mismatch');
  closing('cardBalance',n(w.opening.cardMicrousd)+n(w.cardProject)-n(e.principal)-n(e.fee));change(w,'cardProject',-n(e.principal)-n(e.fee));change(w,'cardFees',n(e.fee));change(w,'inTransit',n(e.principal));j.chargeId=e.id;j.principal=e.principal;j.state='awaiting-provider';
 }else if(e.kind==='provider'){
  if(e.status!=='settled'||e.chargeId!==j.chargeId||n(e.net)<=0n||n(e.net)+fee(e.fee)!==n(j.principal))throw Error('sim_provider_credit_mismatch');
  closing('providerBalance',n(w.opening.providerMicrousd)+n(w.providerProject)+n(e.net));change(w,'providerProject',n(e.net));change(w,'providerFees',n(e.fee));change(w,'inTransit',-n(j.principal));j.providerNet=e.net;j.spent='0';j.refunded='0';j.state='complete';j.completedAt=w.time;j.proof=p.proof;
 }else if(e.kind==='spend'||e.kind==='refund'){
  if(!['complete','refunded'].includes(j.state)||e.status!=='settled'||n(e.amount)<=0n||n(e.amount)>n(j.providerNet)-n(j.spent)-n(j.refunded))throw Error('sim_reversal_or_spend_shortfall');
  closing('providerBalance',n(w.opening.providerMicrousd)+n(w.providerProject)-n(e.amount));change(w,'providerProject',-n(e.amount));
  if(e.kind==='refund'){
   if(e.originalChargeId!==j.chargeId)throw Error('sim_refund_reference_mismatch');
   closing('cardBalance',n(w.opening.cardMicrousd)+n(w.cardProject)+n(e.amount));change(w,'cardProject',n(e.amount));j.refunded=String(n(j.refunded)+n(e.amount));if(n(j.refunded)===n(j.providerNet))j.state='refunded';
  }else{change(w,'spent',n(e.amount));j.spent=String(n(j.spent)+n(e.amount));}
 }else throw Error('sim_unknown_event');
 j.lastProgressAt=w.time;check(w);
}

// Isolated journal and pure simulated balances. No provider clients, wallet keys,
// signer, network, treasury posting or GPU adapter are imported here.
export class ReconciliationSimulation{
 #db;#timer=null;#error=null;
 constructor(path){
  this.#db=new DatabaseSync(path);const tables=this.#db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  if(tables.some(t=>!['reconciliation_sim_meta','reconciliation_sim_cases'].includes(t.name))){this.#db.close();throw Error('reconciliation_simulation_database_required');}
  this.#db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS reconciliation_sim_meta(k TEXT PRIMARY KEY,v TEXT NOT NULL); CREATE TABLE IF NOT EXISTS reconciliation_sim_cases(id TEXT PRIMARY KEY,body TEXT NOT NULL);');
  const mode=this.#db.prepare("SELECT v FROM reconciliation_sim_meta WHERE k='mode'").get();if(mode&&mode.v!=='simulation'){this.#db.close();throw Error('reconciliation_simulation_database_required');}this.#db.prepare("INSERT OR IGNORE INTO reconciliation_sim_meta VALUES('mode','simulation')").run();
 }
 get(caseId){const row=this.#db.prepare('SELECT body FROM reconciliation_sim_cases WHERE id=?').get(caseId);return row?JSON.parse(row.body):null;}
 #tx(caseId,fn){this.#db.exec('BEGIN IMMEDIATE');try{const w=this.get(caseId);if(!w||w.mode!=='simulation'||!same(w.policy,RECONCILIATION_POLICY))throw Error('sim_case_or_policy_mismatch');fn(w);check(w);this.#db.prepare('UPDATE reconciliation_sim_cases SET body=? WHERE id=?').run(JSON.stringify(w),caseId);this.#db.exec('COMMIT');return clone(w);}catch(e){this.#db.exec('ROLLBACK');throw e;}}
 create(name){if(!RECONCILIATION_CASES.includes(name))throw Error('sim_unknown_case');const key='sim-'+name;if(this.get(key))return this.get(key);const w=fresh(key);w.jobs.push({id:'sim-job-1',units:'100000',gross:'100000000',state:'awaiting-chain',createdAt:0,attempts:1});check(w);this.#db.prepare('INSERT INTO reconciliation_sim_cases VALUES(?,?)').run(key,JSON.stringify(w));return clone(w);}
 begin(caseId,jobId,units){id(jobId);const gross=n(units)*1000n;if(gross<=0n)throw Error('sim_invalid_batch');return this.#tx(caseId,w=>{
  const old=w.jobs.find(j=>j.id===jobId);if(old){if(old.units!==units)throw Error('sim_job_conflict');return;}
  if(w.hold||w.paused)throw Error('sim_review_or_pause');if(w.jobs.length>=100)throw Error('sim_history_limit');
  if(w.jobs.some(j=>!['complete','refunded'].includes(j.state)))throw Error('sim_pending_job');
  if(gross>n(w.policy.maxBatchMicrousd)||n(units)>n(w.walletUnits))throw Error('sim_batch_limit');
  const daily=w.jobs.filter(j=>w.time-j.createdAt<86400).reduce((s,j)=>s+n(j.gross),0n);if(daily+gross>n(w.policy.maxDailyMicrousd))throw Error('sim_daily_limit');
  w.jobs.push({id:jobId,units,gross:String(gross),state:'awaiting-chain',createdAt:w.time,attempts:1});
 });}
 observe(caseId,input,{resolve=false,advanceFixture=false}={}){
  if(input?.source!=='simulation')throw Error('real_evidence_forbidden');id(input.id);
  const e=clone(input),digest=createHash('sha256').update(JSON.stringify(e)).digest('hex');
  return this.#tx(caseId,w=>{
   const old=w.receipts.find(r=>r.id===e.id);if(old){if(old.digest!==digest){w.hold='sim_receipt_conflict';w.paused=true;}return;}
   if(w.receipts.length>=1000)throw Error('sim_history_limit');if(w.hold&&!resolve)return;
   const next=clone(w);
   try{apply(next,e);next.receipts.push({id:e.id,digest,event:e});next.events.push({time:w.time,kind:e.kind,id:e.id,proof:w.policy.proof});next.events=next.events.slice(-100);if(advanceFixture)next.fixtureStep++;if(resolve){next.hold=null;next.paused=true;next.fixtureResolved=true;}Object.assign(w,next);}
   catch(err){w.hold=/^sim_[a-z_]+$/.test(err.message)?err.message:'sim_evidence_invalid';w.paused=true;}
  });
 }
 advance(caseId,seconds){if(!Number.isInteger(seconds)||seconds<0||seconds>172800)throw Error('sim_invalid_time');return this.#tx(caseId,w=>{w.time+=seconds;if(w.time>31536000)throw Error('sim_time_limit');const pending=w.jobs.find(j=>!['complete','refunded'].includes(j.state));if(pending&&w.time-(pending.lastProgressAt??pending.createdAt)>w.policy.timeoutSeconds){w.hold='sim_settlement_timeout';w.paused=true;}});}
 control(caseId,action){return this.#tx(caseId,w=>{if(action==='pause')w.paused=true;else if(action==='resume'){if(w.hold)throw Error('sim_review_required');w.paused=false;}else throw Error('sim_unknown_control');});}
 step(caseId,{resolve=false}={}){
  let w=this.get(caseId);if(!w)throw Error('sim_unknown_case');if(!resolve&&(w.hold||w.paused))return w;
  if(w.fixtureStep>=4&&!['sim-refund','sim-refund-after-spend'].includes(caseId))return w;
  if(w.fixtureStep>=5&&caseId==='sim-refund'||w.fixtureStep>=6&&caseId==='sim-refund-after-spend')return w;
  if(!resolve)w=this.advance(caseId,60);
  if(w.hold&&!resolve)return w;
  if(caseId==='sim-delayed'&&w.fixtureStep===1&&w.time<300)return w;
  const stage=['chain','card','charge','provider',...(caseId==='sim-refund-after-spend'?['spend','refund']:['refund'])][w.fixtureStep],j=w.jobs[0];
  const common={id:'sim-'+stage+'-1',jobId:j.id,source:'simulation',at:w.time,completeHistory:true,matches:1,card:'sim-project-card',provider:'sim-project-runpod',kind:stage};
  const body={chain:{finalized:true,signature:'sim-signature-'+j.id,units:'100000',walletUnits:'900000'},card:{invoiceId:'sim-invoice-'+j.id,paidUnits:'100000',status:'settled',net:'98000000',fee:'2000000',cardBalance:'118000000'},charge:{status:'settled',merchant:'RUNPOD',principal:'90000000',fee:'1000000',cardBalance:'27000000'},provider:{status:'settled',chargeId:'sim-charge-1',net:'89000000',fee:'1000000',providerBalance:'99000000'},spend:{status:'settled',amount:'5000000',providerBalance:'94000000'},refund:{status:'settled',originalChargeId:'sim-charge-1',amount:'89000000',providerBalance:'10000000',cardBalance:'116000000'}}[stage];
  if(!body)return w;const e={...common,...body};
  if(!resolve&&!w.fixtureResolved){if(caseId==='sim-unknown-transfer'&&stage==='chain')e.finalized=false;if(caseId==='sim-ambiguous'&&stage==='card')e.matches=2;if(caseId==='sim-balance-gap'&&stage==='card')e.cardBalance='119000000';}
  return this.observe(caseId,e,{resolve,advanceFixture:true});
 }
 status(){return {mode:'simulation',policy:clone(RECONCILIATION_POLICY),running:!!this.#timer,workerError:this.#error,signingEnabled:false,broadcastEnabled:false,paymentsEnabled:false,gpuExperimentsEnabled:false,automaticCreditPosting:false,cases:this.#db.prepare('SELECT body FROM reconciliation_sim_cases ORDER BY id').all().map(r=>JSON.parse(r.body))};}
 start(){if(this.#timer)return;this.#timer=setInterval(()=>{try{for(const w of this.status().cases)this.step(w.caseId);this.#error=null;}catch{this.#error='simulation_worker_held';}},3000);this.#timer.unref();}
 close(){clearInterval(this.#timer);this.#timer=null;this.#db.close();}
}

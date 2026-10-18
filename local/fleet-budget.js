import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {DEFAULT_DRY_RULES} from './automatic-funding.js';

const n=v=>{if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,17})$/.test(v))throw Error('invalid_fleet_amount');return BigInt(v);};
const min=(...v)=>v.reduce((a,b)=>a<b?a:b),max=(a,b)=>a>b?a:b;
const ceil=(a,b)=>(a+b-1n)/b;
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const FLEET_POLICY=Object.freeze({operatingCapMicrousd:'500000000',reserveMicrousd:'50000000',dailyCapMicrousd:'500000000',sessionCapMicrousd:'100000000',hourlyCapMicrousd:'12000000',maxGpuHourlyMicrousd:'2000000',maxGpus:8,durationSeconds:21600,maxPriceIncreaseBps:2000});
export function validateFleetPolicy(p){
 if(!p||Object.keys(p).sort().join()!==Object.keys(FLEET_POLICY).sort().join())throw Error('invalid_fleet_policy');
 for(const k of Object.keys(FLEET_POLICY).filter(k=>k.endsWith('Microusd')))n(p[k]);
 if(!Number.isInteger(p.maxGpus)||p.maxGpus<1||p.maxGpus>1000||!Number.isInteger(p.durationSeconds)||p.durationSeconds<60||p.durationSeconds>86400||!Number.isInteger(p.maxPriceIncreaseBps)||p.maxPriceIncreaseBps<0||p.maxPriceIncreaseBps>10000||n(p.reserveMicrousd)>=n(p.operatingCapMicrousd)||!n(p.dailyCapMicrousd)||!n(p.sessionCapMicrousd)||!n(p.hourlyCapMicrousd)||!n(p.maxGpuHourlyMicrousd))throw Error('invalid_fleet_policy');
 return structuredClone(p);
}
export function planFleetBudget(input,policy=FLEET_POLICY){
 const p=validateFleetPolicy(policy),reasons=[],r={mode:'simulation',action:'hold',reasons,gpuCount:0,reservationMicrousd:'0',rentalExecutionEnabled:false};
 const credit=n(input.creditMicrousd),spent=n(input.spentMicrousd),reserved=n(input.reservedMicrousd),day=n(input.dayCommittedMicrousd),rate=n(input.gpuHourlyMicrousd),baseline=n(input.baselineHourlyMicrousd);
 if(!input.fundingVerified)reasons.push('awaiting_confirmed_project_credit');
 if(!input.feedFresh)reasons.push('stale_funding_or_quote');
 if(!input.balanceConsistent)reasons.push('provider_balance_mismatch');
 if(credit>n(p.operatingCapMicrousd))reasons.push('operating_exposure_exceeded');
 if(!rate||!baseline||rate>n(p.maxGpuHourlyMicrousd)||rate*10000n>baseline*BigInt(10000+p.maxPriceIncreaseBps))reasons.push('abnormal_gpu_price');
 if(spent+reserved>credit)reasons.push('budget_accounting_mismatch');
 const remaining=max(credit-spent-reserved,0n),available=max(remaining-n(p.reserveMicrousd),0n);r.availableMicrousd=String(available);r.remainingMicrousd=String(remaining);
 if(reasons.length)return r;
 if(input.activeSession){reasons.push('existing_session_reserved');return r;}
 const one=ceil(rate*BigInt(p.durationSeconds),3600n),limit=min(available,max(n(p.dailyCapMicrousd)-day,0n),n(p.sessionCapMicrousd));
 const count=min(BigInt(p.maxGpus),limit/one,n(p.hourlyCapMicrousd)/rate);
 if(count===0n){r.action=day>=n(p.dailyCapMicrousd)?'wait-daily-window':'request-funding';reasons.push(r.action==='wait-daily-window'?'daily_spend_window_full':'insufficient_credit_above_reserve');return r;}
 r.action='start-simulated-session';r.gpuCount=Number(count);r.reservationMicrousd=String(one*count);r.hourlyMicrousd=String(rate*count);r.durationSeconds=p.durationSeconds;r.runwaySeconds=String(available*3600n/(rate*count));return r;
}

export function operatingFundingPolicy(amount){
 if(!['500','1000'].includes(amount))throw Error('invalid_operating_preset');
 const target=BigInt(amount)*1000000n;
 return {...DEFAULT_DRY_RULES,providerLowMicrousd:String(target/2n),providerTargetMicrousd:String(target),cardBufferMicrousd:'25000000',maxCardFloatMicrousd:String(target+100000000n),maxTransferUnits:'2000000',maxDailyUnits:'3000000',hourlyMicrousd:'8000000'};
}

// Receives only simulation funding jobs. No provider client, signer or GPU executor.
export class FleetBudgetSimulation {
 #db;#jobs;#timer=null;
 constructor(path,{fundingJobs}={}){
  this.#jobs=fundingJobs;this.#db=new DatabaseSync(path);
  const tables=this.#db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  if(tables.some(t=>!['fleet_sim_meta','fleet_sim_worlds'].includes(t.name))){this.#db.close();throw Error('fleet_simulation_database_required');}
  this.#db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS fleet_sim_meta(k TEXT PRIMARY KEY,v TEXT NOT NULL); CREATE TABLE IF NOT EXISTS fleet_sim_worlds(id TEXT PRIMARY KEY,job TEXT UNIQUE NOT NULL,body TEXT NOT NULL);");
  const mode=this.#db.prepare("SELECT v FROM fleet_sim_meta WHERE k='mode'").get();if(mode&&mode.v!=='simulation'){this.#db.close();throw Error('fleet_simulation_database_required');}this.#db.prepare("INSERT OR IGNORE INTO fleet_sim_meta VALUES ('mode','simulation')").run();
 }
 #tx(fn){this.#db.exec('BEGIN IMMEDIATE');try{const out=fn();this.#db.exec('COMMIT');return out;}catch(e){this.#db.exec('ROLLBACK');throw e;}}
 get(id){const row=this.#db.prepare('SELECT body FROM fleet_sim_worlds WHERE id=?').get(id);return row?JSON.parse(row.body):null;}
 #save(w){this.#db.prepare('UPDATE fleet_sim_worlds SET body=? WHERE id=?').run(JSON.stringify(w),w.id);}
 #event(w,kind,detail={}){w.events.push({atSimulationSecond:w.time,kind,...detail});w.events=w.events.slice(-200);}
 attach(jobId,policy=FLEET_POLICY){
  const j=this.#jobs.get(jobId),p=validateFleetPolicy(policy);if(j?.mode!=='simulation'||j.terms?.destination!=='SIMULATED_SOLCARD_ONLY')throw Error('simulation_funding_required');
  return this.#tx(()=>{const id='fleet-'+hash(jobId).slice(0,24),old=this.get(id);if(old){if(JSON.stringify(old.policy)!==JSON.stringify(p))throw Error('fleet_policy_locked');return old;}
   if(this.#db.prepare('SELECT count(*) AS n FROM fleet_sim_worlds').get().n>=100)throw Error('fleet_case_limit');
   const w={id,jobId,mode:'simulation',policy:p,time:0,creditMicrousd:'0',spentMicrousd:'0',receipt:null,paused:false,fault:null,latch:null,priceMicrousd:'1000000',baselineMicrousd:'1000000',sessions:[],events:[],fundingRequest:null};
   this.#event(w,'attached',{jobId});this.#db.prepare('INSERT INTO fleet_sim_worlds VALUES (?,?,?)').run(id,jobId,JSON.stringify(w));return w;});
 }
 createPreset(amount){
  const job=this.#jobs.create(operatingFundingPolicy(amount),'success',{fixture:'operating-'+amount+'-v1'});
  return this.attach(job.id,{...FLEET_POLICY,operatingCapMicrousd:String(BigInt(amount)*1000000n),dailyCapMicrousd:String(BigInt(amount)*1000000n)});
 }
 #settle(w,elapsed,stop=false){
  const active=w.sessions.find(s=>s.state==='running');if(!active)return;
  active.elapsed=Math.min(active.durationSeconds,active.elapsed+elapsed);
  const charge=ceil(n(active.hourlyMicrousd)*BigInt(active.elapsed),3600n);const delta=charge-n(active.spentMicrousd);
  if(delta<0n||charge>n(active.reservationMicrousd))throw Error('invalid_simulated_charge');
  w.spentMicrousd=String(n(w.spentMicrousd)+delta);active.spentMicrousd=String(charge);
  if(stop||active.elapsed===active.durationSeconds){active.state=stop?'stopped':'completed';active.ended=w.time;this.#event(w,stop?'simulated-wind-down':'session-completed',{sessionId:active.id,spentMicrousd:active.spentMicrousd});}
 }
 #input(w,j){
  const active=w.sessions.find(s=>s.state==='running'),reserved=active?n(active.reservationMicrousd)-n(active.spentMicrousd):0n;
  // Charge the full session at admission for the rolling-day limit. A session
  // remains charged for 24h after ending; this is intentionally conservative.
  const day=w.sessions.filter(s=>s.state==='running'||w.time-(s.ended??s.started)<86400).reduce((sum,s)=>sum+(s.state==='running'?n(s.reservationMicrousd):n(s.spentMicrousd)),0n);
  return {creditMicrousd:w.creditMicrousd,spentMicrousd:w.spentMicrousd,reservedMicrousd:String(reserved),dayCommittedMicrousd:String(day),gpuHourlyMicrousd:w.fault==='price-spike'?'4000000':w.priceMicrousd,baselineHourlyMicrousd:w.baselineMicrousd,fundingVerified:!!w.receipt&&j?.state==='complete',feedFresh:w.fault!=='stale-feed',balanceConsistent:w.fault!=='balance-mismatch',activeSession:!!active};
 }
 step(id,seconds=0){
  if(!Number.isInteger(seconds)||seconds<0||seconds>21600)throw Error('invalid_simulation_time_step');
  return this.#tx(()=>{
   const w=this.get(id);if(!w)throw Error('unknown_fleet_simulation');const j=this.#jobs.get(w.jobId);
   w.time+=seconds;this.#settle(w,seconds);
   if(j?.state==='complete'){
    const r=j.providerReceipt;
    if(r?.source!=='simulation'||r.jobId!==j.id||r.cardReceiptId!==j.cardReceipt?.id||n(r.netMicrousd)!==n(j.balances.projectProviderMicrousd))w.latch='funding_receipt_mismatch';
    else if(w.receipt&&JSON.stringify(w.receipt)!==JSON.stringify(r))w.latch='funding_receipt_changed';
    else if(!w.receipt){w.receipt=structuredClone(r);w.creditMicrousd=r.netMicrousd;this.#event(w,'project-credit-imported',{receiptId:r.id,amountMicrousd:r.netMicrousd});}
   }else if(w.receipt)w.latch='funding_evidence_disappeared';
   const input=this.#input(w,j),decision=planFleetBudget(input,w.policy);
   const abnormal=decision.reasons.find(r=>['stale_funding_or_quote','provider_balance_mismatch','operating_exposure_exceeded','abnormal_gpu_price','budget_accounting_mismatch'].includes(r));
   if(abnormal&&!w.latch){w.latch=abnormal;this.#event(w,'anomaly-hold',{reason:abnormal});}
   if(w.paused||w.latch){this.#settle(w,0,true);w.decision={...decision,action:'paused',reasons:[w.latch??'owner_paused_simulation']};}
   else if(decision.action==='start-simulated-session'){
    const session={id:w.id+'-'+(w.sessions.length+1),state:'running',started:w.time,elapsed:0,spentMicrousd:'0',gpuCount:decision.gpuCount,hourlyMicrousd:decision.hourlyMicrousd,reservationMicrousd:decision.reservationMicrousd,durationSeconds:decision.durationSeconds};w.sessions.push(session);w.fundingRequest=null;w.decision=decision;this.#event(w,'automatic-session-admitted',{sessionId:session.id,gpuCount:session.gpuCount,reservationMicrousd:session.reservationMicrousd});
   }else {w.decision=decision;if(decision.action==='request-funding'&&!w.fundingRequest){w.fundingRequest={state:'requested-simulation-only',created:w.time,reason:'credit_above_reserve_insufficient',amountMicrousd:String(max(n(w.policy.operatingCapMicrousd)-(n(w.creditMicrousd)-n(w.spentMicrousd)),0n))};this.#event(w,'funding-requested',w.fundingRequest);}}
   this.#save(w);return w;
  });
 }
 control(id,action){return this.#tx(()=>{const w=this.get(id);if(!w)throw Error('unknown_fleet_simulation');
  if(action==='pause'){w.paused=true;this.#settle(w,0,true);}
  else if(action==='resume'){if(w.fault)throw Error('clear_simulated_fault_first');w.paused=false;w.latch=null;}
  else if(['price-spike','balance-mismatch','stale-feed'].includes(action)){w.fault=action;}
  else if(action==='clear-fault'){w.fault=null;}
  else throw Error('unknown_fleet_control');this.#event(w,action);this.#save(w);return w;});}
 tick(){for(const row of this.#db.prepare('SELECT id FROM fleet_sim_worlds').all())this.step(row.id,60);}
 status(){return {mode:'simulation',running:!!this.#timer,rentalExecutionEnabled:false,paymentsEnabled:false,gpuExperimentsEnabled:false,quoteSource:'Invented $1/GPU-hour; no availability or price claim',clock:'60 simulated seconds per 3 real seconds; manual advance up to 6h',worlds:this.#db.prepare('SELECT body FROM fleet_sim_worlds ORDER BY rowid DESC').all().map(r=>JSON.parse(r.body)),workerError:this.#db.prepare("SELECT v FROM fleet_sim_meta WHERE k='worker-error'").get()?.v??null};}
 start(){if(this.#timer)return;this.#timer=setInterval(()=>{try{this.tick();this.#db.prepare("DELETE FROM fleet_sim_meta WHERE k='worker-error'").run();}catch{this.#db.prepare("INSERT INTO fleet_sim_meta VALUES ('worker-error','fleet_simulation_held') ON CONFLICT(k) DO UPDATE SET v=excluded.v").run();}},3000);this.#timer.unref();}
 close(){clearInterval(this.#timer);this.#timer=null;this.#db.close();}
}

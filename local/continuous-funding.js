import {DatabaseSync} from 'node:sqlite';
import {FLEET_POLICY,planFleetBudget} from './fleet-budget.js';

const n = v => { if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,17})$/.test(v)) throw Error('invalid_simulation_amount'); return BigInt(v); };
const min=(...v)=>v.reduce((a,b)=>a<b?a:b), max=(a,b)=>a>b?a:b;
const USD=1000000n, UNIT_USD=1000n; // Invented $100,000/WBTC, 8 decimals. Never an executable quote.
export const REPLENISHMENT_POLICY=Object.freeze({minBatchMicrousd:'100000000',maxBatchMicrousd:'500000000',maxExposureMicrousd:'500000000',dailyConversionMicrousd:'1000000000',treasuryReserveUnits:'100000',providerReserveMicrousd:'50000000',targetHours:48,lowHours:12,feeWindowHours:72,capitalHorizonHours:168});
const freshWorld=()=>({mode:'simulation',time:0,paused:false,fault:null,latch:null,fees:[],treasuryUnits:'0',otherUnits:'0',reservedUnits:'0',cardMicrousd:'0',providerMicrousd:'0',creditedMicrousd:'0',spentMicrousd:'0',jobs:[],sessions:[],sessionSequence:0,events:[],decision:'Awaiting sample fees'});

// One shared, finite simulated treasury. No network clients, keys or execution adapters.
export class ContinuousFundingSimulation {
 #db; #timer=null;
 constructor(path){
  this.#db=new DatabaseSync(path);
  const tables=this.#db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  if(tables.some(t=>!['continuous_sim_meta','continuous_sim_state'].includes(t.name))){this.#db.close();throw Error('continuous_simulation_database_required');}
  this.#db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS continuous_sim_meta(k TEXT PRIMARY KEY,v TEXT NOT NULL); CREATE TABLE IF NOT EXISTS continuous_sim_state(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL);');
  const mode=this.#db.prepare("SELECT v FROM continuous_sim_meta WHERE k='mode'").get();
  if(mode&&mode.v!=='simulation'){this.#db.close();throw Error('continuous_simulation_database_required');}
  this.#db.prepare("INSERT OR IGNORE INTO continuous_sim_meta VALUES ('mode','simulation')").run();
  this.#db.prepare('INSERT OR IGNORE INTO continuous_sim_state VALUES (1,?)').run(JSON.stringify(freshWorld()));
 }
 get(){return JSON.parse(this.#db.prepare('SELECT body FROM continuous_sim_state WHERE id=1').get().body);}
 #tx(fn){
  this.#db.exec('BEGIN IMMEDIATE');
  try {const w=this.get();fn(w);this.#check(w);this.#db.prepare('UPDATE continuous_sim_state SET body=? WHERE id=1').run(JSON.stringify(w));this.#db.exec('COMMIT');return w;}
  catch(e){this.#db.exec('ROLLBACK');throw e;}
 }
 #event(w,kind,detail={}){w.events.push({time:w.time,kind,...detail});w.events=w.events.slice(-200);}
 #check(w){
  const fees=w.fees.reduce((a,f)=>a+n(f.computeUnits),0n), deposited=w.jobs.filter(j=>['awaiting-card','awaiting-provider','complete'].includes(j.state)).reduce((a,j)=>a+n(j.units),0n);
  const pending=w.jobs.filter(j=>j.state!=='complete');
  if(pending.length>1||fees!==n(w.treasuryUnits)+deposited||n(w.reservedUnits)>n(w.treasuryUnits))throw Error('continuous_treasury_mismatch');
  const inflight=w.jobs.filter(j=>j.state==='awaiting-card').reduce((a,j)=>a+n(j.amountMicrousd),0n);
  if(deposited*UNIT_USD!==n(w.cardMicrousd)+n(w.providerMicrousd)+n(w.spentMicrousd)+inflight)throw Error('continuous_credit_mismatch');
  if(n(w.providerMicrousd)+n(w.spentMicrousd)!==n(w.creditedMicrousd))throw Error('continuous_provider_mismatch');
  const reservedUsd=n(w.reservedUnits)*UNIT_USD;
  if(n(w.providerMicrousd)+n(w.cardMicrousd)+inflight+reservedUsd>n(REPLENISHMENT_POLICY.maxExposureMicrousd))throw Error('continuous_exposure_exceeded');
 }
 addFees(id,totalUnits){
  if(!/^[a-zA-Z0-9_-]{1,64}$/.test(id??'')||n(totalUnits)===0n||n(totalUnits)>100000000n)throw Error('invalid_sample_fee');
  return this.#tx(w=>{
   const old=w.fees.find(f=>f.id===id);if(old){if(old.totalUnits!==totalUnits)throw Error('sample_fee_conflict');return;}
   if(w.fees.length>=1000)throw Error('simulation_history_limit');
   const compute=n(totalUnits)*70n/100n,other=n(totalUnits)-compute;
   w.fees.push({id,time:w.time,totalUnits,computeUnits:String(compute),otherUnits:String(other),source:'simulation'});
   w.treasuryUnits=String(n(w.treasuryUnits)+compute);w.otherUnits=String(n(w.otherUnits)+other);
   this.#event(w,'sample-fees-confirmed',{id,computeUnits:String(compute)});
  });
 }
 #budget(w){
  const p=REPLENISHMENT_POLICY;
  const recent=w.fees.filter(f=>w.time-f.time<p.feeWindowHours*3600).reduce((a,f)=>a+n(f.computeUnits)*UNIT_USD,0n);
  const cash=max(n(w.treasuryUnits)-n(p.treasuryReserveUnits),0n)*UNIT_USD+n(w.cardMicrousd)+max(n(w.providerMicrousd)-n(p.providerReserveMicrousd),0n);
  // Realized income over a fixed window, or a finite seven-day capital drawdown.
  // Both are further bounded by a 48h cash runway and the owner example caps.
  const hourly=min(n(FLEET_POLICY.hourlyCapMicrousd),max(recent/BigInt(p.feeWindowHours),cash/BigInt(p.capitalHorizonHours)),cash/48n);
  const count=Number(min(BigInt(FLEET_POLICY.maxGpus),hourly/USD));
  return {hourlyMicrousd:String(BigInt(count)*USD),gpuCount:count,recentFeeMicrousd:String(recent)};
 }
 #stop(w){const active=w.sessions.find(s=>s.state==='running');if(active){active.state='stopped';active.ended=w.time;this.#event(w,'simulated-session-stopped',{id:active.id});}}
 #spend(w,seconds){
  const s=w.sessions.find(s=>s.state==='running');if(!s)return;
  const elapsed=Math.min(s.durationSeconds,s.elapsed+seconds),spent=(n(s.hourlyMicrousd)*BigInt(elapsed)+3599n)/3600n,delta=spent-n(s.spentMicrousd);
  if(delta>n(w.providerMicrousd)||spent>n(s.reservationMicrousd))throw Error('continuous_overspend');
  w.providerMicrousd=String(n(w.providerMicrousd)-delta);w.spentMicrousd=String(n(w.spentMicrousd)+delta);s.spentMicrousd=String(spent);s.elapsed=elapsed;
  if(elapsed===s.durationSeconds){s.state='completed';s.ended=w.time;}
 }
 #fund(w,budget){
  const p=REPLENISHMENT_POLICY, pending=w.jobs.find(j=>j.state!=='complete');
  if(pending){
   if(pending.state==='proposed'){pending.state='awaiting-chain';pending.attempts=1;this.#event(w,'simulated-transfer-submitted',{id:pending.id});}
   else if(pending.state==='awaiting-chain'){
    if(w.fault==='unknown-transfer'){w.latch='unknown-transfer';w.decision='Uncertain transfer: reservation retained; no retry';return;}
    pending.chainReceipt={id:pending.id+'-chain',source:'simulation',jobId:pending.id,units:pending.units};
    w.treasuryUnits=String(n(w.treasuryUnits)-n(pending.units));w.reservedUnits='0';pending.state='awaiting-card';
   }else if(pending.state==='awaiting-card'){
    pending.cardReceipt={id:pending.id+'-card',source:'simulation',chainId:pending.chainReceipt.id,netMicrousd:pending.amountMicrousd};
    w.cardMicrousd=String(n(w.cardMicrousd)+n(pending.amountMicrousd));pending.state='awaiting-provider';
   }else if(pending.state==='awaiting-provider'){
    if(w.fault==='receipt-mismatch'){w.latch='receipt-mismatch';w.decision='Provider evidence mismatch: credit held';return;}
    pending.providerReceipt={id:pending.id+'-provider',source:'simulation',cardReceiptId:pending.cardReceipt.id,netMicrousd:pending.amountMicrousd};
    w.cardMicrousd=String(n(w.cardMicrousd)-n(pending.amountMicrousd));w.providerMicrousd=String(n(w.providerMicrousd)+n(pending.amountMicrousd));w.creditedMicrousd=String(n(w.creditedMicrousd)+n(pending.amountMicrousd));
    pending.state='complete';pending.completed=w.time;this.#event(w,'simulated-refill-confirmed',{id:pending.id,amountMicrousd:pending.amountMicrousd});
   }
   w.decision='Funding cycle: '+pending.state;return;
  }
  if(!budget.gpuCount){w.decision='Fees/reserves cannot sustain one simulated GPU';return;}
  const hourly=n(budget.hourlyMicrousd),balance=n(w.providerMicrousd);
  const low=max(100n*USD,hourly*BigInt(p.lowHours)+n(p.providerReserveMicrousd));
  if(balance>low){w.decision='Runway sufficient; surplus stays in WBTC';return;}
  const target=min(n(p.maxExposureMicrousd),max(n(p.minBatchMicrousd),hourly*BigInt(p.targetHours)+n(p.providerReserveMicrousd)));
  const day=w.jobs.filter(j=>w.time-j.created<86400).reduce((a,j)=>a+n(j.amountMicrousd),0n);
  const available=max(n(w.treasuryUnits)-n(p.treasuryReserveUnits),0n)*UNIT_USD;
  let amount=min(max(target-balance,n(p.minBatchMicrousd)),n(p.maxBatchMicrousd),max(n(p.maxExposureMicrousd)-balance-n(w.cardMicrousd),0n),max(n(p.dailyConversionMicrousd)-day,0n),available);
  amount=amount/UNIT_USD*UNIT_USD; // Round down; never exceed cash or caps.
  if(amount<n(p.minBatchMicrousd)){w.decision='Waiting for treasury funds or conversion budget; no sub-$100 top-up';return;}
  if(w.jobs.length>=1000){w.paused=true;this.#stop(w);w.decision='Simulation history limit reached';return;}
  const job={id:'continuous-'+(w.jobs.length+1),source:'simulation',created:w.time,state:'proposed',units:String(amount/UNIT_USD),amountMicrousd:String(amount),attempts:0};
  w.jobs.push(job);w.reservedUnits=job.units;w.decision='Low runway: funding batch reserved';this.#event(w,'simulated-refill-reserved',{id:job.id,amountMicrousd:job.amountMicrousd});
 }
 #fleet(w,budget){
  if(!budget.gpuCount){this.#stop(w);return;}
  const active=w.sessions.find(s=>s.state==='running');
  if(active&&active.gpuCount>budget.gpuCount)this.#stop(w); // Shrink immediately; grow at the next session.
  const running=w.sessions.find(s=>s.state==='running');
  const day=w.sessions.filter(s=>s.state==='running'||w.time-(s.ended??s.started)<86400).reduce((a,s)=>a+n(s.state==='running'?s.reservationMicrousd:s.spentMicrousd),0n);
  // Present current unspent credit to the shared planner; lifetime totals stay in this ledger.
  const decision=planFleetBudget({creditMicrousd:w.providerMicrousd,spentMicrousd:'0',reservedMicrousd:running?String(n(running.reservationMicrousd)-n(running.spentMicrousd)):'0',dayCommittedMicrousd:String(day),gpuHourlyMicrousd:String(USD),baselineHourlyMicrousd:String(USD),fundingVerified:n(w.creditedMicrousd)>0n,feedFresh:true,balanceConsistent:true,activeSession:!!running},{...FLEET_POLICY,maxGpus:budget.gpuCount,hourlyCapMicrousd:budget.hourlyMicrousd,durationSeconds:3600});
  w.fleetDecision=decision;
  if(decision.action==='start-simulated-session'){
   const s={id:'continuous-session-'+(++w.sessionSequence),started:w.time,state:'running',elapsed:0,spentMicrousd:'0',durationSeconds:3600,gpuCount:decision.gpuCount,hourlyMicrousd:decision.hourlyMicrousd,reservationMicrousd:decision.reservationMicrousd};w.sessions.push(s);
  }
 }
 step(seconds=60){
  if(!Number.isInteger(seconds)||seconds<0||seconds>21600||seconds%60)throw Error('invalid_continuous_time_step');
  return this.#tx(w=>{
   for(let i=0;i<Math.max(1,seconds/60);i++){
    w.time+=seconds?60:0;
    if(w.paused||w.latch){this.#stop(w);continue;}
    if(['stale-feed','price-spike'].includes(w.fault)){w.latch=w.fault;this.#stop(w);w.decision='Abnormal activity: review required';continue;}
    this.#spend(w,seconds?60:0);const budget=this.#budget(w);w.budget=budget;
    this.#fund(w,budget);if(w.latch||w.paused)this.#stop(w);else this.#fleet(w,budget);
    // Keep all jobs/fees for dedupe. Old sessions are irrelevant beyond the spend window.
    w.sessions=w.sessions.filter(s=>s.state==='running'||w.time-(s.ended??s.started)<172800);
    this.#check(w);
   }
  });
 }
 control(action){return this.#tx(w=>{
  if(action==='pause'){w.paused=true;this.#stop(w);}
  else if(action==='resume'){if(w.fault||w.latch)throw Error('resolve_simulated_anomaly_first');w.paused=false;}
  else if(action==='resolve'){w.fault=null;w.latch=null;w.paused=true;this.#stop(w);this.#event(w,'synthetic-evidence-resolved');}
  else if(['unknown-transfer','receipt-mismatch','stale-feed','price-spike'].includes(action))w.fault=action;
  else throw Error('unknown_continuous_control');this.#event(w,action);
 });}
 status(){return {mode:'simulation',running:!!this.#timer,paymentsEnabled:false,rentalExecutionEnabled:false,broadcastEnabled:false,policy:REPLENISHMENT_POLICY,world:this.get(),workerError:this.#db.prepare("SELECT v FROM continuous_sim_meta WHERE k='error'").get()?.v??null};}
 start(){if(this.#timer)return;this.#timer=setInterval(()=>{try{this.step();this.#db.prepare("DELETE FROM continuous_sim_meta WHERE k='error'").run();}catch{this.#db.prepare("INSERT INTO continuous_sim_meta VALUES ('error','continuous_simulation_held') ON CONFLICT(k) DO UPDATE SET v=excluded.v").run();}},3000);this.#timer.unref();}
 close(){clearInterval(this.#timer);this.#timer=null;this.#db.close();}
}

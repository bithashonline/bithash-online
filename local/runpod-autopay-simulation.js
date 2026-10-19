import {DatabaseSync} from 'node:sqlite';

const n=v=>{if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,17})$/.test(v))throw Error('autopay_invalid_amount');return BigInt(v);};
const max=(a,b)=>a>b?a:b;
export const AUTOPAY_FLAGS=Object.freeze({signingEnabled:false,broadcastEnabled:false,paymentsEnabled:false,rentalExecutionEnabled:false,gpuExperimentsEnabled:false,automaticCreditPosting:false});
export const AUTOPAY_POLICY=Object.freeze({reloadMicrousd:'100000000',thresholdMicrousd:'50000000',leadMinutes:120,depositMinutes:30,reloadMinutes:2,unknownAfterMinutes:120,cooldownMinutes:60,dailyDepositMicrousd:'1000000000',dailyReloadMicrousd:'1000000000',maxFloatMicrousd:'500000000',retainedWbtcUnits:'100000'});
export const AUTOPAY_CASES=['normal','delayed-reload','declined-card','unknown-reload','mismatched-reload','insufficient-treasury','daily-limit'];

// A pure forecast. No setting here changes a provider account or grants authority.
export function planAutoPay(i){
 const p=AUTOPAY_POLICY,card=n(i.cardMicrousd),provider=n(i.providerMicrousd),hourly=n(i.hourlyMicrousd),reload=n(p.reloadMicrousd);
 const trigger=n(p.thresholdMicrousd)+(hourly*BigInt(p.leadMinutes)+59n)/60n;
 const result={mode:'simulation-policy',action:'wait',reason:'runway_sufficient',cardFundingMicrousd:'0',reloadMicrousd:p.reloadMicrousd,earlyTriggerMicrousd:String(trigger),...AUTOPAY_FLAGS};
 const finish=(action,reason)=>({...result,action,reason});
 if(i.hold)return finish('hold',i.hold);
 if(i.fresh!==true)return finish('hold','observations_stale');
 if(i.pendingReload)return finish('wait','reload_pending_no_duplicate_funding');
 if(i.pendingDeposit)return finish('wait','card_deposit_pending');
 if(hourly===0n)return finish('idle','no_active_compute_burn');
 if(provider>trigger)return result;
 if(card<reload){
  // $100 minimum deposit batches; retain existing card funds and do not sweep surplus.
  const amount=max(reload-card,100000000n);
  if(card+provider+amount>n(p.maxFloatMicrousd))return finish('hold','float_limit');
  if(n(i.dailyDepositMicrousd??'0')+amount>n(p.dailyDepositMicrousd))return finish('hold','daily_deposit_limit');
  if(i.availableTreasuryMicrousd!==undefined&&amount>n(i.availableTreasuryMicrousd))return finish('hold','insufficient_treasury');
  return {...finish('would-fund-card','fund_card_before_reload_threshold'),cardFundingMicrousd:String(amount)};
 }
 if(provider>n(p.thresholdMicrousd))return finish('ready','card_ready_surplus_stays_in_wbtc');
 if(n(i.dailyReloadMicrousd??'0')+reload>n(p.dailyReloadMicrousd))return finish('hold','daily_reload_limit');
 if(i.cooldown===true)return finish('wait','hourly_reload_cooldown');
 return finish('would-observe-reload','native_reload_threshold_reached');
}

export function autoPayObservation(records,hourlyMicrousd,now=Date.now()){
 const f=records?.feeds,card=f?.solcard,provider=f?.runpod;
 const fresh=[card,provider].every(x=>x?.state==='connected'&&x.fresh===true&&Number.isFinite(Date.parse(x.data?.observedAt))&&now>=Date.parse(x.data.observedAt)&&now-Date.parse(x.data.observedAt)<=300000);
 try{return {...planAutoPay({cardMicrousd:card?.data?.balanceMicrousd??'0',providerMicrousd:provider?.data?.balanceMicrousd??'0',hourlyMicrousd:hourlyMicrousd??'0',fresh}),basis:'read-only balances + hypothetical policy; no fee attribution or spending authority',settingsVerified:false,actualAutoPayState:'not-polled',cardMicrousd:card?.data?.balanceMicrousd??null,providerMicrousd:provider?.data?.balanceMicrousd??null};}
 catch{return {mode:'simulation-policy',action:'hold',reason:'invalid_observation',settingsVerified:false,actualAutoPayState:'not-polled',...AUTOPAY_FLAGS};}
}

const UNIT_USD=1000n; // Invented $100,000/WBTC. No conversion quote is fetched.
function world(scenario){
 const treasuryUnits=scenario==='insufficient-treasury'?'150000':'700000';
 return {version:1,mode:'simulation',scenario,id:'autopay-'+scenario,time:0,paused:false,hold:null,treasuryUnits,otherUnits:'300000',card:'0',provider:'75000000',legacy:'75000000',funded:'0',spent:'0',spendRemainder:'0',hourly:'20000000',initialTotal:String(n(treasuryUnits)*UNIT_USD+75000000n),deposits:[],reloads:[],receipts:{},events:[],decision:null};
}
function conservation(w){
 const transit=w.reloads.filter(r=>r.state==='pending').reduce((a,r)=>a+n(r.amount),0n);
 if(n(w.treasuryUnits)*UNIT_USD+n(w.card)+n(w.provider)+transit+n(w.spent)!==n(w.initialTotal)||n(w.legacy)+n(w.funded)!==n(w.provider))throw Error('autopay_conservation_failed');
 if(w.deposits.filter(d=>d.state==='pending').length>1||w.reloads.filter(r=>r.state==='pending').length>1)throw Error('autopay_duplicate_pending');
}
function event(w,kind,id){w.events.push({minute:w.time,kind,id});w.events=w.events.slice(-80);}
function receipt(w,r){
 if(r?.source!=='simulation'||typeof r.id!=='string'||!/^sim-reload-[0-9]+$/.test(r.id))throw Error('autopay_sample_receipt_required');
 const encoded=JSON.stringify({id:r.id,jobId:r.jobId,amount:r.amount,source:r.source});
 if(w.receipts[r.id]){if(w.receipts[r.id]!==encoded)throw Error('autopay_receipt_changed');return;}
 const job=w.reloads.find(j=>j.id===r.jobId);
 if(!job||job.state!=='pending'||job.amount!==r.amount||r.id!==job.receiptId)throw Error('autopay_reload_mismatch');
 w.receipts[r.id]=encoded;job.state='complete';job.completed=w.time;
 w.provider=String(n(w.provider)+n(r.amount));w.funded=String(n(w.funded)+n(r.amount));event(w,'simulated-provider-credit-matched',job.id);
}

// Isolated finite ledger. No provider, wallet, payment or GPU clients are accepted.
export class RunpodAutoPaySimulation{
 #db;#timer=null;
 constructor(path){
  this.#db=new DatabaseSync(path);
  const tables=this.#db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  if(tables.some(t=>t.name!=='autopay_sim_cases')){this.#db.close();throw Error('autopay_separate_database_required');}
  this.#db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS autopay_sim_cases(id TEXT PRIMARY KEY,body TEXT NOT NULL);');
  for(const w of this.#all())if(w.mode!=='simulation'||w.version!==1){this.#db.close();throw Error('autopay_simulation_database_required');}
 }
 #all(){return this.#db.prepare('SELECT body FROM autopay_sim_cases ORDER BY rowid').all().map(r=>JSON.parse(r.body));}
 get(id){const row=this.#db.prepare('SELECT body FROM autopay_sim_cases WHERE id=?').get(id);if(!row)throw Error('autopay_case_missing');return JSON.parse(row.body);}
 #tx(id,fn){this.#db.exec('BEGIN IMMEDIATE');try{const w=this.get(id);fn(w);conservation(w);this.#db.prepare('UPDATE autopay_sim_cases SET body=? WHERE id=?').run(JSON.stringify(w),id);this.#db.exec('COMMIT');return w;}catch(e){this.#db.exec('ROLLBACK');throw e;}}
 create(scenario){if(!AUTOPAY_CASES.includes(scenario))throw Error('autopay_invalid_scenario');const w=world(scenario);this.#db.prepare('INSERT OR IGNORE INTO autopay_sim_cases VALUES (?,?)').run(w.id,JSON.stringify(w));return this.get(w.id);}
 #minute(w){
  if(w.paused||w.hold)return;
  w.time++;
  const raw=n(w.hourly)+n(w.spendRemainder),requested=raw/60n,spent=requested<n(w.provider)?requested:n(w.provider),legacy=spent<n(w.legacy)?spent:n(w.legacy);
  w.spendRemainder=String(raw%60n);w.provider=String(n(w.provider)-spent);w.spent=String(n(w.spent)+spent);w.legacy=String(n(w.legacy)-legacy);w.funded=String(n(w.funded)-(spent-legacy));
  const d=w.deposits.find(d=>d.state==='pending');
  if(d&&w.time-d.at>=AUTOPAY_POLICY.depositMinutes){w.treasuryUnits=String(n(w.treasuryUnits)-n(d.units));w.card=String(n(w.card)+n(d.amount));d.state='complete';event(w,'simulated-card-credit',d.id);}
  const r=w.reloads.find(r=>r.state==='pending');
  if(r){
   const delay=w.scenario==='delayed-reload'?90:AUTOPAY_POLICY.reloadMinutes;
   if(w.scenario==='unknown-reload'){if(w.time-r.at>=AUTOPAY_POLICY.unknownAfterMinutes)w.hold='reload_outcome_unknown';}
   else if(w.time-r.at>=delay){try{receipt(w,{source:'simulation',id:r.receiptId,jobId:r.id,amount:w.scenario==='mismatched-reload'?'80000000':r.amount});}catch(e){w.hold=e.message;}}
  }
  const pendingDeposit=w.deposits.some(d=>d.state==='pending'),pendingReload=w.reloads.some(r=>r.state==='pending');
  const day=items=>items.filter(j=>w.time-j.at<1440).reduce((a,j)=>a+n(j.amount),0n);
  const depositDay=w.scenario==='daily-limit'?n(AUTOPAY_POLICY.dailyDepositMicrousd):day(w.deposits);
  const last=w.reloads.at(-1),available=n(w.treasuryUnits)>n(AUTOPAY_POLICY.retainedWbtcUnits)?(n(w.treasuryUnits)-n(AUTOPAY_POLICY.retainedWbtcUnits))*UNIT_USD:0n;
  const decision=planAutoPay({cardMicrousd:w.card,providerMicrousd:w.provider,hourlyMicrousd:w.hourly,fresh:true,pendingDeposit,pendingReload,hold:w.hold,availableTreasuryMicrousd:String(available),dailyDepositMicrousd:String(depositDay),dailyReloadMicrousd:String(day(w.reloads)),cooldown:!!last&&w.time-last.at<AUTOPAY_POLICY.cooldownMinutes});w.decision=decision;
  if(w.deposits.length>=100||w.reloads.length>=100){w.hold='simulation_history_limit';return;}
  if(decision.action==='would-fund-card'){
   const amount=decision.cardFundingMicrousd,id='sim-deposit-'+(w.deposits.length+1);w.deposits.push({id,at:w.time,state:'pending',amount,units:String(n(amount)/UNIT_USD),attempts:1});event(w,'simulated-wbtc-deposit-reserved',id);
  }else if(decision.action==='would-observe-reload'){
   const id='sim-reload-'+(w.reloads.length+1),job={id,receiptId:id,at:w.time,state:'pending',amount:AUTOPAY_POLICY.reloadMicrousd,attempts:1};
   if(w.scenario==='declined-card'){job.state='declined';w.hold='card_declined_no_operator_retry';}else w.card=String(n(w.card)-n(job.amount));
   w.reloads.push(job);event(w,'simulated-native-reload-attempt',id);
  }
 }
 step(id,minutes=1){if(!Number.isInteger(minutes)||minutes<1||minutes>360)throw Error('autopay_invalid_step');return this.#tx(id,w=>{for(let m=0;m<minutes;m++)this.#minute(w);});}
 observeSampleReceipt(id,r){return this.#tx(id,w=>receipt(w,r));}
 control(id,action){if(!['pause','resume'].includes(action))throw Error('autopay_invalid_control');return this.#tx(id,w=>{if(action==='resume'&&w.hold)throw Error('autopay_review_required');w.paused=action==='pause';});}
 status(){return {mode:'simulation',running:!!this.#timer,policy:AUTOPAY_POLICY,realAutoPayControl:'not-connected',...AUTOPAY_FLAGS,cases:this.#all()};}
 start(){if(this.#timer)return;this.#timer=setInterval(()=>{for(const w of this.#all())try{this.step(w.id);}catch{this.#tx(w.id,x=>{x.hold='simulation_worker_error';});}},3000);this.#timer.unref();}
 close(){clearInterval(this.#timer);this.#timer=null;this.#db.close();}
}

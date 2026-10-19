import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {scanFees,feeAddresses,readComputeGas} from './fee-detection.js';
import {readTreasuryWallets} from './treasury-wallet.js';
import {feeAllocation,WBTC} from './treasury-compute.js';

// Example dry-run settings, not approved spending limits or a conversion quote.
export const DEFAULT_DRY_RULES=Object.freeze({providerLowMicrousd:'25000000',providerTargetMicrousd:'100000000',cardBufferMicrousd:'5000000',maxCardFloatMicrousd:'150000000',maxTransferUnits:'200000',maxDailyUnits:'500000',walletReserveUnits:'10000',assumedWbtcPriceMicrousd:'100000000000',hourlyMicrousd:'0',minRunwayHours:24,minSolLamports:'5000000',maxFeeLamports:'100000'});
const number=v=>{if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,23})$/.test(v))throw Error('invalid_dry_rule_amount');return BigInt(v);};
const min=(...v)=>v.reduce((a,b)=>a<b?a:b),max=(a,b)=>a>b?a:b;
const fresh=(at,now,age=300000)=>Number.isFinite(Date.parse(at))&&now-Date.parse(at)>=0&&now-Date.parse(at)<=age;
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function validateDryRules(p){
 if(!p||Object.keys(p).sort().join()!==Object.keys(DEFAULT_DRY_RULES).sort().join())throw Error('invalid_dry_rules');
 for(const key of Object.keys(DEFAULT_DRY_RULES))if(key!=='minRunwayHours')number(p[key]);
 if(!Number.isInteger(p.minRunwayHours)||p.minRunwayHours<1||p.minRunwayHours>168||number(p.providerLowMicrousd)>=number(p.providerTargetMicrousd)||number(p.providerTargetMicrousd)+number(p.cardBufferMicrousd)>number(p.maxCardFloatMicrousd)||!number(p.assumedWbtcPriceMicrousd)||!number(p.maxTransferUnits)||number(p.maxTransferUnits)>number(p.maxDailyUnits)||!number(p.maxFeeLamports))throw Error('invalid_dry_rules');
 return structuredClone(p);
}
export function fundingReadiness(input,p,now){
 const reasons=[];
 if(!input.projectMint)reasons.push('awaiting_project_token_mint');
 if(!input.routingVerified)reasons.push('70_30_routing_not_verified');
 if(!input.historyComplete)reasons.push('fee_history_incomplete');
 if(!fresh(input.feeObservedAt,now)||input.feeError)reasons.push('fee_read_missing_or_stale');
 for(const name of ['wallet','card','provider'])if(!input[name]||input[name].error||!fresh(input[name].observedAt,now))reasons.push(name+'_read_missing_or_stale');
 if(input.card?.status!=='ACTIVE')reasons.push('card_not_active');
 if(input.pendingFunding)reasons.push('reconcile_existing_funding');
 if(!fresh(input.cardLimits?.observedAt,now,86400000))reasons.push('card_limits_need_confirmation');
 if(!input.gas||!fresh(input.gas.observedAt,now)||number(input.gas.lamports)<number(p.minSolLamports)+number(p.maxFeeLamports))reasons.push('sol_reserve_not_confirmed');
 return reasons;
}
export function decideFunding(input,policy=DEFAULT_DRY_RULES,now=Date.now()){
 const p=validateDryRules(policy),reasons=fundingReadiness(input,p,now);
 const result={mode:'dry-run',sample:input.sample===true,action:'hold',reasons,amountWbtcUnits:'0',estimatedUsdMicros:'0',priceBasis:'Owner-editable simulation assumption; not an executable SolCard quote',paymentsEnabled:false,signingEnabled:false,broadcastEnabled:false,gpuExperimentsEnabled:false};
 const finish=()=>({...result,id:digest(result).slice(0,24)});
 if(reasons.length)return finish();
 const eligible=number(input.feeComputeUnits),committed=number(input.committedUnits),wallet=number(input.wallet.amountUnits),dayUsed=number(input.dailyCommittedUnits);
 const available=min(max(eligible-committed,0n),max(wallet-number(p.walletReserveUnits),0n));
 const provider=number(input.provider.balanceMicrousd),card=number(input.card.balanceMicrousd),hourly=number(p.hourlyMicrousd);
 result.availableFeeWbtcUnits=String(available);result.runwaySeconds=hourly?String(provider*3600n/hourly):null;
 if(!hourly){reasons.push('idle_no_compute_budget_requested');return finish();}
 if(provider>=number(p.providerLowMicrousd)&&provider>=hourly*BigInt(p.minRunwayHours)){reasons.push('provider_balance_sufficient');return finish();}
 const reload=max(number(p.providerTargetMicrousd)-provider,0n);
 if(!reload){reasons.push('runway_target_exceeds_provider_target_review_rules');return finish();}
 const target=min(reload+number(p.cardBufferMicrousd),number(p.maxCardFloatMicrousd));
 if(card>=target){result.action='would_review_provider_reload';reasons.push('card_balance_covers_reload_but_project_link_and_autopay_unverified');return finish();}
 const price=number(p.assumedWbtcPriceMicrousd),required=((target-card)*100000000n+price-1n)/price;
 const cardMin=number(input.cardLimits.minUnits),cardMax=number(input.cardLimits.maxUnits);
 if(!cardMin||cardMin>cardMax)throw Error('invalid_card_limits');
 // Do not round up to a deposit minimum or float cap: accumulate fees instead.
 const n=min(required,available,number(p.maxTransferUnits),max(number(p.maxDailyUnits)-dayUsed,0n),cardMax,(number(p.maxCardFloatMicrousd)-min(card,number(p.maxCardFloatMicrousd)))*100000000n/price);
 if(n<cardMin){reasons.push(dayUsed>=number(p.maxDailyUnits)?'daily_cap_reached':'accumulate_fees_or_review_minimum');return finish();}
 result.action='would_top_up_solcard';result.amountWbtcUnits=String(n);result.estimatedUsdMicros=String(n*price/100000000n);
 reasons.push(n<required?'bounded_partial_topup':'low_provider_runway');return finish();
}

export function sampleFunding(policy=DEFAULT_DRY_RULES,now=Date.now()){
 const at=new Date(now).toISOString(),allocation=feeAllocation('1000000');
 const input={sample:true,projectMint:'SAMPLE_ONLY',routingVerified:true,historyComplete:true,feeObservedAt:at,feeComputeUnits:allocation.compute,committedUnits:'0',dailyCommittedUnits:'0',pendingFunding:false,wallet:{observedAt:at,amountUnits:allocation.compute},card:{observedAt:at,balanceMicrousd:'0',status:'ACTIVE'},provider:{observedAt:at,balanceMicrousd:'10000000'},gas:{observedAt:at,lamports:'10000000'},cardLimits:{observedAt:at,minUnits:'10000',maxUnits:'125310000'}};
 const p={...policy,hourlyMicrousd:policy.hourlyMicrousd==='0'?'1000000':policy.hourlyMicrousd};
 return {label:'SAMPLE ONLY — invented 0.01 WBTC fees, $10 provider balance, $0 card, funded SOL reserve; $1/hour if idle. No ledger posting.',generatedAt:at,totalUnits:'1000000',allocation,policy:p,decision:decideFunding(input,p,now)};
}

// A private observation journal. No executor, signer, credit-posting or payment adapter.
export class AutomaticFunding {
 constructor(path,{treasury,records,projectMint=null,clock=Date.now,scan=scanFees,readWallets=readTreasuryWallets,readGas=readComputeGas}={}){
  this.db=new DatabaseSync(path);this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS auto_settings(k TEXT PRIMARY KEY,v TEXT NOT NULL); CREATE TABLE IF NOT EXISTS auto_receipts(id TEXT PRIMARY KEY,body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS auto_processed(signature TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS auto_decisions(id INTEGER PRIMARY KEY,at TEXT NOT NULL,body TEXT NOT NULL);');
  this.treasury=treasury;this.records=records;this.clock=clock;this.scan=scan;this.readWallets=readWallets;this.readGas=readGas;this.busy=false;this.timer=null;this.flight=null;this.closed=false;this.lastRefresh=null;
  this.config=projectMint?{projectMint,...treasury.setting('wallets')}:null;
  const identity=this.get('configuration');if(this.config)feeAddresses(this.config);
  if(identity&&JSON.stringify(identity)!==JSON.stringify(this.config))throw Error('fee_observer_configuration_locked');
  if(this.config)this.set('configuration',this.config);
  if(!this.get('policy'))this.set('policy',DEFAULT_DRY_RULES);
 }
 get(k){const row=this.db.prepare('SELECT v FROM auto_settings WHERE k=?').get(k);return row?JSON.parse(row.v):null;}
 set(k,v){this.db.prepare('INSERT INTO auto_settings VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k,JSON.stringify(v));}
 savePolicy(policy){this.set('policy',validateDryRules(policy));this.evaluate();}
 sample(){const s=sampleFunding(this.get('policy'),this.clock());this.set('sample',s);return s;}
 status(){
  const receipts=this.db.prepare('SELECT body FROM auto_receipts ORDER BY rowid DESC').all().map(r=>JSON.parse(r.body));
  const fee=this.get('feeObservation'),compute=receipts.reduce((n,r)=>n+BigInt(r.computeUnits),0n);
  return {mode:'dry-run',running:!!this.timer,busy:this.busy,configuration:this.config,state:this.config?(this.get('feeError')?'unavailable':fee?.complete?'observing':'history-incomplete'):'awaiting-token-launch',routing:{computeBps:7000,otherBps:3000,computeWallet:this.treasury.setting('wallets')?.computeWallet,otherWallet:this.treasury.setting('wallets')?.otherWallet},feeObservation:fee,feeError:this.get('feeError'),detectedComputeUnits:String(compute),receiptCount:receipts.length,receipts:receipts.slice(0,20),policy:this.get('policy'),policyApproval:'simulation-only; no spending authorization',decision:this.get('decision'),sample:this.get('sample'),evaluatedAt:this.get('evaluatedAt'),history:this.db.prepare('SELECT at,body FROM auto_decisions ORDER BY id DESC LIMIT 15').all().map(r=>({at:r.at,...JSON.parse(r.body)})),paymentsEnabled:false,broadcastEnabled:false,signingEnabled:false,automaticCreditPosting:false,gpuExperimentsEnabled:false};
 }
 planningInput(){
  const s=this.treasury.snapshot(),f=this.get('feeObservation'),feeds=this.records.status().feeds,card=feeds.solcard,provider=feeds.runpod,profile=this.treasury.setting('fundingProfile'),plans=s.plans.filter(p=>p.state!=='cancelled'),now=this.clock();
  const input={projectMint:this.config?.projectMint,routingVerified:!!f?.routingVerified,historyComplete:!!f?.complete,feeObservedAt:f?.observedAt,feeError:this.get('feeError'),feeComputeUnits:this.status().detectedComputeUnits,
   committedUnits:String(plans.reduce((n,p)=>n+BigInt(p.amount),0n)),dailyCommittedUnits:String(plans.filter(p=>now-Date.parse(p.createdAt)<=86400000).reduce((n,p)=>n+BigInt(p.amount),0n)),pendingFunding:plans.some(p=>p.state!=='provider-credited'),
   wallet:s.walletObservation?{amountUnits:s.walletObservation.computeAmount,observedAt:s.walletObservation.observedAt,error:s.walletError}:null,
   card:card?.data?{observedAt:card.data.observedAt,balanceMicrousd:card.data.balanceMicrousd,status:card.data.cardStatus,error:card.error}:null,
   provider:provider?.data?{observedAt:provider.data.observedAt,balanceMicrousd:provider.data.balanceMicrousd,error:provider.error}:null,
   cardLimits:profile?.cardLimits?{observedAt:profile.cardLimits.observedAt,minUnits:profile.cardLimits.minWbtcUnits,maxUnits:profile.cardLimits.maxWbtcUnits}:null,
   gas:this.get('gasObservation')};
  return input;
 }
 coordinatorSnapshot(){return {...this.status(),input:this.planningInput(),receipts:this.db.prepare('SELECT body FROM auto_receipts ORDER BY id').all().map(r=>JSON.parse(r.body))};}
 evaluate(){
  const input=this.planningInput(),now=this.clock();
  let decision;try{decision=decideFunding(input,this.get('policy'),now);}catch{decision={mode:'dry-run',action:'hold',reasons:['invalid_observation_or_rules'],amountWbtcUnits:'0',paymentsEnabled:false,gpuExperimentsEnabled:false,id:'invalid_observation_or_rules'};}
  if(this.get('decision')?.id!==decision.id){this.db.prepare('INSERT INTO auto_decisions(at,body) VALUES (?,?)').run(new Date(now).toISOString(),JSON.stringify(decision));this.db.exec('DELETE FROM auto_decisions WHERE id NOT IN (SELECT id FROM auto_decisions ORDER BY id DESC LIMIT 500)');}
  this.set('decision',decision);this.set('evaluatedAt',new Date(now).toISOString());return decision;
 }
 refresh(){
  if(this.closed)return Promise.resolve();if(this.flight)return this.flight;
  if(this.lastRefresh!==null&&this.clock()-this.lastRefresh<30000){this.evaluate();return Promise.resolve();}this.lastRefresh=this.clock();
  this.flight=this.run().finally(()=>{this.flight=null;});return this.flight;
 }
 async run(){
  this.busy=true;
  try{
   if(this.config){
    const old=this.get('feeObservation'),batch=await this.scan(this.config,{knownSignatures:this.db.prepare('SELECT signature FROM auto_processed').all().map(r=>r.signature),previousHead:old?.head,previousComplete:old?.complete});
    this.db.exec('BEGIN IMMEDIATE');try{
     for(const r of batch.receipts){const encoded=JSON.stringify(r),oldReceipt=this.db.prepare('SELECT body FROM auto_receipts WHERE id=?').get(r.id);if(oldReceipt&&oldReceipt.body!==encoded)throw Error('conflicting_fee_receipt');this.db.prepare('INSERT OR IGNORE INTO auto_receipts VALUES (?,?)').run(r.id,encoded);}
     for(const sig of batch.processed)this.db.prepare('INSERT OR IGNORE INTO auto_processed VALUES (?)').run(sig);
     this.set('feeObservation',{...batch,receipts:undefined,processed:undefined,observedAt:new Date(this.clock()).toISOString()});this.set('feeError',null);this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
    try{this.treasury.observeWallets(await this.readWallets(this.config));}catch{this.treasury.walletUnavailable();}
    try{this.set('gasObservation',await this.readGas(this.config));}catch{this.set('gasObservation',null);}
   }
  }catch(e){this.set('feeError',/^[a-z_]{1,80}$/.test(e.message)?e.message:'fee_read_unavailable');}
  finally{this.busy=false;if(!this.closed)this.evaluate();}
 }
 start(){if(this.timer||this.closed)return;void this.refresh();this.timer=setInterval(()=>{void this.refresh();},60000);this.timer.unref();}
 async close(){this.closed=true;clearInterval(this.timer);this.timer=null;if(this.flight)await this.flight;this.db.close();}
}

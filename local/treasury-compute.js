import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {decode58} from './solana-evidence.js';

// Pump's supported-pairs list, checked 2026-10-18. This is Portal WBTC,
// not the separate native WBTC mint. No signer or payment credentials belong here.
export const WBTC = Object.freeze({symbol:'WBTC',mint:'3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh',decimals:8,program:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'});
export const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const POLICY = Object.freeze({computeBps:7000,otherTreasuryBps:3000,developmentBps:1500,rewardsBps:1500});
const units = v => {if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,23})$/.test(v))throw Error('invalid_amount');return BigInt(v);};
const positive = v => {const n=units(v);if(!n)throw Error('invalid_amount');return n;};
const identity = v => {if(typeof v!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(v))throw Error('invalid_reference');return v;};
// Internal event IDs prepend the stage to a validated external reference, which
// can be an 88-character Solana signature. Keep that prefix outside its limit.
const eventIdentity = v => {if(typeof v!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(v))throw Error('invalid_reference');return v;};
const address = v => {decode58(v,32);return v;};
const min = (a,b)=>a<b?a:b;
const iso = now=>new Date(now).toISOString();
export function parseAmount(v,decimals){if(!Number.isInteger(decimals)||decimals<0||decimals>18||typeof v!=='string'||!/^\d{1,16}(\.\d{1,18})?$/.test(v))throw Error('invalid_amount');const [whole,fraction='']=v.split('.');if(fraction.length>decimals)throw Error('too_many_decimals');return units((BigInt(whole)*10n**BigInt(decimals)+BigInt(fraction.padEnd(decimals,'0')||'0')).toString()).toString();}
export function formatAmount(v,decimals){if(v===null)return 'Unknown';const n=units(v).toString().padStart(decimals+1,'0');return decimals?n.slice(0,-decimals)+'.'+n.slice(-decimals):n;}
export function feeAllocation(total){const n=units(total),compute=n*70n/100n,other=n-compute,rewards=other/2n;return {compute:compute.toString(),other:other.toString(),development:(other-rewards).toString(),rewards:rewards.toString()};}

export class ComputeTreasury {
 constructor(path,{clock=Date.now,mode='owner-recorded'}={}){
  if(!['owner-recorded','simulation'].includes(mode))throw Error('invalid_mode');this.clock=clock;this.mode=mode;
  this.db=new DatabaseSync(path);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS treasury_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS treasury_events(id TEXT PRIMARY KEY,kind TEXT NOT NULL,body TEXT NOT NULL,at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS treasury_plans(id TEXT PRIMARY KEY,body TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS treasury_reservations(id TEXT PRIMARY KEY,amount TEXT NOT NULL,state TEXT NOT NULL,spent TEXT);`);
  const old=this.setting('mode');if(old&&old!==mode){this.close();throw Error('treasury_mode_mismatch');}this.set('mode',mode);
 }
 close(){this.db.close();}
 setting(k){const r=this.db.prepare('SELECT value FROM treasury_settings WHERE key=?').get(k);return r?JSON.parse(r.value):null;}
 set(k,v){this.db.prepare('INSERT INTO treasury_settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k,JSON.stringify(v));}
 transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const r=fn();this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 configure({computeWallet,otherWallet}){
  const config={computeWallet:address(computeWallet),otherWallet:address(otherWallet),asset:WBTC};if(computeWallet===otherWallet)throw Error('distinct_wallets_required');
  const old=this.setting('wallets');if(old&&JSON.stringify(old)!==JSON.stringify(config))throw Error('wallet_configuration_locked');this.set('wallets',config);return config;
 }
 event(id,kind,body){eventIdentity(id);const encoded=JSON.stringify(body),old=this.db.prepare('SELECT * FROM treasury_events WHERE id=?').get(id);if(old){if(old.kind!==kind||old.body!==encoded)throw Error('conflicting_replay');return false;}this.db.prepare('INSERT INTO treasury_events VALUES (?,?,?,?)').run(id,kind,encoded,iso(this.clock()));return true;}
 recordFees({reference,amount}){positive(amount);if(!this.setting('wallets'))throw Error('wallets_not_configured');return this.transaction(()=>this.event('fee-'+identity(reference),'fee',{amount,source:this.mode}));}
 observeWallets(observation){
  const config=this.setting('wallets');if(!config||observation.mint!==WBTC.mint||observation.computeWallet!==config.computeWallet||observation.otherWallet!==config.otherWallet||observation.decimals!==WBTC.decimals||observation.source!==(this.mode==='simulation'?'simulation':'finalized-rpc'))throw Error('invalid_wallet_observation');
  units(observation.computeAmount);units(observation.otherAmount);const age=this.clock()-Date.parse(observation.observedAt);if(!Number.isFinite(age)||age<0||age>300000)throw Error('stale_wallet_observation');this.set('walletObservation',observation);this.set('walletError',null);
 }
 walletUnavailable(){this.set('walletError','Wallet refresh unavailable');}
 observeProvider({availableMicrousd}){units(availableMicrousd);this.set('providerObservation',{availableMicrousd,observedAt:iso(this.clock()),source:this.mode});}
 plan({id,amount,route='solcard'}){
  identity(id);positive(amount);if(!['provider-checkout','solcard','solcard-wbtc','kast'].includes(route))throw Error('invalid_route');
  return this.transaction(()=>{const old=this.getPlan(id);if(old){if(old.amount!==amount||old.route!==route)throw Error('conflicting_replay');return old;}
   const s=this.snapshot();if(s.availableWbtcUnits===null||BigInt(amount)>BigInt(s.availableWbtcUnits))throw Error('insufficient_observed_compute_funds');
   const p={id,amount,route,state:'planned',createdAt:iso(this.clock()),source:this.mode};this.savePlan(p);return p;});
 }
 getPlan(id){const r=this.db.prepare('SELECT body FROM treasury_plans WHERE id=?').get(identity(id));return r?JSON.parse(r.body):null;}
 savePlan(p){this.db.prepare('INSERT INTO treasury_plans VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(p.id,JSON.stringify(p));}
 advance({id,stage,amount,reference}){
  positive(amount);identity(reference);if(!['deposit-submitted','converted','card-funded','provider-credited'].includes(stage))throw Error('invalid_stage');
  return this.transaction(()=>{const p=this.getPlan(id);if(!p)throw Error('unknown_plan');const prior=p[stage];
   if(prior){if(prior.amount!==amount||prior.reference!==reference)throw Error('conflicting_replay');return p;}
   const cardRoute=p.route!=='provider-checkout',direct=p.route==='solcard-wbtc';
   if((stage==='deposit-submitted'&&!direct)||(stage==='converted'&&direct))throw Error('invalid_funding_transition');
   if(stage==='deposit-submitted'&&amount!==p.amount)throw Error('deposit_amount_mismatch');
   const required=stage==='deposit-submitted'||stage==='converted'?'planned':stage==='card-funded'?(direct?'deposit-submitted':'converted'):cardRoute?'card-funded':'converted';
   if(p.state!==required||(stage==='card-funded'&&!cardRoute))throw Error('invalid_funding_transition');
   // Owner records the NET amount actually received. Card/provider credit is not
   // inferred from a WBTC market price or from an initiated payment.
   if(stage==='provider-credited'&&cardRoute&&BigInt(amount)>BigInt(p['card-funded'].amount))throw Error('credit_exceeds_card_funds');
   if(!this.event(stage+'-'+reference,stage,{planId:id,amount,source:this.mode}))throw Error('reference_already_used');
   p[stage]={amount,reference,at:iso(this.clock())};p.state=stage;this.savePlan(p);
   if(stage==='converted'||stage==='deposit-submitted')this.walletUnavailable(); // Pre-payment balances cannot back a new plan.
   return p;});
 }
 cancel({id,noTransferMade}){return this.transaction(()=>{const p=this.getPlan(id);if(!p||p.state!=='planned'||noTransferMade!==true)throw Error('cannot_cancel_funding');p.state='cancelled';this.savePlan(p);return p;});}
 snapshot(){
  const fees=this.db.prepare("SELECT body FROM treasury_events WHERE kind='fee'").all().reduce((n,r)=>n+BigInt(JSON.parse(r.body).amount),0n),allocation=feeAllocation(fees.toString());
  const plans=this.db.prepare('SELECT body FROM treasury_plans ORDER BY rowid DESC').all().map(r=>JSON.parse(r.body));
  const committed=plans.filter(p=>p.state!=='cancelled').reduce((n,p)=>n+BigInt(p.amount),0n),pending=plans.filter(p=>p.state==='planned').reduce((n,p)=>n+BigInt(p.amount),0n);
  const providerCredit=plans.filter(p=>p.state==='provider-credited').reduce((n,p)=>n+BigInt(p['provider-credited'].amount),0n);
  const reservations=this.db.prepare('SELECT * FROM treasury_reservations').all(),reserved=reservations.filter(r=>r.state==='reserved').reduce((n,r)=>n+BigInt(r.amount),0n),spent=reservations.filter(r=>r.state==='settled').reduce((n,r)=>n+BigInt(r.spent),0n);
  const w=this.setting('walletObservation'),walletAge=this.clock()-Date.parse(w?.observedAt),walletFresh=!!w&&!this.setting('walletError')&&walletAge>=0&&walletAge<=300000;
  const p=this.setting('providerObservation'),providerAge=this.clock()-Date.parse(p?.observedAt),providerFresh=!!p&&providerAge>=0&&providerAge<=300000;
  const positiveOrZero=n=>n>0n?n:0n;
  return {schema:'bithash.compute-treasury.v1',mode:this.mode,observedAt:iso(this.clock()),policy:POLICY,asset:WBTC,wallets:this.setting('wallets'),
   feesReported:fees.toString(),allocation,committedWbtcUnits:committed.toString(),walletObservation:w,walletFresh,walletError:this.setting('walletError'),
   availableWbtcUnits:walletFresh?min(positiveOrZero(BigInt(allocation.compute)-committed),positiveOrZero(BigInt(w.computeAmount)-pending)).toString():null,
   providerObservation:p,providerFresh,providerCreditMicrousd:providerCredit.toString(),reservedMicrousd:reserved.toString(),spentMicrousd:spent.toString(),
   availableProviderMicrousd:providerFresh?min(positiveOrZero(providerCredit-spent-reserved),positiveOrZero(BigInt(p.availableMicrousd)-reserved)).toString():null,
   plans,reservations,paymentsEnabled:false,gpuExperimentsEnabled:false,feeRoutingVerified:false,
   limits:'Fees, conversions and provider credits are owner-recorded. Wallet balances are read-only observations, not proof of fee origin. No signer, payment API or automatic GPU extension.'};
 }
 reserve(id,amount){identity(id);positive(amount);return this.transaction(()=>{const old=this.db.prepare('SELECT * FROM treasury_reservations WHERE id=?').get(id);if(old){if(old.amount!==amount||old.state!=='reserved')throw Error('reservation_conflict');return old;}const s=this.snapshot();if(s.availableProviderMicrousd===null||BigInt(amount)>BigInt(s.availableProviderMicrousd))throw Error('insufficient_provider_budget');this.db.prepare('INSERT INTO treasury_reservations VALUES (?,?,?,NULL)').run(id,amount,'reserved');return {id,amount,state:'reserved'};});}
 settle(id,spent){units(spent);return this.transaction(()=>{const r=this.db.prepare('SELECT * FROM treasury_reservations WHERE id=?').get(identity(id));if(!r||BigInt(spent)>BigInt(r.amount))throw Error('invalid_settlement');if(r.state==='settled'){if(r.spent!==spent)throw Error('conflicting_replay');return;}this.db.prepare("UPDATE treasury_reservations SET state='settled',spent=? WHERE id=?").run(spent,id);});}
}

export function attachTreasuryEvidence(evidence,treasury){
 const s=treasury.snapshot(),facts=evidence.facts.map(f=>f.id==='funding'?{id:'funding',kind:'funding',mode:s.mode,availableBudget:s.availableProviderMicrousd,actualSpend:s.spentMicrousd,treasuryConnected:!!s.wallets,
  spending:'Paused; owner-approved sessions only',state:'WBTC 70% compute / 30% other; other half dev, half BTC rewards',freshness:s.providerFresh?'fresh':'unknown',proofType:'Owner-recorded USD micro-unit provider budget; not an independently verified payment'}:f);
 const bare={schema:evidence.schema,observedAt:evidence.observedAt,facts};return {...bare,digest:createHash('sha256').update(JSON.stringify(bare)).digest('hex')};
}

export function fundingAdvice(treasury,{hourlyMicrousd='0',targetHours=24}={}){
 const s=treasury.snapshot(),rate=units(hourlyMicrousd);if(!Number.isInteger(targetHours)||targetHours<1||targetHours>168)throw Error('invalid_runway');
 const usable=s.availableProviderMicrousd===null?null:BigInt(s.availableProviderMicrousd),target=rate*BigInt(targetHours);
 return {mode:s.mode,action:!s.wallets?'configure_wallets':!s.walletFresh?'refresh_wallets':usable===null?'confirm_provider_balance':usable<target?'prepare_topup':'hold',
  availableProviderMicrousd:s.availableProviderMicrousd,runwaySeconds:usable===null||!rate?null:(usable*3600n/rate).toString(),
  suggestedTopupMicrousd:usable===null?null:(target>usable?target-usable:0n).toString(),paymentsEnabled:false,
  message:'Runway is a budget estimate at the supplied burn rate. Existing rental deadlines are unchanged. New rentals and extensions still require owner approval.'};
}

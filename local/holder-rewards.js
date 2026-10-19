import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import {WBTC,feeAllocation} from './treasury-compute.js';
import {OFFLINE_BLOCKHASH} from './restricted-wallet-signer.js';
import {readFundingTransactionBySignature} from './funding-reconciler.js';
import {buildRewardTransfer,verifyRewardTransfer} from './reward-transfer.js';
import {readHolderSnapshot} from './holder-snapshot.js';
import {decode58} from './solana-evidence.js';
import {RewardPreflight} from './reward-preflight.js';
import {preflightView} from './funding-preflight.js';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex'),copy=v=>structuredClone(v);
const n=v=>{if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,19})$/.test(v))throw Error('rewards_invalid_units');return BigInt(v);};
const addr=v=>new PublicKey(v).toBase58(),fresh=(at,now)=>Number.isFinite(Date.parse(at))&&now>=Date.parse(at)&&now-Date.parse(at)<=300000;
const manifest=r=>({id:r.id,state:'signing-disabled',mint:r.mint,owner:r.owner,budgetUnits:r.budgetUnits,createdAt:r.createdAt,snapshotHash:r.snapshotHash,snapshotSlot:r.snapshotSlot,policyHash:r.policyHash,feeHashes:r.feeHashes,payouts:r.payouts.map(p=>({owner:p.owner,holdingUnits:p.holdingUnits,amount:p.amount,id:p.id,state:'signing-disabled',attempts:[],signature:null}))});
export const REWARDS_FLAGS=Object.freeze({signingEnabled:false,broadcastEnabled:false,paymentsEnabled:false,automaticCreditPosting:false});
export function allocateHolderRewards(snapshot,budget,exclusions){
 const excluded=new Set(exclusions.map(addr)),eligible=snapshot.holders.filter(h=>!excluded.has(h.owner));
 if(eligible.some(h=>!PublicKey.isOnCurve(new PublicKey(h.owner).toBytes())))throw Error('rewards_program_holder_needs_exclusion_review');
 const total=eligible.reduce((v,h)=>v+n(h.units),0n);if(!total||!n(budget))throw Error('rewards_empty_round');
 const rows=eligible.map(h=>({owner:addr(h.owner),holdingUnits:h.units,amount:n(budget)*n(h.units)/total,remainder:n(budget)*n(h.units)%total}));
 let dust=n(budget)-rows.reduce((v,h)=>v+h.amount,0n);
 const ranked=[...rows].sort((a,b)=>a.remainder===b.remainder?a.owner.localeCompare(b.owner):a.remainder>b.remainder?-1:1);
 for(const r of ranked)if(dust>0n){r.amount++;dust--;}
 return rows.filter(h=>h.amount>0n).sort((a,b)=>a.owner.localeCompare(b.owner)).map(({owner,holdingUnits,amount})=>({owner,holdingUnits,amount:String(amount)}));
}

// Durable unpaid liabilities and read-only payout reconciliation. No key,
// transaction submission, swap, card or GPU adapter exists in this manager.
export class HolderRewards {
 #db;#observe;#clock;#reader;#readTx;#config;#preflight;#busy=false;#timer=null;#stopped=true;#flight=null;
 constructor(path,{observe,configuration=null,clock=Date.now,readSnapshot=readHolderSnapshot,readTransaction=readFundingTransactionBySignature,preflight=new RewardPreflight()}={}){
  this.#observe=observe;this.#clock=clock;this.#reader=readSnapshot;this.#readTx=readTransaction;this.#preflight=preflight;
  if(configuration){for(const k of ['projectMint','computeWallet','otherWallet'])addr(configuration[k]);if(!Array.isArray(configuration.excludedOwners))throw Error('rewards_exclusions_required');configuration.excludedOwners.forEach(addr);}
  if(configuration?.automaticRounds===true&&(!Number.isInteger(configuration.roundIntervalHours)||configuration.roundIntervalHours<1||configuration.roundIntervalHours>168||!n(configuration.minRoundUnits)||n(configuration.maxRoundUnits)<n(configuration.minRoundUnits)))throw Error('rewards_round_limits_required');
  this.#config=copy(configuration);this.#db=new DatabaseSync(path);
  const tables=this.#db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  if(tables.some(t=>t.name!=='holder_rewards')){this.#db.close();throw Error('rewards_separate_database_required');}
  this.#db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS holder_rewards(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL)');
  this.#db.prepare('INSERT OR IGNORE INTO holder_rewards VALUES(1,?)').run(JSON.stringify({version:1,configuration:this.#config,receipts:{},rounds:[],snapshot:null,lastCheck:null,error:null}));
  const saved=this.get();if(hash(saved.configuration)!==hash(this.#config)){if(!saved.configuration&&!saved.rounds.length&&!Object.keys(saved.receipts).length){saved.configuration=this.#config;this.#save(saved);}else{this.#db.close();throw Error('rewards_configuration_changed');}}
 }
 get(){return JSON.parse(this.#db.prepare('SELECT body FROM holder_rewards WHERE id=1').get().body);}
 #save(w){this.#db.prepare('UPDATE holder_rewards SET body=? WHERE id=1').run(JSON.stringify(w));}
 #mutate(fn){if(this.#busy)throw Error('rewards_busy');this.#db.exec('BEGIN IMMEDIATE');try{const w=this.get(),r=fn(w);this.#save(w);this.#db.exec('COMMIT');return r;}catch(e){this.#db.exec('ROLLBACK');throw e;}}
 #funds(w){const other=Object.values(w.receipts).reduce((v,r)=>v+n(r.otherUnits),0n),rewards=other/2n,allocated=w.rounds.reduce((v,r)=>v+n(r.budgetUnits),0n);return {otherUnits:String(other),devUnits:String(other-rewards),rewardUnits:String(rewards),allocatedUnits:String(allocated),availableUnits:String(rewards-allocated)};}
 syncFees(){return this.#mutate(w=>{
  if(!this.#config)return this.status();const a=this.#observe().automatic,c=this.#config,now=this.#clock();
  if(a.mode!=='dry-run'||a.busy||a.feeError||!a.feeObservation?.complete||!a.feeObservation.routingVerified||!fresh(a.feeObservation.observedAt,now)||a.receiptCount!==a.receipts?.length)throw Error('rewards_fee_history_unready');
  if(['projectMint','computeWallet','otherWallet'].some(k=>a.configuration?.[k]!==c[k]))throw Error('rewards_fee_identity_mismatch');
  const seen=new Set();for(const r of a.receipts){
   const split=feeAllocation(r.totalUnits);decode58(r.signature,64);
   if(r.id!==r.signature+':'+r.instructionIndex||!Number.isInteger(r.instructionIndex)||r.instructionIndex<0||!Number.isSafeInteger(r.slot)||r.slot<1||seen.has(r.id)||r.source!=='finalized-pump-v2'||r.quoteMint!==WBTC.mint||['projectMint','computeWallet','otherWallet'].some(k=>r[k]!==c[k])||r.computeUnits!==split.compute||r.otherUnits!==split.other)throw Error('rewards_fee_receipt_invalid');
   seen.add(r.id);const key='fee-'+r.id,digest=hash(r);if(w.receipts[key]&&w.receipts[key].digest!==digest)throw Error('rewards_fee_receipt_changed');w.receipts[key]={digest,otherUnits:r.otherUnits,slot:r.slot};
  }
  if(Object.keys(w.receipts).some(k=>!seen.has(k.slice(4))))throw Error('rewards_fee_history_missing');w.lastCheck=new Date(now).toISOString();w.error=null;return this.#funds(w);
 });}
 async refresh(){
  if(this.#busy)throw Error('rewards_busy');
  if(!this.#config)return this.status();
  try{this.syncFees();const w=this.get();this.#busy=true;
   const minContextSlot=Math.max(1,...Object.values(w.receipts).map(r=>r.slot));const snapshot=await this.#reader(this.#config.projectMint,{minContextSlot});
   if(snapshot.source!=='finalized-rpc'||snapshot.mint!==this.#config.projectMint||snapshot.slot<minContextSlot||!fresh(snapshot.observedAt,this.#clock()))throw Error('rewards_snapshot_invalid');
   const next=this.get();next.snapshot=copy(snapshot);next.error=null;this.#save(next);
  }catch(e){const w=this.get();w.error=/^[a-z_]+$/.test(e.message)?e.message:'rewards_read_failed';this.#save(w);throw e;}finally{this.#busy=false;}return this.status();
 }
 prepareRound(id,budgetUnits){
  this.syncFees();return this.#mutate(w=>{
  if(!/^[a-zA-Z0-9_-]{1,64}$/.test(id))throw Error('rewards_round_id_invalid');
  const old=w.rounds.find(r=>r.id===id);if(old){if(old.budgetUnits!==budgetUnits)throw Error('rewards_round_replay_conflict');return copy(old);}
  const c=this.#config,s=w.snapshot,o=this.#observe(),now=this.#clock();
  if(!c||c.policyConfirmed!==true||c.excludedOwners.includes(c.otherWallet)!==true||c.excludedOwners.includes(c.computeWallet)!==true)throw Error('rewards_policy_confirmation_required');
  if(w.error||!s||!fresh(s.observedAt,now)||!fresh(w.lastCheck,now)||!o.treasury.walletFresh||!o.treasury.walletObservation||o.automatic.feeError||!fresh(o.automatic.feeObservation?.observedAt,now))throw Error('rewards_observations_stale');
  if(o.treasury.walletObservation.source!=='finalized-rpc'||o.treasury.walletObservation.mint!==WBTC.mint||o.treasury.walletObservation.otherWallet!==c.otherWallet||o.treasury.walletObservation.computeWallet!==c.computeWallet)throw Error('rewards_wallet_identity_mismatch');
  if(s.slot<Math.max(1,...Object.values(w.receipts).map(r=>r.slot)))throw Error('rewards_snapshot_before_fees');
  if(w.rounds.length>=1000||w.rounds.some(r=>r.state!=='complete'))throw Error('rewards_existing_round_unresolved');
  const funds=this.#funds(w),unpaid=w.rounds.flatMap(r=>r.payouts).filter(p=>p.state!=='paid').reduce((v,p)=>v+n(p.amount),0n),wallet=n(o.treasury.walletObservation.otherAmount);
  if(!n(budgetUnits)||n(budgetUnits)>n(funds.availableUnits)||wallet<n(funds.devUnits)+unpaid+n(budgetUnits))throw Error('rewards_budget_or_development_reserve');
  const rows=allocateHolderRewards(s,budgetUnits,c.excludedOwners),round={id,state:'signing-disabled',mint:WBTC.mint,owner:c.otherWallet,budgetUnits,createdAt:new Date(now).toISOString(),snapshotHash:s.digest,snapshotSlot:s.slot,policyHash:hash(c),feeHashes:Object.values(w.receipts).map(r=>r.digest).sort(),payouts:rows.map((r,index)=>({...r,id:'reward-'+hash({id,index,owner:r.owner,amount:r.amount}).slice(0,24),state:'signing-disabled',attempts:[],signature:null}))};
  round.manifestHash=hash(round);w.rounds.push(round);return copy(round);
 });}
 unsignedPayout(roundId,payoutId){const r=this.get().rounds.find(r=>r.id===roundId),p=r?.payouts.find(p=>p.id===payoutId);if(!p||p.signature||p.state==='paid')throw Error('rewards_payout_not_available');const {tx}=buildRewardTransfer({owner:r.owner,recipient:p.owner,amount:p.amount,blockhash:OFFLINE_BLOCKHASH});return {roundId,payoutId,manifestHash:r.manifestHash,wireBase64:tx.serialize({requireAllSignatures:false,verifySignatures:false}).toString('base64'),blockhashSource:'offline-placeholder',createsRecipientWbtcAccountIfMissing:true,requiresLiveFeeAndRentPreflight:true,...REWARDS_FLAGS};}
 executionIntents(){
  if(!this.#config||this.#busy)return [];const w=this.get();if(w.error)return [];
  for(const r of w.rounds)if(hash(manifest(r))!==r.manifestHash||r.owner!==this.#config.otherWallet||r.policyHash!==hash(this.#config))throw Error('rewards_manifest_changed');
  return w.rounds.filter(r=>r.state!=='complete').flatMap(r=>r.payouts.filter(p=>!p.signature&&p.state!=='paid').map(p=>({id:p.id,kind:'reward',roundId:r.id,payoutId:p.id,owner:r.owner,recipient:p.owner,amount:p.amount,minContextSlot:r.snapshotSlot,manifestHash:r.manifestHash,rewardPolicyHash:r.policyHash})));
 }
 async preflightPayout(roundId,payoutId){
  this.syncFees();if(this.#busy)throw Error('rewards_busy');
  const w=this.get(),r=w.rounds.find(r=>r.id===roundId),p=r?.payouts.find(p=>p.id===payoutId);
  if(!p||p.signature||p.state==='paid'||w.error)throw Error('rewards_payout_not_available');
  if(hash(manifest(r))!==r.manifestHash||r.policyHash!==hash(this.#config))throw Error('rewards_manifest_changed');
  const original=hash(r),pending=w.rounds.flatMap(r=>r.payouts).filter(p=>p.state!=='paid').reduce((v,p)=>v+n(p.amount),0n),policy=this.#config.payoutPolicy??null;
  this.#busy=true;
  try{
   const result=await this.#preflight.check({owner:r.owner,recipient:p.owner,amount:p.amount,minContextSlot:r.snapshotSlot,policy:policy?{...policy,retainedWbtcUnits:String(n(this.#funds(w).devUnits)+pending-n(p.amount))}:null});
   const next=this.get(),rr=next.rounds.find(x=>x.id===r.id);if(hash(rr)!==original)throw Error('rewards_round_changed_during_preflight');
   rr.payouts.find(x=>x.id===p.id).preflight=result;this.#save(next);return result;
  }finally{this.#busy=false;}
 }
 attachExistingSignature(roundId,payoutId,signature){decode58(signature,64);return this.#mutate(w=>{
  const r=w.rounds.find(r=>r.id===roundId),p=r?.payouts.find(p=>p.id===payoutId);if(!p)throw Error('rewards_payout_missing');
  if(p.signature===signature)return;if(p.signature||p.state==='paid')throw Error('rewards_pending_signature_locked');
  if(w.rounds.some(r=>r.payouts.some(p=>p.attempts.some(a=>a.signature===signature))))throw Error('rewards_signature_reused');
  p.signature=signature;p.state='awaiting-finalized';p.attempts.push({signature,state:'pending'});
 });}
 async reconcile(){
  if(this.#busy)throw Error('rewards_busy');this.#busy=true;
  try{const current=this.get();for(const r of current.rounds)for(const p of r.payouts){
   if(!p.signature||p.state==='paid')continue;const raw=await this.#readTx(p.signature,p.id);if(raw===null)continue;
   const proof=verifyRewardTransfer({owner:r.owner,recipient:p.owner,amount:p.amount},p.signature,raw,r.snapshotSlot);
   if(proof.state==='pending')continue;
   const w=this.get(),rr=w.rounds.find(x=>x.id===r.id),pp=rr.payouts.find(x=>x.id===p.id);if(pp.signature!==p.signature)throw Error('rewards_signature_changed');
   pp.attempts.at(-1).state=proof.state;pp.attempts.at(-1).slot=proof.slot;
   if(proof.state==='failed'){pp.signature=null;pp.state='signing-disabled';}else{pp.state='paid';pp.paidSlot=proof.slot;}
   if(rr.payouts.every(x=>x.state==='paid'))rr.state='complete';this.#save(w);
  }}finally{this.#busy=false;}return this.status();
 }
 sign(){throw Error('live_signing_disabled');} broadcast(){throw Error('broadcast_disabled');}
 status(){const w=this.get();return {mode:'read-only-preparation',configured:!!this.#config,busy:this.#busy,state:!this.#config?'awaiting-token-launch':w.error?'held':'preparation-only',configuration:this.#config,...this.#funds(w),snapshot:w.snapshot?{slot:w.snapshot.slot,digest:w.snapshot.digest,holderCount:w.snapshot.holders.length,observedAt:w.snapshot.observedAt}:null,rounds:w.rounds.map(r=>({...r,payouts:r.payouts.map(p=>({...p,preflight:preflightView(p.preflight,this.#clock())}))})),error:w.error,...REWARDS_FLAGS};}
 tick(){if(this.#flight)return this.#flight;this.#flight=(async()=>{
  if(!this.#config)return this.status();await this.reconcile();this.syncFees();const w=this.get(),c=this.#config;
  if(c.automaticRounds===true&&c.policyConfirmed===true&&!w.rounds.some(r=>r.state!=='complete')&&(!w.rounds.length||this.#clock()-Date.parse(w.rounds.at(-1).createdAt)>=c.roundIntervalHours*3600000)){
   const available=n(this.#funds(w).availableUnits),cap=n(c.maxRoundUnits),amount=available<cap?available:cap;
   if(amount>=n(c.minRoundUnits)){await this.refresh();this.prepareRound('round-'+hash({configuration:c,sequence:w.rounds.length,fees:Object.keys(w.receipts).sort()}).slice(0,24),String(amount));}
  }
  return this.status();
 })().catch(e=>{const w=this.get();w.error=/^[a-z_]+$/.test(e.message)?e.message:'rewards_worker_failed';this.#save(w);throw e;}).finally(()=>{this.#flight=null;});return this.#flight;}
 start(){if(!this.#stopped)return;this.#stopped=false;const loop=async()=>{try{await this.tick();}catch{}if(!this.#stopped){this.#timer=setTimeout(loop,60000);this.#timer.unref();}};void loop();}
 async close(){this.#stopped=true;clearTimeout(this.#timer);if(this.#flight)await this.#flight.catch(()=>{});if(this.#busy)throw Error('rewards_busy');this.#db.close();}
}

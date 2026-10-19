import {DatabaseSync} from 'node:sqlite';
import {Keypair,Transaction} from '@solana/web3.js';
import bs58 from 'bs58';
import {fundingUnits,sha256,buildRestrictedTransfer} from './restricted-wallet-signer.js';
import {buildRewardTransfer} from './reward-transfer.js';
import {buildCollectionTransaction} from './fee-collection.js';
import {readFundingTransactionBySignature} from './funding-reconciler.js';

const hash=v=>sha256(JSON.stringify(v)),copy=structuredClone;
const safe=e=>/^[a-z_]{1,80}$/.test(e?.message)?e.message:'wallet_execution_unavailable';
const fresh=(at,now)=>Number.isFinite(Date.parse(at))&&now>=Date.parse(at)&&now-Date.parse(at)<=60000;
export function executionTransaction(intent,blockhash){
 if(intent.kind==='funding')return buildRestrictedTransfer({...intent,blockhash});
 if(intent.kind==='reward')return buildRewardTransfer({...intent,blockhash}).tx;
 if(intent.kind==='collection')return buildCollectionTransaction(intent.configuration,intent.observation,blockhash);
 throw Error('wallet_intent_kind_invalid');
}
export function inspectExecutionWire(intent,wire,blockhash,{signed=false}={}){
 if(!Buffer.isBuffer(wire)||wire.length>1232)throw Error('wallet_wire_invalid');
 const tx=Transaction.from(wire),canonical=executionTransaction(intent,blockhash);
 if(!tx.serializeMessage().equals(canonical.serializeMessage())||tx.signatures.length!==1||tx.signatures[0].publicKey.toBase58()!==intent.owner)throw Error('wallet_message_mismatch');
 if(signed?!tx.verifySignatures():tx.signatures.some(s=>s.signature!==null))throw Error('wallet_signature_invalid');
 return {tx,messageHash:sha256(tx.serializeMessage())};
}

// Dependency boundary: no key file is read at construction. Production supplies
// neither an enabled gate nor a loader. A future custody deployment owns the loader.
export class RestrictedWalletCustody {
 constructor({loadKey,signingEnabled=false}={}){this.loadKey=loadKey;this.enabled=signingEnabled===true;}
 async sign(intent,wire,blockhash){
  if(!this.enabled)throw Error('live_signing_disabled');
  const {tx}=inspectExecutionWire(intent,wire,blockhash);
  if(typeof this.loadKey!=='function')throw Error('wallet_custody_not_configured');
  const secret=await this.loadKey(intent.owner);let key;
  try{
   if(!(secret instanceof Uint8Array)||secret.length!==64)throw Error('wallet_key_invalid');key=Keypair.fromSecretKey(secret);
   if(key.publicKey.toBase58()!==intent.owner)throw Error('wallet_key_identity_mismatch');
   tx.sign(key);const signed=tx.serialize();inspectExecutionWire(intent,signed,blockhash,{signed:true});return signed;
  }finally{secret?.fill?.(0);key?.secretKey.fill(0);}
 }
}
export class WalletBroadcaster {
 constructor({broadcastEnabled=false,fetcher=fetch}={}){this.enabled=broadcastEnabled===true;this.fetcher=fetcher;}
 async send(wire){
  if(!this.enabled)throw Error('broadcast_disabled');
  const tx=Transaction.from(wire);if(!tx.verifySignatures())throw Error('wallet_signature_invalid');
  const expected=bs58.encode(tx.signature);
  const r=await this.fetcher('https://api.mainnet-beta.solana.com',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'wallet-submit',method:'sendTransaction',params:[wire.toString('base64'),{encoding:'base64',skipPreflight:false,preflightCommitment:'finalized',maxRetries:0}]})});
  if(!r.ok)throw Error('wallet_submission_unknown');const raw=await r.text();if(raw.length>8192)throw Error('wallet_submission_unknown');const b=JSON.parse(raw);
  if(b.jsonrpc!=='2.0'||b.id!=='wallet-submit'||b.error||b.result!==expected)throw Error('wallet_submission_unknown');return expected;
 }
}

// Independent durable attempt journal. Unsigned checks never reserve real funds.
// In an authorized deployment, budget reservations precede signing; signed bytes
// precede submission. An uncertain submission is NEVER retried automatically.
export class WalletExecution {
 #db;#source;#prepare;#notify;#read;#custody;#broadcast;#policy;#clock;#enabled;#busy=false;#timer=null;#stopped=true;
 constructor(path,{source,prepare,onSignature=async()=>{},readTransaction=readFundingTransactionBySignature,policy=null,custody=new RestrictedWalletCustody(),broadcaster=new WalletBroadcaster(),signingEnabled=false,broadcastEnabled=false,clock=Date.now}={}){
  this.#source=source;this.#prepare=prepare;this.#notify=onSignature;this.#read=readTransaction;this.#custody=custody;this.#broadcast=broadcaster;this.#policy=copy(policy);this.#clock=clock;
  if(signingEnabled!==broadcastEnabled)throw Error('wallet_partial_activation_forbidden');this.#enabled=signingEnabled===true&&broadcastEnabled===true;
  this.#db=new DatabaseSync(path);const tables=this.#db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  if(tables.some(t=>!['wallet_execution_meta','wallet_execution_jobs'].includes(t.name))){this.#db.close();throw Error('wallet_execution_separate_database_required');}
  this.#db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS wallet_execution_meta(id INTEGER PRIMARY KEY,body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS wallet_execution_jobs(id TEXT PRIMARY KEY,body TEXT NOT NULL);');
  const identity={policy:this.#policy,executionEnabled:this.#enabled},saved=this.#db.prepare('SELECT body FROM wallet_execution_meta WHERE id=1').get();
  if(saved&&saved.body!==JSON.stringify(identity)){this.#db.close();throw Error('wallet_execution_policy_migration_required');}
  this.#db.prepare('INSERT OR IGNORE INTO wallet_execution_meta VALUES(1,?)').run(JSON.stringify(identity));
 }
 #jobs(){return this.#db.prepare('SELECT body FROM wallet_execution_jobs ORDER BY rowid').all().map(r=>JSON.parse(r.body));}
 #save(j){this.#db.prepare('INSERT INTO wallet_execution_jobs VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(j.id,JSON.stringify(j));}
 #current(id){const i=this.#source().find(x=>x.id===id);if(!i)throw Error('wallet_source_intent_unavailable');return i;}
 #reserve(j,preflight){
  const p=this.#policy,now=this.#clock(),i=j.intent;
  if(!p||!fresh(preflight.observedAt,now)||!Number.isFinite(Date.parse(p.expiresAt))||now>=Date.parse(p.expiresAt))throw Error('wallet_authority_policy_unready');
  const owner=p.owners?.[i.owner];if(!owner||!owner.kinds?.includes(i.kind))throw Error('wallet_owner_not_allowed');
  if(i.kind==='funding'&&i.recipient!==owner.depositAddress)throw Error('wallet_destination_not_allowed');
  if(i.kind==='collection'&&(i.configuration.projectMint!==owner.projectMint||i.configuration.otherWallet!==owner.otherWallet||i.configuration.computeWallet!==i.owner))throw Error('wallet_collection_identity_mismatch');
  if(i.kind==='reward'&&(!/^[a-f0-9]{64}$/.test(i.manifestHash)||!owner.rewardPolicyHashes?.includes(i.rewardPolicyHash)))throw Error('wallet_reward_policy_not_approved');
  const amount=fundingUnits(i.kind==='collection'?'0':i.amount),fee=fundingUnits(preflight.totalCostLamports??preflight.networkFeeLamports);
  if(amount>fundingUnits(owner.maxTransferWbtcUnits)||fee>fundingUnits(owner.maxTransactionCostLamports))throw Error('wallet_transaction_cap');
  const jobs=this.#jobs(),reserved=jobs.filter(x=>x.reservedAt);
  if(reserved.some(x=>Date.parse(x.reservedAt)>now))throw Error('wallet_clock_rollback');
  if(jobs.some(x=>x.id!==j.id&&x.intent.owner===i.owner&&x.reservedAt&&!['finalized','failed'].includes(x.state)))throw Error('wallet_other_attempt_pending');
  const day=reserved.filter(x=>x.intent.owner===i.owner&&now-Date.parse(x.reservedAt)<=86400000);
  if(day.reduce((v,x)=>v+BigInt(x.reservedAmount),0n)+amount>fundingUnits(owner.maxDailyWbtcUnits)||day.reduce((v,x)=>v+BigInt(x.reservedCost),0n)+fee>fundingUnits(owner.maxDailyCostLamports))throw Error('wallet_daily_cap');
  j.reservedAt=new Date(now).toISOString();j.reservedAmount=String(amount);j.reservedCost=String(fee);j.state='signing-pending';this.#save(j);
 }
 async #recover(j){
  // Replaying this notification is safe: each receiving manager binds one signature.
  if(j.submissionStartedAt)await this.#notify(j.intent,j.signature);
  const result=await this.#read(j.signature,j.id);
  if(result!==null){
   if(!Number.isSafeInteger(result.slot)||result.slot<(j.preflight.slot??j.intent.minContextSlot??0)||!result.meta||result.meta.err===undefined||result.transaction?.[1]!=='base64')throw Error('wallet_finalized_evidence_invalid');
   const wire=Buffer.from(result.transaction[0],'base64');inspectExecutionWire(j.intent,wire,j.preflight.blockhash,{signed:true});
   if(bs58.encode(Transaction.from(wire).signature)!==j.signature||wire.toString('base64')!==j.signedWire)throw Error('wallet_finalized_signature_mismatch');
   j.state=result.meta.err===null?'finalized':'failed';j.finalizedSlot=result.slot;this.#save(j);return;
  }
  if(j.submissionStartedAt){j.state='submission-unknown';this.#save(j);return;}
  // A signed but unsubmitted transaction is not sent after its preflight expires.
  if(!fresh(j.preflight.observedAt,this.#clock())){j.state='signed-expired-review';this.#save(j);return;}
  if(!this.#enabled)throw Error('live_signing_disabled');
  if(this.#clock()>=Date.parse(this.#policy.expiresAt))throw Error('wallet_authority_policy_expired');
  if(hash(this.#current(j.id))!==j.intentHash)throw Error('wallet_source_intent_changed');
  j.submissionStartedAt=new Date(this.#clock()).toISOString();j.state='submission-unknown';this.#save(j);
  try{await this.#broadcast.send(Buffer.from(j.signedWire,'base64'));j.state='awaiting-finalized';this.#save(j);}
  finally{await this.#notify(j.intent,j.signature);}
 }
 async tick(){
  if(this.#busy)return {skipped:'busy'};this.#busy=true;
  try{
   const incoming=this.#source(),ids=new Set();if(!Array.isArray(incoming)||incoming.length>1000)throw Error('wallet_source_invalid');
   for(const i of incoming){
    if(!/^[a-zA-Z0-9_-]{1,64}$/.test(i.id)||ids.has(i.id))throw Error('wallet_source_duplicate');ids.add(i.id);executionTransaction(i,'11111111111111111111111111111111');
    if(!this.#db.prepare('SELECT id FROM wallet_execution_jobs WHERE id=?').get(i.id)){
     if(this.#jobs().length>=1000)throw Error('wallet_journal_full');this.#save({id:i.id,intent:copy(i),intentHash:hash(i),state:'queued',createdAt:new Date(this.#clock()).toISOString()});
    }
   }
   for(const j of this.#jobs().filter(x=>!['finalized','failed'].includes(x.state)).sort((a,b)=>Date.parse(a.checkedAt??a.createdAt)-Date.parse(b.checkedAt??b.createdAt)).slice(0,20)){
    try{
     j.checkedAt=new Date(this.#clock()).toISOString();
     if(j.signature){await this.#recover(j);continue;}
     // A crash after reservation but before signed bytes requires review, not re-signing.
     if(j.reservedAt){j.state='signing-outcome-review';this.#save(j);continue;}
     if(hash(this.#current(j.id))!==j.intentHash)throw Error('wallet_source_intent_changed');
     const result=await this.#prepare(copy(j.intent));
     if(hash(this.#current(j.id))!==j.intentHash)throw Error('wallet_source_intent_changed');
     j.preflight=copy(result);j.reason=null;j.state=result.state==='checks-passed'?'signing-disabled':'preflight-held';this.#save(j);
     if(!this.#enabled||result.state!=='checks-passed')continue;
     if(!fresh(result.observedAt,this.#clock())||result.simulation!=='passed')throw Error('wallet_preflight_unready');
     const tx=executionTransaction(j.intent,result.blockhash),wire=tx.serialize({requireAllSignatures:false,verifySignatures:false}),checked=inspectExecutionWire(j.intent,wire,result.blockhash);
     if(checked.messageHash!==result.messageHash)throw Error('wallet_preflight_message_mismatch');
     this.#db.exec('BEGIN IMMEDIATE');try{this.#reserve(j,result);this.#db.exec('COMMIT');}catch(e){this.#db.exec('ROLLBACK');throw e;}
     const signed=await this.#custody.sign(j.intent,wire,result.blockhash);inspectExecutionWire(j.intent,signed,result.blockhash,{signed:true});
     j.signedWire=signed.toString('base64');j.signature=bs58.encode(Transaction.from(signed).signature);j.state='signed';this.#save(j);
     await this.#recover(j);
    }catch(e){j.reason=safe(e);j.state=j.signature?'submission-review':j.reservedAt?'signing-outcome-review':'held';this.#save(j);}
   }
   return this.status();
  }finally{this.#busy=false;}
 }
 status(){return {mode:this.#enabled?'execution':'disabled',signingEnabled:this.#enabled,broadcastEnabled:this.#enabled,keyLoaded:false,busy:this.#busy,jobs:this.#jobs().map(({signedWire,...j})=>j)};}
 start(){if(!this.#stopped)return;this.#stopped=false;const loop=async()=>{try{await this.tick();}catch{}if(!this.#stopped){this.#timer=setTimeout(loop,60000);this.#timer.unref();}};void loop();}
 async close(){this.#stopped=true;clearTimeout(this.#timer);while(this.#busy)await new Promise(r=>setTimeout(r,10));this.#db.close();}
}

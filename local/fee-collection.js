import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {PublicKey,Transaction,TransactionInstruction,SystemProgram} from '@solana/web3.js';
import {unpackAccount,unpackMint,TOKEN_PROGRAM_ID} from '@solana/spl-token';
import {WBTC} from './treasury-compute.js';
import {PUMP,PUMP_AMM,feeAddresses,verifyFeeRouting,collectionAccounts} from './fee-detection.js';
import {fundingUnits,sha256} from './restricted-wallet-signer.js';

const schema=JSON.parse(readFileSync(new URL('./fixtures/pump-collection-schema.json',import.meta.url),'utf8'));
const pk=v=>new PublicKey(v),num=v=>{if(!Number.isSafeInteger(v)||v<0)throw Error('collection_invalid_rpc_integer');return v;};
const safe=e=>/^[a-z_]{1,80}$/.test(e?.message)?e.message:'collection_read_unavailable';
const clone=v=>JSON.parse(JSON.stringify(v));
export const COLLECTION_SOURCE=schema.sourceCommit;
const frozenFlags={signingEnabled:false,broadcastEnabled:false,paymentsEnabled:false,gpuExperimentsEnabled:false,automaticCreditPosting:false};
const raw=a=>{if(a===null)return null;if(a?.data?.[1]!=='base64'||typeof a.data[0]!=='string'||a.data[0].length>8192||a.executable!==false)throw Error('collection_account_invalid');const data=Buffer.from(a.data[0],'base64');if(data.toString('base64')!==a.data[0])throw Error('collection_account_invalid');return {...a,owner:pk(a.owner),data};};
function token(a,address,owner){
 if(a===null)return 0n;
 const t=unpackAccount(pk(address),raw(a),TOKEN_PROGRAM_ID);
 if(!t.isInitialized||t.isFrozen||t.isNative||t.mint.toBase58()!==WBTC.mint||t.owner.toBase58()!==owner||t.delegate!==null||t.closeAuthority!==null)throw Error('collection_token_account_mismatch');return t.amount;
}
export function collectionView(r,now=Date.now()){
 if(!r)return null;const age=now-Date.parse(r.observedAt),fresh=age>=0&&age<=60000;
 return {...r,fresh,state:fresh?r.state:'stale'};
}
export function collectionRpc(fetcher=fetch){return async(method,params)=>{
 if(!['getGenesisHash','getMultipleAccounts','getLatestBlockhash','getFeeForMessage','simulateTransaction','getBlockHeight'].includes(method))throw Error('collection_rpc_method_forbidden');
 const response=await fetcher('https://api.mainnet-beta.solana.com',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:method,method,params})});
 if(!response.ok)throw Error('collection_rpc_unavailable');let size=0;const chunks=[],reader=response.body.getReader();
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>262144)throw Error('collection_rpc_too_large');chunks.push(Buffer.from(value));}}finally{await reader.cancel();}
 const b=JSON.parse(Buffer.concat(chunks));if(b.jsonrpc!=='2.0'||b.id!==method||b.error||!Object.hasOwn(b,'result'))throw Error('collection_rpc_invalid');return b.result;
};}

export function inspectCollectionAccounts(config,response){
 const a=feeAddresses(config),values=response?.value;num(response?.context?.slot);
 if(!Array.isArray(values)||values.length!==11)throw Error('collection_accounts_missing');
 const [sharing,curve,pool,vault,ammVault,curveTokens,poolTokens,computeTokens,otherTokens,mint,payer]=values;
 const routing=verifyFeeRouting(config,sharing,curve),c=raw(curve).data;
 if(c[48]>1||c[124]!==0)throw Error('unsupported_collection_coin_mode');
 const mintInfo=unpackMint(pk(WBTC.mint),raw(mint),TOKEN_PROGRAM_ID);if(!mintInfo.isInitialized||mintInfo.decimals!==8)throw Error('collection_mint_mismatch');
 const waitingCurve=c.readBigUInt64LE(125);let waitingPool=0n;
 if(pool!==null){
  const p=raw(pool),b=p.data,key=o=>pk(b.subarray(o,o+32)).toBase58();
  if(p.owner.toBase58()!==PUMP_AMM||b.length<287||b.length>512||b.subarray(287).some(x=>x!==0)||!b.subarray(0,8).equals(Buffer.from([241,154,109,4,17,177,109,188]))||b.readUInt16LE(9)!==0||key(11)!==a.poolAuthority||key(43)!==config.projectMint||key(75)!==WBTC.mint||key(171)!==a.poolAta||key(211)!==a.sharing||b[270]!==0||c[48]!==1)throw Error('collection_pool_mismatch');
  waitingPool=b.readBigUInt64LE(279);
 }
 const vaultUnits=token(vault,a.vaultAta,a.vault),ammVaultUnits=token(ammVault,a.ammVaultAta,a.ammVault),curveUnits=token(curveTokens,a.curveAta,a.curve),poolUnits=token(poolTokens,a.poolAta,a.pool);
 token(computeTokens,a.computeAta,config.computeWallet);token(otherTokens,a.otherAta,config.otherWallet);
 if(waitingCurve>curveUnits||waitingPool>poolUnits)throw Error('collection_fee_bucket_underfunded');
 if(payer!==null){const w=raw(payer);if(w.owner.toBase58()!==SystemProgram.programId.toBase58()||w.data.length!==0)throw Error('collection_fee_payer_invalid');}
 const total=vaultUnits+ammVaultUnits+waitingCurve+waitingPool;
 const reasons=[];if(c[48]===1&&pool===null)reasons.push('collection_migration_pool_missing');if(payer===null)reasons.push('collection_sol_fee_payer_missing');if(!total)reasons.push('no_distributable_wbtc');
 return {routing,slot:response.context.slot,solLamports:String(payer===null?0:num(payer.lamports)),amounts:{curvePending:String(waitingCurve),poolPending:String(waitingPool),pumpVault:String(vaultUnits),ammVault:String(ammVaultUnits),total:String(total),estimatedCompute:String(total*70n/100n),estimatedOther:String(total-total*70n/100n)},steps:[...(waitingCurve?['curveSweep']:[]),...(waitingPool?['poolSweep']:[]),...(waitingPool+ammVaultUnits?['bridge']:[]),...(total?['distribute']:[])],initializeRecipientAtas:computeTokens===null||otherTokens===null,reasons};
}
export function buildCollectionTransaction(config,observation,blockhash){
 const expectedAddresses=feeAddresses(config),r=observation.routing;
 if(JSON.stringify(r?.addresses)!==JSON.stringify(expectedAddresses)||r.recipients?.length!==2||!r.recipients.some(x=>x.wallet===config.computeWallet&&x.bps===7000)||!r.recipients.some(x=>x.wallet===config.otherWallet&&x.bps===3000)||typeof observation.initializeRecipientAtas!=='boolean')throw Error('collection_draft_routing_mismatch');
 const amounts=observation.amounts,curve=fundingUnits(amounts.curvePending),pool=fundingUnits(amounts.poolPending),amm=fundingUnits(amounts.ammVault),vault=fundingUnits(amounts.pumpVault),total=curve+pool+amm+vault;
 const steps=[...(curve?['curveSweep']:[]),...(pool?['poolSweep']:[]),...(pool+amm?['bridge']:[]),...(total?['distribute']:[])];
 if(!total||String(total)!==amounts.total||JSON.stringify(steps)!==JSON.stringify(observation.steps))throw Error('collection_draft_steps_mismatch');
 const layouts=collectionAccounts(config,observation.routing),tx=new Transaction({feePayer:pk(config.computeWallet),recentBlockhash:blockhash});
 for(const step of observation.steps){
  const amm=['poolSweep','bridge'].includes(step),name=step==='distribute'?'distribute_creator_fees_v2':step==='bridge'?'transfer_creator_fees_to_pump_v2':'sweep_creator_fee',program=schema.programs[amm?'pump_amm':'pump'],ix=program.instructions.find(i=>i.name===name);
  const addresses=layouts[step],keys=addresses.map((key,i)=>({pubkey:pk(key),isSigner:i<ix.accounts.length?ix.accounts[i].signer:false,isWritable:i<ix.accounts.length?ix.accounts[i].writable:true}));
  tx.add(new TransactionInstruction({programId:pk(program.address),keys,data:Buffer.from([...ix.discriminator,...(step==='distribute'?[observation.initializeRecipientAtas?1:0]:[])])}));
 }
 return tx;
}
export function inspectCollectionTransaction(wire,config,observation,blockhash){
 if(!Buffer.isBuffer(wire)||wire.length>1232)throw Error('collection_wire_invalid');const tx=Transaction.from(wire),expected=buildCollectionTransaction(config,observation,blockhash).serializeMessage();
 if(!tx.serializeMessage().equals(expected)||tx.signatures.length!==1||tx.signatures[0].publicKey.toBase58()!==config.computeWallet||tx.signatures[0].signature!==null)throw Error('collection_transaction_mismatch');
 return {messageHash:sha256(expected)};
}
export async function previewFeeCollection(config,{rpc=collectionRpc(),policy=null,clock=Date.now}={}){
 const started=clock(),result={mode:'read-only',state:'held',sourceCommit:COLLECTION_SOURCE,observedAt:new Date(started).toISOString(),reasons:[],...frozenFlags,simulation:'not-run'};
 if(!config){result.state='awaiting-token-launch';result.reasons=['awaiting_project_token_mint'];return result;}
 try{
  const a=feeAddresses(config);result.projectMint=config.projectMint;
  if(await rpc('getGenesisHash',[])!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw Error('collection_wrong_network');
  const latest=await rpc('getLatestBlockhash',[{commitment:'finalized'}]),slot=num(latest?.context?.slot),blockhash=latest?.value?.blockhash;height(latest?.value?.lastValidBlockHeight);pk(blockhash);
  const response=await rpc('getMultipleAccounts',[[a.sharing,a.curve,a.pool,a.vaultAta,a.ammVaultAta,a.curveAta,a.poolAta,a.computeAta,a.otherAta,WBTC.mint,config.computeWallet],{encoding:'base64',commitment:'finalized',minContextSlot:slot}]);
  if(num(response?.context?.slot)<slot)throw Error('collection_slot_regression');
  const observed=inspectCollectionAccounts(config,response);Object.assign(result,{amounts:observed.amounts,steps:observed.steps,initializeRecipientAtas:observed.initializeRecipientAtas,slot:observed.slot,recipients:observed.routing.recipients,reasons:[...observed.reasons]});
  if(!policy)result.reasons.push('collection_cost_limits_not_configured');
  else for(const key of ['maxNetworkFeeLamports','maxTotalCostLamports','minSolReserveLamports'])if(!fundingUnits(policy[key]))throw Error('invalid_collection_policy');
  if(!observed.steps.length||observed.reasons.length)return result;
  const tx=buildCollectionTransaction(config,observed,blockhash),wire=tx.serialize({requireAllSignatures:false,verifySignatures:false});
  if(tx.signatures.length!==1||tx.signatures.some(s=>s.signature!==null))throw Error('collection_unexpected_signer');
  result.messageHash=inspectCollectionTransaction(wire,config,observed,blockhash).messageHash;result.blockhash=blockhash;result.lastValidBlockHeight=latest.value.lastValidBlockHeight;
  const fee=await rpc('getFeeForMessage',[tx.serializeMessage().toString('base64'),{commitment:'finalized',minContextSlot:observed.slot}]);
  if(num(fee?.context?.slot)<observed.slot)throw Error('collection_slot_regression');result.networkFeeLamports=String(num(fee.value));
  const sim=await rpc('simulateTransaction',[wire.toString('base64'),{encoding:'base64',sigVerify:false,replaceRecentBlockhash:false,commitment:'finalized',minContextSlot:fee.context.slot,accounts:{encoding:'base64',addresses:[config.computeWallet]}}]);
  if(num(sim?.context?.slot)<fee.context.slot||!sim.value||!Object.hasOwn(sim.value,'err'))throw Error('collection_simulation_invalid');
  result.simulation=sim.value.err===null?'passed':'failed';
  if(result.simulation==='failed')result.reasons.push('collection_simulation_failed');
  else {
   if(!Array.isArray(sim.value.accounts)||sim.value.accounts.length!==1||!sim.value.accounts[0])throw Error('collection_simulated_cost_missing');
   const post=BigInt(num(sim.value.accounts[0].lamports)),cost=BigInt(observed.solLamports)-post;
   if(cost<BigInt(result.networkFeeLamports))throw Error('collection_simulated_cost_invalid');result.totalCostLamports=String(cost);
   if(policy){if(BigInt(result.networkFeeLamports)>BigInt(policy.maxNetworkFeeLamports))result.reasons.push('collection_network_fee_cap');if(cost>BigInt(policy.maxTotalCostLamports))result.reasons.push('collection_total_cost_cap');if(post<BigInt(policy.minSolReserveLamports))result.reasons.push('collection_sol_reserve_shortfall');}
  }
  const endHeight=await rpc('getBlockHeight',[{commitment:'finalized',minContextSlot:sim.context.slot}]);if(height(endHeight)>=result.lastValidBlockHeight)result.reasons.push('collection_blockhash_expired');
  if(clock()-started>60000||clock()<started)result.reasons.push('collection_observation_expired');
  result.state=result.reasons.length?'held':'unsigned-preview';
 }catch(e){result.state='held';result.reasons.push(safe(e));}
 return result;
}
const height=num;

// Observation journal only. Claim drafts never reserve funds or become receipts.
export class FeeCollection {
 #db;#config;#treasury;#automatic;#policy;#preview;#clock;#timer;#flight;#closed=false;
 constructor(path,{treasury,automatic,projectMint=null,policy=null,preview=previewFeeCollection,clock=Date.now}={}){
  if(treasury?.mode!=='owner-recorded')throw Error('collection_real_observer_required');
  this.#treasury=treasury;this.#automatic=automatic;this.#policy=clone(policy);this.#preview=preview;this.#clock=clock;this.#config=projectMint?{projectMint,...treasury.setting('wallets')}:null;
  if(this.#config)feeAddresses(this.#config);
  if(JSON.stringify(automatic.status().configuration??null)!==JSON.stringify(this.#config))throw Error('collection_receipt_observer_mismatch');
  this.#db=new DatabaseSync(path);const tables=this.#db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();if(tables.some(t=>!['collection_meta','collection_events'].includes(t.name))){this.#db.close();throw Error('collection_observer_database_required');}
  this.#db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS collection_meta(k TEXT PRIMARY KEY,v TEXT NOT NULL); CREATE TABLE IF NOT EXISTS collection_events(id INTEGER PRIMARY KEY,body TEXT NOT NULL);');
  const old=this.#get('identity'),identity={mode:'read-only',config:this.#config};if(old&&(old.mode!=='read-only'||old.config&&JSON.stringify(old)!==JSON.stringify(identity))){this.#db.close();throw Error('collection_identity_locked');}this.#set('identity',identity);
 }
 #get(k){const row=this.#db.prepare('SELECT v FROM collection_meta WHERE k=?').get(k);return row?JSON.parse(row.v):null;}
 #set(k,v){this.#db.prepare('INSERT INTO collection_meta VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k,JSON.stringify(v));}
 refresh(){
  if(this.#closed)return Promise.resolve();if(this.#flight)return this.#flight;
  this.#flight=(async()=>{
   let result;
   try{result=await this.#preview(this.#config,{policy:this.#policy,clock:this.#clock});if(this.#config&&JSON.stringify(this.#treasury.setting('wallets'))!==JSON.stringify({computeWallet:this.#config.computeWallet,otherWallet:this.#config.otherWallet}))throw Error('collection_wallets_changed');if(JSON.stringify(this.#automatic.status().configuration??null)!==JSON.stringify(this.#config))throw Error('collection_receipt_observer_mismatch');}
   catch(e){result={state:'held',observedAt:new Date(this.#clock()).toISOString(),reasons:[safe(e)],...frozenFlags};}
   this.#db.exec('BEGIN IMMEDIATE');try{this.#set('observation',result);const key=sha256(JSON.stringify({state:result.state,reasons:result.reasons,amounts:result.amounts}));if(this.#get('lastEvent')!==key){this.#db.prepare('INSERT INTO collection_events(body) VALUES(?)').run(JSON.stringify({at:result.observedAt,state:result.state,reasons:result.reasons,amounts:result.amounts??null}));this.#set('lastEvent',key);this.#db.exec('DELETE FROM collection_events WHERE id NOT IN(SELECT id FROM collection_events ORDER BY id DESC LIMIT 100)');}this.#db.exec('COMMIT');}catch(e){this.#db.exec('ROLLBACK');throw e;}
   return result;
  })().finally(()=>{this.#flight=null;});return this.#flight;
 }
 status(){const detected=this.#automatic.status();return {mode:'read-only',running:!!this.#timer,busy:!!this.#flight,configuration:this.#config,observation:collectionView(this.#get('observation'),this.#clock()),receipts:{count:detected.receiptCount,computeUnits:detected.detectedComputeUnits,historyComplete:!!detected.feeObservation?.complete,source:'existing-finalized-distribution-observer',creditPosted:false},events:this.#db.prepare('SELECT body FROM collection_events ORDER BY id DESC LIMIT 10').all().map(r=>JSON.parse(r.body)),...frozenFlags};}
 start(){if(this.#timer||this.#closed)return;void this.refresh().catch(()=>{});this.#timer=setInterval(()=>{void this.refresh().catch(()=>{});},60000);this.#timer.unref();}
 async close(){this.#closed=true;clearInterval(this.#timer);this.#timer=null;if(this.#flight)await this.#flight;this.#db.close();}
}

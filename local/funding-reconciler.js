import {DatabaseSync} from 'node:sqlite';
import bs58 from 'bs58';
import {decode58} from './solana-evidence.js';
import {WBTC} from './treasury-compute.js';
import {fundingUnits,transferAccounts,inspectRestrictedTransfer} from './restricted-wallet-signer.js';

const encode=v=>JSON.stringify(v),copy=v=>JSON.parse(encode(v));
const exact=(a,b)=>encode(a)===encode(b);
function validateJob(j){
 if(!/^[a-zA-Z0-9_-]{1,64}$/.test(j.id))throw Error('invalid_reconciliation_id');
 decode58(j.signature,64);for(const a of [j.owner,j.recipient,j.blockhash])decode58(a,32);
 if(!/^[a-f0-9]{64}$/.test(j.messageHash)||fundingUnits(j.amount)===0n||j.mint!==WBTC.mint||j.slotNumber!==1)throw Error('invalid_reconciliation_terms');
 transferAccounts(j.owner,j.recipient);return j;
}
// This adapter has one fixed read-only RPC method and no send/airdrop operation.
export async function readFinalizedFundingTransaction(job,{fetcher=fetch}={}){
 validateJob(job);
 return readFundingTransactionBySignature(job.signature,job.id,{fetcher});
}
export async function readFundingTransactionBySignature(signature,id,{fetcher=fetch}={}){
 decode58(signature,64);if(!/^[a-zA-Z0-9_-]{1,64}$/.test(id))throw Error('invalid_reconciliation_id');
 const r=await fetcher('https://api.mainnet-beta.solana.com',{method:'POST',redirect:'error',signal:AbortSignal.timeout(12000),headers:{'Content-Type':'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id,method:'getTransaction',params:[signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:0}]})});
 if(!r.ok)throw Error('funding_rpc_unavailable');const raw=await r.text();if(raw.length>2097152)throw Error('funding_rpc_response_too_large');
 const b=JSON.parse(raw);if(b.error||b.id!==id||!Object.hasOwn(b,'result'))throw Error('funding_rpc_invalid');return b.result;
}
export function verifyFundingTransaction(job,result){
 validateJob(job);if(result===null)return {state:'pending'};
 if(!Number.isSafeInteger(result?.slot)||!result.meta||!Array.isArray(result.transaction)||result.transaction[1]!=='base64')throw Error('invalid_chain_evidence');
 const wire=Buffer.from(result.transaction[0],'base64');
 const {tx,sourceAccount,destinationAccount,messageHash}=inspectRestrictedTransfer(wire,{owner:job.owner,recipient:job.recipient,amount:job.amount,blockhash:job.blockhash});
 if(!tx.verifySignatures()||messageHash!==job.messageHash||bs58.encode(tx.signature)!==job.signature)throw Error('chain_signature_mismatch');
 if(result.meta.err!==null){if(result.meta.err===undefined)throw Error('invalid_chain_evidence');return {state:'failed',slot:result.slot};}
 if((result.meta.innerInstructions??[]).some(i=>i.instructions?.length))throw Error('unexpected_inner_instructions');
 const keys=tx.compileMessage().accountKeys.map(k=>k.toBase58());
 const balance=(rows,account,owner)=>{
  if(!Array.isArray(rows))throw Error('missing_token_balances');const found=rows.filter(r=>keys[r.accountIndex]===account);
  if(found.length!==1)throw Error('ambiguous_token_balance');const r=found[0];
  if(r.mint!==WBTC.mint||r.owner!==owner||r.programId!==WBTC.program||r.uiTokenAmount?.decimals!==8)throw Error('token_balance_identity_mismatch');
  return fundingUnits(r.uiTokenAmount.amount);
 };
 const debit=balance(result.meta.preTokenBalances,sourceAccount,job.owner)-balance(result.meta.postTokenBalances,sourceAccount,job.owner);
 const credit=balance(result.meta.postTokenBalances,destinationAccount,job.recipient)-balance(result.meta.preTokenBalances,destinationAccount,job.recipient);
 if(debit!==BigInt(job.amount)||credit!==BigInt(job.amount))throw Error('token_delta_mismatch');
 return {state:'finalized',slot:result.slot,signature:job.signature,amount:job.amount};
}

// The current MCP invoice lacks a chain signature and proven net card credit.
// Never invent either from a matching amount/address or swapUsdAmount.
export function assessSolCardInvoice(invoice,job){
 if(!invoice)return {state:'unavailable',reason:'card_receipt_unavailable'};
 if(invoice.network!=='SOLANA'||invoice.currency!=='WBTC'||invoice.address!==job.recipient)return {state:'review-required',reason:'card_invoice_identity_mismatch'};
 return {state:'unavailable',reason:'card_signature_and_net_credit_not_proven'};
}

export class FundingReconciler {
 #db;#mode;#clock;#chain;#card;#provider;#busy=false;#timer=null;#stopped=true;#delay;#schedule;#cancel;
 constructor(path,{mode='observe-only',clock=Date.now,readChain=readFinalizedFundingTransaction,
  readCard=async()=>({state:'unavailable',reason:'card_backend_not_connected'}),readProvider=async()=>({state:'unavailable',reason:'provider_receipts_not_connected'}),
  intervalMs=60000,schedule=setTimeout,cancel=clearTimeout}={}){
  if(!['observe-only','simulation'].includes(mode)||!Number.isInteger(intervalMs)||intervalMs<1000)throw Error('invalid_reconciler_config');
  this.#db=new DatabaseSync(path);this.#db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS reconciliation_meta(key TEXT PRIMARY KEY,body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS reconciliation_jobs(id TEXT PRIMARY KEY, signature TEXT UNIQUE NOT NULL, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS reconciliation_receipts(id TEXT PRIMARY KEY, job TEXT NOT NULL, body TEXT NOT NULL);');
  const existing=this.#get('mode');if(existing&&existing!==mode){this.#db.close();throw Error('reconciliation_mode_mismatch');}this.#set('mode',mode);
  this.#mode=mode;this.#clock=clock;this.#chain=readChain;this.#card=readCard;this.#provider=readProvider;this.#delay=intervalMs;this.#schedule=schedule;this.#cancel=cancel;
 }
 #get(key){const r=this.#db.prepare('SELECT body FROM reconciliation_meta WHERE key=?').get(key);return r?JSON.parse(r.body):null;}
 #set(key,value){this.#db.prepare('INSERT INTO reconciliation_meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body').run(key,encode(value));}
 #save(j){this.#db.prepare('UPDATE reconciliation_jobs SET body=? WHERE id=?').run(encode(j),j.id);}
 get(id){const r=this.#db.prepare('SELECT body FROM reconciliation_jobs WHERE id=?').get(id);return r?JSON.parse(r.body):null;}
 register(input){
  const terms=copy(validateJob(input));const old=this.get(terms.id);if(old){if(!exact(old.terms,terms))throw Error('reconciliation_terms_changed');return old;}
  const job={id:terms.id,terms,state:'awaiting-chain',mode:this.#mode,checks:0,createdAt:new Date(this.#clock()).toISOString()};
  this.#db.prepare('INSERT INTO reconciliation_jobs VALUES (?,?,?)').run(terms.id,terms.signature,encode(job));return job;
 }
 #receipt(j,receipt,stage){
  if(receipt?.state!=='credited')return false;
  // Only synthetic receipts are currently consumable. Production adapters must
  // authenticate their provenance and binding before this gate can be extended.
  if(this.#mode!=='simulation'||receipt.source!=='simulation')throw Error('unverified_credit_receipt');
  const t=j.terms;
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(receipt.id)||receipt.jobId!==j.id||receipt.signature!==t.signature||receipt.slotNumber!==t.slotNumber||receipt.depositAddress!==t.recipient||receipt.wbtcUnits!==t.amount)throw Error('credit_receipt_mismatch');
  if(fundingUnits(receipt.netMicrousd)===0n)throw Error('invalid_credit_amount');
  if(stage==='provider'&&(receipt.cardReceiptId!==j.card.id||BigInt(receipt.netMicrousd)>BigInt(j.card.netMicrousd)))throw Error('provider_credit_mismatch');
  const at=Date.parse(receipt.observedAt),now=this.#clock();if(!Number.isFinite(at)||at>now||now-at>300000)throw Error('stale_credit_receipt');
  const key=stage+'-'+receipt.id;
  this.#db.exec('BEGIN IMMEDIATE');try{
   const old=this.#db.prepare('SELECT * FROM reconciliation_receipts WHERE id=?').get(key);
   if(old&&(old.job!==j.id||!exact(JSON.parse(old.body),receipt)))throw Error('credit_receipt_reused');
   if(!old)this.#db.prepare('INSERT INTO reconciliation_receipts VALUES (?,?,?)').run(key,j.id,encode(receipt));
   const next={...j,[stage]:copy(receipt),state:stage==='card'?'awaiting-provider':'complete',reason:null};
   this.#save(next);this.#db.exec('COMMIT');
   // Only update the in-memory job after both receipt and progression commit.
   // Otherwise tick's error save would resurrect a rolled-back credit.
   Object.assign(j,next);
  }catch(e){this.#db.exec('ROLLBACK');throw e;}return true;
 }
 async tick(){
  if(this.#busy)return {skipped:'busy'};this.#busy=true;let errors=0;
  try{
   const jobs=this.#db.prepare("SELECT body FROM reconciliation_jobs WHERE json_extract(body,'$.state') IN ('awaiting-chain','awaiting-card','awaiting-provider') ORDER BY COALESCE(json_extract(body,'$.lastCheckedAt'),''), rowid LIMIT 20").all().map(r=>JSON.parse(r.body));
   for(const j of jobs){
    try{
     j.checks++;j.lastCheckedAt=new Date(this.#clock()).toISOString();
     if(j.state==='awaiting-chain'){
      const proof=verifyFundingTransaction(j.terms,await this.#chain(j.terms));
      if(proof.state==='pending'){j.reason='transaction_not_finalized_or_not_found';}
      else if(proof.state==='failed'){j.state='chain-failed';j.chain=proof;j.reason='finalized_transaction_failed';}
      else {j.state='awaiting-card';j.chain=proof;j.reason='awaiting_attributable_card_credit';}
     }else if(j.state==='awaiting-card'){
      const receipt=await this.#card(copy(j));if(!this.#receipt(j,receipt,'card'))j.reason=receipt?.reason??'awaiting_card_receipt';
     }else if(j.state==='awaiting-provider'){
      const receipt=await this.#provider(copy(j));if(!this.#receipt(j,receipt,'provider'))j.reason=receipt?.reason??'awaiting_provider_receipt';
     }
     this.#save(j);
    }catch(e){errors++;j.reason=/^[a-z_]{1,80}$/.test(e.message)?e.message:'reconciliation_read_failed';this.#save(j);}
   }
   this.#set('lastTick',{at:new Date(this.#clock()).toISOString(),checked:jobs.length,errors});return {checked:jobs.length,errors};
  }finally{this.#busy=false;}
 }
 status(){const jobs=this.#db.prepare('SELECT body FROM reconciliation_jobs').all().map(r=>JSON.parse(r.body));return {mode:this.#mode,running:!this.#stopped,busy:this.#busy,lastTick:this.#get('lastTick'),jobs:jobs.map(({id,state,reason,checks})=>({id,state,reason,checks})),liveSigning:false,broadcastEnabled:false,automaticCreditPosting:false};}
 start(){if(!this.#stopped)return;this.#stopped=false;const loop=async()=>{let failed=false;try{const r=await this.tick();failed=!!r.errors;}catch{failed=true;}if(!this.#stopped){this.#timer=this.#schedule(loop,failed?Math.min(this.#delay*5,300000):this.#delay);this.#timer?.unref?.();}};void loop();}
 async stop(){this.#stopped=true;if(this.#timer!==null)this.#cancel(this.#timer);while(this.#busy)await new Promise(r=>setTimeout(r,10));}
 async close(){await this.stop();this.#db.close();}
}

import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {WBTC} from './treasury-compute.js';
import {matchSettlements} from './settlement-matching.js';
const clone=v=>JSON.parse(JSON.stringify(v));
const id=v=>{if(typeof v!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(v))throw Error('invalid_funding_record_id');return v;};
const at=v=>{if(typeof v!=='string'||!Number.isFinite(Date.parse(v)))throw Error('invalid_funding_record_time');return v;};
const label=v=>{if(typeof v!=='string'||v.length>160)throw Error('invalid_funding_record_text');return v;};
export function dollarsToMicros(v){
 if(typeof v==='number'){if(!Number.isFinite(v)||Math.abs(v)>1e9)throw Error('invalid_funding_record_amount');v=String(v);if(/[eE]/.test(v))v=Number(v).toFixed(12);}
 if(typeof v!=='string'||! /^-?\d{1,16}(\.\d{1,18})?$/.test(v))throw Error('invalid_funding_record_amount');
 const negative=v.startsWith('-'),[whole,fraction='']=v.replace(/^-/,'').split('.');
 const n=BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0').slice(0,6));return ((negative?-1n:1n)*n).toString();
}
function rows(v){if(!Array.isArray(v)||v.length>1000)throw Error('invalid_funding_record_list');return v;}
export function normalizeSolcardRecords(raw,expected){
 const {card,addresses,activity,deposits}=raw;
 if(card?.slotNumber!==1||card.currency!=='USD'||card.last4!==expected.last4||card.fundingAccountId!==expected.fundingAccountId||card.fundingAccountShared!==false||addresses?.slotNumber!==1||addresses.solanaAddress!==expected.depositAddress)throw Error('solcard_project_identity_mismatch');
 const matching=rows(deposits?.deposits).filter(d=>d.slotNumber===1&&d.network==='SOLANA'&&d.paymentAddress===expected.depositAddress);
 const invoiceMap=new Map();for(const d of matching){if(invoiceMap.has(d.invoiceId))throw Error('duplicate_solcard_invoice');invoiceMap.set(d.invoiceId,d);}
 const detailMap=new Map();for(const entry of rows(raw.invoiceDetails??[])){
  id(entry.id);if(detailMap.has(entry.id))throw Error('duplicate_solcard_invoice_detail');
  let detail={state:'unavailable'};
  if(entry.state==='read'){
   const d=entry.value,listed=invoiceMap.get(entry.id);
   if(!listed||d?.invoiceId!==entry.id||d.address!==expected.depositAddress||d.network!=='SOLANA'||d.currency!==listed.currency||d.amount!==listed.amount)throw Error('solcard_invoice_detail_mismatch');
   detail={state:'read',address:d.address,network:d.network,status:label(d.status),paidAmount:d.payment?.currencyAmount==null?null:label(d.payment.currencyAmount),
    conversionUsd:d.payment?.swapUsdAmount==null?null:label(d.payment.swapUsdAmount),refundPresent:!!d.refundSignature};
  }
  detailMap.set(entry.id,detail);
 }
 const seen=new Set(),records=rows(activity?.rows).map(r=>{
  id(r.id);if(seen.has(r.id))throw Error('duplicate_solcard_activity');seen.add(r.id);
  if(r.currency!=='USD')throw Error('solcard_activity_currency_mismatch');
  const d=invoiceMap.get(r.id);
  return {id:r.id,kind:'card-activity',amountMicrousd:dollarsToMicros(r.amount),status:label(r.status),description:label(r.description),occurredAt:at(r.createdAt),
   invoice:d?{id:id(d.invoiceId),asset:label(d.currency),amount:label(d.amount),status:label(d.status),paymentStatus:label(d.paymentStatus),detail:detailMap.get(d.invoiceId)??{state:'unavailable'}}:null,
   attribution:'unattributed',chainSignature:null};
 });
 return {provider:'solcard',accountRef:createHash('sha256').update(JSON.stringify([card.fundingAccountId,card.slotNumber,addresses.solanaAddress])).digest('hex'),assetMint:WBTC.mint,observedAt:at(raw.observedAt),connection:'authenticated-api',balanceMicrousd:dollarsToMicros(card.balance),cardStatus:label(card.status),
  records,coverage:{activityHasMore:activity.hasMore===true,depositsHasMore:deposits.hasMore??Number(deposits.pagination?.totalPages)>1,invoiceDetailsIncomplete:raw.invoiceDetailsIncomplete??true,scope:'bounded current-card history; invoice details require slot and deposit address match'},
  limitation:'Provider-reported card activity. No transfer signature or fee-origin proof; excluded from project credit.'};
}
export function normalizeRunpodRecords(raw){
 const a=raw.account;if(!a||typeof a.id!=='string'||!a.id)throw Error('runpod_account_missing');
 const seen=new Set(),records=rows(a.stripeReloadHistory).map(r=>{id(r.id);if(seen.has(r.id))throw Error('duplicate_runpod_reload');seen.add(r.id);
  return {id:r.id,kind:'provider-reload',amountMicrousd:dollarsToMicros(r.amount),status:r.transactionCompletedAt?'provider-reported-completed':'pending',occurredAt:r.transactionCompletedAt?at(r.transactionCompletedAt):null,
   medium:label(r.medium),type:label(r.type),attribution:'unattributed',cardActivityId:null};});
 let usage=null;
 if(raw.billing!==undefined||raw.billingWindow!==undefined){
  const b=raw.billing,q=b?.metadata?.query,w=raw.billingWindow;
  if(!w||!q||q.bucketSize!=='day'||w.bucketSize!=='day'||Date.parse(q.startTime)!==Date.parse(w.start)||Date.parse(q.endTime)!==Date.parse(w.end))throw Error('runpod_usage_window_mismatch');
  const start=Date.parse(at(w.start)),end=Date.parse(at(w.end)),observed=Date.parse(at(raw.observedAt));
  if(start%86400000||end%86400000||start>observed||end!==Math.ceil(observed/86400000)*86400000||end<start||end-start>366*86400000)throw Error('runpod_usage_window_invalid');
  const daily=rows(b.records).map(r=>({start:at(r.startTime),end:at(r.endTime),amountMicrousd:dollarsToMicros(r.totalAmount)}));
  if(b.metadata.recordCount!==daily.length)throw Error('runpod_usage_incomplete');
  const dates=new Set();let sum=0n;
  for(const r of daily){const s=Date.parse(r.start),e=Date.parse(r.end);if(s%86400000||e-s!==86400000||s<start||e>end||dates.has(s)||BigInt(r.amountMicrousd)<0n)throw Error('runpod_usage_bucket_invalid');dates.add(s);sum+=BigInt(r.amountMicrousd);}
  const counterMicrousd=dollarsToMicros(b.metadata.totals?.totalAmount),total=BigInt(counterMicrousd),difference=total-sum;
  // Independent six-decimal truncation can differ by <1 microdollar per bucket.
  if(total<0n||difference<0n||difference>BigInt(daily.length))throw Error('runpod_usage_totals_mismatch');
  usage={source:'authenticated-rest-billing-fixed-window',start:new Date(start).toISOString(),end:new Date(end).toISOString(),bucketSize:'day',counterMicrousd,daily,detailScope:'Account-wide billing since a persistent anchor; not per-resource project attribution'};
 }
 return {provider:'runpod',observedAt:at(raw.observedAt),connection:'authenticated-api',accountRef:createHash('sha256').update(a.id).digest('hex'),balanceMicrousd:dollarsToMicros(a.clientBalance),records,usage,
  coverage:{start:at(raw.window.start),end:at(raw.window.end),scope:'90-day Stripe reload history; not every payment rail'},
  limitation:'Account credits can include personal funding. Reload records lack a project-card linkage; excluded from project credit.'};
}

// This database is evidence only. It has no treasury posting or payment capability.
export class FundingRecords{
 #db;#readers;#clock;#timer;#stopped=true;#busy=false;#lastRefresh=0;#onFeed;
 constructor(path,{readSolcard,readRunpod,expectedSolcard,clock=Date.now,onFeed=()=>{}}={}){
  this.#db=new DatabaseSync(path);this.#db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS funding_record_feeds(provider TEXT PRIMARY KEY,body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS settlement_observations(id INTEGER PRIMARY KEY,digest TEXT NOT NULL,body TEXT NOT NULL);');
  this.#readers={solcard:async()=>normalizeSolcardRecords(await readSolcard(),expectedSolcard),runpod:async()=>normalizeRunpodRecords(await readRunpod())};this.#clock=clock;this.#onFeed=onFeed;
 }
 #get(provider){const row=this.#db.prepare('SELECT body FROM funding_record_feeds WHERE provider=?').get(provider);return row?JSON.parse(row.body):null;}
 #save(provider,body){this.#db.prepare('INSERT INTO funding_record_feeds VALUES (?,?) ON CONFLICT(provider) DO UPDATE SET body=excluded.body').run(provider,JSON.stringify(body));}
 async refresh({force=false}={}){
  if(this.#busy)return {skipped:'busy'};if(!force&&this.#clock()-this.#lastRefresh<30000)return {skipped:'rate-limited'};
  this.#busy=true;this.#lastRefresh=this.#clock();
  try{await Promise.all(Object.entries(this.#readers).map(async([provider,read])=>{
   try{const next=await read(),now=this.#clock(),delta=now-Date.parse(next.observedAt);if(delta<0||delta>60000)throw Error('stale_funding_read');
    const old=this.#get(provider);if(provider==='runpod'&&old?.data?.accountRef&&old.data.accountRef!==next.accountRef)throw Error('runpod_account_changed');
    this.#save(provider,{state:'connected',checkedAt:new Date(now).toISOString(),error:null,data:next});this.#onFeed(provider,this.#get(provider));
   }catch(e){const old=this.#get(provider);this.#save(provider,{state:'unavailable',checkedAt:new Date(this.#clock()).toISOString(),error:/^[a-z_]{1,80}$/.test(e.message)?e.message:'funding_read_unavailable',data:old?.data??null});this.#onFeed(provider,this.#get(provider));}
  }));this.#recordMatching();return this.status();}finally{this.#busy=false;}
 }
 #feeds(){return Object.fromEntries(['solcard','runpod'].map(provider=>{
  const feed=this.#get(provider)??{state:'not-connected',data:null};const age=this.#clock()-Date.parse(feed.data?.observedAt);return [provider,{...clone(feed),fresh:feed.state==='connected'&&age>=0&&age<=360000}];}));}
 #recordMatching(){
  const matching=matchSettlements(this.#feeds()),digest=createHash('sha256').update(JSON.stringify(matching)).digest('hex');
  if(this.#db.prepare('SELECT digest FROM settlement_observations ORDER BY id DESC LIMIT 1').get()?.digest===digest)return;
  this.#db.exec('BEGIN IMMEDIATE');try{this.#db.prepare('INSERT INTO settlement_observations(digest,body) VALUES(?,?)').run(digest,JSON.stringify({observedAt:new Date(this.#clock()).toISOString(),matching}));this.#db.exec('DELETE FROM settlement_observations WHERE id NOT IN(SELECT id FROM settlement_observations ORDER BY id DESC LIMIT 100)');this.#db.exec('COMMIT');}catch(e){this.#db.exec('ROLLBACK');throw e;}
 }
 status(){const feeds=this.#feeds();return {mode:'read-only',running:!this.#stopped,busy:this.#busy,automaticCreditPosting:false,feeds,settlement:{...matchSettlements(feeds),history:this.#db.prepare('SELECT body FROM settlement_observations ORDER BY id DESC LIMIT 10').all().map(r=>JSON.parse(r.body))}};}
 readCardReceipt(job){const feeds=this.#feeds(),f=feeds.solcard;return {state:'unavailable',reason:!f.fresh?'card_records_unavailable_or_stale':'card_records_lack_transfer_signature',observedAt:f.data?.observedAt??null,matching:matchSettlements(feeds,job)};}
 readProviderReceipt(job){const feeds=this.#feeds(),f=feeds.runpod;return {state:'unavailable',reason:!f.fresh?'provider_records_unavailable_or_stale':'provider_records_lack_project_card_link',observedAt:f.data?.observedAt??null,matching:matchSettlements(feeds,job)};}
 start(){if(!this.#stopped)return;this.#stopped=false;const loop=async()=>{try{await this.refresh();}finally{if(!this.#stopped){this.#timer=setTimeout(loop,300000);this.#timer.unref();}}};void loop().catch(()=>{});}
 async close(){this.#stopped=true;clearTimeout(this.#timer);while(this.#busy)await new Promise(r=>setTimeout(r,10));this.#db.close();}
}

import {createPublicKey,randomBytes} from 'node:crypto';
import {MAX_CHUNK,PROBE_KEY,bounds,target,stamp,digest,rangeFail,rangeRequest,verifyRangeReceipt,recoveryPublic} from './own-range-protocol.js';
export class OwnRangeLedger {
 constructor(controller,{authorizeApproval}={}){this.controller=controller;this.authorizeApproval=authorizeApproval;controller.db.exec(`
  CREATE TABLE IF NOT EXISTS own_range_jobs(id TEXT PRIMARY KEY,target TEXT NOT NULL,start TEXT NOT NULL,end TEXT NOT NULL,
   next TEXT NOT NULL,solver TEXT NOT NULL,state TEXT NOT NULL,epoch INTEGER NOT NULL DEFAULT 0,expires INTEGER NOT NULL DEFAULT 0,
   pod TEXT,public_key TEXT,capability_hash TEXT,approval_digest TEXT,recovery_key_id TEXT,recovery_public TEXT);
  CREATE TABLE IF NOT EXISTS own_range_chunks(job TEXT NOT NULL,epoch INTEGER NOT NULL,start TEXT NOT NULL,end TEXT NOT NULL,
   request TEXT NOT NULL,state TEXT NOT NULL,receipt_digest TEXT,PRIMARY KEY(job,epoch,start));
  CREATE TABLE IF NOT EXISTS own_range_receipts(digest TEXT PRIMARY KEY,job TEXT NOT NULL,epoch INTEGER NOT NULL,
   start TEXT NOT NULL,end TEXT NOT NULL,received INTEGER NOT NULL,payload TEXT NOT NULL,signature TEXT NOT NULL,private INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS own_range_meta(key TEXT PRIMARY KEY,value INTEGER NOT NULL);`);}
 clock(now){stamp(now);const db=this.controller.db,old=db.prepare("SELECT value FROM own_range_meta WHERE key='clock'").get()?.value??0;
  if(now<old)throw rangeFail('clock_rollback');db.prepare("INSERT OR REPLACE INTO own_range_meta VALUES('clock',?)").run(now);return now;}
 row(id){const r=this.controller.db.prepare('SELECT * FROM own_range_jobs WHERE id=?').get(id);if(!r)throw rangeFail('unknown_job');return r;}
 reserve(id,targetId,size,solverSha256){
  const t=target(targetId);size=BigInt(size);
  if(!/^range-[a-f0-9]{24}$/.test(id)||size<1n||size>MAX_CHUNK||!/^[a-f0-9]{64}$/.test(solverSha256))throw rangeFail('invalid_plan');
  return this.controller.transaction(()=>{
   const db=this.controller.db,old=db.prepare('SELECT * FROM own_range_jobs WHERE id=?').get(id);
   if(old){if(old.target!==targetId||old.solver!==solverSha256||BigInt(old.end)-BigInt(old.start)!==size)throw rangeFail('conflicting_plan');return old;}
   if(db.prepare("SELECT id FROM own_range_jobs WHERE target=? AND state='private-review'").get(targetId))throw rangeFail('target_paused');
   const used=db.prepare('SELECT start,end FROM own_range_jobs WHERE target=?').all(targetId).sort((a,b)=>BigInt(a.start)<BigInt(b.start)?-1:1);
   let start=targetId==='range-probe-71'?PROBE_KEY-4n:BigInt(t.start);for(const r of used){if(start+size<=BigInt(r.start))break;if(start<BigInt(r.end))start=BigInt(r.end);}
   bounds(targetId,String(start),String(start+size));
   db.prepare("INSERT INTO own_range_jobs(id,target,start,end,next,solver,state) VALUES(?,?,?,?,?,?,'planned')")
    .run(id,targetId,String(start),String(start+size),String(start),solverSha256);return this.row(id);
  });
 }
 // Operator-only enrollment, never a public HTTP endpoint. A benchmark approval
 // cannot authorize puzzle search: purpose, target, job, range and binary bind.
 lease(id,{publicKey,providerPodId,expiresAt,approval,recoveryPublicKey=null,capability=null},now=Date.now()){
  stamp(now);stamp(expiresAt);const key=createPublicKey(publicKey);
  if(key.asymmetricKeyType!=='ed25519'||!/^[-a-zA-Z0-9]{1,64}$/.test(providerPodId)||expiresAt<=now||expiresAt-now>900000||capability!==null&&!/^[a-f0-9]{64}$/.test(capability))throw rangeFail('invalid_enrollment');
  return this.controller.transaction(()=>{
   this.clock(now);
   const r=this.row(id),db=this.controller.db;
   if(db.prepare("SELECT id FROM own_range_jobs WHERE target=? AND state='private-review'").get(r.target))throw rangeFail('target_paused');
   if(['completed','private-review'].includes(r.state)||r.state==='leased'&&now<r.expires)throw rangeFail('lease_unavailable');
   if(!approval||!Number.isSafeInteger(approval.expiresAt)||approval.expiresAt<=now)throw rangeFail('range_approval_required');
   if(!approval||approval.state!==(r.target==='puzzle-71'?'google-owner-approved':'local-validation')||approval.workload!=='fixed-public-puzzle-range'||approval.jobId!==id||
    approval.targetId!==r.target||approval.start!==r.start||approval.end!==r.end||approval.solverSha256!==r.solver||
    approval.providerPodId!==providerPodId||approval.expiresAt<expiresAt||! /^[a-f0-9]{64}$/.test(approval.digest))throw rangeFail('range_approval_required');
   if(r.target==='puzzle-71'&&approval.validationOnly!==false||r.target==='range-probe-71'&&approval.validationOnly!==true)throw rangeFail('wrong_approval_scope');
   if(r.target==='puzzle-71'&&(typeof this.authorizeApproval!=='function'||this.authorizeApproval(approval,r)!==true))throw rangeFail('range_approval_unverified');
   const recipient=r.target==='puzzle-71'?recoveryPublic(recoveryPublicKey):null;
   if(r.target==='puzzle-71'&&approval.recoveryKeyId!==recipient.keyId)throw rangeFail('recovery_key_not_approved');
   capability??=randomBytes(32).toString('hex');const epoch=r.epoch+1;
   db.prepare("UPDATE own_range_chunks SET state='interrupted' WHERE job=? AND state='pending'").run(id);
   db.prepare("UPDATE own_range_jobs SET state='leased',epoch=?,expires=?,pod=?,public_key=?,capability_hash=?,approval_digest=?,recovery_key_id=?,recovery_public=? WHERE id=?")
    .run(epoch,expiresAt,providerPodId,key.export({type:'spki',format:'pem'}).toString(),digest(capability),approval.digest,recipient?.keyId??null,recipient?.publicKey??null,id);
   return {jobId:id,epoch,capability,expiresAt,recoveryPublicKey:recipient?.publicKey??null};
  });
 }
 authenticate(id,epoch,capability,now,allowExpired=false){
  const r=this.row(id);stamp(now);
  if(r.epoch!==epoch||typeof capability!=='string'||! /^[a-f0-9]{64}$/.test(capability)||digest(capability)!==r.capability_hash)throw rangeFail('lease_fenced');
  if(!allowExpired&&(r.state!=='leased'||now>=r.expires))throw rangeFail('lease_expired');return r;
 }
 next(id,epoch,capability,size,now=Date.now()){
  size=BigInt(size);if(size<1n||size>MAX_CHUNK)throw rangeFail('invalid_chunk_size');
  return this.controller.transaction(()=>{
   this.clock(now);
   const r=this.authenticate(id,epoch,capability,now),db=this.controller.db;
   if(db.prepare("SELECT id FROM own_range_jobs WHERE target=? AND state='private-review'").get(r.target))throw rangeFail('target_paused');
   if(r.next===r.end)return null;
   const old=db.prepare("SELECT request FROM own_range_chunks WHERE job=? AND epoch=? AND start=? AND state='pending'").get(id,epoch,r.next);
   if(old)return JSON.parse(old.request);
   const end=BigInt(r.next)+size<BigInt(r.end)?BigInt(r.next)+size:BigInt(r.end);
   const request=rangeRequest({schema:'bithash.own-range-request.v1',jobId:id,epoch,targetId:r.target,start:r.next,end:String(end),
    solverSha256:r.solver,providerPodId:r.pod,expiresAt:r.expires,recoveryKeyId:r.recovery_key_id});
   db.prepare("INSERT INTO own_range_chunks(job,epoch,start,end,request,state) VALUES(?,?,?,?,?,'pending')")
    .run(id,epoch,request.start,request.end,JSON.stringify(request));return request;
  });
 }
 accept(id,epoch,capability,envelope,now=Date.now()){
  return this.controller.transaction(()=>{
   this.clock(now);
   const r=this.authenticate(id,epoch,capability,now,true),db=this.controller.db;
   const payload=verifyRangeReceipt(envelope,r.public_key),q=payload.request,serialized=JSON.stringify(payload),sha=digest(serialized);
   if(q.jobId!==id||q.epoch!==epoch||q.targetId!==r.target||q.solverSha256!==r.solver||q.providerPodId!==r.pod)throw rangeFail('identity_mismatch');
   if(db.prepare('SELECT digest FROM own_range_receipts WHERE digest=?').get(sha))return {accepted:true,duplicate:true,digest:sha,completed:r.state==='completed',privateReview:r.state==='private-review'};
   this.authenticate(id,epoch,capability,now);
   const chunk=db.prepare('SELECT * FROM own_range_chunks WHERE job=? AND epoch=? AND start=?').get(id,epoch,q.start);
   if(!chunk||chunk.state!=='pending'||chunk.request!==JSON.stringify(q)||r.next!==q.start)throw rangeFail('noncontiguous_receipt');
   const privateReview=payload.result.status==='candidate';
   db.prepare('INSERT INTO own_range_receipts VALUES(?,?,?,?,?,?,?,?,?)').run(sha,id,epoch,q.start,q.end,now,serialized,envelope.signature,privateReview?1:0);
   db.prepare("UPDATE own_range_chunks SET state=?,receipt_digest=? WHERE job=? AND epoch=? AND start=?")
    .run(privateReview?'private-review':'accepted',sha,id,epoch,q.start);
   if(privateReview)db.prepare("UPDATE own_range_jobs SET state='private-review' WHERE id=?").run(id);
   else db.prepare('UPDATE own_range_jobs SET next=?,state=? WHERE id=?').run(q.end,q.end===r.end?'completed':'leased',id);
   return {accepted:true,duplicate:false,digest:sha,completed:!privateReview&&q.end===r.end,privateReview};
  });
 }
}
export function ownRangeSummary(db){
 const has=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='own_range_jobs'").get();
 if(!has)return {schema:'bithash.own-range-ledger.v1',status:'not-configured',items:[],puzzle71CheckpointedCandidates:'0'};
 const rows=db.prepare('SELECT id,target,start,end,next,state,epoch,expires,solver FROM own_range_jobs ORDER BY rowid').all();
 return {schema:'bithash.own-range-ledger.v1',status:'available',policy:'own-history-only',itemsLimit:100,
  puzzle71CheckpointedCandidates:rows.filter(r=>r.target==='puzzle-71').reduce((n,r)=>n+BigInt(r.next)-BigInt(r.start),0n).toString(),
  items:rows.slice(0,100).map(r=>r.state==='private-review'?{id:r.id,targetId:r.target,state:'private-review'}:
   {id:r.id,targetId:r.target,start:r.start,end:r.end,next:r.next,state:r.state,epoch:r.epoch,expiresAt:r.expires,solverSha256:r.solver,
    evidence:r.next===r.start?'reserved-no-completed-work':r.target==='range-probe-71'?'known-answer-probe':'authenticated-worker-claim',hardwareVerified:false,coverageVerified:false})};
}

import {createHash,createPublicKey,sign,verify} from 'node:crypto';
export const telemetryDomain='bithash.gpu-telemetry.v1\n';
const hash=s=>createHash('sha256').update(s).digest('hex');
const integer=s=>typeof s==='string'&&/^(0|[1-9][0-9]{0,29})$/.test(s);
function normalized(p){
 const fields=['schema','lease','sequence','state','device','utilizationPercent','candidatesPerSecond','candidatesChecked'];
 if(!p||Object.keys(p).sort().join()!==[...fields].sort().join()||p.schema!=='bithash.gpu-telemetry.v1'||typeof p.lease!=='string'||!/^[a-f0-9]{32}$/.test(p.lease)||!Number.isSafeInteger(p.sequence)||p.sequence<1||!['idle','computing','error'].includes(p.state)||!['cpu-fixture','nvidia-gpu'].includes(p.device)||!(p.utilizationPercent===null||(Number.isInteger(p.utilizationPercent)&&p.utilizationPercent>=0&&p.utilizationPercent<=100))||!(p.candidatesPerSecond===null||integer(p.candidatesPerSecond))||!(p.candidatesChecked===null||integer(p.candidatesChecked)))throw Error('invalid_report');
 return Object.fromEntries(fields.map(k=>[k,p[k]]));
}
export function signTelemetry(payload,key){const p=normalized(payload);return {payload:p,signature:sign(null,Buffer.from(telemetryDomain+JSON.stringify(p)),key).toString('base64')};}
export class GpuTelemetry{
 constructor(db){this.db=db;db.exec(`CREATE TABLE IF NOT EXISTS gpu_telemetry_leases(id TEXT PRIMARY KEY, enrollment TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS gpu_telemetry_reports(digest TEXT PRIMARY KEY,lease TEXT NOT NULL,sequence INTEGER NOT NULL,received_at INTEGER NOT NULL,envelope TEXT NOT NULL,UNIQUE(lease,sequence));`);}
 enroll(e,now=Date.now()){
  if(!e||Object.keys(e).sort().join()!==['id','publicKey','build','providerPodId','kind','expiresAt'].sort().join()||!/^[a-f0-9]{32}$/.test(e.id)||!/^sha256:[a-f0-9]{64}$/.test(e.build)||!['transport-test','gpu'].includes(e.kind)||!(e.kind==='transport-test'?e.providerPodId===null:/^[a-z0-9]{10,32}$/.test(e.providerPodId))||!Number.isSafeInteger(e.expiresAt)||e.expiresAt<=now||e.expiresAt-now>86400000)throw Error('invalid_enrollment');
  if(createPublicKey(e.publicKey).asymmetricKeyType!=='ed25519')throw Error('invalid_key');
  const value=JSON.stringify(e),old=this.db.prepare('SELECT enrollment FROM gpu_telemetry_leases WHERE id=?').get(e.id);
  if(old){if(old.enrollment!==value)throw Error('immutable_enrollment');return;}
  this.db.prepare('INSERT INTO gpu_telemetry_leases(id,enrollment) VALUES (?,?)').run(e.id,value);
 }
 revoke(id){this.db.prepare('UPDATE gpu_telemetry_leases SET revoked=1 WHERE id=?').run(id);}
 accept(envelope,now=Date.now()){
  if(!Number.isSafeInteger(now)||!envelope||Object.keys(envelope).sort().join()!=='payload,signature'||typeof envelope.signature!=='string'||!/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature))throw Error('invalid_envelope');
  const p=normalized(envelope.payload),bytes=telemetryDomain+JSON.stringify(p),digest=hash(bytes);
  this.db.exec('BEGIN IMMEDIATE');try{
   const row=this.db.prepare('SELECT * FROM gpu_telemetry_leases WHERE id=?').get(p.lease);if(!row)throw Error('unknown_lease');
   const e=JSON.parse(row.enrollment);if(row.revoked||now>=e.expiresAt||!verify(null,Buffer.from(bytes),e.publicKey,Buffer.from(envelope.signature,'base64'))||((e.kind==='transport-test')!==(p.device==='cpu-fixture')))throw Error('authentication_failed');
   const old=this.db.prepare('SELECT * FROM gpu_telemetry_reports WHERE lease=? ORDER BY sequence DESC LIMIT 1').get(p.lease);
   if(old&&now<old.received_at)throw Error('clock_rollback');
   if(old&&p.sequence<=old.sequence){if(old.digest!==digest)throw Error('replay');this.db.exec('COMMIT');return {digest,duplicate:true};}
   if(p.candidatesChecked!==null){const prior=this.db.prepare("SELECT envelope FROM gpu_telemetry_reports WHERE lease=? AND json_extract(envelope,'$.payload.candidatesChecked') IS NOT NULL ORDER BY sequence DESC LIMIT 1").get(p.lease);if(prior&&BigInt(p.candidatesChecked)<BigInt(JSON.parse(prior.envelope).payload.candidatesChecked))throw Error('counter_rollback');}
   if(this.db.prepare('SELECT count(*) AS n FROM gpu_telemetry_reports').get().n>=100000)throw Error('history_full');
   this.db.prepare('INSERT INTO gpu_telemetry_reports VALUES (?,?,?,?,?)').run(digest,p.lease,p.sequence,now,JSON.stringify({payload:p,signature:envelope.signature}));
   this.db.exec('COMMIT');return {digest,duplicate:false};
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 proof(digest){
  if(!/^[a-f0-9]{64}$/.test(digest))return null;
  const r=this.db.prepare('SELECT * FROM gpu_telemetry_reports WHERE digest=?').get(digest);if(!r)return null;
  const e=JSON.parse(this.db.prepare('SELECT enrollment FROM gpu_telemetry_leases WHERE id=?').get(r.lease).enrollment);
  return {schema:'bithash.gpu-proof.v1',digest,receivedAt:new Date(r.received_at).toISOString(),domain:telemetryDomain,enrollment:e,envelope:JSON.parse(r.envelope),evidence:'authenticated-worker-claim',hardwareVerified:false,coverageVerified:false};
 }
 snapshot(now=Date.now()){
  const rows=this.db.prepare('SELECT * FROM gpu_telemetry_leases ORDER BY rowid DESC LIMIT 100').all();
  return {schema:'bithash.remote-progress.v1',observedAt:new Date(now).toISOString(),source:'hosted-collector',history:{records:this.db.prepare('SELECT count(*) AS n FROM gpu_telemetry_reports').get().n,capacity:100000},items:rows.map(r=>{
   const e=JSON.parse(r.enrollment),v=this.db.prepare('SELECT * FROM gpu_telemetry_reports WHERE lease=? ORDER BY sequence DESC LIMIT 1').get(e.id);
   const freshness=r.revoked?'revoked':now>=e.expiresAt?'expired':!v?'never-seen':now<v.received_at?'clock-unknown':now-v.received_at>=30000?'stale':'fresh';
   return {id:e.id,kind:e.kind,providerPodId:e.providerPodId,build:e.build,expiresAt:new Date(e.expiresAt).toISOString(),freshness,lastReceivedAt:v?new Date(v.received_at).toISOString():null,reported:v?JSON.parse(v.envelope).payload:null,proof:v?'/api/gpu-proof/'+v.digest:null,evidence:'authenticated-worker-claim',hardwareVerified:false,coverageVerified:false};
  })};
 }
}

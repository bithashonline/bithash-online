import {proposeOperatorRun} from './operator-proposals.js';
import {readFileSync} from 'node:fs';
import {catalogEvidence} from './runpod-v2.js';
import {createHash,createPublicKey} from 'node:crypto';
export function approvalView(store){
 const s=store.snapshot();
 const hasChain=store.db.prepare("SELECT name FROM sqlite_master WHERE name='chain_evidence'").get();
 return {...s,proposals:s.proposals.map(p=>({...p,sourceEvidenceUrl:(()=>{const e=store.db.prepare("SELECT seq FROM spending_events WHERE proposal=? AND kind='proposed' ORDER BY seq LIMIT 1").get(p.id);return e?'/api/approval-evidence/'+e.seq:null})()})),chainEvidence:hasChain?store.db.prepare('SELECT record FROM chain_evidence ORDER BY signature').all().map(r=>JSON.parse(r.record)):[],authMode:store.owner.startsWith('google:')?'google':'legacy-wallet',ownerRawBase64:store.owner.startsWith('google:')?null:Buffer.from(createPublicKey(store.owner).export({format:'jwk'}).x,'base64url').toString('base64'),ownerPublicKey:store.owner.startsWith('google:')?null:store.owner,signingDomain:'bithash.spending-approval.v1',events:s.events.map(e=>({...e,evidenceUrl:store.db.prepare('SELECT seq FROM spending_evidence WHERE seq=?').get(e.seq)?`/api/approval-evidence/${e.seq}`:null,verification:'local-ledger-record'}))};
}
export async function handleApprovalApi(req,res,{store,auth,getSnapshot,origin='http://127.0.0.1:4173'}={}){
 const route=new URL(req.url,origin).pathname;
 if(!route.startsWith('/api/approval'))return false;
 const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));return true};
 if(req.method==='GET'&&route==='/api/approvals/provider-catalog'){
  try{return send(200,catalogEvidence(JSON.parse(readFileSync(new URL('../experiments/evidence/2026-10-12-runpod-catalog.json',import.meta.url),'utf8'))));}catch{return send(503,{error:'catalog_evidence_unavailable'});}
 }
 if(!store)return send(503,{error:'approval_store_not_configured'});
 if(req.method==='GET'&&route==='/api/approvals')return send(200,approvalView(store));
 if(req.method==='GET'&&/^\/api\/approval-evidence\/[1-9][0-9]*$/.test(route)){
  const row=store.db.prepare('SELECT record FROM spending_evidence WHERE seq=?').get(Number(route.split('/').pop()));
  return row?send(200,{sha256:createHash('sha256').update(row.record).digest('hex'),record:JSON.parse(row.record)}):send(404,{error:'evidence_missing'});
 }
 if(req.method!=='POST'||!['/api/approvals/approve','/api/approvals/propose'].includes(route))return send(405,{error:'method_not_allowed'});
 if(req.headers.origin!==origin||!req.headers['content-type']?.startsWith('application/json'))return send(403,{error:'origin_or_content_type_rejected'});
 let body='';
 try{
  for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>4096)return send(413,{error:'body_too_large'});}
  const v=JSON.parse(body);if(route==='/api/approvals/propose'){auth.authorize(req);if(!store.owner.startsWith('google:')||store.owner!=='google:'+auth.ownerSub||!getSnapshot)throw Error();return send(201,proposeOperatorRun(store,v,getSnapshot()));}let result;if(store.owner.startsWith('google:')){auth.authorize(req);if(!v||Object.keys(v).sort().join()!=='digest,id')throw Error();result=store.approveGoogle(v.id,v.digest,Math.floor(Date.now()/1000),auth.ownerSub);}else{if(!v||Object.keys(v).sort().join()!=='digest,id,signature')throw Error();result=store.approve(v.id,v.digest,v.signature,Math.floor(Date.now()/1000));}
  return send(200,result);
 }catch{
  store.tx(()=>store.event(null,Math.floor(Date.now()/1000),route==='/api/approvals/propose'?'proposal_submission_rejected':'approval_submission_rejected'));
  return send(400,{error:'approval_rejected',detail:'Signature, proposal, expiry or available budget did not pass validation.'});
 }
}

import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
const idOK=id=>typeof id==='string'&&/^[a-z0-9]{10,32}$/.test(id);
const states=['PROVISIONING','STARTING','RUNNING','EXITED','ERROR','TERMINATED'];
export async function observePod(id,key,fetcher=fetch,now=Date.now){
 if(!idOK(id))throw Error('invalid_id');
 const base={id,status:'UNKNOWN',observedAt:new Date(now()).toISOString(),gpuModel:null,gpuCount:null,hourlyUsd:null,evidence:'provider-unavailable'};
 try{
  const r=await fetcher('https://api.runpod.io/v2/pods/'+id,{method:'GET',headers:{Authorization:'Bearer '+key,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(5000)});
  if(r.status===404)return {...base,status:'DELETED',observedAt:new Date(now()).toISOString(),evidence:'provider-get-404'};
  if(!r.ok)throw Error();
  const p=await r.json();
  if(p.id!==id||!states.includes(p.status)||typeof p.gpu?.id!=='string'||p.gpu.id.length>100||!Number.isSafeInteger(p.gpu.count)||p.gpu.count<1||p.gpu.count>64||!/^\d+(\.\d{1,6})?$/.test(String(p.cost)))throw Error();
  return {...base,status:p.status,observedAt:new Date(now()).toISOString(),gpuModel:p.gpu.id,gpuCount:p.gpu.count,hourlyUsd:String(p.cost),evidence:'provider-get'};
 }catch{return base;}
}
export async function fleetSnapshot(ids,key,fetcher=fetch,now=Date.now){
 const items=[];
 for(let i=0;i<ids.length;i+=4)items.push(...await Promise.all(ids.slice(i,i+4).map(id=>observePod(id,key,fetcher,now))));
 return {schema:'bithash.fleet-status.v1',source:'runpod-read-only',scope:'registered-bithash-pods',observedAt:new Date(now()).toISOString(),items};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const key=readFileSync(join(process.env.CREDENTIALS_DIRECTORY,'runpod-key'),'utf8').trim();
 const db=new DatabaseSync('/var/lib/bithash-shutdown/state.sqlite',{readOnly:true});
 db.exec('PRAGMA busy_timeout=2000');
 let snapshot=null;
 const refresh=async()=>{try{
  // Read every registered Pod; fail unavailable rather than silently truncate inventory.
  const rows=db.prepare('SELECT pod FROM shutdown_leases ORDER BY rowid DESC LIMIT 101').all();
  if(rows.length>100)throw Error('inventory_limit');
  snapshot=await fleetSnapshot(rows.map(r=>r.pod),key);
 }catch{snapshot=null;}finally{setTimeout(refresh,20000);}};
 createServer((req,res)=>{
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','private, no-store');
  if(req.method!=='GET'){res.writeHead(405).end('{"error":"method_not_allowed"}');return;}
  if(req.url!=='/api/fleet-status'){res.writeHead(404).end('{"error":"not_found"}');return;}
  if(!snapshot||Date.now()-Date.parse(snapshot.observedAt)>45000){res.writeHead(503).end('{"error":"fleet_unavailable"}');return;}
  res.end(JSON.stringify(snapshot));
 }).listen(8790,'127.0.0.1');
 refresh();
}

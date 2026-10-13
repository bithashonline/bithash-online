import https from 'node:https';
import {readFileSync} from 'node:fs';
export function collectorConfig(file){const c=JSON.parse(readFileSync(file,'utf8'));const u=new URL(c.origin);if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('invalid_collector_origin');return {origin:u.origin,ca:readFileSync(c.caFile)};}
// Explicit private trust root; certificate AND host validation remain enabled.
export function collectorRequest(config,path,{method='GET',body}={}){
 if(!(/^\/api\/(gpu-progress|gpu-proof\/[a-f0-9]{64}|worker\/gpu-progress)$/.test(path)))throw Error('invalid_collector_path');
 return new Promise((resolve,reject)=>{
  const data=body?Buffer.from(JSON.stringify(body)):null;
  const req=https.request(config.origin+path,{method,ca:config.ca,rejectUnauthorized:true,timeout:5000,headers:data?{'Content-Type':'application/json','Content-Length':data.length}:{}},res=>{
   let bytes=0;const chunks=[];res.on('data',c=>{bytes+=c.length;if(bytes>262144){res.destroy();reject(Error('collector_response_too_large'));}else chunks.push(c);});
   res.on('error',()=>reject(Error('collector_response_failed')));res.on('end',()=>{try{if(res.statusCode!==200)throw Error('collector_http_'+res.statusCode);resolve(JSON.parse(Buffer.concat(chunks)));}catch(e){reject(e);}});
  });
  req.on('timeout',()=>req.destroy());req.on('error',()=>reject(Error('collector_unreachable')));req.end(data);
 });
}
export function remoteProgressHandler(config){return async(req,res)=>{
 if(req.url!=='/api/gpu-progress'&&!/^\/api\/gpu-proof\/[a-f0-9]{64}$/.test(req.url??''))return false;
 res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET'){res.writeHead(405);res.end('{"error":"method_not_allowed"}');return true;}
 try{const v=await collectorRequest(config,req.url);res.end(JSON.stringify(v));}catch{res.writeHead(503);res.end('{"error":"remote_collector_unavailable"}');}return true;
};}

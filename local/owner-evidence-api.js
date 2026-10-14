import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
const routes=/^\/api\/(?:fleet-status|operator|operator-proof\/[a-f0-9]{64}|gpu-detail\/[a-z0-9]{10,32}(?:\/[1-9][0-9]{0,14})?|gpu-activity\/[a-z0-9]{10,32}|gpu-activity-proof\/[a-f0-9]{64})$/;
export async function readOwnerEvidence(config,path){
 if(!routes.test(path)||!/^[a-z][a-z0-9-]{0,31}@[-.a-zA-Z0-9]{1,253}$/.test(config.sshTarget??''))throw Error('invalid_evidence_request');
 const script="const fs=require('fs');const key=fs.readFileSync('/etc/bithash-collector/dashboard-read-token','utf8').trim();(async()=>{const r=await fetch('https://telemetry.bithash.online"+path+"',{method:'GET',headers:{Authorization:'Bearer '+key},redirect:'error',signal:AbortSignal.timeout(6000)});if(![200,404].includes(r.status))throw Error();const text=await r.text();if(Buffer.byteLength(text)>1000000)throw Error();process.stdout.write(JSON.stringify({status:r.status,data:JSON.parse(text)}));})().catch(()=>{process.exitCode=1});";
 const remote="node -e '"+script.replaceAll("'","'\\''")+"'";
 const {stdout}=await exec('ssh',['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=5','-o','UserKnownHostsFile='+config.knownHostsFile,'-i',config.keyFile,config.sshTarget,remote],{timeout:12000,maxBuffer:1050000,windowsHide:true});return JSON.parse(stdout);
}
export function ownerEvidenceHandler(config,{read=readOwnerEvidence}={}){const pending=new Map();return async(req,res)=>{
 if(!routes.test(req.url??''))return false;
 const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));return true};
 if(req.method!=='GET')return send(405,{error:'method_not_allowed'});
 try{let item=pending.get(req.url);if(!item||Date.now()-item.at>3000){item={at:Date.now(),value:read(config,req.url)};pending.set(req.url,item);if(pending.size>100)pending.delete(pending.keys().next().value);}const v=await item.value;if(![200,404].includes(v.status))throw Error();return send(v.status,v.data);}catch{pending.delete(req.url);return send(503,{error:'hosted_evidence_unavailable'});}
};}

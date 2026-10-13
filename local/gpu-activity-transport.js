import {execFile,spawn} from 'node:child_process';import {promisify} from 'node:util';import {podOK,activityRecord} from './gpu-activity-record.js';
const run=promisify(execFile);
const sshArgs=c=>['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=8','-o','UserKnownHostsFile='+c.knownHostsFile,'-i',c.keyFile,'root@YOUR_COLLECTOR_HOST'];
export async function readGpuActivities(config,ids){
 if(!Array.isArray(ids)||ids.length>8||!ids.length||ids.some(id=>!podOK(id))||new Set(ids).size!==ids.length)throw Error('invalid_activity_ids');
 const script="const fs=require('fs');const key=fs.readFileSync('/etc/bithash-collector/dashboard-read-token','utf8').trim();(async()=>{const out=[];for(const id of "+JSON.stringify(ids)+"){const r=await fetch('https://telemetry.bithash.online/api/gpu-detail/'+id,{headers:{Authorization:'Bearer '+key},redirect:'error',signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('activity_unavailable');out.push(await r.json());}process.stdout.write(JSON.stringify(out));})().catch(()=>{process.stderr.write('activity_unavailable');process.exitCode=1;});";
 const remote="node -e '"+script.replaceAll("'","'\\''")+"'";
 const {stdout}=await run('ssh',[...sshArgs(config),remote],{timeout:75000,maxBuffer:524288,windowsHide:true});return JSON.parse(stdout);
}
export function publishGpuActivities(records,config){
 if(!Array.isArray(records)||!records.length||records.length>8)throw Error('invalid_activity_records');const checked=records.map(r=>{const v=activityRecord(r.report);if(v.digest!==r.digest||r.schema!==v.schema)throw Error('invalid_activity_record');return v;});
 const body=JSON.stringify(checked);if(Buffer.byteLength(body)>524288)throw Error('activity_batch_too_large');
 return new Promise((resolve,reject)=>{const child=spawn('ssh',[...sshArgs(config),'node /opt/bithash-operator/gpu-activity-ingest.mjs'],{stdio:['pipe','pipe','pipe'],windowsHide:true});const timer=setTimeout(()=>{child.kill();reject(Error('activity_publish_timeout'));},20000);let out='';child.stdout.on('data',c=>{out+=c;if(out.length>2000)child.kill();});child.stderr.resume();child.stdin.on('error',()=>{});child.on('error',()=>{clearTimeout(timer);reject(Error('activity_publish_failed'));});child.on('exit',code=>{clearTimeout(timer);if(code===0&&out.trim()===checked.map(r=>r.digest).join(','))resolve();else reject(Error('activity_publish_failed'));});child.stdin.end(body);});
}

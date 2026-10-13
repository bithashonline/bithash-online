import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fleetEvidence} from './chatgpt-operator.js';
const run=promisify(execFile);
// Fixed read-only paths. The existing read credential stays on the collector host.
export async function readHostedEvidence({keyFile,knownHostsFile}){
 if(!keyFile||!knownHostsFile)throw Error('evidence_connection_not_configured');
 const script="const fs=require('fs');const key=fs.readFileSync('/etc/bithash-collector/dashboard-read-token','utf8').trim();(async()=>{const out={};for(const [name,path] of [['fleet','/api/fleet-status'],['progress','/api/gpu-progress']]){const r=await fetch('https://telemetry.bithash.online'+path,{headers:{Authorization:'Bearer '+key},redirect:'error',signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('evidence_unavailable');out[name]=await r.json();}process.stdout.write(JSON.stringify(out));})().catch(()=>{process.stderr.write('evidence_unavailable');process.exitCode=1;});";
 const remote="node -e '"+script.replaceAll("'","'\\''")+"'";
 const {stdout}=await run('ssh',['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=8','-o','UserKnownHostsFile='+knownHostsFile,'-i',keyFile,'root@YOUR_COLLECTOR_HOST',remote],{timeout:25000,maxBuffer:524288,windowsHide:true});
 const {fleet,progress}=JSON.parse(stdout);return fleetEvidence(fleet,progress);
}

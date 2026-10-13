// Node22 worker sidecar. Never receives provider, treasury or model credentials.
import {readFileSync,writeFileSync,renameSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {collectorConfig,collectorRequest} from './collector-client.js';
import {signTelemetry} from './gpu-telemetry.js';
const [file,mode]=process.argv.slice(2);
if(!file||!['once','watch'].includes(mode))throw Error('usage: gpu-reporter.js PRIVATE_CONFIG.json once|watch');
const c=JSON.parse(readFileSync(file,'utf8')),remote=collectorConfig(file),key=readFileSync(c.keyFile);
if(!/^[a-f0-9]{32}$/.test(c.lease)||!Number.isSafeInteger(c.expiresAt)||!c.sequenceFile||!['gpu','transport-test'].includes(c.kind))throw Error('invalid_reporter_config');
let quit=false;process.once('SIGTERM',()=>{quit=true;});process.once('SIGINT',()=>{quit=true;});
do{
 if(Date.now()>=c.expiresAt)break;
 let utilizationPercent=null,state='idle',candidatesPerSecond=null,candidatesChecked=null;
 try{
  if(c.kind==='gpu'){
   const lines=execFileSync('nvidia-smi',['--query-gpu=utilization.gpu','--format=csv,noheader,nounits','--id=0'],{encoding:'utf8',timeout:3000}).trim();
   if(!/^\d{1,3}$/.test(lines)||Number(lines)>100)throw Error('invalid_gpu_sample');utilizationPercent=Number(lines);
   // Search counters come only from a fresh scanner metrics file, never utilization.
   if(c.metricsFile){const m=JSON.parse(readFileSync(c.metricsFile,'utf8'));if(!Number.isSafeInteger(m.observedAt)||Date.now()-m.observedAt<0||Date.now()-m.observedAt>30000)throw Error('stale_metrics');({state,candidatesPerSecond,candidatesChecked}=m);}
  }
 }catch{state='error';candidatesPerSecond=null;candidatesChecked=null;}
 const previous=existsSync(c.sequenceFile)?Number(readFileSync(c.sequenceFile,'utf8')):0;
 if(!Number.isSafeInteger(previous)||previous<0||previous>=Number.MAX_SAFE_INTEGER)throw Error('invalid_sequence_state');
 const sequence=previous+1;writeFileSync(c.sequenceFile+'.tmp',String(sequence),{mode:0o600});renameSync(c.sequenceFile+'.tmp',c.sequenceFile);
 const envelope=signTelemetry({schema:'bithash.gpu-telemetry.v1',lease:c.lease,sequence,state,device:c.kind==='gpu'?'nvidia-gpu':'cpu-fixture',utilizationPercent,candidatesPerSecond,candidatesChecked},key);
 try{const result=await collectorRequest(remote,'/api/worker/gpu-progress',{method:'POST',body:envelope});console.log(JSON.stringify({accepted:true,digest:result.digest,sequence}));}catch{console.error('{"accepted":false,"error":"report_delivery_failed"}');if(mode==='once')process.exitCode=1;}
 if(mode==='once')break;
 await delay(10000);
}while(!quit);

import {readFileSync,writeFileSync,renameSync,lstatSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPrivateKey} from 'node:crypto';
import {runWorker,executeCase,hardwareSample} from './core.mjs';
import {sha,validateConfig,verifyBundle,claimLease} from './runtime.mjs';
import {collectorConfig,collectorRequest} from './collector-client.js';
import {signTelemetry,telemetryDomain} from './gpu-telemetry.js';
const root=dirname(fileURLToPath(import.meta.url));
function atomic(file,value){writeFileSync(file+'.tmp',JSON.stringify(value)+'\n',{mode:0o600});renameSync(file+'.tmp',file);}
async function main(){
  if(process.argv.length!==3 || process.platform!=='linux') throw Error('linux_private_config_required');
  const file=resolve(process.argv[2]),c=validateConfig(JSON.parse(readFileSync(file)));
  for(const p of [file,c.keyFile]) if(!lstatSync(p).isFile()||(lstatSync(p).mode&0o077))throw Error('private_file_permissions_required');
  verifyBundle(root,c.build);
  const remote=collectorConfig(file),key=createPrivateKey(readFileSync(c.keyFile));
  if(key.asymmetricKeyType!=='ed25519')throw Error('invalid_worker_key');
  // Immutable start marker: never restart a lease with counters or sequences reset.
  const state=claimLease(c.stateDir,c.lease);
  let sequence=0;
  const stop=new AbortController();const abort=()=>stop.abort();
  process.once('SIGTERM',abort);process.once('SIGINT',abort);
  const result=await runWorker(c,{
    signal:stop.signal,
    vectors:JSON.parse(readFileSync(join(root,'vectors.json'))).profiles,
    hardware:signal=>hardwareSample(c.gpu,signal),
    scan:(v,timeout,signal)=>executeCase(join(root,'bithash-benchmark'),v,timeout,signal),
    saveMetrics:m=>atomic(join(state,'metrics.json'),m),
    saveResults:results=>atomic(join(state,'cases.json'),results),
    report:async m=>{
      if(Date.now()>=c.expiresAt)throw Error('expired');
      atomic(join(state,'sequence.json'),++sequence);
      const envelope=signTelemetry({schema:'bithash.gpu-telemetry.v1',lease:c.lease,sequence,
        state:m.state,device:'nvidia-gpu',utilizationPercent:m.utilizationPercent,
        candidatesPerSecond:m.candidatesPerSecond,candidatesChecked:m.candidatesChecked},key);
      const receipt=await collectorRequest(remote,'/api/worker/gpu-progress',{method:'POST',body:envelope});
      const digest=sha(telemetryDomain+JSON.stringify(envelope.payload));
      if(receipt.digest!==digest)throw Error('receipt_mismatch');
      atomic(join(state,'latest-receipt.json'),{digest,sequence});
      console.log(JSON.stringify({event:'report_accepted',digest,sequence}));
    }
  });
  atomic(join(state,'result.json'),{...result,build:c.build});
  console.log(JSON.stringify({event:'run_complete',status:result.status,completedCases:result.completedCases,puzzle71Candidates:'0'}));
  if(result.status!=='passed')process.exitCode=1;
}
main().catch(()=>{console.error('{"error":"worker_failed_closed"}');process.exitCode=1;});

import {readFileSync,writeFileSync,renameSync,lstatSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';import {fileURLToPath} from 'node:url';
import {createHash,createPrivateKey} from 'node:crypto';
import {hardwareSample} from '../worker/core.mjs';
import {collectorConfig,collectorRequest} from '../../local/collector-client.js';
import {signTelemetry,telemetryDomain} from '../../local/gpu-telemetry.js';
import {rangeClient} from '../../local/own-range-client.js';
import {runOwnRangeWorker} from '../../local/own-range-runtime.js';
const sha=x=>createHash('sha256').update(x).digest('hex');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const atomic=(file,value)=>{writeFileSync(file+'.tmp',JSON.stringify(value),{mode:0o600});renameSync(file+'.tmp',file);};
async function main(){
 if(process.platform!=='linux'||process.argv.length!==3)throw Error('invalid_platform');
 const filename=resolve(process.argv[2]),c=JSON.parse(readFileSync(filename)),q=c.range;
 for(const f of [filename,c.keyFile])if(!lstatSync(f).isFile()||(lstatSync(f).mode&0o077))throw Error('private_permissions');
 const manifestBytes=readFileSync(join(root,'manifest.json')),manifest=JSON.parse(manifestBytes);
 if(c.build!=='sha256:'+sha(manifestBytes)||manifest.workload!=='fixed-public-puzzle-range'||manifest.files['native/bithash-range']!==q.solverSha256)throw Error('manifest_pin');
 for(const [name,hash]of Object.entries(manifest.files)){
  if(name.startsWith('/')||name.split('/').includes('..')||!lstatSync(join(root,name)).isFile()||sha(readFileSync(join(root,name)))!==hash)throw Error('package_pin');
 }
 const key=readFileSync(c.keyFile),remote=collectorConfig(filename),transport=rangeClient(q),stop=new AbortController();
 process.once('SIGTERM',()=>stop.abort());process.once('SIGINT',()=>stop.abort());
 let sequence=0,checked=0n,rate=null,state='idle',busy=null,hardwareChecked=false;
 const report=async()=>{if(Date.now()>=q.expiresAt)throw Error('expired');const utilizationPercent=await hardwareSample(c.gpu,stop.signal);hardwareChecked=true;
  const envelope=signTelemetry({schema:'bithash.gpu-telemetry.v1',lease:c.lease,sequence:++sequence,state,device:'nvidia-gpu',utilizationPercent,
   candidatesPerSecond:rate,candidatesChecked:String(checked)},createPrivateKey(key));
  const ack=await collectorRequest(remote,'/api/worker/gpu-progress',{method:'POST',body:envelope});
  if(ack.digest!==sha(telemetryDomain+JSON.stringify(envelope.payload)))throw Error('telemetry_receipt');
 };
 const tick=()=>busy??(busy=report().finally(()=>{busy=null;}));
 await tick();state='computing';
 const timer=setInterval(()=>{void tick().catch(()=>stop.abort());},10000);
 try{
  const client=async(path,input)=>{const ack=await transport(path,input);
   if(path.endsWith('/receipt')&&!ack.duplicate&&input.envelope.payload.result.status==='completed'){
    const v=input.envelope.payload.result;checked+=BigInt(v.attempted);rate=String(Math.floor(Number(v.attempted)*1e9/Number(v.elapsedNanoseconds)));
   }return ack;};
  const result=await runOwnRangeWorker(q,{client,directory:q.stateDirectory,privateKey:key,signal:stop.signal});
  if(!['completed','private-review'].includes(result.status))throw Error('incomplete_worker');
  clearInterval(timer);if(busy)await busy;state='idle';await tick();
  const qualification=JSON.parse(readFileSync(join(q.stateDirectory,'qualification.json')));
  atomic(join(q.stateDirectory,'result.json'),{schema:'bithash.owned-range-result.v1',status:result.status,jobId:q.jobId,solverSha256:q.solverSha256,
   qualification,hardwareChecked,uniqueCoverageVerified:false});
  console.log(JSON.stringify({status:result.status,acceptedChunks:result.acceptedChunks}));
 }finally{clearInterval(timer);key.fill(0);}
}
main().catch(()=>{console.error('Range GPU worker failed closed');process.exitCode=1;});

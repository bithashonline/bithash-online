import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {addressFor} from './solver.js';
import {rangeRequest,nativeResult,rangeFail,digest,target,sealCandidate,PROBE_KEY,LOWER} from './own-range-protocol.js';
export async function cpuRangeProbe(request,{signal}={}){
 request=rangeRequest(request);
 if(request.targetId!=='range-probe-71'||BigInt(request.end)-BigInt(request.start)>64n)throw rangeFail('cpu_probe_only');
 const began=process.hrtime.bigint();let matched=false;
 for(let key=BigInt(request.start);key<BigInt(request.end);key++){
  if(signal?.aborted)throw rangeFail('interrupted');if(addressFor(key)===target(request.targetId).address)matched=true;
 }
 return {result:nativeResult(request,{schema:'bithash.native-range.v1',targetId:request.targetId,start:request.start,end:request.end,
  attempted:String(BigInt(request.end)-BigInt(request.start)),status:'completed',matched,elapsedNanoseconds:String(process.hrtime.bigint()-began)}),sealedCandidate:null};
}
export function cudaOwnRange(request,{binaryPath,recoveryPublicKey,signal,now=Date.now()}={}){
 request=rangeRequest(request);
 if(signal?.aborted)return Promise.reject(rangeFail('interrupted'));
 if(process.platform!=='linux'||typeof binaryPath!=='string'||!isAbsolute(binaryPath))return Promise.reject(rangeFail('cuda_unavailable'));
 try{if(digest(readFileSync(binaryPath))!==request.solverSha256)throw Error();}catch{return Promise.reject(rangeFail('binary_pin_rejected'));}
 const timeout=Math.min(60000,request.expiresAt-now);if(timeout<=0)return Promise.reject(rangeFail('lease_expired'));
 return new Promise((resolve,reject)=>{
  const child=spawn(binaryPath,['scan',request.targetId,request.start,request.end],{shell:false,windowsHide:true,env:{},stdio:['ignore','pipe','pipe','pipe']});
  let output='',secret=Buffer.alloc(0),error=null,settled=false;
  const fail=code=>{error??=code;child.kill('SIGKILL');};
  const abort=()=>fail('interrupted');signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>fail('solver_timeout'),timeout);
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);secret.fill(0);error?reject(rangeFail(error)):resolve(value);};
  child.stdout.on('data',b=>{output+=b.toString();if(Buffer.byteLength(output)>4096)fail('invalid_result');});
  child.stderr.on('data',()=>fail('solver_failed'));
  child.stdio[3].on('data',b=>{if(secret.length+b.length>80){b.fill(0);fail('invalid_candidate');}else{const old=secret;secret=Buffer.concat([old,b]);old.fill(0);b.fill(0);}});
  child.on('error',()=>finish('solver_failed'));
  child.on('close',code=>{
   if(error||code!==0)return finish(error??'solver_failed');
   try{const result=nativeResult(request,JSON.parse(output));
    if(result.status==='completed'&&secret.length)throw rangeFail('unexpected_secret');
    const sealedCandidate=result.status==='candidate'?sealCandidate(secret.toString(),request,recoveryPublicKey):null;
    finish(null,{result,sealedCandidate});
   }catch(e){finish(e.code??'invalid_result');}
  });
 });
}
export async function qualifyRangeGpu(config,{signal}={}){
 const spans=[[PROBE_KEY,PROBE_KEY+1n],[PROBE_KEY-1n,PROBE_KEY],[LOWER,PROBE_KEY+1n]];
 const results=[];
 for(const [start,end] of spans){const request=rangeRequest({schema:'bithash.own-range-request.v1',jobId:'range-'+'0'.repeat(24),epoch:1,
  targetId:'range-probe-71',start:String(start),end:String(end),solverSha256:config.solverSha256,providerPodId:config.providerPodId,
  expiresAt:config.expiresAt,recoveryKeyId:null});results.push((await cudaOwnRange(request,{binaryPath:config.binaryPath,signal})).result);}
 return {schema:'bithash.range-gpu-qualification.v1',solverSha256:config.solverSha256,results,evidence:'known-answer-probes; not exhaustive-search attestation'};
}

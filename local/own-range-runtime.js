import {mkdir,readFile,writeFile,rename,unlink,open} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {rangeRequest,signRangeReceipt,rangeFail} from './own-range-protocol.js';
import {cpuRangeProbe,cudaOwnRange,qualifyRangeGpu} from './own-range-backend.js';
async function acquireLock(directory){
 const path=join(directory,'worker.lock'),guard=join(directory,'reclaim.lock');
 let handle;
 try{handle=await open(path,'wx',0o600);}catch(e){
  if(e.code!=='EEXIST')throw rangeFail('worker_lock_failed');
  let reclaimer;try{reclaimer=await open(guard,'wx',0o600);}catch{throw rangeFail('worker_already_running');}
  try{
   const old=JSON.parse(await readFile(path,'utf8'));if(!Number.isSafeInteger(old.pid)||old.pid<1)throw rangeFail('invalid_worker_lock');
   try{process.kill(old.pid,0);throw rangeFail('worker_already_running');}catch(e){if(e.code!=='ESRCH')throw e;}
   await unlink(path);try{handle=await open(path,'wx',0o600);}catch{throw rangeFail('worker_already_running');}
  }finally{await reclaimer.close();await unlink(guard);}
 }
 const token=randomBytes(16).toString('hex');await handle.writeFile(JSON.stringify({pid:process.pid,token}));
 return async()=>{await handle.close();const current=JSON.parse(await readFile(path,'utf8'));if(current.token===token)await unlink(path);};
}
export async function runOwnRangeWorker(config,{client,directory,privateKey,signal,maxChunks=1000,execute,afterScan}={}){
 if(!directory||!privateKey||!Number.isSafeInteger(maxChunks)||maxChunks<1||maxChunks>1000||
  !['bitcrack-cuda-exact-range','node-openssl-range-probe'].includes(config.backend))throw rangeFail('invalid_worker_config');
 await mkdir(directory,{recursive:true,mode:0o700});const release=await acquireLock(directory);
 const file=join(directory,'pending-receipt.json');let accepted=0;
 const save=async value=>{
  const temporary=await open(file+'.tmp','w',0o600);
  try{await temporary.writeFile(JSON.stringify(value));await temporary.sync();}finally{await temporary.close();}
  await rename(file+'.tmp',file);
  if(process.platform==='linux'){const parent=await open(directory,'r');try{await parent.sync();}finally{await parent.close();}}
 };
 try{
  // Deliver a committed local intent before qualifying/scanning anything again.
  let pending;try{pending=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw rangeFail('invalid_pending_receipt');}
  if(pending){const ack=await client('/worker/range/receipt',pending);await unlink(file);accepted++;
   if(ack.completed||ack.privateReview)return {status:ack.privateReview?'private-review':'completed',acceptedChunks:accepted};}
  if(config.backend==='bitcrack-cuda-exact-range'&&!execute){const q=await qualifyRangeGpu(config,{signal});await writeFile(join(directory,'qualification.json'),JSON.stringify(q),{mode:0o600});}
  for(let n=0;n<maxChunks;n++){
   if(signal?.aborted)throw rangeFail('interrupted');if(Date.now()>=config.expiresAt)throw rangeFail('lease_expired');
   const task=await client('/worker/range/task',{jobId:config.jobId,epoch:config.epoch,chunkSize:config.chunkSize});
   if(task.request===null)return {status:'completed',acceptedChunks:accepted};
   const request=rangeRequest(task.request);
   if(request.jobId!==config.jobId||request.epoch!==config.epoch||request.providerPodId!==config.providerPodId||
    request.solverSha256!==config.solverSha256||request.expiresAt!==config.expiresAt||
    ((config.backend==='node-openssl-range-probe'||config.validationOnly)&&request.targetId!=='range-probe-71'))throw rangeFail('assignment_mismatch');
   const scan=execute??(config.backend==='bitcrack-cuda-exact-range'?cudaOwnRange:cpuRangeProbe);
   const native=await scan(request,{binaryPath:config.binaryPath,recoveryPublicKey:config.recoveryPublicKey,signal});
   if(signal?.aborted||Date.now()>=config.expiresAt)throw rangeFail('interrupted');
   const envelope=signRangeReceipt({schema:'bithash.own-range-receipt.v1',request,backend:config.backend,result:native.result,sealedCandidate:native.sealedCandidate},privateKey);
   await save({jobId:config.jobId,epoch:config.epoch,envelope});
   await afterScan?.(envelope); // Test-only crash injection, absent from CLI config.
   const result=await client('/worker/range/receipt',{jobId:config.jobId,epoch:config.epoch,envelope});await unlink(file);accepted++;
   if(result.privateReview)return {status:'private-review',acceptedChunks:accepted};
   if(result.completed)return {status:'completed',acceptedChunks:accepted};
  }
  return {status:'paused-at-chunk-limit',acceptedChunks:accepted};
 }finally{await release();}
}

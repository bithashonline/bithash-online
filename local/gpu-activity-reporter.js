import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';import {join} from 'node:path';import {activityEvidence,activityRecord} from './gpu-activity-record.js';
export function activityWork(evidences,state,now=Date.now(),watchUntil=0){
 const interval=Number.isSafeInteger(watchUntil)&&watchUntil>now&&watchUntil-now<=1800000?60000:900000;
 const attempts=(state.attempts??[]).filter(at=>Number.isSafeInteger(at)&&now-at<86400000);
 const waiting=state.retry?.nextAt?now<state.retry.nextAt:now-(state.lastAttemptAt??0)<interval;
 if(attempts.length>=96||waiting)return {ready:[],attempts,reason:attempts.length>=96?'daily_limit':state.retry?.nextAt?'retry_wait':'cooldown'};
 return {ready:evidences.filter(e=>state.records?.[e.podId]?.report.evidence.fingerprint!==e.fingerprint).sort((a,b)=>(Date.parse(state.records?.[a.podId]?.report.generatedAt)||0)-(Date.parse(state.records?.[b.podId]?.report.generatedAt)||0)).slice(0,8),attempts,reason:'ready'};
}
export function reportFailure(e){
 const message=e?.message??'',code=/^(activity_model_http_\d{3}|model_stream_[a-z_]{1,80}|model_incomplete|invalid_activity_output|invalid_activity_result|chatgpt_plan_not_connected|signin_required)$/.test(message)?message:['TimeoutError','AbortError'].includes(e?.name)?'model_timeout':message==='fetch failed'?'model_network_unavailable':'activity_request_failed';
 const transient=/^activity_model_http_(408|429|5\d\d)$|^model_stream_(server_error|rate_limit_exceeded|temporarily_unavailable)$|^model_(incomplete|timeout|network_unavailable)$/.test(code);
 return {code,transient};
}
export async function openGpuReporter(directory,{enabled,model,read,write,publish,access,isBusy,setBusy,clock=Date.now,watchUntil=0}={}){
 const file=join(directory,'gpu-activity-state.json');let state={records:{},attempts:[],lastAttemptAt:0},timer,stopped=false,working=false,status='starting',phase='idle',publishUnavailable=false,publishCursor=0;
 try{state=JSON.parse(await readFile(file,'utf8'));if(!state||typeof state.records!=='object'||!Array.isArray(state.attempts)||!Number.isSafeInteger(state.lastAttemptAt))throw Error();for(const r of Object.values(state.records))if(activityRecord(r.report).digest!==r.digest)throw Error();}catch(e){if(e.code!=='ENOENT')throw Error('invalid_gpu_activity_state');}
 if(state.retry&&(!Number.isSafeInteger(state.retry.nextAt)||!Number.isInteger(state.retry.count)||state.retry.count<0||state.retry.count>3||typeof state.retry.code!=='string'))throw Error('invalid_gpu_activity_state');
 const save=async()=>{await writeFile(file+'.tmp',JSON.stringify(state),{mode:0o600});await rename(file+'.tmp',file);};
 const sync=async records=>{try{await publish(records);publishUnavailable=false;}catch{publishUnavailable=true;console.log('operator_status: gpu_activity_publish_unavailable');}};
 async function tick(){if(stopped||!enabled||working||isBusy())return;working=true;setBusy(true);
  try{
   // Publish saved records even when inference is in cooldown or offline. No token leaves the laptop.
   phase='publishing';const cached=Object.values(state.records);if(cached.length){const batch=Array.from({length:Math.min(8,cached.length)},(_,i)=>cached[(publishCursor+i)%cached.length]);publishCursor=(publishCursor+batch.length)%cached.length;await sync(batch);}
   phase='reading';const details=await read();phase='preparing';const evidences=details.map(d=>activityEvidence(d,clock()));
   const work=activityWork(evidences,state,clock(),watchUntil);state.attempts=work.attempts;
   if(!work.ready.length){status=work.reason==='ready'?'up-to-date':work.reason;return;}
   phase='checkpointing';state.lastAttemptAt=clock();state.attempts.push(clock());await save(); // Persist before requesting so restart cannot reset quota.
   phase='requesting';status='writing';const records=await write(work.ready,{accessToken:await access(),model});phase='validating';
   await mkdir(join(directory,'gpu-activity-records'),{recursive:true,mode:0o700});
   for(const r of records){const checked=activityRecord(r.report);if(checked.digest!==r.digest)throw Error('invalid_activity_result');const archive=join(directory,'gpu-activity-records',r.digest+'.json');try{await writeFile(archive,JSON.stringify(r),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}state.records[r.report.podId]=r;}
   state.retry=null;await save();await sync(records);status='up-to-date';
  }catch(e){status='unavailable';if(phase==='requesting'){
    const failure=reportFailure(e),count=state.retry?.count??0;
    const retry=failure.transient&&count<3;
    state.retry={count:retry?count+1:0,nextAt:clock()+(retry?60000*2**count:900000),code:failure.code};
    status=retry?'retry_wait':'unavailable';try{await save();}catch{status='checkpoint_unavailable';}
    console.log('operator_status: gpu_activity_'+failure.code);
   }else console.log('operator_status: gpu_activity_unavailable_'+phase+(['EACCES','EPERM','ENOENT'].includes(e.code)?'_'+e.code:''));}
  finally{working=false;setBusy(false);}
 }
 const loop=async()=>{await tick();if(!stopped)timer=setTimeout(loop,60000);};
 return {start(){if(enabled)loop();},stop(){stopped=true;clearTimeout(timer);},tick,status(){return {enabled:Boolean(enabled),status,model,publishUnavailable,retry:state.retry??null,intervalMinutes:watchUntil>clock()&&watchUntil-clock()<=1800000?1:15,watchUntil:Number.isSafeInteger(watchUntil)?watchUntil:0,maxDailyRequests:96,requestsLast24Hours:state.attempts.filter(at=>clock()-at<86400000).length,records:Object.values(state.records).map(r=>({podId:r.report.podId,generatedAt:r.report.generatedAt,digest:r.digest}))};}};
}

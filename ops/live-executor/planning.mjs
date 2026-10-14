import {hash} from './executor.mjs';
import {bounds} from '../../local/own-range-protocol.js';
export const GPU_PREFERENCE=Object.freeze(['rtx-a5000','rtx-4090','rtx-5090']);
export function liveOptions(quote,limits,now=Date.now(),rangeMission=null){
 if(rangeMission){if(!['chunkSize,end,jobId,recoveryKeyId,solverSha256,start,targetId','chunkSize,end,jobId,recoveryKeyId,resumeFrom,solverSha256,start,targetId'].includes(Object.keys(rangeMission).sort().join())||rangeMission.targetId!=='puzzle-71'||!/^range-[a-f0-9]{24}$/.test(rangeMission.jobId)||! /^[a-f0-9]{64}$/.test(rangeMission.solverSha256)||! /^[a-f0-9]{64}$/.test(rangeMission.recoveryKeyId))throw Error('invalid_range_terms');bounds('puzzle-71',rangeMission.start,rangeMission.end);
  if(Object.hasOwn(rangeMission,'resumeFrom')&&(typeof rangeMission.resumeFrom!=='string'||! /^(0|[1-9][0-9]*)$/.test(rangeMission.resumeFrom)||BigInt(rangeMission.resumeFrom)<BigInt(rangeMission.start)||BigInt(rangeMission.resumeFrom)>=BigInt(rangeMission.end)))throw Error('invalid_range_terms');}
 if(!limits||Object.keys(limits).sort().join()!=='capMicrousd,maxDurationSeconds'||!Number.isInteger(limits.maxDurationSeconds)||limits.maxDurationSeconds<300||limits.maxDurationSeconds>900||typeof limits.capMicrousd!=='string'||!/^\d{1,7}$/.test(limits.capMicrousd)||BigInt(limits.capMicrousd)<10000n||BigInt(limits.capMicrousd)>1000000n)throw Error('invalid_live_limits');
 const r=quote?.record,age=now-Date.parse(r?.observedAt);
 if(!r||quote.sha256!==hash(r)||!Number.isFinite(age)||age< -5000||age>60000||r.filters?.count!==1||r.filters?.cloud!=='SECURE'||r.filters?.minCudaVersion!=='12.8'||!Array.isArray(r.rows))throw Error('invalid_live_quote');
 // Only unavailable hardware triggers fallback. An unaffordable preferred GPU
 // holds instead of silently changing the user's budget or selected hardware.
 const rows=GPU_PREFERENCE.map(gpu=>r.rows.filter(x=>x.gpu===gpu));
 if(rows.some(xs=>xs.length>1||xs.some(x=>!['NONE','LOW','MEDIUM','HIGH'].includes(x.availability)||!/^\d{1,12}$/.test(x.hourlyPerGpuMicrousd))))throw Error('invalid_live_quote');
 const row=rows.flat().find(x=>x.availability!=='NONE');
 if(!row)return [];
 const ceiling=(BigInt(row.hourlyPerGpuMicrousd)*105n+99n)/100n+10000n;
 return [...new Set([300,limits.maxDurationSeconds])].flatMap(durationSeconds=>{
  const estimated=(ceiling*BigInt(durationSeconds)+3599n)/3600n;
  if(estimated>BigInt(limits.capMicrousd))return [];
  const input={gpu:row.gpu,durationSeconds,capMicrousd:limits.capMicrousd,...(rangeMission?{jobId:rangeMission.jobId}:{})};
  return [{id:'option-'+hash(input).slice(0,16),input,estimatedMaximumMicrousd:String(estimated),workload:rangeMission?'fixed-public-puzzle-range':'fixed-synthetic-known-answer',count:1,puzzle71Candidates:rangeMission?String(BigInt(rangeMission.end)-BigInt(rangeMission.resumeFrom??rangeMission.start)):'0'}];
 });
}
export function validateLiveChoice(choice){
 if(!choice||Object.keys(choice).sort().join()!=='generatedAt,model,optionId,reason,responseId,schema'||choice.schema!=='bithash.live-choice.v1'||!/^gpt-[a-zA-Z0-9._-]{1,60}$/.test(choice.model??'')||!/^resp_[a-zA-Z0-9_-]{1,180}$/.test(choice.responseId??'')||!Number.isFinite(Date.parse(choice.generatedAt))||typeof choice.reason!=='string'||choice.reason.length>500||!/^hold$|^option-[a-f0-9]{16}$/.test(choice.optionId??''))throw Error('invalid_live_choice');
 return choice;
}

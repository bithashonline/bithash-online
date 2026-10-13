import {hash} from './executor.mjs';
export function liveOptions(quote,limits,now=Date.now()){
 if(!limits||Object.keys(limits).sort().join()!=='capMicrousd,maxDurationSeconds'||!Number.isInteger(limits.maxDurationSeconds)||limits.maxDurationSeconds<300||limits.maxDurationSeconds>900||typeof limits.capMicrousd!=='string'||!/^\d{1,7}$/.test(limits.capMicrousd)||BigInt(limits.capMicrousd)<10000n||BigInt(limits.capMicrousd)>1000000n)throw Error('invalid_live_limits');
 const r=quote?.record,age=now-Date.parse(r?.observedAt);
 if(!r||quote.sha256!==hash(r)||!Number.isFinite(age)||age< -5000||age>60000||r.filters?.count!==1||r.filters?.cloud!=='SECURE'||r.filters?.minCudaVersion!=='12.8'||!Array.isArray(r.rows))throw Error('invalid_live_quote');
 const row=r.rows.find(x=>x.gpu==='rtx-a5000');
 if(!row||!['NONE','LOW','MEDIUM','HIGH'].includes(row.availability)||!/^\d{1,12}$/.test(row.hourlyPerGpuMicrousd))throw Error('invalid_live_quote');
 if(row.availability==='NONE')return [];
 const ceiling=(BigInt(row.hourlyPerGpuMicrousd)*105n+99n)/100n+10000n;
 return [...new Set([300,limits.maxDurationSeconds])].flatMap(durationSeconds=>{
  const estimated=(ceiling*BigInt(durationSeconds)+3599n)/3600n;
  if(estimated>BigInt(limits.capMicrousd))return [];
  const input={gpu:'rtx-a5000',durationSeconds,capMicrousd:limits.capMicrousd};
  return [{id:'option-'+hash(input).slice(0,16),input,estimatedMaximumMicrousd:String(estimated),workload:'fixed-synthetic-known-answer',count:1,puzzle71Candidates:'0'}];
 });
}
export function validateLiveChoice(choice){
 if(!choice||Object.keys(choice).sort().join()!=='generatedAt,model,optionId,reason,responseId,schema'||choice.schema!=='bithash.live-choice.v1'||!/^gpt-[a-zA-Z0-9._-]{1,60}$/.test(choice.model??'')||!/^resp_[a-zA-Z0-9_-]{1,180}$/.test(choice.responseId??'')||!Number.isFinite(Date.parse(choice.generatedAt))||typeof choice.reason!=='string'||choice.reason.length>500||!/^hold$|^option-[a-f0-9]{16}$/.test(choice.optionId??''))throw Error('invalid_live_choice');
 return choice;
}

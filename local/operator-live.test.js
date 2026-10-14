import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {hash} from '../ops/live-executor/executor.mjs';import {liveOptions} from '../ops/live-executor/planning.mjs';import {chooseLive,draftLive} from './operator-live.js';
const limits={maxDurationSeconds:600,capMicrousd:'300000'};
test('automatic own-range draft reconciles a lost response using the saved allocated job without another quote or inference',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'auto-range-planner-')),t=ticket();
 t.rangeMission={jobId:'range-'+'2'.repeat(24),targetId:'puzzle-71',start:String(1n<<70n),end:String((1n<<70n)+8n),resumeFrom:String((1n<<70n)+4n),solverSha256:'a'.repeat(64),recoveryKeyId:'b'.repeat(64),chunkSize:'4'};
 t.options=liveOptions(t.quote,t.limits,Date.now(),t.rangeMission);assert.equal(t.options[0].puzzle71Candidates,'4');
 let quotes=0,models=0,submits=0;const call=async(action,input)=>{if(action==='quote-range-ai'){quotes++;assert.deepEqual(input,{limits});return t;}assert.equal(action,'propose-ai');if(++submits===1)throw Error('executor_outcome_unknown');return {state:'proposed',terms:{rangeMission:t.rangeMission}};};
 const choose=async()=>{models++;return {schema:'bithash.live-choice.v1',optionId:t.options[0].id,model:'gpt-6.1-sol',responseId:'resp_auto_fixture',generatedAt:new Date().toISOString(),reason:'Resume exact remaining assignment.'};};
 try{await assert.rejects(()=>draftLive(dir,limits,{call,choose,ownRange:true}),/executor_outcome_unknown/);const d=await draftLive(dir,limits,{call,choose,ownRange:true});assert.equal(d.result.terms.rangeMission.jobId,t.rangeMission.jobId);assert.equal(quotes,1);assert.equal(models,1);assert.equal(submits,2);}finally{await rm(dir,{recursive:true,force:true});}
});
test('range model choices retain the fixed mission and use separate resumable drafting state',async()=>{
 const t=ticket();t.observedAt=t.quote.record.observedAt;t.rangeMission={jobId:'range-'+'1'.repeat(24),targetId:'puzzle-71',start:String(1n<<70n),end:String((1n<<70n)+8n),solverSha256:'a'.repeat(64),recoveryKeyId:'b'.repeat(64),chunkSize:'4'};t.options=liveOptions(t.quote,t.limits,Date.now(),t.rangeMission);
 let submitted;const fetcher=async(url,o)=>{assert(JSON.parse(o.body).instructions.includes('exact owned Puzzle #71 assignment'));return new Response('data: '+JSON.stringify({type:'response.completed',response:{id:'resp_range_fixture',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({optionId:t.options[0].id,reason:'Qualify then search the supplied range.'})}]}]}})+'\n\n',{headers:{'content-type':'text/event-stream'}});};
 const dir=await mkdtemp(join(tmpdir(),'range-planner-'));
 try{const d=await draftLive(dir,t.limits,{rangeJobId:t.rangeMission.jobId,accessToken:'fixture',model:'gpt-6.1-sol',choose:(q,x)=>chooseLive(q,{...x,fetcher}),call:async(action,input)=>{if(action==='quote-range-ai'){assert.equal(input.jobId,t.rangeMission.jobId);return t;}assert.equal(action,'propose-ai');submitted=input;return {state:'proposed'};}});assert.equal(d.state,'submitted');assert.equal(submitted.choice.optionId,t.options[0].id);assert.equal(t.options[0].input.jobId,t.rangeMission.jobId);assert.equal(t.options[0].workload,'fixed-public-puzzle-range');}
 finally{await rm(dir,{recursive:true,force:true});}
});
function ticket(){const now=Date.now(),record={observedAt:new Date(now).toISOString(),filters:{count:1,cloud:'SECURE',minCudaVersion:'12.8'},rows:[{gpu:'rtx-a5000',availability:'LOW',hourlyPerGpuMicrousd:'270000'}]},quote={record,sha256:hash(record)};return {schema:'bithash.live-planning-ticket.v1',id:'plan-'+'a'.repeat(24),expiresAt:now+180000,limits,quote,options:liveOptions(quote,limits,now)};}
test('real planner accepts only bounded quoted options, no model-supplied commands or replacements',async()=>{
 const t=ticket();let body;const fetcher=async(url,o)=>{body=JSON.parse(o.body);assert.equal(body.tools,undefined);return new Response('data: '+JSON.stringify({type:'response.completed',response:{id:'resp_fixture',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({optionId:t.options[0].id,reason:'Use the smallest known-answer run.'})}]}]}})+'\n\n',{headers:{'content-type':'text/event-stream'}});};
 const choice=await chooseLive(t,{accessToken:'fixture',model:'gpt-6.1-sol',fetcher});assert.equal(choice.optionId,t.options[0].id);assert.equal(body.store,false);assert.ok(body.instructions.includes('Google owner approval'));
 t.options[0].input.gpu='rtx-4090';await assert.rejects(chooseLive(t,{accessToken:'fixture',model:'gpt-6.1-sol',fetcher}),/ticket/);
});
test('no availability holds before inference; quote tampering and excess limits fail',()=>{
 const t=ticket();t.quote.record.rows[0].availability='NONE';t.quote.sha256=hash(t.quote.record);assert.deepEqual(liveOptions(t.quote,limits),[]);
 assert.throws(()=>liveOptions(t.quote,{...limits,maxDurationSeconds:901}));t.quote.sha256='b'.repeat(64);assert.throws(()=>liveOptions(t.quote,limits));
});
test('lost proposal response resumes the saved choice without another quote/model request or approval',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'bithash-live-'));let calls=[],inferences=0,fail=true;const t=ticket();
 const call=async(action,input)=>{calls.push(action);assert.ok(!['approve','cancel'].includes(action));if(action==='quote-ai')return t;if(fail){fail=false;throw Error('executor_outcome_unknown');}return {state:'proposed',terms:{planner:{choice:input.choice}}};};
 const choose=async()=>{inferences++;return {schema:'bithash.live-choice.v1',optionId:t.options[0].id,model:'gpt-6.1-sol',responseId:'resp_fixture',generatedAt:new Date().toISOString(),reason:'Small run'};};
 try{await assert.rejects(draftLive(dir,limits,{call,choose}));const d=await draftLive(dir,limits,{call,choose});assert.equal(d.state,'submitted');assert.equal(inferences,1);assert.deepEqual(calls,['quote-ai','propose-ai','propose-ai']);}finally{await rm(dir,{recursive:true,force:true});}
});

 test('fallback order, availability validation and spending ceiling are deterministic',()=>{
 const t=ticket();const set=rows=>{t.quote.record.rows=rows;t.quote.sha256=hash(t.quote.record);return liveOptions(t.quote,limits);};
 const row=(gpu,availability,price='500000')=>({gpu,availability,hourlyPerGpuMicrousd:price});
 assert.equal(set([row('rtx-5090','HIGH'),row('rtx-4090','HIGH'),row('rtx-a5000','LOW')])[0].input.gpu,'rtx-a5000');
 assert.equal(set([row('rtx-a5000','NONE'),row('rtx-5090','HIGH'),row('rtx-4090','LOW')])[0].input.gpu,'rtx-4090');
 assert.equal(set([row('rtx-a5000','NONE'),row('rtx-4090','NONE'),row('rtx-5090','HIGH')])[0].input.gpu,'rtx-5090');
 assert.deepEqual(set([row('rtx-a5000','NONE'),row('rtx-4090','NONE'),row('rtx-5090','NONE')]),[]);
 assert.deepEqual(set([row('rtx-a5000','HIGH','99999999'),row('rtx-4090','HIGH')]),[]);
 assert.throws(()=>set([row('rtx-a5000','UNKNOWN'),row('rtx-4090','HIGH')]));
 assert.throws(()=>set([row('rtx-4090','HIGH'),row('rtx-4090','NONE')]));
 });

test('two-GPU operator choice survives a lost submission without new ranges or another model call',async()=>{
 const {fleetOptions}=await import('../ops/live-executor/fleet-terms.mjs'),dir=await mkdtemp(join(tmpdir(),'fleet-planner-')),t=ticket();
 const start=1n<<70n;t.fleetMissions=[0,1].map(i=>({jobId:'range-'+String(i+1).repeat(24),targetId:'puzzle-71',start:String(start+BigInt(i*8)),end:String(start+BigInt((i+1)*8)),resumeFrom:String(start+BigInt(i*8)+4n),solverSha256:'a'.repeat(64),recoveryKeyId:'b'.repeat(64),chunkSize:'4'}));t.options=fleetOptions(t.quote,t.limits,Date.now(),t.fleetMissions);
 let quotes=0,models=0,submits=0;
 const call=async(action,input)=>{if(action==='quote-fleet-ai'){quotes++;assert.deepEqual(input,{count:2,limits});return t;}assert.equal(action,'propose-ai');if(++submits===1)throw Error('executor_outcome_unknown');return {state:'proposed',terms:{count:2}};};
 const fetcher=async(url,o)=>{models++;assert(JSON.parse(o.body).instructions.includes('two separate one-GPU Pods'));return new Response('data: '+JSON.stringify({type:'response.completed',response:{id:'resp_fleet_fixture',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({optionId:t.options[0].id,reason:'Only approved two-Pod option.'})}]}]}})+'\n\n',{headers:{'content-type':'text/event-stream'}});};
 const options={call,choose:(q,x)=>chooseLive(q,{...x,fetcher}),accessToken:'fixture',model:'gpt-6.1-sol',ownRange:true,fleetCount:2};
 try{await assert.rejects(()=>draftLive(dir,limits,options),/executor_outcome_unknown/);const d=await draftLive(dir,limits,options);assert.equal(d.result.terms.count,2);assert.equal(quotes,1);assert.equal(models,1);assert.equal(submits,2);await assert.rejects(()=>draftLive(dir,limits,{...options,ownRange:false}),/invalid_fleet_terms/);}finally{await rm(dir,{recursive:true,force:true});}
});

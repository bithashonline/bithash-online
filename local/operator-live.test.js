import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {hash} from '../ops/live-executor/executor.mjs';import {liveOptions} from '../ops/live-executor/planning.mjs';import {chooseLive,draftLive} from './operator-live.js';
const limits={maxDurationSeconds:600,capMicrousd:'300000'};
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

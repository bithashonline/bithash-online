import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {activityEvidence,activityRecord,validateActivityAdvice} from './gpu-activity-record.js';import {writeGpuActivity} from './gpu-activity-model.js';import {activityWork,openGpuReporter} from './gpu-activity-reporter.js';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/gpu-detail.json',import.meta.url))),detail=()=>({...structuredClone(fixture),observedAt:new Date().toISOString(),rental:{...fixture.rental,observedAt:new Date().toISOString()}});
const sse=r=>new Response('data: '+JSON.stringify({type:'response.completed',response:r})+'\n\n',{headers:{'content-type':'text/event-stream'}});
const advice=e=>({summary:{text:'The provider reports this rental absent. Historical worker claims remain available.',sourceIds:['provider','context']},updates:[{text:'The controller recorded stop and deletion requests.',sourceIds:e.sources.filter(s=>s.kind==='controller-event').slice(0,2).map(s=>s.id)}]});
const record=e=>activityRecord({schema:'bithash.gpu-activity-report.v1',podId:e.podId,generatedAt:new Date().toISOString(),model:'gpt-6.1-sol',responseId:'resp_fixture',readOnly:true,executionEnabled:false,evidence:e,advice:advice(e)});
test('temporary watch mode expires, preserves daily cap and never exceeds one request per minute',()=>{
 const e=activityEvidence(detail()),now=Date.now(),s={records:{},attempts:[],lastAttemptAt:now-61000};
 assert.equal(activityWork([e],s,now,now+600000).ready.length,1);
 assert.equal(activityWork([e],{...s,lastAttemptAt:now-59000},now,now+600000).reason,'cooldown');
 for(const end of [now,now-1,now+1800001])assert.equal(activityWork([e],s,now,end).reason,'cooldown');
 assert.equal(activityWork([e],{...s,attempts:Array(96).fill(now)},now,now+600000).reason,'daily_limit');
});
test('real saved logs preserve claims, unknowns and counter resets without exporting extra fields',()=>{
 const d=detail();d.secret='must-not-export';d.rental.privateEnvironment='private';const e=activityEvidence(d),r=record(e);
 assert.equal(e.sources.filter(s=>s.kind==='signed-worker-claim').length,13);assert.equal(e.sources.filter(s=>s.kind==='controller-event').length,6);assert.equal(e.sources.find(s=>s.id==='context').data.freshness,'expired');assert.equal(e.sources.find(s=>s.id==='provider').data.gpuModel,null);assert(!JSON.stringify(e).includes('must-not-export'));assert(!JSON.stringify(e).includes('privateEnvironment'));
 const renewed=activityEvidence({...d,observedAt:new Date().toISOString(),rental:{...d.rental,observedAt:new Date().toISOString()}});assert.equal(e.fingerprint,renewed.fingerprint);
 assert.throws(()=>activityEvidence({...d,observedAt:'2000-01-01T00:00:00Z'}));assert.throws(()=>activityRecord({...r.report,podId:'wrong0000000'}));assert.throws(()=>activityRecord({...r.report,executionEnabled:true}));assert.throws(()=>activityRecord({...r.report,evidence:{...e,sources:[]}}));
 for(const sourceIds of [[],['controller:99999'],['provider','provider']])assert.throws(()=>validateActivityAdvice({...advice(e),summary:{text:'Unverified statement',sourceIds}},e));
 assert.throws(()=>validateActivityAdvice({...advice(e),summary:{text:'Go to https://evil.invalid',sourceIds:['provider']}},e));
});
test('one plan request writes each rental once, with restricted citation IDs and no paid fallback/tools',async()=>{
 const e=activityEvidence(detail()),other={...e,podId:'90et1ky0nsxu7n'};const d2={...detail(),podId:other.podId,rental:{...detail().rental,id:other.podId}};const e2=activityEvidence(d2);let calls=0;
 const fetcher=async(url,o)=>{calls++;const body=JSON.parse(o.body);assert(url.endsWith('/responses'));assert.equal(body.store,false);assert.equal(body.tools,undefined);assert.equal(o.redirect,'error');assert(body.instructions.includes('not zero'));assert.equal(body.text.format.schema.properties.records.items.anyOf.length,2);
  return sse({id:'resp_fixture',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({records:[{podId:e.podId,...advice(e)},{podId:e2.podId,...advice(e2)}]})}]}]});};
 const records=await writeGpuActivity([e,e2],{accessToken:'fixture',model:'gpt-6.1-sol',fetcher});assert.equal(records.length,2);assert.equal(calls,1);assert.equal(records[0].report.responseId,'resp_fixture');
 await assert.rejects(writeGpuActivity([e],{accessToken:'fixture',model:'gpt-6.1-sol',fetcher:async()=>new Response(null,{status:429})}),/429/);
});
test('unsupported cross-rental citations and duplicate/missing model outputs never publish',async()=>{
 const e=activityEvidence(detail());for(const records of [[],[{podId:e.podId,summary:{text:'made up',sourceIds:['worker:'+'f'.repeat(64)]},updates:[]}],[{podId:'other0000000',...advice(e)}]])await assert.rejects(writeGpuActivity([e],{accessToken:'fixture',model:'gpt-6.1-sol',fetcher:async()=>sse({id:'resp_fixture',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({records})}]}]})}));
});
test('changed-source batching, cooldown and rolling request limit survive restart; unchanged logs cost no inference',async()=>{
 const e=activityEvidence(detail()),now=Date.now();assert.equal(activityWork([e],{records:{},attempts:[now],lastAttemptAt:now},now).reason,'cooldown');assert.equal(activityWork([e],{records:{},attempts:Array(96).fill(now-10000),lastAttemptAt:0},now).reason,'daily_limit');assert.equal(activityWork([e],{records:{[e.podId]:record(e)},attempts:[],lastAttemptAt:0},now).ready.length,0);
 const dir=await mkdtemp(join(tmpdir(),'bithash-gpu-activity-'));let writes=0,publishes=0,busy=false;
 const opts={enabled:true,model:'gpt-6.1-sol',read:async()=>[detail()],write:async es=>{writes++;return es.map(record);},publish:async()=>{publishes++;},access:async()=>'fixture',isBusy:()=>busy,setBusy:v=>{busy=v;}};
 try{const r=await openGpuReporter(dir,opts);await r.tick();await r.tick();assert.equal(writes,1);assert.equal(r.status().records.length,1);assert.equal(busy,false);const restarted=await openGpuReporter(dir,opts);await restarted.tick();assert.equal(writes,1);assert(publishes>=3);assert.equal(restarted.status().requestsLast24Hours,1);r.stop();restarted.stop();}finally{await rm(dir,{recursive:true,force:true});}
});

test('temporary model failures retry at 1/2/4 minutes, survive restart and stop at the daily quota',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'bithash-retry-'));let now=Date.now(),calls=0;
 const opts={enabled:true,model:'gpt-6.1-sol',clock:()=>now,read:async()=>{const d=detail();d.observedAt=new Date(now).toISOString();d.rental.observedAt=d.observedAt;return [d];},write:async()=>{calls++;throw Error('activity_model_http_503');},publish:async()=>{},access:async()=>'fixture',isBusy:()=>false,setBusy:()=>{}};
 try{let r=await openGpuReporter(dir,opts);await r.tick();assert.equal(r.status().retry.nextAt,now+60000);await r.tick();assert.equal(calls,1);r.stop();now+=60000;r=await openGpuReporter(dir,opts);await r.tick();assert.equal(calls,2);assert.equal(r.status().retry.nextAt,now+120000);now+=120000;await r.tick();assert.equal(r.status().retry.nextAt,now+240000);now+=240000;await r.tick();assert.equal(r.status().retry.nextAt,now+900000);assert.equal(r.status().requestsLast24Hours,4);r.stop();}finally{await rm(dir,{recursive:true,force:true});}
});
test('authorization failures are not rapidly retried; publication outage does not block new reports',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'bithash-retry-'));let now=Date.now(),calls=0,fail=true;
 const opts={enabled:true,model:'gpt-6.1-sol',clock:()=>now,read:async()=>{const d=detail();d.observedAt=new Date(now).toISOString();d.rental.observedAt=d.observedAt;return [d];},write:async es=>{calls++;if(fail)throw Error('activity_model_http_401');return es.map(record);},publish:async()=>{throw Error('offline');},access:async()=>'fixture',isBusy:()=>false,setBusy:()=>{}};
 try{const r=await openGpuReporter(dir,opts);await r.tick();assert.equal(r.status().retry.nextAt,now+900000);now+=60000;await r.tick();assert.equal(calls,1);now+=900000;fail=false;await r.tick();assert.equal(r.status().records.length,1);assert.equal(r.status().retry,null);assert.equal(r.status().publishUnavailable,true);r.stop();}finally{await rm(dir,{recursive:true,force:true});}
});

import {test} from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {validActivity,verifyActivity,activityView} from './public/gpu-activity.mjs';import {telemetry} from './worker/telemetry.mjs';
const id='17jsao96984h9q',url='/api/gpu-proof/'+'a'.repeat(64);
function snapshot(){const report={schema:'bithash.gpu-activity-report.v1',podId:id,generatedAt:new Date().toISOString(),model:'gpt-6.1-sol',responseId:'resp_fixture',readOnly:true,executionEnabled:false,evidence:{schema:'bithash.gpu-activity-evidence.v1',podId:id,observedAt:new Date().toISOString(),sources:[{id:'provider',kind:'provider-observation',url:null,data:{status:'DELETED'}},{id:'worker:'+'a'.repeat(64),kind:'signed-worker-claim',url,data:{state:'idle'}}]},advice:{summary:{text:'Provider reports the rental deleted; the worker report is historical.',sourceIds:['provider']},updates:[{text:'Worker reported idle.',sourceIds:['worker:'+'a'.repeat(64)]}]}};return {schema:'bithash.gpu-activity-snapshot.v1',observedAt:new Date().toISOString(),syncReceivedAt:new Date().toISOString(),record:{schema:'bithash.gpu-activity-record.v1',digest:createHash('sha256').update(JSON.stringify(report)).digest('hex'),report}};}
test('AI report displays fixed proof links, escaped text, capture age and cached/new-source state',async()=>{
 const s=snapshot();assert(validActivity(s,id));await verifyActivity(s,id);assert.equal(validActivity(null,id),false);assert.equal(validActivity({schema:s.schema},id),false);
 const d={entries:[{reportUrl:url}],controllerEvents:[],rental:{status:'DELETED'}};const html=activityView(s,id,d);assert(html.includes('OPERATOR CONNECTED'));assert(html.includes(url));assert(html.includes('/api/gpu-activity-proof/'+s.record.digest));assert(html.includes('AI interpretation'));
 assert(activityView(s,id,d,false).includes('OPERATOR OFFLINE'));assert(activityView(s,id,{...d,entries:[{reportUrl:'/api/gpu-proof/'+'b'.repeat(64)}]}).includes('REVIEW PENDING'));
 const hostile=structuredClone(s);hostile.record.report.advice.summary.text='<img onerror="bad">';assert(!activityView(hostile,id,d).includes('<img onerror'));assert(!validActivity({...s,record:{...s.record,report:{...s.record.report,podId:'wrong0000000'}}},id));
 const bad=structuredClone(s);bad.record.report.evidence.sources[1].url='javascript:bad';assert(!validActivity(bad,id));const uncited=structuredClone(s);uncited.record.report.advice.summary.sourceIds=['controller:999'];assert(!validActivity(uncited,id));const modified=structuredClone(s);modified.record.report.advice.summary.text='Changed';await assert.rejects(verifyActivity(modified,id),/digest/);
});
test('AI proxy is read-only, checks rental/hash binding, retains historical records and rejects altered archives',async()=>{
 const s=snapshot(),env={BITHASH_TELEMETRY_READ_TOKEN:'a'.repeat(64)},req=(path,options={})=>new Request('https://bithash.online'+path,options),path='/api/gpu-activity/'+id;
 const fetcher=async(u,o)=>{assert.equal(u,'https://telemetry.bithash.online'+path);assert.equal(o.headers.Cookie,undefined);assert.equal(o.method,'GET');return Response.json(s);};
 assert.equal((await telemetry(req(path),env,fetcher)).status,200);assert.equal((await telemetry(req(path,{method:'POST'}),env,fetcher)).status,405);assert.equal((await telemetry(req(path+'?model=other'),env,fetcher)).status,400);
 assert.equal((await telemetry(req('/api/gpu-activity-proof/'+s.record.digest),env,async()=>Response.json(s.record))).status,200);
 const altered=structuredClone(s);altered.record.report.advice.summary.text='Changed';assert.equal((await telemetry(req(path),env,async()=>Response.json(altered))).status,503);
 const wrong=structuredClone(s);wrong.record.report.podId='other0000000';assert.equal((await telemetry(req(path),env,async()=>Response.json(wrong))).status,503);
 assert.equal((await telemetry(req(path),env,async()=>new Response(null,{status:404}))).status,404);
});
test('both actual plan-generated acceptance records retain valid digests and render their source-linked advice',async()=>{
 const records=JSON.parse(readFileSync(new URL('./fixtures/gpu-activity-records.json',import.meta.url)));assert.equal(records.length,2);
 for(const record of records){const s={schema:'bithash.gpu-activity-snapshot.v1',syncReceivedAt:new Date().toISOString(),record};await verifyActivity(s,record.report.podId);const html=activityView(s,record.report.podId,{entries:[],controllerEvents:[],rental:{status:'DELETED'}});assert(html.includes('GPU activity report'));assert(html.includes('/api/gpu-activity-proof/'+record.digest));assert(!html.includes('Awaiting an AI report'));}
});

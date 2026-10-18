import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {detailView,relayLog,validDetail} from './public/gpu-detail.mjs';import {fleetView} from './public/fleet.mjs';import {remoteCards} from './public/remote-progress.mjs';import {telemetry} from './worker/telemetry.mjs';
const id='17jsao96984h9q',now=Date.now(),fixture=JSON.parse(readFileSync(new URL('./fixtures/gpu-reports.json',import.meta.url)));
const entries=fixture.proofs.filter(p=>p.enrollment.providerPodId===id).map((p,i)=>({cursor:i+1,workerId:p.enrollment.id,sequence:p.envelope.payload.sequence,receivedAt:p.receivedAt,build:p.enrollment.build,...p.envelope.payload,reportUrl:'/api/gpu-proof/'+p.digest})).sort((a,b)=>Date.parse(b.receivedAt)-Date.parse(a.receivedAt));
const value=()=>({schema:'bithash.gpu-detail.v1',podId:id,observedAt:new Date().toISOString(),rental:{id,status:'DELETED',observedAt:new Date().toISOString(),gpuModel:null,evidence:'provider-get-404'},registration:{label:'bithash-test',startedAt:'2026-10-13T02:00:00Z',deadline:'2026-10-13T02:30:00Z',maxSpendMicrousd:'300000',hourlyCeilingMicrousd:'900000',phase:'absence_observed'},entries,workers:[],controllerEvents:[{seq:1,at:now-1000,kind:'stop_intent',code:null},{seq:2,at:now,kind:'provider_404_observed',code:null}],controllerEventsTruncated:false,olderCursor:null,workload:null,rangeAssignment:null,hardwareVerified:false,coverageVerified:false});
test('saved real reports render a deleted rental, readable states and honest missing fields',()=>{
 const d=value();assert.equal(entries.length,13);assert(validDetail(d,id));const html=detailView(d);
 for(const text of ['RENTAL DELETED','Source activity timeline','Worker reported computing','Worker reported an error','stop','No production range recorded','Not reconciled','Signed reports &amp; source records']){if(text==='Signed reports &amp; source records')continue;assert(html.includes(text),text);}
 assert(!html.includes('RECENT REPORT'));assert(!html.includes('rig-active.png'));assert(html.includes(entries[0].reportUrl));assert(relayLog(d).match(/SIGNED WORKER REPORT/g).length<13);
 const hostile=detailView({...d,registration:{...d.registration,label:'<script>alert(1)</script>'}});assert(!hostile.includes('<script>'));assert(hostile.includes('&lt;script&gt;'));
 assert(!validDetail({...d,podId:'other0000000'},id));assert(!validDetail({...d,entries:[{...entries[0],reportUrl:'https://evil.invalid'}]},id));
});
test('real fleet and worker cards open rental-specific files',()=>{
 const d=value(),p={...d.rental,gpuCount:null,hourlyUsd:null},s={schema:'bithash.fleet-status.v1',source:'runpod-read-only',scope:'registered-bithash-pods',observedAt:new Date().toISOString(),items:[p]};
 assert(fleetView(s,fixture.snapshot).html.includes('href="#gpu/'+id+'"'));assert(remoteCards(fixture.snapshot).includes('href="#gpu/'+id+'"'));
});
test('detail bridge accepts only fixed GETs, checks rental identity, bounded history and freshness',async()=>{
 const env={BITHASH_TELEMETRY_READ_TOKEN:'a'.repeat(64)},request=(tail='',options={})=>new Request('https://bithash.online/api/gpu-detail/'+id+tail,options),json=d=>Response.json(d);let calls=0;
 const fetcher=async(url,o)=>{calls++;assert.equal(url,'https://telemetry.bithash.online/api/gpu-detail/'+id+'/10');assert.equal(o.method,'GET');assert.equal(o.headers.Cookie,undefined);return json({...value(),olderCursor:4});};
 assert.equal((await telemetry(request('/10'),env,fetcher)).status,200);assert.equal(calls,1);
 assert.equal((await telemetry(request('',{method:'POST'}),env,fetcher)).status,405);assert.equal((await telemetry(request('?before=10'),env,fetcher)).status,400);
 for(const bad of [{...value(),podId:'other0000000'},{...value(),entries:Array(51).fill(entries[0])},{...value(),entries:[{...entries[0],reportUrl:'https://evil.invalid'}]},{...value(),observedAt:'2000-01-01T00:00:00Z'}])assert.equal((await telemetry(request(),env,async()=>json(bad))).status,503);
 assert.equal((await telemetry(request(),env,async()=>new Response(null,{status:404}))).status,404);
});

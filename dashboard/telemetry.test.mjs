import {test} from 'node:test';
import assert from 'node:assert/strict';
import {telemetry} from './worker/telemetry.mjs';
const env={BITHASH_TELEMETRY_READ_TOKEN:'a'.repeat(64)};
const req=(path='/api/gpu-progress',options={})=>new Request('https://bithash.online'+path,options);
const snapshot=()=>({schema:'bithash.remote-progress.v1',source:'hosted-collector',observedAt:new Date().toISOString(),history:{records:0,capacity:100000},items:[]});
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
test('proxy only makes fixed authenticated reads without forwarding browser credentials',async()=>{
 let calls=0;
 const fetcher=async(url,options)=>{calls++;assert.equal(url,'https://telemetry.bithash.online/api/gpu-progress');assert.equal(options.headers.Authorization,'Bearer '+env.BITHASH_TELEMETRY_READ_TOKEN);assert.equal(options.headers.Cookie,undefined);assert.equal(options.redirect,'manual');return json(snapshot());};
 assert.equal((await telemetry(req('/api/gpu-progress',{headers:{cookie:'private',authorization:'untrusted'}}),env,fetcher)).status,200);
 assert.equal(await telemetry(req('/api/worker/gpu-progress'),env,fetcher),null);
 assert.equal((await telemetry(req('/api/gpu-progress',{method:'POST'}),env,fetcher)).status,405);
 assert.equal((await telemetry(req('/api/gpu-progress?url=https://evil.invalid'),env,fetcher)).status,400);
 assert.equal((await telemetry(req(),{},fetcher)).status,503);assert.equal(calls,1);
});
test('stale, future, malformed, oversized and failed upstream responses fail closed',async()=>{
 for(const fetcher of [async()=>new Response(null,{status:302,headers:{location:"https://evil.invalid"}}),async()=>json({...snapshot(),observedAt:new Date(Date.now()-60000).toISOString()}),async()=>json({...snapshot(),observedAt:new Date(Date.now()+60000).toISOString()}),async()=>json({}),async()=>new Response('x'.repeat(262145),{headers:{'content-type':'application/json'}}),async()=>{throw Error('upstream detail must stay private');}]){
  const r=await telemetry(req(),env,fetcher);assert.equal(r.status,503);assert.equal((await r.json()).error,'remote_collector_unavailable');
 }
});
test('proof paths retain original evidence and reject mismatched digests',async()=>{
 const digest='b'.repeat(64),data={schema:'bithash.gpu-proof.v1',digest,hardwareVerified:false,coverageVerified:false};
 const r=await telemetry(req('/api/gpu-proof/'+digest),env,async()=>json(data));assert.deepEqual(await r.json(),data);
 assert.equal((await telemetry(req('/api/gpu-proof/'+digest),env,async()=>json({...data,digest:'c'.repeat(64)}))).status,503);
 assert.equal((await telemetry(req('/api/gpu-proof/'+digest),env,async()=>json({},404))).status,404);
});

test('fleet status uses the same fixed authenticated bridge and rejects stale snapshots or writes',async()=>{
 const value={schema:'bithash.fleet-status.v1',source:'runpod-read-only',scope:'registered-bithash-pods',observedAt:new Date().toISOString(),items:[]};
 const fetcher=async(url,o)=>{assert.equal(url,'https://telemetry.bithash.online/api/fleet-status');assert.equal(o.method,'GET');return json(value);};
 assert.equal((await telemetry(req('/api/fleet-status'),env,fetcher)).status,200);
 assert.equal((await telemetry(req('/api/fleet-status',{method:'POST'}),env,fetcher)).status,405);
 assert.equal((await telemetry(req('/api/fleet-status?pod=other'),env,fetcher)).status,400);
 assert.equal((await telemetry(req('/api/fleet-status'),env,async()=>json({...value,observedAt:'2000-01-01T00:00:00Z'}))).status,503);
});

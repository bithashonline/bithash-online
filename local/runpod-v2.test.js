import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {RunpodV2ReadApi,catalogEvidence,stageFixtureDeployment} from './runpod-v2.js';
const raw=JSON.parse(readFileSync(new URL('../experiments/evidence/2026-10-12-runpod-catalog.json',import.meta.url)));
const now=Date.parse(raw.observedAt);
const args={gpu:'rtx-4090',count:1,durationSeconds:900,image:'ghcr.io/bithashonline/fixture@sha256:'+'a'.repeat(64),operationId:'fixture-test'};
test('provider evidence excludes unknown fields and marks old observations stale',()=>{
 const source=structuredClone(raw);source.gpus[0].env={SECRET:'do-not-publish'};
 const e=catalogEvidence(source,now);assert.equal(e.stale,false);assert.equal(e.record.rows.find(g=>g.gpu==='rtx-4090').hourlyPerGpuMicrousd,'890000');
 assert.equal(JSON.stringify(e).includes('do-not-publish'),false);assert.equal(catalogEvidence(source,now+60001).stale,true);
 assert.throws(()=>catalogEvidence(source,now-6000));
});
test('staging binds rate/request but never authorizes a rental',()=>{
 const e=catalogEvidence(raw,now),s=stageFixtureDeployment(e,args,now);
 assert.equal(s.record.computeOnlyEstimateMicrousd,'222500');assert.equal(s.record.allInCapMicrousd,null);assert.equal(s.deployable,false);
 assert.equal(s.record.request.gpu.id,'NVIDIA GeForce RTX 4090');assert.deepEqual(s.record.request.ports,[]);
 assert.throws(()=>stageFixtureDeployment(e,{...args,gpu:'rtx-a5000'},now));
 assert.throws(()=>stageFixtureDeployment(e,{...args,count:2},now));
 assert.throws(()=>stageFixtureDeployment(e,{...args,image:'latest'},now));
 assert.throws(()=>stageFixtureDeployment(e,args,now+60001));
 e.record.rows[0].hourlyPerGpuMicrousd='1';assert.throws(()=>stageFixtureDeployment(e,args,now));
});
test('read API pins origin, count parameter, redirect rejection; sanitizes failures',async()=>{
 let request;
 const api=new RunpodV2ReadApi({apiKey:'private-test-key',clock:()=>now,fetchImpl:async(url,opts)=>{request={url,opts};return {ok:true,json:async()=>({gpus:raw.gpus})}}});
 await api.catalog();assert.equal(new URL(request.url).searchParams.get('count'),'1');assert.equal(request.opts.method,'GET');assert.equal(request.opts.redirect,'error');
 assert.equal(api.createPod,undefined);await assert.rejects(()=>api.catalog(11));
 const bad=new RunpodV2ReadApi({apiKey:'private-test-key',fetchImpl:async()=>{throw Error('secret private-test-key')}});
 await assert.rejects(()=>bad.catalog(),/^Error: runpod_catalog_unreachable$/);
});

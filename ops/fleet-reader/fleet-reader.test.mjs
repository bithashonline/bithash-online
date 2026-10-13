import {test} from 'node:test';import assert from 'node:assert/strict';
import {observePod,fleetSnapshot} from './fleet-reader.mjs';
const id='17jsao96984h9q',now=()=>100000;
test('read-only provider request strips credentials, IPs and unrelated fields',async()=>{
 const r=await observePod(id,'fixture',async(url,o)=>{assert.equal(url,'https://api.runpod.io/v2/pods/'+id);assert.equal(o.method,'GET');assert.equal(o.redirect,'error');return Response.json({id,status:'RUNNING',gpu:{id:'RTX 4090',count:1},cost:.89,env:{SECRET:'never-export'},ssh:{host:'private-host'}});},now);
 assert.equal(r.status,'RUNNING');assert.equal(r.gpuCount,1);assert(!JSON.stringify(r).includes('never-export'));assert(!JSON.stringify(r).includes('private-host'));
});
test('only 404 establishes deletion; errors and malformed replies remain unknown',async()=>{
 assert.equal((await observePod(id,'fixture',async()=>new Response(null,{status:404}),now)).status,'DELETED');
 for(const status of [401,403,429,500])assert.equal((await observePod(id,'fixture',async()=>new Response(null,{status}),now)).status,'UNKNOWN');
 assert.equal((await observePod(id,'fixture',async()=>Response.json({id:'wrong'}),now)).status,'UNKNOWN');
 assert.equal((await observePod(id,'fixture',async()=>{throw Error('private');},now)).status,'UNKNOWN');
});
test('registered scope retained and each Pod is independently observed',async()=>{
 const r=await fleetSnapshot([id,'90et1ky0nsxu7n'],'fixture',async()=>new Response(null,{status:404}),now);
 assert.equal(r.scope,'registered-bithash-pods');assert.equal(r.items.length,2);assert(r.items.every(p=>p.status==='DELETED'));
});

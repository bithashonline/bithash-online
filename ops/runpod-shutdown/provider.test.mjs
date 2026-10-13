import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { RunpodShutdownApi } from './provider.mjs';

const id='fixturepod001';
const payload={id,name:'bithash-shutdown-test',status:'RUNNING',cost:'0.274',mounts:{},env:{SECRET:'must-not-leak'}};
test('transport uses fixed HTTPS origin, bearer header and rejects redirects; returns allowlisted fields only',async()=>{
  const calls=[];const api=new RunpodShutdownApi({apiKey:'fixture',fetchImpl:async(url,opts)=>{calls.push({url,opts});return new Response(JSON.stringify(payload));}});
  const data=await api.get(id);await api.stop(id);await api.delete(id);
  assert.equal(data.hourlyMicrousd,'274000');assert(!JSON.stringify(data).includes('must-not-leak'));
  assert.deepEqual(calls.map(c=>[c.url,c.opts.method,c.opts.redirect]),[
    [`https://api.runpod.io/v2/pods/${id}`,'GET','error'],[`https://api.runpod.io/v2/pods/${id}/action`,'POST','error'],[`https://api.runpod.io/v2/pods/${id}`,'DELETE','error']]);
  assert(calls.every(c=>c.opts.headers.Authorization==='Bearer fixture'));
  assert.equal(calls[1].opts.headers['Content-Type'],'application/json');
  assert.equal(calls[1].opts.body,'{"action":"stop"}');
  assert.equal(calls[0].opts.body,undefined);assert.equal(calls[2].opts.body,undefined);
  await assert.rejects(()=>api.stop('../bad'),/invalid_pod_id/);
});
test('401/403/429/500 bodies and thrown fetch details never become error messages',async()=>{
  for(const status of [401,403,429,500]){
    const api=new RunpodShutdownApi({apiKey:'fixture',fetchImpl:async()=>new Response('must-not-leak',{status})});
    await assert.rejects(()=>api.stop(id),error=>error.code===`http_${status}`&&!error.message.includes('must-not-leak'));
  }
  const api=new RunpodShutdownApi({apiKey:'fixture',fetchImpl:async()=>{throw Error('must-not-leak');}});
  await assert.rejects(()=>api.get(id),/transport_or_response_error/);
});
test('GET 404 differs from forbidden; malformed responses are rejected',async()=>{
  const missing=new RunpodShutdownApi({apiKey:'fixture',fetchImpl:async()=>new Response('',{status:404})});
  assert.equal(await missing.get(id),null);await assert.rejects(()=>missing.delete(id),/http_404/);
  for(const value of [{...payload,id:'different'}, {...payload,cost:'NaN'}, {...payload,status:'UNKNOWN'}]){
    const api=new RunpodShutdownApi({apiKey:'fixture',fetchImpl:async()=>new Response(JSON.stringify(value))});
    await assert.rejects(()=>api.get(id));
  }
});
test('unknown and attached v2 mounts never become disposable',async()=>{
  const value={...payload};delete value.mounts;
  const api=new RunpodShutdownApi({apiKey:'fixture',fetchImpl:async()=>new Response(JSON.stringify(value))});
  assert.equal((await api.get(id)).networkVolumeId,undefined);
  for(const mounts of [null,[],{network:[]},{persistent:null},{future:{}},{persistent:{size:20,path:'/workspace'}},{network:[{volumeId:'fixture',path:'/workspace'}]}]) {
    value.mounts=mounts;const data=await api.get(id);
    assert(!(data.volumeInGb===0 && data.networkVolumeId===null));
  }
  value.mounts={};const data=await api.get(id);
  assert.equal(data.volumeInGb,0);assert.equal(data.networkVolumeId,null);
});
test('all v2 lifecycle states are retained, including transitional and error states',async()=>{
  for(const status of ['PROVISIONING','STARTING','RUNNING','EXITED','ERROR','TERMINATED']) {
    const api=new RunpodShutdownApi({apiKey:'fixture',fetchImpl:async()=>new Response(JSON.stringify({...payload,status}))});
    assert.equal((await api.get(id)).desiredStatus,status);
  }
});
test('real loopback HTTP exercises stop, status, delete, 404 and bounded timeout without Runpod access',async()=>{
  let remote=structuredClone(payload);const requests=[];
  const server=createServer((req,res)=>{
    requests.push(req.method+' '+req.url);assert.equal(req.headers.authorization,'Bearer fixture');
    if(req.url==='/hang')return;
    if(req.method==='GET'){res.writeHead(remote?200:404,{'Content-Type':'application/json'});res.end(JSON.stringify(remote));}
    else if(req.method==='POST'){remote.status='EXITED';res.writeHead(200);res.end();}
    else if(req.method==='DELETE'){remote=null;res.writeHead(204);res.end();}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin=`http://127.0.0.1:${server.address().port}`;
  try {
    const api=new RunpodShutdownApi({apiKey:'fixture',fetchImpl:(url,opts)=>fetch(origin+new URL(url).pathname,opts)});
    assert.equal((await api.get(id)).desiredStatus,'RUNNING');await api.stop(id);
    assert.equal((await api.get(id)).desiredStatus,'EXITED');await api.delete(id);assert.equal(await api.get(id),null);
    assert.equal(requests.length,5);
    const slow=new RunpodShutdownApi({apiKey:'fixture',timeoutMs:50,fetchImpl:(_url,opts)=>fetch(origin+'/hang',opts)});
    await assert.rejects(()=>slow.get(id),/transport_or_response_error/);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});


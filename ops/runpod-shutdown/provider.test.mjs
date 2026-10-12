import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { RunpodShutdownApi } from './provider.mjs';

const id='fixturepod001';
const payload={id,name:'bithash-shutdown-test',desiredStatus:'RUNNING',costPerHr:'0.274',volumeInGb:0,networkVolumeId:null,env:{SECRET:'must-not-leak'}};
test('transport uses fixed HTTPS origin, bearer header and rejects redirects; returns allowlisted fields only',async()=>{
  const calls=[];const api=new RunpodShutdownApi({apiKey:'fixture',fetchImpl:async(url,opts)=>{calls.push({url,opts});return new Response(JSON.stringify(payload));}});
  const data=await api.get(id);await api.stop(id);await api.delete(id);
  assert.equal(data.hourlyMicrousd,'274000');assert(!JSON.stringify(data).includes('must-not-leak'));
  assert.deepEqual(calls.map(c=>[c.url,c.opts.method,c.opts.redirect]),[
    [`https://rest.runpod.io/v1/pods/${id}`,'GET','error'],[`https://rest.runpod.io/v1/pods/${id}/stop`,'POST','error'],[`https://rest.runpod.io/v1/pods/${id}`,'DELETE','error']]);
  assert(calls.every(c=>c.opts.headers.Authorization==='Bearer fixture'));
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
  for(const value of [{...payload,id:'different'}, {...payload,costPerHr:'NaN'}, {...payload,desiredStatus:'UNKNOWN'}]){
    const api=new RunpodShutdownApi({apiKey:'fixture',fetchImpl:async()=>new Response(JSON.stringify(value))});
    await assert.rejects(()=>api.get(id));
  }
});
test('missing network-volume metadata remains unknown, never silently disposable',async()=>{
  const value={...payload};delete value.networkVolumeId;
  const api=new RunpodShutdownApi({apiKey:'fixture',fetchImpl:async()=>new Response(JSON.stringify(value))});
  assert.equal((await api.get(id)).networkVolumeId,undefined);
  value.networkVolumeId=null;value.networkVolume={id:'attached-fixture-volume'};
  assert.equal((await api.get(id)).networkVolumeId,'attached-fixture-volume');
});
test('real loopback HTTP exercises stop, status, delete, 404 and bounded timeout without Runpod access',async()=>{
  let remote=structuredClone(payload);const requests=[];
  const server=createServer((req,res)=>{
    requests.push(req.method+' '+req.url);assert.equal(req.headers.authorization,'Bearer fixture');
    if(req.url==='/hang')return;
    if(req.method==='GET'){res.writeHead(remote?200:404,{'Content-Type':'application/json'});res.end(JSON.stringify(remote));}
    else if(req.method==='POST'){remote.desiredStatus='EXITED';res.writeHead(200);res.end();}
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

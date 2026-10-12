import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ShutdownController, validateLease } from './controller.mjs';
import { ProviderError } from './provider.mjs';

const start = Date.parse('2026-10-12T12:00:00Z');
export const lease = changes => ({ schema:'bithash.shutdown-lease.v1',podId:'fixturepod001',expectedName:'bithash-shutdown-test',
  startedAt:new Date(start).toISOString(),notAfter:new Date(start+1800000).toISOString(),
  maxSpendMicrousd:'100000',hourlyCeilingMicrousd:'274000',shutdownHeadroomSeconds:60,deleteDisposablePod:true,...changes });
export const pod = changes => ({id:'fixturepod001',name:'bithash-shutdown-test',desiredStatus:'RUNNING',hourlyMicrousd:'274000',volumeInGb:0,networkVolumeId:null,...changes});
async function fixture(fn) {
  const dir=mkdtempSync(join(tmpdir(),'bithash-shutdown-')),path=join(dir,'state.sqlite');
  let clock=start, remote=pod(); const calls=[];
  const provider={get:async id=>{calls.push(['get',id]);return remote;},stop:async id=>{calls.push(['stop',id]);remote={...remote,desiredStatus:'EXITED'};},delete:async id=>{calls.push(['delete',id]);remote=null;}};
  let controller=new ShutdownController(path,provider,{clock:()=>clock});
  try {await fn({get c(){return controller;},path,dir,provider,calls,setTime:t=>clock=t,setPod:p=>remote=p,
    reopen:()=>{controller.close();controller=new ShutdownController(path,provider,{clock:()=>clock});return controller;}});}
  finally {controller.close();assert.equal(dirname(resolve(dir)),resolve(tmpdir()));rmSync(dir,{recursive:true,force:true});}
}
test('integer budget shortens absolute deadline and reserves shutdown headroom',()=>{
  const p=validateLease(lease());
  assert.equal(p.deadline,start+Number(100000n*3600000n/274000n));assert.equal(p.triggerAt,p.deadline-60000);
  assert.equal(validateLease(lease({maxSpendMicrousd:'999999'})).deadline,start+1800000);
});
test('invalid policies cannot extend runtime or silently enable destructive cleanup',()=>{
  for(const change of [{maxSpendMicrousd:'0'},{hourlyCeilingMicrousd:'0'},{maxSpendMicrousd:0.1},
    {shutdownHeadroomSeconds:0},{notAfter:new Date(start+1800001).toISOString()},
    {deleteDisposablePod:'true'},{podId:'../../pods'},{expectedName:'unrelated'},
    {maxSpendMicrousd:'1'},{apiKey:'not-allowed'}])assert.throws(()=>validateLease(lease(change)));
});
test('registration is immutable and restart cannot reset deadline',()=>fixture(async f=>{
  const first=f.c.register(lease());assert.deepEqual(f.c.register(lease()),first);
  assert.throws(()=>f.c.register(lease({maxSpendMicrousd:'200000'})),/immutable/);
  assert.equal(f.reopen().status()[0].deadline,first.deadline);
}));
test('no mutation before deadline; stop, delete and subsequent absence are separate observations',()=>fixture(async f=>{
  const entry=f.c.register(lease());await f.c.tick();assert.equal(f.calls.filter(c=>c[0]!=='get').length,0);
  f.setTime(Date.parse(entry.triggerAt));await f.c.tick();assert.equal(f.c.status()[0].phase,'stop_pending');
  assert.equal(f.c.status()[0].billingReconciled,false);
  await f.c.tick();assert.equal(f.c.status()[0].phase,'delete_pending');
  await f.c.tick();assert.equal(f.c.status()[0].phase,'absence_observed');
  assert.deepEqual(f.calls.filter(c=>c[0]!=='get').map(c=>c[0]),['stop','delete']);
  assert.equal(f.c.status()[0].permitsNewRental,false);
}));
test('200 stop response with RUNNING status does not claim success; retries stop-only policy',()=>fixture(async f=>{
  const entry=f.c.register(lease({deleteDisposablePod:false}));f.provider.stop=async id=>f.calls.push(['stop',id]);
  f.setTime(Date.parse(entry.triggerAt));await f.c.tick();await f.c.tick();
  assert.equal(f.c.status()[0].phase,'stop_pending');assert.equal(f.c.status()[0].stopAttempts,2);
}));
test('403 stop failure is recorded and does not prevent separately authorized disposal',()=>fixture(async f=>{
  const entry=f.c.register(lease());f.provider.stop=async()=>{throw new ProviderError('http_403',403);};
  f.setTime(Date.parse(entry.triggerAt));await f.c.tick();assert.equal(f.c.status()[0].lastError,'http_403');
  await f.c.tick();assert.equal(f.c.status()[0].deleteAttempts,1);await f.c.tick();
  assert.equal(f.c.status()[0].phase,'absence_observed');assert(f.c.events().some(e=>e.code==='http_403'));
}));
test('403 on both operations stays unresolved and retries, never releases billing responsibility',()=>fixture(async f=>{
  const entry=f.c.register(lease());f.provider.stop=async()=>{throw new ProviderError('http_403',403);};
  f.provider.delete=async()=>{throw new ProviderError('http_403',403);};f.setTime(Date.parse(entry.triggerAt));
  await f.c.tick();await f.c.tick();await f.c.tick();
  assert.equal(f.c.status()[0].phase,'delete_pending');assert.equal(f.c.status()[0].deleteAttempts,2);
  assert.equal(f.c.status()[0].billingReconciled,false);
}));
test('timeout after accepted delete reconciles with GET after process restart',()=>fixture(async f=>{
  const entry=f.c.register(lease());f.setTime(Date.parse(entry.triggerAt));await f.c.tick();
  f.provider.delete=async()=>{f.setPod(null);throw new ProviderError('transport_or_response_error');};
  await f.c.tick();f.reopen();await f.c.tick();assert.equal(f.c.status()[0].phase,'absence_observed');
  assert.equal(f.c.status()[0].deleteAttempts,1);
}));
test('GET timeout cannot block deadline stop of a previously verified Pod',()=>fixture(async f=>{
  const entry=f.c.register(lease());await f.c.tick();
  f.provider.get=async()=>{throw new ProviderError('transport_or_response_error');};
  f.setTime(Date.parse(entry.triggerAt));await f.c.tick();assert.equal(f.c.status()[0].stopAttempts,1);
  assert.equal(f.c.status()[0].deleteAttempts,0);
}));
test('unverified or mismatched Pod cannot receive stop/delete commands',()=>fixture(async f=>{
  f.c.register(lease());f.setTime(start+1800000);f.setPod(pod({name:'unrelated-workload'}));
  await f.c.tick();assert.equal(f.c.status()[0].lastError,'identity_mismatch');
  f.provider.get=async()=>{throw new ProviderError('http_403',403);};await f.c.tick();
  assert.equal(f.c.status()[0].lastError,'identity_unverified');assert.equal(f.calls.filter(c=>c[0]!=='get').length,0);
}));
test('changed identity after verification also blocks mutation',()=>fixture(async f=>{
  f.c.register(lease());await f.c.tick();f.setTime(start+1800000);f.setPod(pod({name:'unrelated'}));
  await f.c.tick();assert.equal(f.calls.filter(c=>c[0]!=='get').length,0);
  f.provider.get=async()=>{throw new ProviderError('transport_or_response_error');};await f.c.tick();
  assert.equal(f.c.status()[0].identityVerified,false);assert.equal(f.calls.filter(c=>c[0]!=='get').length,0);
}));
test('future-dated registration cannot postpone an already-billing allocation',()=>fixture(f=>{
  assert.throws(()=>f.c.register(lease({startedAt:new Date(start+1000).toISOString()})),/future_start_rejected/);
}));
test('persistent or unknown storage blocks deletion while preserving stop action',()=>fixture(async f=>{
  f.c.register(lease());f.setTime(start+1800000);
  for(const storage of [{volumeInGb:5},{volumeInGb:undefined},{networkVolumeId:'volume-test'}]){
    f.setPod(pod(storage));await f.c.tick();await f.c.tick();
    assert.equal(f.c.status()[0].deleteAttempts,0);assert.equal(f.c.status()[0].lastError,'storage_disposal_blocked');
  }
  assert.equal(f.c.status()[0].stopAttempts,3);
}));
test('stop-only policy never deletes and catches a later provider resume',()=>fixture(async f=>{
  f.c.register(lease({deleteDisposablePod:false}));f.setTime(start+1800000);
  await f.c.tick();await f.c.tick();assert.equal(f.c.status()[0].phase,'provider_expected_stopped');
  f.setPod(pod());await f.c.tick();assert.equal(f.c.status()[0].stopAttempts,2);assert.equal(f.c.status()[0].deleteAttempts,0);
}));
test('price above registered ceiling stops early and never expands the budget',()=>fixture(async f=>{
  f.c.register(lease());f.setPod(pod({hourlyMicrousd:'999000'}));await f.c.tick();
  assert.equal(f.c.status()[0].reason,'rate_exceeded');assert.equal(f.c.status()[0].stopAttempts,1);
}));
test('clock rollback latches a stop and restart does not clear it',()=>fixture(async f=>{
  f.c.register(lease());await f.c.tick();f.setTime(start-60000);await f.c.tick();
  assert.equal(f.c.status()[0].reason,'clock_rollback');assert.equal(f.reopen().status()[0].reason,'clock_rollback');
}));
test('operator stop stays latched through restart',()=>fixture(async f=>{
  f.c.register(lease());f.c.requestStopAll();f.reopen();await f.c.tick();assert.equal(f.c.status()[0].stopAttempts,1);
}));
test('unknown exception messages cannot leak through persisted events',()=>fixture(async f=>{
  f.c.register(lease());f.provider.get=async()=>{throw Error('private-controller-value');};await f.c.tick();
  assert(!JSON.stringify(f.c.events()).includes('private-controller-value'));
}));
test('real subprocess crash after accepted stop recovers persisted intent',()=>fixture(async f=>{
  const entry=f.c.register(lease()); const remote=join(f.dir,'remote.json');writeFileSync(remote,JSON.stringify(pod()));
  const child=spawnSync(process.execPath,['--experimental-sqlite',new URL('./fixtures/crash-after-stop.mjs',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'),f.path,remote,String(Date.parse(entry.triggerAt))],{encoding:'utf8'});
  assert.equal(child.status,73,child.stderr);assert.equal(f.c.status()[0].stopAttempts,1);
  f.setPod(JSON.parse(readFileSync(remote,'utf8')));f.setTime(Date.parse(entry.triggerAt));
  f.reopen();await f.c.tick();await f.c.tick();assert.equal(f.c.status()[0].phase,'absence_observed');
}));

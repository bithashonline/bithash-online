import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Controller, MockProvider } from './controller.js';
import { fixtures } from './solver.js';
import { workRequest, workResult, requestDigest } from './worker-protocol.js';
import { executeFixture, runFixtureChunk } from './worker-runner.js';

const request = {protocol:1,job:'test-job',epoch:1,fixture:'puzzle-3',start:'4',end:'8'};
function setup(t) {
  const dir = mkdtempSync(join(tmpdir(),'bithash-worker-')); const path=join(dir,'state.sqlite');
  let c=new Controller(path);
  t.after(()=>{c.close();rmSync(dir,{recursive:true,force:true});});
  c.fund('fixture-funding','bithash','100');c.plan('test-job','puzzle-3','4','8','50');
  c.dispatch('test-job',new MockProvider(c));c.lease('test-job',0,10);
  return {get c(){return c;},reopen(){c.close();c=new Controller(path);return c;}};
}
test('fixed subprocess executes every solved fixture and returns no candidate fields',async()=>{
  for(const f of fixtures) {
    const r=await executeFixture({...request,fixture:f.id,start:f.start,end:f.end});
    assert.equal(r.matched,true);assert.equal(r.attempted,(BigInt(f.end)-BigInt(f.start)).toString());
    assert.equal(r.backend,'node-openssl-cpu-fixture');assert.ok(BigInt(r.elapsedNanoseconds)>0n);
    assert.equal(Object.hasOwn(r,'privateKey'),false);
  }
  assert.equal((await executeFixture({...request,end:'7'})).matched,false);
});
test('protocol excludes arbitrary targets, ranges, commands and secret-bearing extra fields',()=>{
  for(const patch of [{fixture:'public-puzzle-71'},{end:'9'},{start:'8'},{epoch:0},{command:'anything'},
    {job:'a; b'},{start:4},{address:'other'}]) assert.throws(()=>workRequest({...request,...patch}));
  const good={protocol:1,requestDigest:requestDigest(request),backend:'node-openssl-cpu-fixture',attempted:'4',matched:true,elapsedNanoseconds:'1'};
  for(const patch of [{requestDigest:'wrong'},{attempted:'5'},{backend:'cuda'},{privateKey:'sensitive'},{matched:'true'}])
    assert.throws(()=>workResult(request,{...good,...patch}));
});
test('worker failures do not echo submitted data',()=>{
  const marker='SHOULD_NOT_APPEAR';
  const child=spawnSync(process.execPath,[fileURLToPath(new URL('./fixture-worker.js',import.meta.url))],
    {input:JSON.stringify({...request,privateKey:marker}),encoding:'utf8',timeout:5000,windowsHide:true});
  assert.equal(child.status,1);assert.equal(child.stdout,'');assert.equal(child.stderr.includes(marker),false);
});
test('subprocess checkpoint survives controller restart with exact nonduplicated coverage',async t=>{
  const s=setup(t);
  assert.equal((await runFixtureChunk(s.c,'test-job',1,'2',()=>1)).matched,false);
  const c=s.reopen();assert.equal(c.job('test-job').next,'6');
  assert.equal((await runFixtureChunk(c,'test-job',1,'2',()=>2)).matched,true);
  assert.equal(c.report().uniqueCheckpointedCandidates,'4');
  await assert.rejects(runFixtureChunk(c,'test-job',1,'2',()=>3));
  assert.equal(c.report().uniqueCheckpointedCandidates,'4');
});
test('expired lease during worker execution cannot commit progress',async t=>{
  const {c}=setup(t);let calls=0;
  await assert.rejects(runFixtureChunk(c,'test-job',1,'2',()=>calls++===0?1:10),/Stale lease/);
  assert.equal(c.job('test-job').next,'4');
  const lease=c.lease('test-job',10,10);
  await runFixtureChunk(c,'test-job',lease.epoch,'2',()=>11);
  assert.equal(c.report().uniqueCheckpointedCandidates,'2');
});
test('two simultaneous workers cannot credit the same chunk twice',async t=>{
  const {c}=setup(t);
  const results=await Promise.allSettled([runFixtureChunk(c,'test-job',1,'2',()=>1),runFixtureChunk(c,'test-job',1,'2',()=>1)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(c.report().uniqueCheckpointedCandidates,'2');
});

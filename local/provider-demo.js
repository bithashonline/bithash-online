import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { Controller } from './controller.js';
import { RunpodDryRun } from './runpod-dryrun.js';
import { runFixtureChunk } from './worker-runner.js';
import { dashboardSnapshot } from './dashboard-api.js';

const dir=mkdtempSync(join(tmpdir(),'bithash-provider-demo-')),path=join(dir,'state.sqlite');
let c=new Controller(path);
try {
  c.fund('synthetic','bithash','100');c.plan('demo','puzzle-3','4','8','50');
  let provider=new RunpodDryRun(c);
  const request=provider.prepare('demo','example.invalid/bithash-fixture@sha256:'+'a'.repeat(64));
  assert.throws(()=>provider.submit('demo',{timeoutAfterAccept:true}));
  const afterTimeout={status:c.job('demo').status,reserved:c.balance('reserved').toString()};
  c.close();c=new Controller(path);provider=new RunpodDryRun(c);provider.reconcile('demo');
  c.lease('demo',0,30);
  const first=await runFixtureChunk(c,'demo',1,'2',()=>1);
  const duringWork=dashboardSnapshot(path,1000);
  c.close();c=new Controller(path);provider=new RunpodDryRun(c);
  const resumedAt=c.job('demo').next;
  const second=await runFixtureChunk(c,'demo',1,'2',()=>2);
  provider.terminate('demo');c.settle('demo','synthetic-invoice','12','2');
  assert.equal(provider.snapshot().instances.length,1);assert.equal(resumedAt,'6');
  assert.equal(c.balance('available'),88n);assert.equal(c.balance('reserved'),0n);
  console.log(JSON.stringify({mode:'RUNPOD DRY RUN / REAL LOCAL CPU FIXTURE',gpuUsed:false,realFundsSpent:'0',
    clock:'simulated seconds from Unix epoch',requestIsPreviewOnly:true,request,afterTimeout,resumedAt,first,second,duringWork,
    provider:provider.snapshot(),finalDashboard:dashboardSnapshot(path,3000),syntheticLedger:c.report().simulatedMicroUSD},null,2));
} finally {c.close();assert.equal(dirname(resolve(dir)),resolve(tmpdir()));rmSync(dir,{recursive:true,force:true});}


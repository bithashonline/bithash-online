import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { once } from 'node:events';
import { Controller, MockProvider } from './controller.js';
import { WorkerReceipts } from './worker-receipts.js';
import { WorkerActivity, signWorkerActivity } from './worker-activity.js';
import { dashboardSnapshot } from './dashboard-api.js';
import { createWorkerServer } from './worker-api.js';

const build='sha256:'+'a'.repeat(64);
test('history retains signed activity across restart and excludes rejected and duplicate reports',()=>setup(({c,activity,sign,reopen})=>{
 const report=sign();activity.accept(report,101);activity.accept(report,102);
 assert.throws(()=>activity.accept({...report,signature:'bad'},103));
 assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM worker_activity_history').get().n,1);
 const resumed=reopen(),next=new WorkerActivity(resumed);next.accept(sign({sequence:2}),104);
 const rows=resumed.db.prepare('SELECT * FROM worker_activity_history ORDER BY id').all();
 assert.equal(rows.length,2);assert.equal(rows[0].received_at,101);assert.deepEqual(JSON.parse(rows[0].envelope),report);
 assert.equal(resumed.job('private-job').next,'4');
}));
async function setup(fn) {
  const dir=mkdtempSync(join(tmpdir(),'bithash-activity-')), path=join(dir,'state.sqlite');
  let c=new Controller(path);
  try {
    c.fund('test','bithash','100'); c.plan('private-job','puzzle-3','4','8','50');
    c.dispatch('private-job',new MockProvider(c)); c.lease('private-job',100,300);
    const keys=generateKeyPairSync('ed25519'), receipts=new WorkerReceipts(c);
    receipts.enroll('private-job',1,keys.publicKey.export({format:'pem',type:'spki'}),build);
    const sign=(patch={})=>signWorkerActivity({schema:'bithash.worker-activity.v1',job:'private-job',epoch:1,
      provider:'mock:private-job',build,sequence:1,state:'computing',device:'cpu-fixture',
      utilizationPercent:null,candidatesPerSecond:'100',...patch},keys.privateKey);
    await fn({c,path,receipts,sign,activity:new WorkerActivity(c),reopen(){c.close();c=new Controller(path);return c;}});
  } finally { c.close();assert.equal(dirname(resolve(dir)),resolve(tmpdir()));rmSync(dir,{recursive:true,force:true}); }
}
test('activity survives restart without adding coverage; duplicate cannot make stale worker fresh',()=>setup(({c,path,sign,activity,reopen})=>{
  const report=sign(); activity.accept(report,101);
  assert.equal(c.job('private-job').next,'4');
  assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM checkpoints').get().n,0);
  const service=new WorkerActivity(reopen());
  assert.deepEqual(service.accept(report,135),{duplicate:true});
  const view=dashboardSnapshot(path,135000);
  assert.equal(view.fixtures.items[0].activity.freshness,'stale');
  assert.equal(view.fixtures.items[0].activity.lastReceivedAt,'1970-01-01T00:01:41.000Z');
  assert.deepEqual(view.live.rigs,[]);
  assert.equal(JSON.stringify(view).includes('private-job'),false);
  assert.equal(JSON.stringify(view).includes('PUBLIC KEY'),false);
  service.accept(sign({sequence:2}),136);
  assert.equal(dashboardSnapshot(path,136000).fixtures.items[0].activity.freshness,'fresh');
}));
test('bad signature, conflicting sequence, old sequence, unknown fields and clock rollback reject',()=>setup(({sign,activity})=>{
  const bad=sign();bad.payload.state='idle'; assert.throws(()=>activity.accept(bad,101));
  activity.accept(sign({sequence:2}),102);
  for(const report of [sign(),sign({sequence:2,state:'idle'}),sign({sequence:3,provider:'wrong'}),sign({sequence:3,build:'sha256:'+'b'.repeat(64)})]) assert.throws(()=>activity.accept(report,103));
  assert.throws(()=>activity.accept(sign({sequence:3}),101));
  assert.throws(()=>sign({temperature:'secret'}));
  assert.throws(()=>sign({utilizationPercent:101}));
  assert.throws(()=>sign({candidatesPerSecond:'-1'}));
}));
test('expired, replaced and stopped leases reject activity; old epoch not displayed as current',()=>setup(({c,path,sign,activity,receipts})=>{
  activity.accept(sign(),101);
  assert.throws(()=>activity.accept(sign({sequence:2}),400));
  assert.equal(dashboardSnapshot(path,400000).fixtures.items[0].activity.freshness,'stale');
  c.lease('private-job',400,300);
  assert.throws(()=>activity.accept(sign({sequence:2}),401));
  assert.equal(dashboardSnapshot(path,401000).fixtures.items[0].activity.freshness,'never-seen');
  c.stop('private-job'); assert.throws(()=>activity.accept(sign({sequence:3}),402));
}));
test('future received time is unknown; stopped job is inactive and GPU claims never verify hardware',()=>setup(({c,path,sign,activity})=>{
  activity.accept(sign({device:'rtx-4090',utilizationPercent:98,candidatesPerSecond:'2900000000'}),110);
  assert.equal(dashboardSnapshot(path,109000).fixtures.items[0].activity.freshness,'clock-unknown');
  const view=dashboardSnapshot(path,110000).fixtures.items[0];
  assert.equal(view.activity.hardwareVerified,false);assert.equal(view.gpuVerified,false);
  c.stop('private-job');assert.equal(dashboardSnapshot(path,111000).fixtures.items[0].activity.freshness,'inactive');
}));
test('HTTP activity accepts signed report and status exposes only sanitized claims',()=>setup(async({path,receipts,sign})=>{
  const server=createWorkerServer(receipts,{databasePath:path,clock:()=>101});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const root=`http://127.0.0.1:${server.address().port}`;
  try {
    const send=body=>fetch(root+'/api/worker/activity',{method:'POST',headers:{'content-type':'application/json'},body});
    assert.equal((await send(JSON.stringify(sign()))).status,200);
    assert.deepEqual(await (await send('{}')).json(),{error:'activity_rejected'});
    assert.equal((await fetch(root+'/api/worker/activity')).status,405);
    const view=await (await fetch(root+'/api/status')).json();
    assert.equal(view.fixtures.items[0].activity.reported.candidatesPerSecond,'100');
    assert.equal(view.fixtures.items[0].activity.evidence,'authenticated-worker-claim');
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}));

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Controller, MockProvider, charge } from './controller.js';
import { fixtures, addressFor, integer, search } from './solver.js';

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'puzzle-fixture-'));
  const path = join(dir, 'state.sqlite');
  let c = new Controller(path);
  t.after(() => { c.close(); rmSync(dir, { recursive: true, force: true }); });
  return { get c() { return c; }, path, reopen() { c.close(); c = new Controller(path); return c; } };
}
function ready(c) { c.fund('receipt', 'coin-a', '1000'); c.plan('job', 'puzzle-3', '4', '8', '500'); c.dispatch('job', new MockProvider(c)); }
test('compressed secp256k1 vectors and all three solved ranges', () => {
  for (const [i, key] of ['1', '3', '7'].entries()) {
    assert.equal(addressFor(key), fixtures[i].address);
    assert.equal(search(fixtures[i].id, fixtures[i].start, fixtures[i].end).matched, true);
  }
  assert.equal(search('puzzle-3', '4', '7').matched, false);
  assert.equal(search('puzzle-3', '7', '8').attempted, '1');
  assert.throws(() => search('puzzle-71', '1', '2'));
  assert.throws(() => search('puzzle-1', '1', '3'));
  assert.throws(() => addressFor('0'));
});
test('exact integers and conservative billing rounding', () => {
  assert.throws(() => integer(0.1)); assert.throws(() => integer('01'));
  assert.throws(() => integer(-1n)); assert.throws(() => charge(-1n,'7'));
  assert.equal(charge('61', '7', '60'), 840n);
  assert.equal(charge('0', '7', '60', '120'), 840n);
  assert.equal(charge('3600', '9007199254740993'), 32425917317067574800n);
});
test('fee fixture replay deduplicates; conflicts roll back', t => {
  const { c } = setup(t);
  c.fund('r', 'a', '9007199254740993'); c.fund('r', 'a', '9007199254740993');
  assert.throws(() => c.fund('r', 'b', '4'));
  assert.equal(c.balance('available'), 9007199254740993n);
  assert.equal(c.balance('contribution:a'), -9007199254740993n);
});
test('overlap, replay conflict and exhausted budget cannot mutate reserves', t => {
  const { c } = setup(t); ready(c);
  assert.throws(() => c.plan('other', 'puzzle-3', '5', '7', '10'));
  assert.throws(() => c.plan('job', 'puzzle-3', '4', '8', '400'));
  assert.throws(() => c.plan('p2', 'puzzle-2', '2', '4', '501'));
  assert.equal(c.balance('reserved'), 500n);
  assert.equal(c.report().jobs.length, 1);
});
test('adjacent partitions accepted without double coverage', t => {
  const { c } = setup(t); c.fund('r','a','100');
  c.plan('a','puzzle-3','4','6','10'); c.plan('b','puzzle-3','6','8','10');
  for (const id of ['a','b']) { c.dispatch(id,new MockProvider(c)); const j=c.lease(id,0); c.runChunk(id,j.epoch,'2',1); }
  assert.equal(c.report().uniqueCheckpointedCandidates,'4');
});
test('accepted create timeout survives restart; reconciliation creates no second job', t => {
  const state = setup(t); let c = state.c;
  c.fund('r','a','1000'); c.plan('job','puzzle-3','4','8','500');
  assert.throws(() => c.dispatch('job',new MockProvider(c,{timeoutAfterCreate:true})));
  c=state.reopen(); assert.equal(c.job('job').status,'unknown');
  assert.throws(() => c.dispatch('job',new MockProvider(c)));
  assert.equal(c.balance('reserved'),500n); c.reconcile('job');
  assert.equal(c.db.prepare('SELECT count(*) AS n FROM mock_jobs').get().n,1);
  assert.equal(c.job('job').status,'ready');
});
test('ambiguous absent provider remains reserved and paused', t => {
  const {c}=setup(t); ready(c);
  c.db.prepare("UPDATE jobs SET status='unknown' WHERE id='job'").run();
  c.db.prepare("DELETE FROM mock_jobs WHERE id='job'").run();
  assert.throws(()=>c.reconcile('job')); assert.throws(()=>c.stop('job'));
  assert.equal(c.balance('reserved'),500n);
});
test('restart checkpoint, fenced expired lease and duplicate reports', t => {
  const state=setup(t); let c=state.c; ready(c);
  const first=c.lease('job',0,10); c.runChunk('job',first.epoch,'2',1);
  c.checkpoint('job',first.epoch,'6',2); // duplicate does not count twice
  c=state.reopen(); assert.equal(c.job('job').next,'6');
  assert.throws(()=>c.lease('job',9));
  const second=c.lease('job',10,10);
  assert.throws(()=>c.checkpoint('job',first.epoch,'8',11));
  assert.throws(()=>c.checkpoint('job',second.epoch,'5',11));
  assert.throws(()=>c.checkpoint('job',second.epoch,'9',11));
  assert.equal(c.runChunk('job',second.epoch,'2',11).matched,true);
  assert.equal(c.report().uniqueCheckpointedCandidates,'4');
  assert.throws(()=>c.checkpoint('job',second.epoch,'8',20));
});
test('process exits during transaction; SQLite rolls back and work safely repeats', t => {
  const state=setup(t); const c=state.c; ready(c); const j=c.lease('job',0,10);
  const script=`import {Controller} from ${JSON.stringify(new URL('./controller.js',import.meta.url).href)};
    const c=new Controller(${JSON.stringify(state.path)}); c.db.exec('BEGIN IMMEDIATE');
    c.db.prepare("UPDATE jobs SET next='6' WHERE id='job'").run(); process.exit(73);`;
  const child=spawnSync(process.execPath,['--experimental-sqlite','--input-type=module','-e',script],{encoding:'utf8'});
  assert.equal(child.status,73,child.stderr);
  const reopened=state.reopen(); assert.equal(reopened.job('job').next,'4');
  assert.equal(reopened.runChunk('job',j.epoch,'2',1).attempted,'2');
  assert.equal(reopened.report().uniqueCheckpointedCandidates,'2');
});
test('stopped job retains reservation; invoice replay exact and excess rejected', t => {
  const {c}=setup(t); ready(c); const j=c.lease('job',0);
  c.runChunk('job',j.epoch,'1',1);
  assert.throws(()=>c.settle('job','i','70','10'));
  c.stop('job'); assert.equal(c.balance('reserved'),500n);
  assert.throws(()=>c.settle('job','i',-1n,'10'));
  assert.throws(()=>c.checkpoint('job',j.epoch,'8',2));
  assert.throws(()=>c.settle('job','i','501','10'));
  c.settle('job','i','70','10'); c.settle('job','i','70','10');
  assert.throws(()=>c.settle('job','i','71','10'));
  assert.throws(()=>c.settle('job','different','70','10'));
  assert.equal(c.balance('available'),930n); assert.equal(c.balance('reserved'),0n);
  assert.equal(c.balance('expense'),70n);
  assert.equal(c.balance('available')+c.balance('reserved')+c.balance('expense'),1000n);
});
test('paid adapter disabled even when it claims simulation',t=>{
  const {c}=setup(t); c.fund('r','a','100'); c.plan('job','puzzle-1','1','2','10');
  let called=false; assert.throws(()=>c.dispatch('job',{simulation:true,create(){called=true;}}));
  assert.equal(called,false); assert.equal(c.job('job').status,'planned');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Controller, MockProvider } from './controller.js';
import { coverageSummary, previewCoverageRange } from './coverage.js';
import { dashboardSnapshot } from './dashboard-api.js';

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'bithash-coverage-')), path = join(dir,'state.db');
  let c = new Controller(path);
  t.after(() => { c.close(); rmSync(dir,{ recursive:true, force:true }); });
  return { get c() { return c; }, path, reopen() { c.close(); c = new Controller(path); return c; } };
}
const snapshot = (overrides = {}) => ({ schema:'bithash.external-coverage.v1', id:'pool-a-1',
  targetId:'puzzle-3', targetVersion:1, sourceUrl:'https://example.org/pool-a',
  observedAt:100, expiresAt:1000, intervals:[{ start:'4',end:'6' }], ...overrides });

test('overlapping source claims are unioned, separate from our actual checkpoints', t => {
  const {c} = setup(t);
  c.coverage.importSnapshot(snapshot({ intervals:[{start:'4',end:'6'},{start:'5',end:'7'}] }),100);
  c.coverage.importSnapshot(snapshot({id:'pool-b',sourceUrl:'https://example.org/pool-b',intervals:[{start:'6',end:'8'}]}),100);
  let report = coverageSummary(c.db,'puzzle-3',100);
  assert.equal(report.externalReportedCandidates,'4'); assert.equal(report.ownCheckpointedCandidates,'0');
  assert.equal(c.report().uniqueCheckpointedCandidates,'0');
  c.fund('r','a','10');
  const {job,selection} = c.planNextFixture('j','puzzle-3','1','1',100);
  assert.equal(selection.preference,'external-reported-fallback'); assert.equal(job.start,'4');
  c.dispatch('j',new MockProvider(c)); const lease = c.lease('j',0); c.runChunk('j',lease.epoch,'1',1);
  report = coverageSummary(c.db,'puzzle-3',100);
  assert.equal(report.externalReportedCandidates,'4'); assert.equal(report.ownCheckpointedCandidates,'1');
});
test('exact #71 arithmetic, scattered intervals, boundaries, and no executable #71 path', t => {
  const {c} = setup(t), start = 1n << 70n, end = 1n << 71n;
  c.coverage.importSnapshot(snapshot({ targetId:'puzzle-71', intervals:[
    {start:start.toString(),end:(start+7n).toString()}, {start:(end-2n).toString(),end:end.toString()}
  ] }),100);
  const next = previewCoverageRange(c.db,'puzzle-71','20',100);
  assert.equal(next.start,(start+7n).toString()); assert.equal(next.end,(start+27n).toString());
  assert.equal(coverageSummary(c.db,'puzzle-71',100).externalReportedCandidates,'9');
  assert.equal(next.dispatchEnabled,false);
  assert.throws(() => c.planNextFixture('live','puzzle-71','1','1',100),/fixture-only/);
  assert.throws(() => c.plan('live','puzzle-71',start.toString(),(start+1n).toString(),'1'),/fixture/);
});
test('prefer fresh unreported gaps, then fall back without permanently excluding any key', t => {
  const {c} = setup(t); c.fund('r','a','10'); c.coverage.importSnapshot(snapshot(),100);
  const a = c.planNextFixture('a','puzzle-3','4','1',100);
  const b = c.planNextFixture('b','puzzle-3','4','1',100);
  assert.deepEqual([a.job.start,a.job.end,a.selection.preference],['6','8','unreported']);
  assert.deepEqual([b.job.start,b.job.end,b.selection.preference],['4','6','external-reported-fallback']);
  assert.equal(previewCoverageRange(c.db,'puzzle-3','4',100),null);
  assert.equal(coverageSummary(c.db,'puzzle-3',100).ownCheckpointedCandidates,'0');
  assert.throws(() => c.planNextFixture('c','puzzle-3','4','1',100),/already allocated/);
  assert.equal(c.balance('reserved'),2n);
});
test('expiry, withdrawal, replacement, and replay cannot silently reactivate stale claims', t => {
  const state = setup(t), c = state.c;
  c.coverage.importSnapshot(snapshot(),100);
  assert.equal(previewCoverageRange(c.db,'puzzle-3','1',999).start,'6');
  assert.equal(previewCoverageRange(c.db,'puzzle-3','1',1000).start,'4');
  const fresh = snapshot({id:'new',observedAt:200,expiresAt:1500,intervals:[{start:'6',end:'8'}]});
  c.coverage.importSnapshot(fresh,200);
  assert.equal(c.coverage.importSnapshot(snapshot(),200).state,'superseded');
  assert.equal(previewCoverageRange(c.db,'puzzle-3','1',200).start,'4');
  c.coverage.withdraw('new',201); c.coverage.withdraw('new',202);
  assert.equal(c.coverage.importSnapshot(fresh,203).state,'withdrawn');
  const reopened = state.reopen();
  assert.equal(coverageSummary(reopened.db,'puzzle-3',203).activeSnapshots,0);
  assert.equal(coverageSummary(reopened.db,'puzzle-3',203).historicalSnapshots,2);
  assert.throws(() => reopened.coverage.importSnapshot(snapshot({id:'older'}),204),/newer/);
});
test('reject invalid or aggregate-only imports atomically and preserve previous snapshot', t => {
  const {c} = setup(t); c.coverage.importSnapshot(snapshot(),100);
  const invalid = [
    {intervals:[{start:'4',end:'4'}]}, {intervals:[{start:'3',end:'5'}]}, {intervals:[{start:'4',end:'9'}]},
    {intervals:[{start:4,end:'5'}]}, {intervals:[{start:'04',end:'5'}]}, {targetVersion:2},
    {intervals:[{start:'4',end:'5',verified:true}]}, {intervals:[{start:'9'.repeat(1000),end:'8'}]},
    {scannedPercent:1}, {observedAt:201}, {expiresAt:100}, {expiresAt:31*86400000},
    {sourceUrl:'https://secret@example.org/'}, {sourceUrl:'https://example.org/?token=secret'},
    {intervals:Array.from({length:10001},()=>({start:'4',end:'5'}))}, {targetId:'arbitrary-wallet'}
  ];
  for (const patch of invalid) assert.throws(() => c.coverage.importSnapshot(snapshot({id:'invalid',...patch}),200));
  assert.throws(() => c.coverage.importSnapshot(snapshot({intervals:[]}),200),/Conflicting/);
  assert.equal(coverageSummary(c.db,'puzzle-3',200).externalReportedCandidates,'2');
  assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM coverage_imports').get().n,1);
});
test('empty replacement retracts source claims; other source still counts', t => {
  const {c} = setup(t); c.coverage.importSnapshot(snapshot(),100);
  c.coverage.importSnapshot(snapshot({id:'b',sourceUrl:'https://example.org/b',intervals:[{start:'5',end:'7'}]}),100);
  c.coverage.importSnapshot(snapshot({id:'empty',observedAt:200,intervals:[]}),200);
  assert.equal(coverageSummary(c.db,'puzzle-3',200).externalReportedCandidates,'2');
  assert.equal(previewCoverageRange(c.db,'puzzle-3','4',200).end,'5');
});
test('scheduled choices survive restart; replay stable after source changes; budget failure rolls back', t => {
  const state = setup(t); let c = state.c; c.fund('r','a','2'); c.coverage.importSnapshot(snapshot(),100);
  const first = c.planNextFixture('j','puzzle-3','1','1',100); c = state.reopen();
  c.coverage.withdraw('pool-a-1',101);
  assert.deepEqual(c.planNextFixture('j','puzzle-3','1','1',102),first);
  assert.throws(() => c.planNextFixture('j','puzzle-3','2','1',102),/replay/);
  assert.throws(() => c.planNextFixture('bad','puzzle-3','1','2',102),/Budget/);
  assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM coverage_selections').get().n,1);
  assert.equal(c.report().jobs.length,1); assert.equal(c.balance('reserved'),1n);
});
test('two concurrent controller processes allocate disjoint ranges under one database lock', async t => {
  const {c,path} = setup(t); c.fund('r','a','10');
  const moduleUrl = new URL('./controller.js',import.meta.url).href;
  const code = `import {Controller} from ${JSON.stringify(moduleUrl)};
    const c = new Controller(process.argv[1]); c.planNextFixture(process.argv[2],'puzzle-3','2','1',100); c.close();`;
  await Promise.all(['one','two'].map(id => promisify(execFile)(process.execPath,
    ['--experimental-sqlite','--input-type=module','-e',code,path,id])));
  const jobs = c.report().jobs.sort((a,b)=>Number(BigInt(a.start)-BigInt(b.start)));
  assert.deepEqual(jobs.map(j=>[j.start,j.end]),[['4','6'],['6','8']]);
  assert.equal(c.balance('reserved'),2n);
});
test('dashboard exposes aggregate evidence without source URLs, import IDs or invented live rigs', t => {
  const {c,path} = setup(t); c.coverage.importSnapshot(snapshot({id:'private-import-id'}),100);
  const view = dashboardSnapshot(path,100), report = view.coverage.targets.find(t=>t.targetId==='puzzle-3');
  assert.equal(report.externalReportedCandidates,'2'); assert.equal(report.ownCheckpointedCandidates,'0');
  assert.equal(report.externalEvidence,'unverified-source-reports'); assert.equal(view.live.providerConnected,false);
  assert.equal(JSON.stringify(view).includes('private-import-id'),false);
  assert.equal(JSON.stringify(view).includes('example.org'),false);
});
test('all tiny external coverage patterns eventually allocate each candidate exactly once', t => {
  const {c} = setup(t); c.fund('r','a','100');
  for (let mask=0; mask<16; mask++) {
    c.db.exec('DELETE FROM coverage_selections; DELETE FROM jobs;');
    c.coverage.importSnapshot(snapshot({id:`pattern-${mask}`,observedAt:100+mask,
      intervals:[4,5,6,7].filter((_,i)=>mask&(1<<i)).map(n=>({start:String(n),end:String(n+1)}))}),100+mask);
    const allocated = [];
    for (let i=0; i<4; i++) allocated.push(c.planNextFixture(`m${mask}-${i}`,'puzzle-3','1','1',100+mask).job.start);
    assert.deepEqual(allocated.sort(),['4','5','6','7']);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { validRangeWorker, rangeWorkerPanel, validateSnapshot } from './public/workers.mjs';
const r={schema:'bithash.range-worker.v1',backend:'node-openssl-cpu-fixture',state:'accepted',assigned:{start:'4',end:'8'},next:'6',
 acceptedChunks:1,failedAttempts:1,interruptedAttempts:0,lastError:null,lastFinishedAt:'2026-10-13T00:00:00Z',
 records:[{start:'4',end:'6',state:'failed',error:'worker_failed',digest:null},{start:'4',end:'6',state:'accepted',error:null,digest:'a'.repeat(64)}],
 evidence:'local-known-answer-validation',hardwareVerified:false,coverageVerified:false};
test('range details show exact resume position, failed attempts and result links',()=>{
 assert.equal(validRangeWorker(r),true);const html=rangeWorkerPanel(r,true);
 for(const phrase of ['CPU / OpenSSL','Resume at 6','1 failed attempts','[4, 6)','worker failed','/range-result.html#','Puzzle #71 work: zero'])assert.ok(html.includes(phrase));
 assert.ok(rangeWorkerPanel(r,false).includes('LAST KNOWN'));assert.ok(!html.includes('GPU verified'));
});
test('range view rejects forged verified flags, invalid ranges, secret fields in links and oversized history',()=>{
 for(const patch of [{hardwareVerified:true},{coverageVerified:true},{next:'9'},{assigned:{start:'8',end:'4'}},
  {records:[{...r.records[1],digest:'https://evil.example/secret'}]},{records:Array(21).fill(r.records[1])},{lastError:'<script>'}])
  assert.equal(validRangeWorker({...r,...patch}),false);
 const snapshot={schema:'bithash.dashboard.v1',source:'local-controller',observedAt:'2026-10-13T00:00:00Z',
  fixtures:{status:'available',jobs:1,checkpoints:1,items:[{id:'a'.repeat(24),fixture:'puzzle-3',status:'running',
   progress:{completed:'2',total:'4'},authenticatedReceipts:0,activity:{freshness:'never-seen',lastReceivedAt:null},rangeWorker:r}]}};
 assert.equal(validateSnapshot(snapshot),true);
 assert.equal(validateSnapshot({...snapshot,fixtures:{...snapshot.fixtures,items:[{...snapshot.fixtures.items[0],rangeWorker:{...r,next:'9'}}]}}),false);
});

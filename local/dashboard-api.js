import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { coverageSummary } from './coverage.js';
import { activityProjection } from './worker-activity.js';
import { localOperator } from './operator.js';
import { rangeProjection, rangeResultProof } from './range-worker.js';
import { ownRangeSummary } from './own-range-ledger.js';

// Read-only projection of the existing fixture controller. Never infer live rigs
// or real treasury balances from this database's synthetic micro-USD ledger.
export function dashboardSnapshot(databasePath, now = Date.now()) {
  const result = {
    schema: 'bithash.dashboard.v1', observedAt: new Date(now).toISOString(),
    source: 'local-controller', live: { treasuryConnected: false, providerConnected: false, aiConnected: false, rigs: [] },
    policy: { computeBasisPoints: null, earmark: 'unresolved', spending: 'owner-approved-runs', fees: 'accumulate-in-treasury', operatorCount: 1 },
    fixtures: { status: 'not-configured', jobs: 0, checkpoints: 0, states: {}, items: [] },
    coverage: { status: 'not-configured', targets: [] },
    ownRanges:{schema:'bithash.own-range-ledger.v1',status:'not-configured',items:[],puzzle71CheckpointedCandidates:'0'}
  };
  if (!databasePath) return result;
  let db;
  try {
    db = new DatabaseSync(databasePath, { readOnly: true });
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1000; BEGIN;');
    const jobs = db.prepare('SELECT status, COUNT(*) AS count FROM jobs GROUP BY status').all();
    const allowed = new Set(['planned','ready','work_done','settled','reserved','starting','running','completed','stopped','failed','unknown','exhausted','found','leased','paused']);
    const states = {};
    for (const row of jobs) { const state = allowed.has(row.status) ? row.status : 'other'; states[state] = (states[state] ?? 0) + row.count; }
    const hasReceipts = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='worker_receipts'").get();
    const receiptCounts = new Map(hasReceipts ? db.prepare('SELECT job, COUNT(*) AS count FROM worker_receipts GROUP BY job').all().map(r => [r.job, r.count]) : []);
    const hasActivity = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='worker_activity'").get();
    const activity = hasActivity ? db.prepare('SELECT * FROM worker_activity WHERE job=? AND epoch=?') : null;
    const items = db.prepare('SELECT id,fixture,status,start,end,next,epoch,expires FROM jobs ORDER BY id LIMIT 100').all().map(row=>({
      id: createHash('sha256').update(row.id).digest('hex').slice(0,24),
      fixture: ['puzzle-1','puzzle-2','puzzle-3'].includes(row.fixture) ? row.fixture : 'other',
      status: allowed.has(row.status) ? row.status : 'other',
      progress: { completed: (BigInt(row.next)-BigInt(row.start)).toString(), total: (BigInt(row.end)-BigInt(row.start)).toString() },
      lease: { epoch: row.epoch, freshness: row.status === 'running' ? (Math.floor(now/1000) < row.expires ? 'fresh' : 'stale') : 'inactive' },
      evidence: receiptCounts.has(row.id) ? 'includes-authenticated-cpu-fixture-reports' : 'local-solved-fixture',
      authenticatedReceipts: receiptCounts.get(row.id) ?? 0, gpuVerified: false,
      activity: activityProjection(activity?.get(row.id,row.epoch),row,Math.floor(now/1000)),
      rangeWorker: rangeProjection(db,row,Math.floor(now/1000))
    }));
    result.fixtures = { status: 'available', jobs: jobs.reduce((n,r)=>n+r.count,0), checkpoints: db.prepare('SELECT COUNT(*) AS count FROM checkpoints').get().count, states, items, itemsLimit: 100 };
    result.coverage = { status: 'available', targets: ['puzzle-1','puzzle-2','puzzle-3','puzzle-71'].map(id => coverageSummary(db,id,now)) };
    result.ownRanges=ownRangeSummary(db);
    db.exec('COMMIT');
  } catch {
    result.coverage = { status: 'unavailable', targets: [] };
    result.ownRanges = {schema:'bithash.own-range-ledger.v1',status:'unavailable',items:[],puzzle71CheckpointedCandidates:null};
    result.fixtures = { status: 'unavailable', jobs: null, checkpoints: null, states: {}, items: [] };
  } finally { db?.close(); }
  return result;
}

export function handleDashboardApi(req, res, { databasePath } = {}) {
  const route=new URL(req.url, 'http://localhost').pathname;
  const proof = /^\/api\/range-proof\/([a-f0-9]{64})$/.exec(route);
  if (!['/api/status','/api/operator'].includes(route) && !proof) return false;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // No mutation, arbitrary SQL, filesystem path or credentials accepted from clients.
  if (req.method !== 'GET') { res.setHeader('Allow','GET'); res.writeHead(405); res.end(JSON.stringify({error:'method_not_allowed'})); return true; }
  if (proof) {
    let db;
    try {
      if (!databasePath) throw Error();
      db = new DatabaseSync(databasePath,{readOnly:true});db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1000;');
      const result = rangeResultProof(db,proof[1]);
      res.writeHead(result?200:404);res.end(JSON.stringify(result??{error:'not_found'}));
    } catch {res.writeHead(503);res.end(JSON.stringify({error:'range_proof_unavailable'}));}
    finally {db?.close();}
    return true;
  }
  const snapshot=dashboardSnapshot(databasePath);
  res.end(JSON.stringify(route==='/api/operator'?localOperator(snapshot):snapshot));
  return true;
}

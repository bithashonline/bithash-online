import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { coverageSummary } from './coverage.js';
import { activityProjection } from './worker-activity.js';
import { localOperator } from './operator.js';

// Read-only projection of the existing fixture controller. Never infer live rigs
// or real treasury balances from this database's synthetic micro-USD ledger.
export function dashboardSnapshot(databasePath, now = Date.now()) {
  const result = {
    schema: 'bithash.dashboard.v1', observedAt: new Date(now).toISOString(),
    source: 'local-controller', live: { treasuryConnected: false, providerConnected: false, aiConnected: false, rigs: [] },
    policy: { computeBasisPoints: null, earmark: 'unresolved', spending: 'owner-approved-runs', fees: 'accumulate-in-treasury', operatorCount: 1 },
    fixtures: { status: 'not-configured', jobs: 0, checkpoints: 0, states: {}, items: [] },
    coverage: { status: 'not-configured', targets: [] }
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
      activity: activityProjection(activity?.get(row.id,row.epoch),row,Math.floor(now/1000))
    }));
    result.fixtures = { status: 'available', jobs: jobs.reduce((n,r)=>n+r.count,0), checkpoints: db.prepare('SELECT COUNT(*) AS count FROM checkpoints').get().count, states, items, itemsLimit: 100 };
    result.coverage = { status: 'available', targets: ['puzzle-1','puzzle-2','puzzle-3','puzzle-71'].map(id => coverageSummary(db,id,now)) };
    db.exec('COMMIT');
  } catch {
    result.coverage = { status: 'unavailable', targets: [] };
    result.fixtures = { status: 'unavailable', jobs: null, checkpoints: null, states: {}, items: [] };
  } finally { db?.close(); }
  return result;
}

export function handleDashboardApi(req, res, { databasePath } = {}) {
  const route=new URL(req.url, 'http://localhost').pathname;
  if (!['/api/status','/api/operator'].includes(route)) return false;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // No mutation, arbitrary SQL, filesystem path or credentials accepted from clients.
  if (req.method !== 'GET') { res.setHeader('Allow','GET'); res.writeHead(405); res.end(JSON.stringify({error:'method_not_allowed'})); return true; }
  const snapshot=dashboardSnapshot(databasePath);
  res.end(JSON.stringify(route==='/api/operator'?localOperator(snapshot):snapshot));
  return true;
}

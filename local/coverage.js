import { createHash } from 'node:crypto';
import { fixtures, integer } from './solver.js';

// Immutable target version. #71 is planning-only; Controller still executes fixtures only.
export const coverageTargets = Object.freeze([...fixtures, Object.freeze({
  id: 'puzzle-71', start: (1n << 70n).toString(), end: (1n << 71n).toString()
})]);
const MAX_AGE = 30 * 24 * 60 * 60 * 1000;
function clock(n) { if (!Number.isSafeInteger(n) || n < 0) throw Error('Invalid coverage clock'); return n; }
function exact(value) {
  if (typeof value !== 'string' || value.length > 78) throw Error('Expected bounded decimal string');
  return integer(value);
}
function shape(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw Error('Invalid coverage schema');
}
function target(id) {
  const result = coverageTargets.find(t => t.id === id);
  if (!result) throw Error('Unknown coverage target');
  return result;
}
function union(ranges) {
  const sorted = ranges.map(r => ({ start: BigInt(r.start), end: BigInt(r.end) }))
    .sort((a,b) => a.start < b.start ? -1 : a.start > b.start ? 1 : 0);
  const result = [];
  for (const r of sorted) {
    const last = result.at(-1);
    if (last && r.start <= last.end) { if (r.end > last.end) last.end = r.end; }
    else result.push(r);
  }
  return result;
}
function gaps(t, blocked) {
  const result = []; let cursor = BigInt(t.start);
  for (const r of union(blocked)) {
    if (cursor < r.start) result.push({ start: cursor, end: r.start });
    if (r.end > cursor) cursor = r.end;
  }
  if (cursor < BigInt(t.end)) result.push({ start: cursor, end: BigInt(t.end) });
  return result;
}
const serialize = ranges => ranges.map(r => ({ start: r.start.toString(), end: r.end.toString() }));
const count = ranges => union(ranges).reduce((n,r) => n + r.end - r.start, 0n).toString();

export function initCoverage(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS coverage_imports(
    id TEXT PRIMARY KEY, target TEXT NOT NULL, source TEXT NOT NULL,
    observed INTEGER NOT NULL, expires INTEGER NOT NULL, imported INTEGER NOT NULL,
    digest TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL, withdrawn INTEGER);
    CREATE UNIQUE INDEX IF NOT EXISTS coverage_current_source ON coverage_imports(target,source) WHERE state='active';
    CREATE TABLE IF NOT EXISTS coverage_selections(job TEXT PRIMARY KEY, request TEXT NOT NULL, decision TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS coverage_feed_state(source TEXT PRIMARY KEY,target TEXT NOT NULL,
      last_attempt INTEGER NOT NULL,next_refresh INTEGER NOT NULL,last_success INTEGER,
      status TEXT NOT NULL,error TEXT,digest TEXT,payload TEXT);
    CREATE TABLE IF NOT EXISTS coverage_feed_observations(id INTEGER PRIMARY KEY,source TEXT NOT NULL,
      observed INTEGER NOT NULL,digest TEXT NOT NULL,payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS coverage_policy(target TEXT PRIMARY KEY,mode TEXT NOT NULL,changed INTEGER NOT NULL);`);
}

export function coveragePolicy(db,targetId) {
  target(targetId);
  const exists=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='coverage_policy'").get();
  return exists?db.prepare('SELECT mode FROM coverage_policy WHERE target=?').get(targetId)?.mode??'prefer-external':'prefer-external';
}

// Local administrative API. Never expose import/withdraw as public HTTP mutations.
export class CoverageLedger {
  constructor(controller) { this.controller = controller; }
  setPolicy(targetId,mode,now=Date.now()) {
    target(targetId);clock(now);
    if(!['own-only','prefer-external'].includes(mode))throw Error('Invalid coverage policy');
    return this.controller.transaction(()=>{
      const db=this.controller.db;
      db.prepare(`INSERT INTO coverage_policy(target,mode,changed) VALUES (?,?,?)
        ON CONFLICT(target) DO UPDATE SET mode=excluded.mode,changed=excluded.changed`).run(targetId,mode,now);
      if(mode==='own-only')db.prepare("UPDATE coverage_imports SET state='withdrawn',withdrawn=COALESCE(withdrawn,?) WHERE target=? AND state='active'")
        .run(now,targetId);
      return {targetId,mode,changedAt:now};
    });
  }
  importSnapshot(input, now = Date.now()) {
    clock(now);
    shape(input, ['schema','id','targetId','targetVersion','sourceUrl','observedAt','expiresAt','intervals']);
    if (input.schema !== 'bithash.external-coverage.v1' || input.targetVersion !== 1 ||
        typeof input.id !== 'string' || !/^[a-zA-Z0-9._-]{1,96}$/.test(input.id)) throw Error('Invalid coverage identity');
    const t = target(input.targetId);
    if (typeof input.sourceUrl !== 'string' || input.sourceUrl.length > 2048) throw Error('Invalid source URL');
    const url = new URL(input.sourceUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw Error('Expected public HTTPS source without credentials/query/fragment');
    clock(input.observedAt); clock(input.expiresAt);
    if (input.observedAt > now || input.expiresAt <= input.observedAt || input.expiresAt - input.observedAt > MAX_AGE) throw Error('Invalid coverage freshness');
    if (!Array.isArray(input.intervals) || input.intervals.length > 10000) throw Error('Expected at most 10000 exact intervals');
    const intervals = serialize(union(input.intervals.map(r => {
      shape(r, ['start','end']); const start = exact(r.start), end = exact(r.end);
      if (start < BigInt(t.start) || end > BigInt(t.end) || end <= start) throw Error('Coverage outside target bounds');
      return { start, end };
    })));
    const payload = JSON.stringify({ schema: input.schema, id: input.id, targetId: t.id, targetVersion: 1,
      sourceUrl: url.href, observedAt: input.observedAt, expiresAt: input.expiresAt, intervals });
    const digest = createHash('sha256').update(payload).digest('hex');
    return this.controller.transaction(() => {
      const db = this.controller.db;
      if(coveragePolicy(db,t.id)==='own-only')throw Error('External coverage disabled by owner');
      const old = db.prepare('SELECT * FROM coverage_imports WHERE id=?').get(input.id);
      if (old) { if (old.digest !== digest) throw Error('Conflicting coverage replay'); return { id: old.id, digest, state: old.state }; }
      if (input.expiresAt <= now) throw Error('Cannot activate expired coverage');
      const latest = db.prepare('SELECT MAX(observed) AS observed FROM coverage_imports WHERE target=? AND source=?').get(t.id, url.href);
      if (latest.observed !== null && input.observedAt <= latest.observed) throw Error('Coverage snapshot must be newer');
      db.prepare("UPDATE coverage_imports SET state='superseded' WHERE target=? AND source=? AND state='active'").run(t.id, url.href);
      db.prepare("INSERT INTO coverage_imports VALUES (?,?,?,?,?,?,?,?,'active',NULL)")
        .run(input.id, t.id, url.href, input.observedAt, input.expiresAt, now, digest, payload);
      return { id: input.id, digest, state: 'active' };
    });
  }
  withdraw(id, now = Date.now()) {
    clock(now);
    return this.controller.transaction(() => {
      const db = this.controller.db, row = db.prepare('SELECT * FROM coverage_imports WHERE id=?').get(id);
      if (!row) throw Error('Unknown coverage snapshot');
      if (now < row.imported) throw Error('Withdrawal predates import');
      db.prepare("UPDATE coverage_imports SET state='withdrawn',withdrawn=COALESCE(withdrawn,?) WHERE id=?").run(now, id);
    });
  }
}

function records(db, targetId, now) {
  clock(now); target(targetId);
  const configured = Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='coverage_imports'").get());
  const imports = configured ? db.prepare('SELECT * FROM coverage_imports WHERE target=? ORDER BY observed,id').all(targetId) : [];
  const mode=coveragePolicy(db,targetId);
  const active = mode==='own-only'?[]:imports.filter(r => r.state === 'active' && r.observed <= now && now < r.expires);
  const external = union(active.flatMap(r => JSON.parse(r.payload).intervals));
  // Every existing allocation is reserved against new dispatch. Interrupted work must
  // resume the same durable job; it is not credited as completed by this scheduler.
  const own = db.prepare('SELECT start,end,next FROM jobs WHERE fixture=?').all(targetId);
  const hasRanges=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='own_range_jobs'").get();
  if(hasRanges)own.push(...db.prepare('SELECT start,end,next FROM own_range_jobs WHERE target=?').all(targetId));
  return { configured, imports, active, external, own, mode };
}

export function previewCoverageRange(db, targetId, size, now = Date.now()) {
  size = exact(size); if (!size) throw Error('Expected positive range size');
  const t = target(targetId), { own, external, active, mode } = records(db, targetId, now);
  const preferred = gaps(t, [...own, ...external]);
  const available = preferred.length ? preferred : gaps(t, own);
  if (!available.length) return null;
  const first = available[0], end = first.start + size < first.end ? first.start + size : first.end;
  return { targetId, targetVersion: 1, start: first.start.toString(), end: end.toString(),
    preference: mode==='own-only'?'own-history':preferred.length ? 'unreported' : 'external-reported-fallback',
    externalSnapshotIds: active.map(r => r.id), selectedAt: now,
    dispatchEnabled: false, evidence: 'planning-only; external reports are not proof of search' };
}

export function coverageSummary(db, targetId, now = Date.now()) {
  const t = target(targetId), r = records(db, targetId, now);
  const onlineFeed=coverageFeedSummary(db,targetId,now);
  return { targetId, targetVersion: 1, status: r.configured ? 'available' : 'not-configured',
    externalEvidence: 'unverified-source-reports', sourceFeedConnected: onlineFeed.connected,onlineFeed,
    totalCandidates: (BigInt(t.end)-BigInt(t.start)).toString(),
    externalReportedCandidates: count(r.external), activeSnapshots: r.active.length,
    historicalSnapshots: r.imports.length,
    inactiveSnapshots: r.imports.length-r.active.length,
    ownAllocatedCandidates: count(r.own),
    ownCheckpointedCandidates: count(r.own.filter(j => BigInt(j.next) > BigInt(j.start)).map(j => ({start:j.start,end:j.next}))),
    ownEvidence: 'controller checkpoints; separate from external reports; not exhaustive-search attestation',
    policy: r.mode==='own-only'?'own-history-only':'prefer-unreported-then-fallback', permanentlyExcludedByExternalReports: '0',
    dispatchEnabled: false };
}

export function coverageFeedSummary(db,targetId,now=Date.now()) {
  clock(now);
  if(coveragePolicy(db,targetId)==='own-only')return {status:'disabled-by-owner',connected:false,exactRangeMapConnected:false,
    exactIntervalsImportedFromPublicFeed:0,reason:'Owner chose own search history only; external reads and imports are disabled.'};
  const hasTable=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='coverage_feed_state'").get();
  const row=hasTable?db.prepare('SELECT * FROM coverage_feed_state WHERE target=? ORDER BY last_attempt DESC LIMIT 1').get(targetId):null;
  if(!row)return {status:'not-configured',connected:false,exactRangeMapConnected:false};
  const fresh=row.last_success!==null&&row.last_success<=now&&now<row.last_success+600000;
  const observation=row.payload?JSON.parse(row.payload):null;
  if(row.source==='https://starnetlive.space/') {
    const current=['refreshing','exact-range-reports','unavailable'].includes(row.status)?row.status:'unavailable';
    const snapshot=observation?.snapshotId?db.prepare('SELECT state,expires FROM coverage_imports WHERE id=?').get(observation.snapshotId):null;
    const active=Boolean(snapshot&&snapshot.state==='active'&&now<snapshot.expires);
    return {source:row.source,status:current==='exact-range-reports'&&!fresh?'stale':current,
      connected:fresh&&current==='exact-range-reports',exactRangeMapConnected:active,
      scope:'public-listed-worker-histories; global-completeness-unverified',
      lastAttemptAt:new Date(row.last_attempt).toISOString(),
      lastSuccessAt:row.last_success===null?null:new Date(row.last_success).toISOString(),
      nextRefreshAt:new Date(row.next_refresh).toISOString(),
      error:['source_schema_rejected','source_response_rejected','source_timeout','source_fetch_failed'].includes(row.error)?row.error:null,
      listedProfilesRead:observation?.listedProfilesRead??0,completedRecordsRead:observation?.completedRecordsRead??0,
      exactIntervalsImportedFromPublicFeed:active?observation.exactIntervalsImported:0,
      reason:'Exact inclusive source endpoints normalized to half-open intervals; source reports influence priority only.'};
  }
  const statuses=['refreshing','masked-range-data','exact-boundaries-unavailable','unavailable'];
  const current=statuses.includes(row.status)?row.status:'unavailable';
  return {status:current==='unavailable'||current==='refreshing'?current:fresh?current:'stale',
    connected:fresh&&current!=='unavailable'&&current!=='refreshing',exactRangeMapConnected:false,
    scope:'recent-sample-only',lastAttemptAt:new Date(row.last_attempt).toISOString(),
    lastSuccessAt:row.last_success===null?null:new Date(row.last_success).toISOString(),
    nextRefreshAt:new Date(row.next_refresh).toISOString(),
    error:['source_schema_rejected','source_response_rejected','source_timeout','source_fetch_failed'].includes(row.error)?row.error:null,
    reportedScannedRanges:observation?.reportedScannedRanges??null,totalPoolRanges:observation?.totalPoolRanges??null,
    maskedCompletedRecords:observation?.maskedCompletedRecords??null,recentRecords:observation?.recentRecords??null,
    exactIntervalsImportedFromPublicFeed:0,
    reason:'Public range prefixes hide a digit; exact intervals cannot be inferred from masks or percentages.'};
}

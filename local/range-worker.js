import { createHash, randomUUID } from 'node:crypto';
import { integer } from './solver.js';
import { workRequest } from './worker-protocol.js';
import { RANGE_BACKENDS, executeRange, validateRangeResult, rangeError } from './range-backends.js';

export const RANGE_ERRORS = Object.freeze(['interrupted', 'lease_expired', 'lease_fenced', 'checkpoint_changed',
  'invalid_result', 'worker_failed', 'worker_timeout', 'cuda_unavailable', 'binary_pin_rejected']);

export function initRangeWorker(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS range_attempts(
    id TEXT PRIMARY KEY, job TEXT NOT NULL, epoch INTEGER NOT NULL,
    start TEXT NOT NULL, end TEXT NOT NULL, backend TEXT NOT NULL,
    started INTEGER NOT NULL, finished INTEGER, state TEXT NOT NULL,
    error TEXT, payload TEXT, digest TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS range_one_inflight ON range_attempts(job) WHERE state='running';`);
}

function time(now) {
  if (!Number.isSafeInteger(now) || now < 0) throw rangeError('invalid_clock');
  return now;
}
function fence(job, epoch, now) {
  if (job.status !== 'running' || job.epoch !== epoch) throw rangeError('lease_fenced');
  if (now >= job.expires) throw rangeError('lease_expired');
}

// Operator-side orchestration of fixed solved fixtures. The child never receives
// the SQLite database, provider credentials, a wallet or an arbitrary target.
export class RangeWorker {
  constructor(controller, { backend = RANGE_BACKENDS[0], binaryPath,
    clock = () => Math.floor(Date.now() / 1000), execute = executeRange } = {}) {
    if (!RANGE_BACKENDS.includes(backend)) throw rangeError('unsupported_backend');
    this.controller = controller; this.backend = backend; this.binaryPath = binaryPath;
    this.clock = clock; this.execute = execute;
    initRangeWorker(controller.db);
  }
  recover() {
    const c = this.controller, now = time(this.clock());
    return c.transaction(() => {
      let recovered = 0;
      for (const attempt of c.db.prepare("SELECT * FROM range_attempts WHERE state='running'").all()) {
        const job = c.job(attempt.job);
        if (job.status === 'running' && job.epoch === attempt.epoch && now < job.expires) continue;
        c.db.prepare("UPDATE range_attempts SET state='interrupted',finished=?,error=? WHERE id=?")
          .run(now, job.epoch !== attempt.epoch ? 'lease_fenced' : 'lease_expired', attempt.id);
        recovered++;
      }
      return recovered;
    });
  }
  async chunk(jobId, epoch, size, { signal } = {}) {
    const c = this.controller;
    size = integer(size);
    if (!size) throw rangeError('invalid_chunk_size');
    if (signal?.aborted) throw rangeError('interrupted');
    this.recover();
    // Persist intent before launching. The unique inflight index blocks two
    // processes from executing the same assigned chunk at the same time.
    const { id, request } = c.transaction(() => {
      const job = c.job(jobId), now = time(this.clock());
      fence(job, epoch, now);
      if (job.next === job.end) throw rangeError('range_finished');
      if (c.db.prepare("SELECT id FROM range_attempts WHERE job=? AND state='running'").get(jobId))
        throw rangeError('chunk_inflight');
      const end = BigInt(job.next) + size < BigInt(job.end) ? BigInt(job.next) + size : BigInt(job.end);
      const request = workRequest({ protocol: 1, job: jobId, epoch, fixture: job.fixture, start: job.next, end: String(end) });
      const id = randomUUID();
      c.db.prepare("INSERT INTO range_attempts(id,job,epoch,start,end,backend,started,state) VALUES (?,?,?,?,?,?,?,'running')")
        .run(id, jobId, epoch, request.start, request.end, this.backend, now);
      return { id, request };
    });
    try {
      const raw = await this.execute(request, { backend: this.backend, binaryPath: this.binaryPath, signal });
      if (signal?.aborted) throw rangeError('interrupted');
      const result = validateRangeResult(request, raw, this.backend);
      return c.transaction(() => {
        const job = c.job(jobId), now = time(this.clock());
        fence(job, epoch, now);
        if (job.next !== request.start) throw rangeError('checkpoint_changed');
        if (c.db.prepare('SELECT state FROM range_attempts WHERE id=?').get(id)?.state !== 'running')
          throw rangeError('lease_fenced');
        const payload = JSON.stringify({ schema: 'bithash.range-result.v1',
          job: createHash('sha256').update(jobId).digest('hex').slice(0,24), epoch,
          fixture: request.fixture, start: request.start, end: request.end,
          result: { backend: result.backend, attempted: result.attempted, matched: result.matched,
            elapsedNanoseconds: result.elapsedNanoseconds },
          evidence: 'local-known-answer-validation', hardwareVerified: false, coverageVerified: false });
        const digest = createHash('sha256').update(payload).digest('hex');
        // Result archive and cursor commit together. A crash cannot leave credited
        // work without a matching normalized result, or vice versa.
        c.db.prepare('INSERT INTO checkpoints VALUES (?,?,?)').run(jobId, epoch, request.end);
        c.db.prepare('UPDATE jobs SET next=? WHERE id=?').run(request.end, jobId);
        c.db.prepare("UPDATE range_attempts SET state='accepted',finished=?,payload=?,digest=? WHERE id=?")
          .run(now, payload, digest, id);
        return { id, request, result, digest, completed: request.end === job.end };
      });
    } catch (error) {
      const code = signal?.aborted ? 'interrupted' : RANGE_ERRORS.includes(error.code) ? error.code : 'worker_failed';
      c.transaction(() => c.db.prepare("UPDATE range_attempts SET state=?,finished=?,error=? WHERE id=? AND state='running'")
        .run(code === 'interrupted' ? 'interrupted' : 'failed', time(this.clock()), code, id));
      throw rangeError(code); // Never persist or echo native diagnostics/candidate output.
    }
  }
  async run(jobId, { chunkSize = '1', maxChunks = 16, signal, leaseSeconds = 30 } = {}) {
    if (!Number.isSafeInteger(maxChunks) || maxChunks < 1 || maxChunks > 1000) throw rangeError('invalid_chunk_limit');
    if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 300) throw rangeError('invalid_lease_duration');
    if (integer(chunkSize) < 1n) throw rangeError('invalid_chunk_size');
    this.recover();
    const c = this.controller, job = c.job(jobId);
    if (job.next === job.end) {
      if (['running','ready'].includes(job.status)) c.stop(jobId);
      return { state: 'completed', chunks: 0, next: job.next };
    }
    const lease = c.lease(jobId, time(this.clock()), leaseSeconds);
    let chunks = 0;
    while (chunks < maxChunks) {
      const result = await this.chunk(jobId, lease.epoch, chunkSize, { signal });
      chunks++;
      if (result.completed) { c.stop(jobId); return { state: 'completed', chunks, next: result.request.end }; }
    }
    return { state: 'paused-at-chunk-limit', chunks, next: c.job(jobId).next };
  }
}

export function rangeResultProof(db, digest) {
  if (!/^[a-f0-9]{64}$/.test(digest)) return null;
  const row = db.prepare("SELECT payload FROM range_attempts WHERE digest=? AND state='accepted'").get(digest);
  if (!row || createHash('sha256').update(row.payload).digest('hex') !== digest) return null;
  const p = JSON.parse(row.payload);
  if (p.schema !== 'bithash.range-result.v1' || !/^[a-f0-9]{24}$/.test(p.job) ||
      !['puzzle-1','puzzle-2','puzzle-3'].includes(p.fixture) ||
      p.hardwareVerified !== false || p.coverageVerified !== false ||
      p.evidence !== 'local-known-answer-validation' ||
      Object.keys(p).sort().join() !== ['schema','job','epoch','fixture','start','end','result','evidence','hardwareVerified','coverageVerified'].sort().join()) return null;
  const request = workRequest({ protocol:1,job:p.job,epoch:p.epoch,fixture:p.fixture,start:p.start,end:p.end });
  const r=p.result;
  if (Object.keys(r).sort().join() !== ['backend','attempted','matched','elapsedNanoseconds'].sort().join() ||
      !RANGE_BACKENDS.includes(r.backend) || integer(r.attempted)!==BigInt(request.end)-BigInt(request.start) ||
      typeof r.matched!=='boolean' || integer(r.elapsedNanoseconds)<1n) return null;
  return { schema:'bithash.range-proof.v1',digest,payload:row.payload,evidence:'local-known-answer-validation',
    hardwareVerified:false,coverageVerified:false };
}

export function rangeProjection(db, job, now) {
  const hasTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='range_attempts'").get();
  if (!hasTable) return null;
  const rows = db.prepare('SELECT * FROM range_attempts WHERE job=? ORDER BY started,rowid').all(job.id);
  if (!rows.length) return null;
  const latest = rows.at(-1);
  const liveAttempt = latest.state === 'running' && job.status === 'running' && latest.epoch === job.epoch && now < job.expires;
  const state = latest.state === 'running' ? (liveAttempt ? 'running' : 'interrupted') : latest.state;
  const accepted = rows.filter(r => r.state === 'accepted');
  return { schema: 'bithash.range-worker.v1', backend: RANGE_BACKENDS.includes(latest.backend) ? latest.backend : 'other',
    state: job.next === job.end ? 'completed' : state,
    assigned: { start: job.start, end: job.end }, next: job.next,
    acceptedChunks: accepted.length, failedAttempts: rows.filter(r => r.state === 'failed').length,
    interruptedAttempts: rows.filter(r => r.state === 'interrupted').length + (latest.state === 'running' && !liveAttempt ? 1 : 0),
    lastError: RANGE_ERRORS.includes(latest.error) ? latest.error : (latest.state === 'running' && !liveAttempt ? 'lease_expired' : null),
    lastFinishedAt: latest.finished === null ? null : new Date(latest.finished * 1000).toISOString(),
    // Fixed public fixture ranges only. No native output, candidate keys, provider
    // identity, database path, environment or signing material in the public view.
    records: rows.slice(-20).map(r => ({ start: r.start, end: r.end,
      state: r.state === 'running' && (r.epoch !== job.epoch || now >= job.expires || job.status !== 'running') ? 'interrupted' : r.state,
      error: RANGE_ERRORS.includes(r.error) ? r.error : null,
      digest: r.state === 'accepted' && /^[a-f0-9]{64}$/.test(r.digest ?? '') ? r.digest : null })),
    recordsLimit: 20, evidence: 'local-known-answer-validation', hardwareVerified: false, coverageVerified: false };
}

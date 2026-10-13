import { createHash, createPublicKey, sign, verify } from 'node:crypto';
import { workRequest, workResult } from './worker-protocol.js';
import { search } from './solver.js';

const domain = 'bithash.fixture-receipt.v1\n';
const digest = value => createHash('sha256').update(value).digest('hex');
function shape(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join() !== keys.sort().join()) throw Error('Invalid receipt schema');
}
function payload(value) {
  shape(value, ['schema', 'provider', 'build', 'request', 'result']);
  if (value.schema !== 'bithash.fixture-receipt.v1' || typeof value.provider !== 'string' ||
      value.provider.length > 200 || !/^sha256:[a-f0-9]{64}$/.test(value.build)) throw Error('Invalid receipt identity');
  const request = workRequest(value.request);
  const result = workResult(request, value.result);
  return { schema: value.schema, provider: value.provider, build: value.build, request,
    result: { protocol: result.protocol, requestDigest: result.requestDigest, backend: result.backend,
      attempted: result.attempted, matched: result.matched, elapsedNanoseconds: result.elapsedNanoseconds } };
}
export function signFixtureReceipt(value, privateKey) {
  const normalized = payload(value);
  return { payload: normalized, signature: sign(null, Buffer.from(domain + JSON.stringify(normalized)), privateKey).toString('base64') };
}

// Enrollment is an operator-side function, deliberately unavailable over HTTP.
// Only public keys are persisted; workers never receive controller credentials.
export class WorkerReceipts {
  constructor(controller) {
    this.controller = controller;
    controller.db.exec(`CREATE TABLE IF NOT EXISTS worker_identities (
      job TEXT NOT NULL, epoch INTEGER NOT NULL, public_key TEXT NOT NULL,
      provider TEXT NOT NULL, build TEXT NOT NULL, PRIMARY KEY(job,epoch));
      CREATE TABLE IF NOT EXISTS worker_receipts (
      id TEXT PRIMARY KEY, job TEXT NOT NULL, epoch INTEGER NOT NULL,
      start TEXT NOT NULL, end TEXT NOT NULL, received_at INTEGER NOT NULL,
      payload TEXT NOT NULL, signature TEXT NOT NULL, UNIQUE(job,epoch,start));`);
  }
  enroll(jobId, epoch, publicKey, build) {
    const key = createPublicKey(publicKey);
    if (key.asymmetricKeyType !== 'ed25519' || !/^sha256:[a-f0-9]{64}$/.test(build)) throw Error('Invalid worker identity');
    const pem = key.export({ type: 'spki', format: 'pem' }).toString();
    return this.controller.transaction(() => {
      const job = this.controller.job(jobId);
      if (job.status !== 'running' || job.epoch !== epoch || !job.provider) throw Error('Worker requires assigned lease');
      const old = this.controller.db.prepare('SELECT * FROM worker_identities WHERE job=? AND epoch=?').get(jobId, epoch);
      if (old) {
        if (old.public_key !== pem || old.provider !== job.provider || old.build !== build) throw Error('Conflicting enrollment');
        return;
      }
      this.controller.db.prepare('INSERT INTO worker_identities VALUES (?,?,?,?,?)').run(jobId, epoch, pem, job.provider, build);
    });
  }
  accept(envelope, now = Math.floor(Date.now() / 1000)) {
    if (!Number.isSafeInteger(now) || now < 0) throw Error('Invalid clock');
    shape(envelope, ['payload', 'signature']);
    if (typeof envelope.signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature)) throw Error('Invalid signature');
    const p = payload(envelope.payload), serialized = JSON.stringify(p), id = digest(domain + serialized);
    const r = p.request, c = this.controller;
    return c.transaction(() => {
      const identity = c.db.prepare('SELECT * FROM worker_identities WHERE job=? AND epoch=?').get(r.job, r.epoch);
      if (!identity || identity.provider !== p.provider || identity.build !== p.build ||
          !verify(null, Buffer.from(domain + serialized), identity.public_key, Buffer.from(envelope.signature, 'base64')))
        throw Error('Worker authentication failed');
      // An already committed receipt can be acknowledged after expiry/restart;
      // this does not refresh a lease or add coverage a second time.
      if (c.db.prepare('SELECT id FROM worker_receipts WHERE id=?').get(id)) return { id, duplicate: true };
      const job = c.job(r.job);
      if (job.status !== 'running' || job.epoch !== r.epoch || now >= job.expires || job.provider !== p.provider)
        throw Error('Stale worker lease');
      if (job.fixture !== r.fixture || job.next !== r.start || BigInt(r.end) > BigInt(job.end)) throw Error('Noncontiguous worker receipt');
      // Tiny, solved fixtures only: independently reproduce the match outcome.
      // This still does not prove physical GPU execution or truthful timing.
      if (search(r.fixture, r.start, r.end).matched !== p.result.matched) throw Error('Fixture outcome mismatch');
      c.db.prepare('INSERT INTO worker_receipts VALUES (?,?,?,?,?,?,?,?)')
        .run(id, r.job, r.epoch, r.start, r.end, now, serialized, envelope.signature);
      c.db.prepare('INSERT INTO checkpoints VALUES (?,?,?)').run(r.job, r.epoch, r.end);
      c.db.prepare('UPDATE jobs SET next=? WHERE id=?').run(r.end, r.job);
      return { id, duplicate: false };
    });
  }
}

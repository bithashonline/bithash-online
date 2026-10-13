import { createHash } from 'node:crypto';
import { fixtures, integer } from './solver.js';
function shape(v, keys) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join() !== [...keys].sort().join()) throw Error('Invalid worker schema');
}
export function workRequest(r) {
  shape(r, ['protocol', 'job', 'epoch', 'fixture', 'start', 'end']);
  const f = fixtures.find(f => f.id === r.fixture);
  if (r.protocol !== 1 || typeof r.job !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(r.job) ||
    !Number.isSafeInteger(r.epoch) || r.epoch < 1 || !f) throw Error('Unsupported fixture request');
  const start = integer(r.start), end = integer(r.end);
  if (start < BigInt(f.start) || end > BigInt(f.end) || end <= start) throw Error('Outside solved fixture');
  return { protocol: 1, job: r.job, epoch: r.epoch, fixture: f.id, start: start.toString(), end: end.toString() };
}
export function requestDigest(r) { return createHash('sha256').update(JSON.stringify(workRequest(r))).digest('hex'); }
export function workResult(r, v) {
  r = workRequest(r);
  shape(v, ['protocol', 'requestDigest', 'backend', 'attempted', 'matched', 'elapsedNanoseconds']);
  if (v.protocol !== 1 || v.requestDigest !== requestDigest(r) || v.backend !== 'node-openssl-cpu-fixture' ||
    integer(v.attempted) !== BigInt(r.end) - BigInt(r.start) || typeof v.matched !== 'boolean' || integer(v.elapsedNanoseconds) < 1n)
    throw Error('Invalid worker result');
  return v;
}

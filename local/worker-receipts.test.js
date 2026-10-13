import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { once } from 'node:events';
import { Controller, MockProvider } from './controller.js';
import { WorkerReceipts, signFixtureReceipt } from './worker-receipts.js';
import { createWorkerServer } from './worker-api.js';
import { requestDigest } from './worker-protocol.js';
import { executeFixture } from './worker-runner.js';
import { search } from './solver.js';
import { dashboardSnapshot } from './dashboard-api.js';

const build = 'sha256:' + 'a'.repeat(64);
const keys = () => generateKeyPairSync('ed25519');
const pem = key => key.export({ format: 'pem', type: 'spki' }).toString();
async function setup(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'bithash-receipts-')), path = join(dir, 'state.sqlite');
  let c = new Controller(path);
  try {
    c.fund('test', 'bithash', '100'); c.plan('job', 'puzzle-3', '4', '8', '50');
    c.dispatch('job', new MockProvider(c)); c.lease('job', 100, 30);
    const key = keys(); const receipts = new WorkerReceipts(c);
    receipts.enroll('job', 1, pem(key.publicKey), build);
    await fn({ c, receipts, key, path, reopen: () => { c.close(); c = new Controller(path); return c; } });
  } finally { c.close(); assert.equal(dirname(resolve(dir)), resolve(tmpdir())); rmSync(dir, { recursive: true, force: true }); }
}
function value(start = '4', end = '6', epoch = 1) {
  const request = { protocol: 1, job: 'job', epoch, fixture: 'puzzle-3', start, end };
  return { schema: 'bithash.fixture-receipt.v1', provider: 'mock:job', build, request,
    result: { protocol: 1, requestDigest: requestDigest(request), backend: 'node-openssl-cpu-fixture', ...search('puzzle-3', start, end) } };
}
test('signed receipts survive restart, duplicates add no coverage, and later contiguous work advances', () => setup(({ c, receipts, key, path, reopen }) => {
  const first = signFixtureReceipt(value(), key.privateKey);
  assert.equal(receipts.accept(first, 101).duplicate, false);
  const resumed = reopen(), service = new WorkerReceipts(resumed);
  assert.equal(service.accept(first, 500).duplicate, true);
  assert.equal(resumed.job('job').next, '6');
  assert.equal(service.accept(signFixtureReceipt(value('6', '8'), key.privateKey), 102).duplicate, false);
  assert.equal(resumed.job('job').next, '8');
  const snapshot = dashboardSnapshot(path, 102000);
  assert.equal(snapshot.fixtures.items[0].authenticatedReceipts, 2);
  assert.match(snapshot.fixtures.items[0].evidence, /authenticated/);
  assert.equal(snapshot.fixtures.items[0].gpuVerified, false);
  assert.deepEqual(snapshot.live.rigs, []);
  assert.equal(JSON.stringify(snapshot).includes('PUBLIC KEY'), false);
}));
test('wrong key, altered signed result, wrong build/provider, unknown fields and wrong outcome are rejected', () => setup(({ c, receipts, key }) => {
  assert.throws(() => receipts.accept(signFixtureReceipt(value(), keys().privateKey), 101));
  const changed = signFixtureReceipt(value(), key.privateKey); changed.payload.result.elapsedNanoseconds = '1';
  assert.throws(() => receipts.accept(changed, 101));
  for (const patch of [{ build: 'sha256:' + 'b'.repeat(64) }, { provider: 'mock:other' }])
    assert.throws(() => receipts.accept(signFixtureReceipt({ ...value(), ...patch }, key.privateKey), 101));
  const falseResult = value(); falseResult.result.matched = !falseResult.result.matched;
  assert.throws(() => receipts.accept(signFixtureReceipt(falseResult, key.privateKey), 101));
  const extra = signFixtureReceipt(value(), key.privateKey); extra.payload.result.privateKey = 'must-not-store';
  assert.throws(() => receipts.accept(extra, 101));
  assert.equal(c.job('job').next, '4');
  assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM worker_receipts').get().n, 0);
}));
test('expired, replaced and terminated leases cannot submit new work', () => setup(({ c, receipts, key }) => {
  const signed = signFixtureReceipt(value(), key.privateKey);
  assert.throws(() => receipts.accept(signed, 130));
  c.lease('job', 130); assert.throws(() => receipts.accept(signed, 131));
  receipts.enroll('job', 2, pem(key.publicKey), build);
  c.stop('job'); assert.throws(() => receipts.accept(signFixtureReceipt(value('4', '6', 2), key.privateKey), 131));
  assert.equal(c.job('job').next, '4'); assert.equal(c.balance('reserved'), 50n);
}));
test('gaps, conflicting retries and enrollment replacement cannot change accepted work', () => setup(({ c, receipts, key }) => {
  assert.throws(() => receipts.accept(signFixtureReceipt(value('6', '8'), key.privateKey), 101));
  const accepted = value(); receipts.accept(signFixtureReceipt(accepted, key.privateKey), 101);
  accepted.result.elapsedNanoseconds = '1';
  assert.throws(() => receipts.accept(signFixtureReceipt(accepted, key.privateKey), 102));
  assert.throws(() => receipts.enroll('job', 1, pem(keys().publicKey), build));
  assert.equal(c.job('job').next, '6');
}));
test('database failure rolls back receipt and checkpoint together and permits retry', () => setup(({ c, receipts, key }) => {
  c.db.exec("CREATE TRIGGER fail_checkpoint BEFORE INSERT ON checkpoints BEGIN SELECT RAISE(ABORT, 'injected'); END");
  const signed = signFixtureReceipt(value(), key.privateKey);
  assert.throws(() => receipts.accept(signed, 101));
  assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM worker_receipts').get().n, 0);
  assert.equal(c.job('job').next, '4');
  c.db.exec('DROP TRIGGER fail_checkpoint'); assert.equal(receipts.accept(signed, 102).duplicate, false);
}));
test('HTTP accepts an actual subprocess result, rejects bad/oversize requests, and publishes sanitized status', () => setup(async ({ c, receipts, key, path }) => {
  const server = createWorkerServer(receipts, { databasePath: path, clock: () => 101 });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const root = `http://127.0.0.1:${server.address().port}`;
  const send = (body, contentType = 'application/json') => fetch(root + '/api/worker/receipts', { method: 'POST', headers: { 'content-type': contentType }, body });
  try {
    const p = value(); p.result = await executeFixture(p.request);
    const encoded = JSON.stringify(signFixtureReceipt(p, key.privateKey));
    assert.equal((await send(encoded)).status, 200);
    assert.equal((await (await send(encoded)).json()).duplicate, true);
    assert.equal((await send(encoded, 'text/plain')).status, 415);
    assert.equal((await send('x'.repeat(9000))).status, 413);
    assert.deepEqual(await (await send('{')).json(), { error: 'receipt_rejected' });
    assert.equal((await fetch(root + '/api/worker/receipts')).status, 405);
    assert.equal((await fetch(root + '/api/worker/enroll')).status, 404);
    const status = await (await fetch(root + '/api/status')).json();
    assert.equal(status.fixtures.items[0].authenticatedReceipts, 1);
    assert.equal(c.job('job').next, '6');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}));

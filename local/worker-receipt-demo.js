import { generateKeyPairSync, createHash } from 'node:crypto';
import { readFileSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { once } from 'node:events';
import { Controller, MockProvider } from './controller.js';
import { WorkerReceipts, signFixtureReceipt } from './worker-receipts.js';
import { createWorkerServer } from './worker-api.js';
import { executeFixture } from './worker-runner.js';
import { dashboardSnapshot } from './dashboard-api.js';

// Fresh persistent demo folder per run; ephemeral signing key stays in memory.
const dir = mkdtempSync(resolve('work/receipt-demo-')), path = join(dir, 'state.sqlite');
const key = generateKeyPairSync('ed25519');
const hash = createHash('sha256');
for (const file of ['fixture-worker.js', 'worker-protocol.js', 'solver.js']) {
  const data = readFileSync(new URL(file, import.meta.url));
  hash.update(file + '\n' + data.length + '\n'); hash.update(data);
}
const build = 'sha256:' + hash.digest('hex');
let controller = new Controller(path), server;
const results = [];
try {
  controller.fund('receipt-demo', 'bithash', '100');
  controller.plan('receipt-job', 'puzzle-3', '4', '8', '50');
  controller.dispatch('receipt-job', new MockProvider(controller));
  const lease = controller.lease('receipt-job', Math.floor(Date.now()/1000), 60);
  let receipts = new WorkerReceipts(controller);
  receipts.enroll(lease.id, lease.epoch, key.publicKey.export({ type: 'spki', format: 'pem' }), build);
  const request = { protocol: 1, job: lease.id, epoch: lease.epoch, fixture: lease.fixture, start: '4', end: '6' };
  const result = await executeFixture(request);
  const envelope = signFixtureReceipt({ schema: 'bithash.fixture-receipt.v1', provider: lease.provider, build, request, result }, key.privateKey);
  // Real local CPU subprocess; this harness signs its output. No remote/GPU claim.
  for (let attempt = 0; attempt < 2; attempt++) {
    server = createWorkerServer(receipts, { databasePath: path });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/worker/receipts`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(envelope)
    });
    if (!response.ok) throw Error('Demo receipt rejected');
    results.push(await response.json());
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); server = null;
    controller.close(); controller = new Controller(path); receipts = new WorkerReceipts(controller);
  }
  console.log(JSON.stringify({ mode: 'LOCAL SIGNED CPU FIXTURE / MOCK PROVIDER', spendingEnabled: false,
    transport: 'loopback HTTP', build, databasePath: path, submissions: results,
    snapshot: dashboardSnapshot(path), limitations: ['Signing harness is local; no remote attestation.',
      'No GPU execution, provider rental, treasury funding or AI connection.'] }, null, 2));
} finally {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  controller.close();
}

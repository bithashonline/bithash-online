import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AllocationLedger } from './policies.js';
import { fixturePolicy, fixtureReceipt } from './allocation-fixtures.js';

const dir = mkdtempSync(join(tmpdir(), 'allocation-demo-'));
const ledger = new AllocationLedger(join(dir, 'fixture.sqlite'));
try {
  for (const [coin, kind] of [['main', 'main'], ['child-a', 'child'], ['child-b', 'child']]) {
    const p = ledger.register(fixturePolicy(coin, kind));
    const r = fixtureReceipt(p, `fee-${coin}`, coin === 'child-b' ? '1' : '10001');
    ledger.allocate(r); ledger.allocate(r); // Deduplicated replay.
  }
  console.log(JSON.stringify({ fixturePercentagesNotApproved: true, provider: 'NOT CONNECTED',
    ...ledger.reportAllocations() }, null, 2));
} finally { ledger.close(); rmSync(dir, { recursive: true, force: true }); }

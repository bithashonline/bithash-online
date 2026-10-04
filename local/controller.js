import { DatabaseSync } from 'node:sqlite';
import { fixtures, integer, search } from './solver.js';

function time(t) { if (!Number.isSafeInteger(t) || t < 0) throw Error('Invalid clock'); return t; }
function positive(n) { n = integer(n); if (n <= 0n) throw Error('Expected positive amount'); return n; }
export function charge(seconds, rate, quantum = '1', minimum = '0') {
  seconds = integer(seconds); rate = positive(rate); quantum = positive(quantum); minimum = integer(minimum);
  const units = ((seconds + quantum - 1n) / quantum) * quantum;
  return (units > minimum ? units : minimum) * rate;
}
export class Controller {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS ledger(id TEXT PRIMARY KEY, debit TEXT NOT NULL, credit TEXT NOT NULL, amount TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, fixture TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL,
        next TEXT NOT NULL, status TEXT NOT NULL, epoch INTEGER NOT NULL, expires INTEGER NOT NULL,
        cap TEXT NOT NULL, billed TEXT NOT NULL DEFAULT '0', provider TEXT, seconds TEXT NOT NULL DEFAULT '0');
      CREATE TABLE IF NOT EXISTS mock_jobs(id TEXT PRIMARY KEY, provider TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS checkpoints(job TEXT, epoch INTEGER, next TEXT, PRIMARY KEY(job,epoch,next));`);
  }
  close() { this.db.close(); }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  post(id, debit, credit, amount) {
    amount = positive(amount).toString();
    const old = this.db.prepare('SELECT * FROM ledger WHERE id=?').get(id);
    if (old) {
      if (old.debit !== debit || old.credit !== credit || old.amount !== amount) throw Error('Conflicting ledger replay');
      return;
    }
    this.db.prepare('INSERT INTO ledger VALUES (?,?,?,?)').run(id, debit, credit, amount);
  }
  balance(account) {
    return this.db.prepare('SELECT * FROM ledger WHERE debit=? OR credit=?').all(account, account)
      .reduce((sum, e) => sum + (e.debit === account ? BigInt(e.amount) : -BigInt(e.amount)), 0n);
  }
  fund(receipt, coin, amount) {
    if (!receipt || !coin) throw Error('Receipt/coin required');
    // Synthetic USD microcredits, explicitly not SOL fees or a conversion.
    return this.transaction(() => this.post('fixture:' + receipt, 'available', 'contribution:' + coin, amount));
  }
  job(id) { const j = this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id); if (!j) throw Error('Unknown job'); return j; }
  plan(id, fixtureId, start, end, cap) {
    start = integer(start); end = integer(end); cap = positive(cap);
    const f = fixtures.find(f => f.id === fixtureId);
    if (!id || !f || start < BigInt(f.start) || end > BigInt(f.end) || end <= start) throw Error('Invalid fixture range');
    return this.transaction(() => {
      const existing = this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
      if (existing) {
        if (existing.fixture !== fixtureId || existing.start !== start.toString() || existing.end !== end.toString() || existing.cap !== cap.toString()) throw Error('Conflicting job replay');
        return existing;
      }
      for (const j of this.db.prepare('SELECT * FROM jobs WHERE fixture=?').all(fixtureId))
        if (start < BigInt(j.end) && end > BigInt(j.start)) throw Error('Overlapping range');
      if (cap > this.balance('available')) throw Error('Budget exhausted');
      this.post('reserve:' + id, 'reserved', 'available', cap);
      this.db.prepare('INSERT INTO jobs(id,fixture,start,end,next,status,epoch,expires,cap) VALUES (?,?,?,?,?,?,0,0,?)')
        .run(id, fixtureId, start.toString(), end.toString(), start.toString(), 'planned', cap.toString());
      return this.job(id);
    });
  }
  dispatch(id, provider) {
    // Only this exact built-in mock class is accepted. No flag can enable spending.
    if (!(provider instanceof MockProvider) || provider.constructor !== MockProvider || provider.controller !== this) throw Error('Spending disabled: mock only');
    this.transaction(() => {
      const j = this.job(id);
      if (j.status === 'unknown') throw Error('Reconcile ambiguous creation first');
      if (j.status !== 'planned') throw Error('Invalid dispatch state');
      this.db.prepare("UPDATE jobs SET status='unknown' WHERE id=?").run(id);
    });
    const providerId = provider.create(id); // Timeout deliberately leaves durable unknown + reserve.
    this.attach(id, providerId);
  }
  attach(id, providerId) {
    this.transaction(() => {
      if (this.job(id).status !== 'unknown' || !providerId) throw Error('Invalid reconciliation');
      this.db.prepare("UPDATE jobs SET status='ready',provider=? WHERE id=?").run(providerId, id);
    });
  }
  reconcile(id) {
    const p = this.db.prepare('SELECT provider FROM mock_jobs WHERE id=?').get(id);
    if (!p) throw Error('Provider outcome still unknown; reserve retained');
    this.attach(id, p.provider);
  }
  lease(id, now, duration = 30) {
    time(now); time(duration); if (!duration || !Number.isSafeInteger(now + duration)) throw Error('Invalid lease duration');
    return this.transaction(() => {
      const j = this.job(id);
      if (j.status !== 'ready' && !(j.status === 'running' && now >= j.expires)) throw Error('Lease unavailable');
      this.db.prepare("UPDATE jobs SET status='running',epoch=epoch+1,expires=? WHERE id=?").run(now + duration, id);
      return this.job(id);
    });
  }
  checkpoint(id, epoch, next, now) {
    next = integer(next); time(now);
    return this.transaction(() => {
      const j = this.job(id);
      if (j.status !== 'running' || j.epoch !== epoch || now >= j.expires) throw Error('Stale lease');
      if (next < BigInt(j.next) || next > BigInt(j.end)) throw Error('Invalid checkpoint');
      this.db.prepare('INSERT OR IGNORE INTO checkpoints VALUES (?,?,?)').run(id, epoch, next.toString());
      this.db.prepare('UPDATE jobs SET next=? WHERE id=?').run(next.toString(), id);
      return this.job(id);
    });
  }
  runChunk(id, epoch, size, now) {
    size = positive(size);
    const j = this.job(id);
    if (j.status !== 'running' || j.epoch !== epoch || time(now) >= j.expires) throw Error('Stale lease');
    const end = BigInt(j.next) + size < BigInt(j.end) ? BigInt(j.next) + size : BigInt(j.end);
    if (end === BigInt(j.next)) throw Error('Range finished');
    const result = search(j.fixture, j.next, end);
    this.checkpoint(id, epoch, end, now);
    return result;
  }
  settle(id, invoice, amount, seconds) {
    amount = integer(amount); seconds = integer(seconds); if (!invoice) throw Error('Invoice required');
    return this.transaction(() => {
      const j = this.job(id);
      if (j.status === 'settled') {
        if (j.billed !== amount.toString() || j.seconds !== seconds.toString() ||
          !this.db.prepare('SELECT id FROM ledger WHERE id=?').get('invoice:' + invoice + ':' + id)) throw Error('Conflicting settlement');
        return;
      }
      if (j.status !== 'work_done' || amount > BigInt(j.cap)) throw Error('Settlement requires completed/stopped work and bill within reserved cap');
      if (amount > 0n) this.post('invoice:' + invoice + ':' + id, 'expense', 'reserved', amount);
      else this.db.prepare('INSERT INTO ledger VALUES (?,?,?,?)').run('invoice:' + invoice + ':' + id, 'expense', 'reserved', '0');
      const release = BigInt(j.cap) - amount;
      if (release) this.post('release:' + id, 'available', 'reserved', release);
      this.db.prepare("UPDATE jobs SET status='settled',billed=?,seconds=? WHERE id=?").run(amount.toString(), seconds.toString(), id);
    });
  }
  stop(id) {
    return this.transaction(() => {
      const j = this.job(id);
      if (!['ready', 'running'].includes(j.status)) throw Error('Cannot stop unresolved job');
      // Local mock termination only; do not release liability until invoice settlement.
      this.db.prepare("UPDATE jobs SET status='work_done',epoch=epoch+1 WHERE id=?").run(id);
    });
  }
  report() {
    const jobs = this.db.prepare('SELECT * FROM jobs ORDER BY id').all();
    return { mode: 'LOCAL SOLVED FIXTURES / MOCK PROVIDER', spendingEnabled: false,
      realFeesLamports: '0', realProviderPaid: '0', uniqueCheckpointedCandidates: jobs.reduce((s,j) => s + BigInt(j.next) - BigInt(j.start), 0n).toString(),
      coverageEvidence: 'Durable contiguous checkpoints; local demo runs execute CPU checks. Imported worker reports would not prove exhaustive coverage.',
      simulatedMicroUSD: { available: this.balance('available').toString(), reserved: this.balance('reserved').toString(), expense: this.balance('expense').toString() }, jobs };
  }
}
export class MockProvider {
  constructor(controller, { timeoutAfterCreate = false } = {}) { this.controller = controller; this.timeoutAfterCreate = timeoutAfterCreate; }
  create(id) {
    const db = this.controller.db;
    db.prepare('INSERT OR IGNORE INTO mock_jobs VALUES (?,?)').run(id, 'mock:' + id);
    if (this.timeoutAfterCreate) throw Error('Simulated timeout after provider accepted');
    return db.prepare('SELECT provider FROM mock_jobs WHERE id=?').get(id).provider;
  }
}

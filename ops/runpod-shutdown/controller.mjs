import { DatabaseSync } from 'node:sqlite';
import { ProviderError, validPodId } from './provider.mjs';

const fields = ['schema','podId','expectedName','startedAt','notAfter','maxSpendMicrousd','hourlyCeilingMicrousd','shutdownHeadroomSeconds','deleteDisposablePod'];
const fail = code => { throw new Error(code); };
const amount = value => typeof value === 'string' && /^[1-9][0-9]{0,11}$/.test(value) ? BigInt(value) : fail('invalid_money');
const timestamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) ? Date.parse(value) : fail('invalid_timestamp');
export function validateLease(input) {
  if (!input || Object.keys(input).length !== fields.length || fields.some(k => !Object.hasOwn(input,k))) fail('invalid_lease_fields');
  if (input.schema !== 'bithash.shutdown-lease.v1' || !validPodId(input.podId)) fail('invalid_lease_identity');
  if (typeof input.expectedName !== 'string' || !/^bithash-[a-z0-9-]{1,64}$/.test(input.expectedName)) fail('invalid_expected_name');
  const started = timestamp(input.startedAt), notAfter = timestamp(input.notAfter);
  if (notAfter <= started || notAfter - started > 1800000) fail('maximum_30_minutes');
  const budget = amount(input.maxSpendMicrousd), rate = amount(input.hourlyCeilingMicrousd);
  if (!Number.isInteger(input.shutdownHeadroomSeconds) || input.shutdownHeadroomSeconds < 60 || input.shutdownHeadroomSeconds > 300) fail('invalid_headroom');
  if (typeof input.deleteDisposablePod !== 'boolean') fail('explicit_disposal_policy_required');
  const affordableMs = budget * 3600000n / rate;
  const deadline = started + Number(affordableMs < BigInt(notAfter - started) ? affordableMs : BigInt(notAfter - started));
  const triggerAt = deadline - input.shutdownHeadroomSeconds * 1000;
  if (triggerAt <= started) fail('insufficient_shutdown_headroom');
  return { policy: Object.fromEntries(fields.map(k => [k,input[k]])), started, deadline, triggerAt };
}

export class ShutdownController {
  #db; #provider; #clock; #busy = false;
  constructor(path, provider, { clock = Date.now } = {}) {
    this.#provider = provider; this.#clock = clock;
    this.#db = new DatabaseSync(path);
    this.#db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS shutdown_leases(
        pod TEXT PRIMARY KEY, policy TEXT NOT NULL, deadline INTEGER NOT NULL, trigger_at INTEGER NOT NULL,
        verified INTEGER NOT NULL DEFAULT 0, reason TEXT, phase TEXT NOT NULL DEFAULT 'registered',
        last_seen INTEGER NOT NULL DEFAULT 0, stop_attempts INTEGER NOT NULL DEFAULT 0,
        delete_attempts INTEGER NOT NULL DEFAULT 0, last_stop INTEGER, error TEXT);
      CREATE TABLE IF NOT EXISTS shutdown_events(
        seq INTEGER PRIMARY KEY, at INTEGER NOT NULL, pod TEXT NOT NULL, kind TEXT NOT NULL, code TEXT);
    `);
  }
  close() { this.#db.close(); }
  #event(id, now, kind, code = null) {
    this.#db.prepare('INSERT INTO shutdown_events(at,pod,kind,code) VALUES(?,?,?,?)').run(now,id,kind,code);
  }
  register(input) {
    const {policy,started,deadline,triggerAt} = validateLease(input), text = JSON.stringify(policy);
    if (started > this.#clock()) fail('future_start_rejected');
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const old = this.#db.prepare('SELECT policy FROM shutdown_leases WHERE pod=?').get(policy.podId);
      if (old && old.policy !== text) fail('immutable_lease_conflict');
      if (!old) {
        if (this.#db.prepare("SELECT count(*) AS n FROM shutdown_leases WHERE phase!='absence_observed'").get().n >= 8) fail('maximum_8_registered_pods');
        this.#db.prepare('INSERT INTO shutdown_leases(pod,policy,deadline,trigger_at) VALUES(?,?,?,?)').run(policy.podId,text,deadline,triggerAt);
        this.#event(policy.podId, this.#clock(), 'registered');
      }
      this.#db.exec('COMMIT');
    } catch (error) { this.#db.exec('ROLLBACK'); throw error; }
    return this.status().find(x => x.podId === policy.podId);
  }
  requestStopAll(reason = 'operator_stop') {
    if (!['operator_stop','controller_exit'].includes(reason)) fail('invalid_stop_reason');
    this.#db.prepare("UPDATE shutdown_leases SET reason=COALESCE(reason,?) WHERE phase!='absence_observed'").run(reason);
  }
  status() {
    return this.#db.prepare('SELECT * FROM shutdown_leases ORDER BY pod').all().map(row => ({
      podId: row.pod, deadline: new Date(row.deadline).toISOString(), triggerAt: new Date(row.trigger_at).toISOString(),
      identityVerified: Boolean(row.verified), reason: row.reason, phase: row.phase,
      stopAttempts: row.stop_attempts, deleteAttempts: row.delete_attempts, lastError: row.error,
      billingReconciled: false, permitsNewRental: false
    }));
  }
  events() { return this.#db.prepare('SELECT at,pod,kind,code FROM shutdown_events ORDER BY seq').all(); }
  #patch(id, values) {
    const columns = Object.keys(values);
    this.#db.prepare(`UPDATE shutdown_leases SET ${columns.map(k=>`${k}=?`).join(',')} WHERE pod=? AND phase!='absence_observed'`).run(...Object.values(values),id);
  }
  #latch(id, reason) { this.#db.prepare('UPDATE shutdown_leases SET reason=COALESCE(reason,?) WHERE pod=?').run(reason,id); }
  #failure(id, now, error) {
    const code = error instanceof ProviderError ? error.code : 'controller_operation_failed';
    this.#patch(id,{error:code}); this.#event(id,now,'request_failed',code);
  }
  async tick() {
    if (this.#busy) fail('tick_already_running');
    this.#busy = true;
    try {
      // Concurrent independent Pods prevent one slow API call delaying the entire fleet.
      const rows = this.#db.prepare("SELECT * FROM shutdown_leases WHERE phase!='absence_observed'").all();
      await Promise.all(rows.map(row=>this.#step(row)));
      return this.status();
    } finally { this.#busy = false; }
  }
  async #step(row) {
    const policy = JSON.parse(row.policy), id = row.pod;
    const wall = this.#clock();
    if (!Number.isSafeInteger(wall) || wall < 0) fail('invalid_clock');
    const now = Math.max(wall,row.last_seen);
    this.#patch(id,{last_seen:now});
    if (wall < row.last_seen) this.#latch(id,'clock_rollback');
    if (now >= row.trigger_at) this.#latch(id,'deadline_or_budget');
    let pod, readOk = false;
    try {
      pod = await this.#provider.get(id); readOk = true;
      if (!pod) {
        this.#patch(id,{phase:'absence_observed',error:null}); this.#event(id,now,'provider_404_observed'); return;
      }
      if (pod.id !== id || pod.name !== policy.expectedName) {
        this.#patch(id,{verified:0,error:'identity_mismatch'}); this.#event(id,now,'identity_mismatch'); return;
      }
      this.#patch(id,{verified:1,error:null}); row.verified = 1;
      if (BigInt(pod.hourlyMicrousd) > BigInt(policy.hourlyCeilingMicrousd)) this.#latch(id,'rate_exceeded');
    } catch (error) { this.#failure(id,now,error); }
    row = this.#db.prepare('SELECT * FROM shutdown_leases WHERE pod=?').get(id);
    if (!row.reason) return;
    // A previously checked ID remains stoppable even when the next GET times out.
    // Deletion always requires a fresh matching identity/storage observation.
    if (!row.verified) { this.#patch(id,{error:'identity_unverified'}); return; }
    const stopObserved = readOk && pod && ['EXITED','TERMINATED'].includes(pod.desiredStatus);
    if (stopObserved) this.#patch(id,{phase:'provider_expected_stopped'});
    const canDelete = readOk && pod && policy.deleteDisposablePod && pod.volumeInGb === 0 && pod.networkVolumeId === null;
    // Try stop first. A rejected/ambiguous stop does not suppress authorized deletion.
    if (canDelete && (stopObserved || row.stop_attempts > 0)) {
      this.#db.prepare("UPDATE shutdown_leases SET phase='delete_pending',delete_attempts=delete_attempts+1 WHERE pod=? AND phase!='absence_observed'").run(id);
      this.#event(id,now,'delete_intent');
      try { await this.#provider.delete(id); this.#event(id,now,'delete_accepted'); }
      catch (error) { this.#failure(id,now,error); }
      return;
    }
    if (stopObserved) {
      if (policy.deleteDisposablePod && !canDelete) this.#patch(id,{error:'storage_disposal_blocked'});
      return; // Keep polling; expectedStatus is not a final bill or proof of physical state.
    }
    this.#db.prepare("UPDATE shutdown_leases SET phase='stop_pending',stop_attempts=stop_attempts+1,last_stop=? WHERE pod=? AND phase!='absence_observed'").run(now,id);
    this.#event(id,now,'stop_intent');
    try { await this.#provider.stop(id); this.#event(id,now,'stop_accepted'); }
    catch (error) { this.#failure(id,now,error); }
  }
}

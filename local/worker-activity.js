import { createHash, sign, verify } from 'node:crypto';

const domain = 'bithash.worker-activity.v1\n';
function normalize(p) {
  const fields = ['schema','job','epoch','provider','build','sequence','state','device','utilizationPercent','candidatesPerSecond'];
  if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).sort().join() !== fields.sort().join()) throw Error('Invalid activity schema');
  if (p.schema !== 'bithash.worker-activity.v1' || !/^[a-zA-Z0-9_-]{1,100}$/.test(p.job) || typeof p.job !== 'string' ||
      !Number.isSafeInteger(p.epoch) || p.epoch < 1 || !Number.isSafeInteger(p.sequence) || p.sequence < 1 ||
      typeof p.provider !== 'string' || p.provider.length > 200 || typeof p.build !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(p.build) ||
      !['idle','computing','error'].includes(p.state) || !['cpu-fixture','rtx-a5000','rtx-4090','rtx-5090','other'].includes(p.device) ||
      !(p.utilizationPercent === null || (Number.isInteger(p.utilizationPercent) && p.utilizationPercent >= 0 && p.utilizationPercent <= 100)) ||
      !(p.candidatesPerSecond === null || (typeof p.candidatesPerSecond === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(p.candidatesPerSecond)))) throw Error('Invalid activity fields');
  return Object.fromEntries(fields.map(k => [k,p[k]]));
}
export function signWorkerActivity(payload, privateKey) {
  const p = normalize(payload);
  return { payload:p, signature:sign(null,Buffer.from(domain + JSON.stringify(p)),privateKey).toString('base64') };
}

// Authenticated reports remain worker claims, never coverage or spending authority.
export class WorkerActivity {
  constructor(controller) {
    this.controller = controller;
    controller.db.exec(`CREATE TABLE IF NOT EXISTS worker_activity (
      job TEXT NOT NULL, epoch INTEGER NOT NULL, sequence INTEGER NOT NULL,
      digest TEXT NOT NULL, received_at INTEGER NOT NULL, state TEXT NOT NULL,
      device TEXT NOT NULL, utilization INTEGER, rate TEXT, PRIMARY KEY(job,epoch));`);
    controller.db.exec(`CREATE TABLE IF NOT EXISTS worker_activity_history (
      id INTEGER PRIMARY KEY, job TEXT NOT NULL, epoch INTEGER NOT NULL,
      sequence INTEGER NOT NULL, received_at INTEGER NOT NULL, digest TEXT NOT NULL,
      envelope TEXT NOT NULL, UNIQUE(job,epoch,sequence));`);
  }
  accept(envelope, now = Math.floor(Date.now()/1000)) {
    if (!Number.isSafeInteger(now) || now < 0 || !envelope || Object.keys(envelope).sort().join() !== 'payload,signature' ||
        typeof envelope.signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature)) throw Error('Invalid activity envelope');
    const p = normalize(envelope.payload), bytes = Buffer.from(domain + JSON.stringify(p));
    const digest = createHash('sha256').update(bytes).digest('hex'), c = this.controller;
    return c.transaction(() => {
      const identity = c.db.prepare('SELECT * FROM worker_identities WHERE job=? AND epoch=?').get(p.job,p.epoch);
      if (!identity || identity.provider !== p.provider || identity.build !== p.build ||
          !verify(null,bytes,identity.public_key,Buffer.from(envelope.signature,'base64'))) throw Error('Activity authentication failed');
      const job = c.job(p.job);
      if (job.status !== 'running' || job.epoch !== p.epoch || job.provider !== p.provider || now >= job.expires) throw Error('Stale activity lease');
      const old = c.db.prepare('SELECT * FROM worker_activity WHERE job=? AND epoch=?').get(p.job,p.epoch);
      if (old && now < old.received_at) throw Error('Activity clock rollback');
      if (old && p.sequence <= old.sequence) {
        if (old.digest === digest) return { duplicate:true };
        throw Error('Activity replay or conflict');
      }
      // Preserve existing evidence at capacity; archiving and alerts are required
      // before sustained fleet operation. Replays do not consume storage.
      if(c.db.prepare('SELECT COUNT(*) AS n FROM worker_activity_history').get().n>=100000)throw Error('Activity history capacity reached');
      c.db.prepare('INSERT INTO worker_activity_history(job,epoch,sequence,received_at,digest,envelope) VALUES (?,?,?,?,?,?)')
        .run(p.job,p.epoch,p.sequence,now,digest,JSON.stringify({payload:p,signature:envelope.signature}));
      c.db.prepare(`INSERT INTO worker_activity VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(job,epoch) DO UPDATE SET sequence=excluded.sequence,digest=excluded.digest,
        received_at=excluded.received_at,state=excluded.state,device=excluded.device,
        utilization=excluded.utilization,rate=excluded.rate`)
        .run(p.job,p.epoch,p.sequence,digest,now,p.state,p.device,p.utilizationPercent,p.candidatesPerSecond);
      return { duplicate:false };
    });
  }
}

export function activityProjection(row, job, nowSeconds) {
  if (!row) return { freshness:job.status === 'running' ? 'never-seen' : 'inactive', lastReceivedAt:null, evidence:'no-activity-report', hardwareVerified:false };
  const age = nowSeconds-row.received_at;
  const freshness = job.status !== 'running' ? 'inactive' : age < 0 ? 'clock-unknown' :
    nowSeconds >= job.expires || age >= 30 ? 'stale' : 'fresh';
  return { freshness, lastReceivedAt:new Date(row.received_at*1000).toISOString(),
    evidence:'authenticated-worker-claim', hardwareVerified:false,
    reported:{ state:row.state, device:row.device, utilizationPercent:row.utilization, candidatesPerSecond:row.rate } };
}

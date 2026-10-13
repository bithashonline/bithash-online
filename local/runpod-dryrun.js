import { createHash } from 'node:crypto';

const hash = text => createHash('sha256').update(text).digest('hex');
const imagePattern = /^[a-z0-9][a-z0-9./_-]*@sha256:[a-f0-9]{64}$/;
export function createPodPreview(job, imageName) {
  if (typeof imageName !== 'string' || !imagePattern.test(imageName)) throw Error('Pinned image digest required');
  if (!job || !['puzzle-1','puzzle-2','puzzle-3'].includes(job.fixture)) throw Error('Solved fixture required');
  const name = 'bithash-fixture-' + hash(String(job.id)).slice(0,24);
  return { method:'POST', url:'https://rest.runpod.io/v1/pods', body:{
    name, cloudType:'SECURE', computeType:'GPU', gpuTypeIds:['NVIDIA GeForce RTX 4090'], gpuCount:1,
    interruptible:false, imageName, containerDiskInGb:20, volumeInGb:5,
    ports:[], supportPublicIp:false, globalNetworking:false,
    env:{ BITHASH_MODE:'SOLVED_FIXTURE_ONLY', BITHASH_FIXTURE:job.fixture }
  }};
}

// No fetch, credentials or real provider transport exists in this class.
// SQLite models the remote outcome separately from the durable request intent.
export class RunpodDryRun {
  constructor(controller) {
    this.c=controller;
    controller.db.exec(`CREATE TABLE IF NOT EXISTS runpod_intents(
      job TEXT PRIMARY KEY, request TEXT NOT NULL, digest TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runpod_simulated_pods(
      job TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE, digest TEXT NOT NULL, state TEXT NOT NULL);`);
  }
  prepare(id,imageName) {
    return this.c.transaction(()=>{
      const job=this.c.job(id), request=JSON.stringify(createPodPreview(job,imageName)), digest=hash(request);
      const prior=this.c.db.prepare('SELECT * FROM runpod_intents WHERE job=?').get(id);
      if(prior){if(prior.digest!==digest)throw Error('Conflicting immutable rental intent');return JSON.parse(prior.request)}
      if(job.status!=='planned')throw Error('Expected planned reserved job');
      this.c.db.prepare('INSERT INTO runpod_intents VALUES (?,?,?)').run(id,request,digest);
      return JSON.parse(request);
    });
  }
  submit(id,{timeoutAfterAccept=false,timeoutBeforeAccept=false}={}) {
    const intent=this.c.transaction(()=>{
      const i=this.c.db.prepare('SELECT * FROM runpod_intents WHERE job=?').get(id);
      if(!i||this.c.job(id).status!=='planned')throw Error('Submission blocked; reconcile existing outcome');
      this.c.db.prepare("UPDATE jobs SET status='unknown' WHERE id=?").run(id);return i;
    });
    if(timeoutBeforeAccept)throw Error('Simulated timeout; outcome unknown');
    const providerId='dryrun-'+hash(id).slice(0,24);
    this.c.db.prepare('INSERT INTO runpod_simulated_pods VALUES (?,?,?,?)').run(id,providerId,intent.digest,'RUNNING');
    if(timeoutAfterAccept)throw Error('Simulated timeout; outcome unknown');
    this.reconcile(id);
    return providerId;
  }
  reconcile(id) {
    return this.c.transaction(()=>{
      const j=this.c.job(id), i=this.c.db.prepare('SELECT * FROM runpod_intents WHERE job=?').get(id);
      const p=this.c.db.prepare('SELECT * FROM runpod_simulated_pods WHERE job=?').get(id);
      if(!i||!p||p.digest!==i.digest||p.state!=='RUNNING')throw Error('Unresolved provider evidence; reservation retained');
      if(j.provider===p.id && ['ready','running'].includes(j.status))return p.id;
      if(j.status!=='unknown')throw Error('Invalid reconciliation state');
      this.c.db.prepare("UPDATE jobs SET status='ready',provider=? WHERE id=?").run(p.id,id);return p.id;
    });
  }
  terminate(id) {
    return this.c.transaction(()=>{
      const j=this.c.job(id),p=this.c.db.prepare('SELECT * FROM runpod_simulated_pods WHERE job=?').get(id);
      if(!p||j.provider!==p.id)throw Error('Unresolved instance identity');
      if(p.state==='TERMINATED'&&['work_done','settled'].includes(j.status))return;
      if(!['ready','running'].includes(j.status))throw Error('Invalid termination state');
      this.c.db.prepare("UPDATE runpod_simulated_pods SET state='TERMINATED' WHERE job=?").run(id);
      this.c.db.prepare("UPDATE jobs SET status='work_done',epoch=epoch+1 WHERE id=?").run(id);
      // Provider termination is simulated. Money remains reserved until invoice settlement.
    });
  }
  snapshot() {
    return {mode:'RUNPOD_DRY_RUN',networkEnabled:false,spendingEnabled:false,
      intents:this.c.db.prepare('SELECT job,digest FROM runpod_intents ORDER BY job').all(),
      instances:this.c.db.prepare('SELECT id,state FROM runpod_simulated_pods ORDER BY id').all()};
  }
}

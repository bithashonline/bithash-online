import {OwnRangeLedger,ownRangeSummary} from '../../local/own-range-ledger.js';
import {approvedRangeMission} from '../../local/own-range-approval.js';
import {digest,recoveryPublic,nativeResult,PROBE_KEY,LOWER} from '../../local/own-range-protocol.js';
const shape=(o,keys)=>o&&Object.keys(o).sort().join()===keys.split(',').sort().join();
export class RangeBridge {
 constructor(executor,config){
  this.executor=executor;this.config=config;
  if(!shape(config,'jobId,start,end,solverSha256,archiveSha256,build,image,bootstrap,recoveryPublicKey,origin,chunkSize')||
   !/^sha256:[a-f0-9]{64}$/.test(config.build)||! /^[a-f0-9]{64}$/.test(config.archiveSha256)||
   !/^runpod\/base@sha256:[a-f0-9]{64}$/.test(config.image)||config.origin!=='https://telemetry.bithash.online'||
   typeof config.bootstrap!=='string'||BigInt(config.chunkSize)<1n||BigInt(config.chunkSize)>1048576n)throw Error('invalid_range_deployment');
  this.recipient=recoveryPublic(config.recoveryPublicKey);
  this.ledger=new OwnRangeLedger({db:executor.db,transaction:fn=>executor.tx(fn)},{authorizeApproval:(a,job)=>
   digest(a)===digest(approvedRangeMission(executor.snapshot(),job,executor.clock()))});
  const job=this.ledger.reserve(config.jobId,'puzzle-71',String(BigInt(config.end)-BigInt(config.start)),config.solverSha256);
  if(job.start!==config.start||job.end!==config.end)throw Error('range_plan_conflict');
 }
 mission(){const c=this.config,job=this.ledger.row(c.jobId);if(['completed','private-review'].includes(job.state)||job.state==='leased'&&job.expires>this.executor.clock())throw Error('range_job_unavailable');
  return {jobId:job.id,targetId:job.target,start:job.start,end:job.end,solverSha256:job.solver,recoveryKeyId:this.recipient.keyId,chunkSize:c.chunkSize};}
 artifacts(terms){
  const c=this.config,m=terms.rangeMission;
  const expected={jobId:c.jobId,targetId:'puzzle-71',start:c.start,end:c.end,solverSha256:c.solverSha256,recoveryKeyId:this.recipient.keyId,chunkSize:c.chunkSize};
  if(digest(m)!==digest(expected))throw Error('deployment_changed_reapproval_required');return c;
 }
 async propose(input){if(!shape(input,'gpu,durationSeconds,capMicrousd,jobId')||input.jobId!==this.config.jobId)throw Error('invalid_range_terms');
  return this.executor.propose({gpu:input.gpu,durationSeconds:input.durationSeconds,capMicrousd:input.capMicrousd},{rangeMission:this.mission()});}
 enroll(run,publicKey){
  const t=JSON.parse(run.terms),a=this.artifacts(t),job=this.ledger.row(t.rangeMission.jobId);
  const capability=digest('bithash.range-capability.v1\n'+run.token),expiresAt=run.deadline-90000;
  let lease;
  if(job.state==='leased'&&job.public_key===publicKey&&job.pod===run.pod&&job.approval_digest===run.digest&&job.expires===expiresAt&&job.capability_hash===digest(capability))
   lease={jobId:job.id,epoch:job.epoch,capability,expiresAt};
  else lease=this.ledger.lease(job.id,{publicKey,providerPodId:run.pod,expiresAt,capability,
   recoveryPublicKey:a.recoveryPublicKey,approval:approvedRangeMission(this.executor.snapshot(),job,this.executor.clock())},this.executor.clock());
  return {schema:'bithash.own-range-worker-config.v1',backend:'bitcrack-cuda-exact-range',origin:a.origin,capability:lease.capability,caFile:null,
   stateDirectory:'/bithash-private/range-state',keyFile:'/bithash-private/key.pem',jobId:lease.jobId,epoch:lease.epoch,providerPodId:run.pod,
   expiresAt,chunkSize:a.chunkSize,solverSha256:a.solverSha256,binaryPath:'/bithash-private/worker/native/bithash-range',recoveryPublicKey:a.recoveryPublicKey,validationOnly:false};
 }
 summary(){return ownRangeSummary(this.executor.db);}
 checked(run){const t=JSON.parse(run.terms),j=this.ledger.row(t.rangeMission.jobId);return j.state==='completed'?String(BigInt(j.next)-BigInt(j.start)):'0';}
 validateArchive(p,t,r){
  if(!shape(p,'schema,id,podId,lease,build,result')||p.schema!=='bithash.worker-archive.v1'||p.id!==r.id||p.podId!==r.pod||p.lease!==r.lease||p.build!==t.build)throw Error('invalid_archive_identity');
  const v=p.result,q=v?.qualification,job=this.ledger.row(t.rangeMission.jobId);
  if(!shape(v,'schema,status,jobId,solverSha256,qualification,hardwareChecked,uniqueCoverageVerified')||v.schema!=='bithash.owned-range-result.v1'||
   !['completed','private-review'].includes(v.status)||job.state!==v.status||v.jobId!==job.id||v.solverSha256!==t.rangeMission.solverSha256||v.hardwareChecked!==true||v.uniqueCoverageVerified!==false||
   !shape(q,'schema,solverSha256,results,evidence')||q.schema!=='bithash.range-gpu-qualification.v1'||q.solverSha256!==job.solver||!Array.isArray(q.results)||q.results.length!==3)throw Error('invalid_range_archive');
  const spans=[[PROBE_KEY,PROBE_KEY+1n],[PROBE_KEY-1n,PROBE_KEY],[LOWER,PROBE_KEY+1n]];
  for(let i=0;i<3;i++)nativeResult({schema:'bithash.own-range-request.v1',jobId:'range-'+'0'.repeat(24),epoch:1,targetId:'range-probe-71',start:String(spans[i][0]),end:String(spans[i][1]),solverSha256:job.solver,providerPodId:r.pod,expiresAt:r.deadline-90000,recoveryKeyId:null},q.results[i]);
  if(v.status==='completed'&&job.next!==job.end)throw Error('incomplete_range_archive');return p;
 }
}

import {createHash} from 'node:crypto';

export const GPU_IDS = Object.freeze({'rtx-a5000':'NVIDIA RTX A5000','rtx-4090':'NVIDIA GeForce RTX 4090','rtx-5090':'NVIDIA GeForce RTX 5090'});
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const integer = (n,min,max) => Number.isSafeInteger(n)&&n>=min&&n<=max;
export const LIVE_BLOCKERS = Object.freeze([
 'Independent shutdown host and provider deletion permissions need live verification.',
 'A published, digest-pinned fixture worker image and receipt pipeline need verification.',
 'An all-in spending ceiling including storage and shutdown headroom is required.',
 'Owner approval must bind the complete deployment request and shutdown policy.',
 'Durable dispatch and ambiguous-create reconciliation are not connected.'
]);

// This adapter has no mutation method. Enabling rentals requires a separate,
// reviewed dispatcher; a caller-supplied boolean cannot bypass these gates.
export class RunpodV2ReadApi {
 constructor({apiKey,fetchImpl=fetch,clock=Date.now}) {
  if(typeof apiKey!=='string'||!apiKey.trim())throw Error('runpod_key_missing');
  this.key=apiKey;this.fetchImpl=fetchImpl;this.clock=clock;
 }
 async catalog(count=1) {
  if(!integer(count,1,10))throw Error('invalid_gpu_count');
  const filters={include:['AVAILABILITY'],product:['POD'],cloud:'SECURE',count,minCudaVersion:'12.8'};
  const query=new URLSearchParams({include:'AVAILABILITY',product:'POD',cloud:'SECURE',count:String(count),minCudaVersion:'12.8'});
  let r,body;
  try{r=await this.fetchImpl('https://api.runpod.io/v2/catalog/gpus?'+query,{method:'GET',headers:{Authorization:'Bearer '+this.key},redirect:'error',signal:AbortSignal.timeout(5000)});}catch{throw Error('runpod_catalog_unreachable');}
  if(!r.ok)throw Error('runpod_catalog_http_'+r.status);
  try{body=await r.json();}catch{throw Error('runpod_catalog_invalid_json');}
  if(!Array.isArray(body?.gpus))throw Error('runpod_catalog_invalid_schema');
  return catalogEvidence({observedAt:new Date(this.clock()).toISOString(),filters,gpus:body.gpus},this.clock());
 }
}

export function catalogEvidence(raw,now=Date.now()) {
 const f=raw?.filters,t=Date.parse(raw?.observedAt);
 if(!Number.isFinite(t)||t>now+5000||f?.cloud!=='SECURE'||f?.minCudaVersion!=='12.8'||f?.product?.join()!=='POD'||f?.include?.join()!=='AVAILABILITY'||!integer(f?.count,1,10)||!Array.isArray(raw.gpus))throw Error('invalid_catalog_evidence');
 const rows=[];
 for(const [gpu,id] of Object.entries(GPU_IDS)) {
  const matches=raw.gpus.filter(g=>g.id===id);if(matches.length!==1)throw Error('missing_or_duplicate_gpu');
  const g=matches[0],price=g.price?.secure;
  if(g.secure!==true||typeof price!=='number'||!Number.isFinite(price)||price<=0||price>1000||!['NONE','LOW','MEDIUM','HIGH'].includes(g.availability))throw Error('invalid_catalog_gpu');
  rows.push({gpu,id,hourlyPerGpuMicrousd:String(Math.ceil(price*1e6)),availability:g.availability});
 }
 const record={schema:'bithash.runpod-catalog.v1',observedAt:new Date(t).toISOString(),filters:{cloud:'SECURE',product:'POD',count:f.count,minCudaVersion:'12.8'},rows,priceBasis:'per-GPU catalog compute rate; storage and other charges not included',limitations:'Availability is an observation, not a reservation or a count of free GPUs.'};
 return {record,sha256:hash(record),stale:now-t>60000,liveExecutionEnabled:false,blockers:[...LIVE_BLOCKERS]};
}

export function stageFixtureDeployment(evidence,{gpu,count,durationSeconds,image,diskGb=30,operationId},now=Date.now()) {
 // Only normalized, hash-bound observations from this adapter are accepted.
 const r=evidence?.record,t=Date.parse(r?.observedAt);
 if(!r||evidence.sha256!==hash(r)||r.schema!=='bithash.runpod-catalog.v1'||!Number.isFinite(t)||t>now||now-t>60000)throw Error('quote_stale_or_invalid');
 if(!integer(count,1,10)||r.filters.count!==count||r.filters.cloud!=='SECURE'||r.filters.minCudaVersion!=='12.8'||!integer(durationSeconds,60,1800)||!integer(diskGb,1,50))throw Error('invalid_deployment_limits');
 if(typeof image!=='string'||!/^ghcr\.io\/bithashonline\/[a-z0-9-]+@sha256:[a-f0-9]{64}$/.test(image)||!/^fixture-[a-z0-9-]{1,40}$/.test(operationId))throw Error('unpinned_fixture_request');
 const row=r.rows.find(g=>g.gpu===gpu);
 if(!row||row.id!==GPU_IDS[gpu]||!['LOW','MEDIUM','HIGH'].includes(row.availability)||!/^\d{1,12}$/.test(row.hourlyPerGpuMicrousd))throw Error('gpu_unavailable');
 const compute=(BigInt(row.hourlyPerGpuMicrousd)*BigInt(count)*BigInt(durationSeconds)+3599n)/3600n;
 const request={name:'bithash-'+operationId,image,cloud:'SECURE',gpu:{id:row.id,count,minCudaVersion:'12.8'},disk:diskGb,ports:[],startSsh:false,startJupyter:false,globalNetworking:false};
 const record={schema:'bithash.runpod-staged-request.v1',catalogDigest:evidence.sha256,request,durationSeconds,computeOnlyEstimateMicrousd:String(compute),allInCapMicrousd:null,workload:'solved-fixtures-only',imageVerified:false};
 return {record,sha256:hash(record),deployable:false,blockers:[...LIVE_BLOCKERS]};
}

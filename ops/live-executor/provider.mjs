import {RunpodV2ReadApi, GPU_IDS} from '../../local/runpod-v2.js';
export {GPU_IDS};
export class RunpodExecutorApi extends RunpodV2ReadApi {
 async request(path,{method='GET',body}={}) {
  let r;try{r=await this.fetchImpl('https://api.runpod.io/v2'+path,{method,headers:{Authorization:'Bearer '+this.key,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(10000)});}catch{throw Error('provider_outcome_unknown');}
  if(r.status===404&&method==='GET')return null;
  if(!r.ok)throw Error('provider_http_'+r.status);
  try{return await r.json();}catch{throw Error('provider_outcome_unknown');}
 }
 async inventory(){
  let cursor=null;const pods=[],seen=new Set();
  for(let page=0;page<100;page++){
   const r=await this.request('/pods?limit=100&includeClusterPods=true'+(cursor?'&cursor='+encodeURIComponent(cursor):''));
   if(!Array.isArray(r?.pods)||typeof r.pagination?.hasNextPage!=='boolean')throw Error('inventory_invalid');
   for(const p of r.pods){if(!/^[a-z0-9]{10,32}$/.test(p.id)||seen.has(p.id))throw Error('inventory_invalid');seen.add(p.id);pods.push(p);}
   if(!r.pagination.hasNextPage)return pods;
   if(typeof r.pagination.nextCursor!=='string'||!r.pagination.nextCursor||r.pagination.nextCursor===cursor)throw Error('inventory_invalid');cursor=r.pagination.nextCursor;
  }throw Error('inventory_incomplete');
 }
 create(body){return this.request('/pods',{method:'POST',body});}
 getPod(id){if(!/^[a-z0-9]{10,32}$/.test(id))throw Error('invalid_pod');return this.request('/pods/'+id);}
}

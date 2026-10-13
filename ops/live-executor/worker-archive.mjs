import {readFileSync} from 'node:fs';
import {validateResult} from '../../gpu/worker/core.mjs';
const vectors=JSON.parse(readFileSync(new URL('../../gpu/comparison/vectors.json',import.meta.url))).profiles;
const exact=(o,fields)=>o&&Object.keys(o).sort().join()===fields.split(',').sort().join();
export function validateArchive(p,terms,run){
 if(!exact(p,'schema,id,podId,lease,build,result')||p.schema!=='bithash.worker-archive.v1'||p.id!==run.id||p.podId!==run.pod||p.lease!==run.lease||p.build!==terms.build)throw Error('invalid_archive_identity');
 const r=p.result;
 if(!exact(r,'schema,status,workload,completedCases,candidatesChecked,puzzle71Candidates,uniqueCoverageVerified,deliveryFailed,results,build')||r.schema!=='bithash.supervised-worker-result.v1'||!['passed','failed'].includes(r.status)||r.workload!=='fixed-synthetic-known-answer'||r.build!==p.build||r.puzzle71Candidates!=='0'||r.uniqueCoverageVerified!==false||typeof r.deliveryFailed!=='boolean'||!Array.isArray(r.results)||r.results.length>512||r.completedCases!==r.results.length||!/^\d{1,30}$/.test(r.candidatesChecked??''))throw Error('invalid_archive_result');
 let count=0n;
 for(const c of r.results){
  const vector=vectors.find(v=>v.id==='small'&&v.mode===c?.mode);
  if(!vector)throw Error('invalid_archive_case');validateResult(JSON.stringify(c),vector);count+=BigInt(c.attempted);
 }
 if(count!==BigInt(r.candidatesChecked)||(r.status==='passed'&&(r.results.length<2||r.deliveryFailed)))throw Error('invalid_archive_count');
 return p;
}

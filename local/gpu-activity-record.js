import {createHash} from 'node:crypto';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const exact=(v,keys)=>v&&Object.keys(v).sort().join()===keys.slice().sort().join();
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
export const podOK=v=>typeof v==='string'&&/^[a-z0-9]{10,32}$/.test(v);
export const sourceUrlOK=v=>v===null||typeof v==='string'&&(/^\/api\/gpu-proof\/[a-f0-9]{64}$/.test(v)||/^https:\/\/github\.com\/bithashonline\/bithash-online\/blob\/[a-f0-9]{40}\/experiments\/[a-zA-Z0-9.-]+\.md$/.test(v));
const fields={
 'provider-observation':['status','gpuModel','gpuCount','hourlyUsd','evidence'],
 'controller-registration':['label','startedAt','deadline','maxSpendMicrousd','hourlyCeilingMicrousd','phase','billingReconciled'],
 'source-configuration':['workload','provenance','rangeAssignment','hardwareVerified','coverageVerified'],
 'reporting-context':['freshness','reportsInWindow','olderReportsExist','controllerHistoryTruncated'],
 'signed-worker-claim':['workerId','sequence','build','state','device','candidatesChecked','candidatesPerSecond','utilizationPercent'],
 'controller-event':['seq','kind','code']
};
export function validateActivityEvidence(e){
 if(!exact(e,['schema','podId','observedAt','fingerprint','sources'])||e.schema!=='bithash.gpu-activity-evidence.v1'||!podOK(e.podId)||!iso(e.observedAt)||!Array.isArray(e.sources)||!e.sources.length||e.sources.length>154)throw Error('invalid_activity_evidence');
 const ids=new Set();for(const s of e.sources){
  if(!exact(s,['id','kind','at','url','data'])||!fields[s.kind]||!exact(s.data,fields[s.kind])||! /^(provider|registration|workload|context|worker:[a-f0-9]{64}|controller:[1-9][0-9]{0,12})$/.test(s.id)||ids.has(s.id)||!(s.at===null||iso(s.at))||!sourceUrlOK(s.url))throw Error('invalid_activity_source');
  ids.add(s.id);for(const v of Object.values(s.data))if(v!==null&&!(typeof v==='string'&&v.length<=300||typeof v==='boolean'||typeof v==='number'&&Number.isSafeInteger(v)))throw Error('invalid_activity_source');
  if(s.kind==='signed-worker-claim'&&(s.id!=='worker:'+s.url?.split('/').at(-1)||!/^\/api\/gpu-proof\/[a-f0-9]{64}$/.test(s.url)))throw Error('invalid_activity_source');
 }
 if(hash({podId:e.podId,sources:e.sources.map(({at,...s})=>s)})!==e.fingerprint)throw Error('activity_fingerprint_mismatch');return e;
}
export function activityEvidence(d,now=Date.now()){
 if(d?.schema!=='bithash.gpu-detail.v1'||!podOK(d.podId)||!Array.isArray(d.entries)||d.entries.length>50||!Array.isArray(d.controllerEvents)||d.controllerEvents.length>100||!Array.isArray(d.workers))throw Error('invalid_gpu_detail');
 const age=now-Date.parse(d.observedAt);if(!Number.isFinite(age)||age< -5000||age>45000)throw Error('stale_gpu_detail');
 const sources=[],add=(id,kind,at,url,data)=>sources.push({id,kind,at,url,data});
 if(d.rental){const p=d.rental,age=now-Date.parse(p.observedAt);if(!Number.isFinite(age)||age< -5000||age>45000||p.id!==d.podId)throw Error('stale_provider_observation');add('provider','provider-observation',p.observedAt,null,Object.fromEntries(fields['provider-observation'].map(k=>[k,p[k]??null])));}
 if(d.registration){const r=d.registration;add('registration','controller-registration',r.startedAt,null,Object.fromEntries(fields['controller-registration'].map(k=>[k,r[k]??null])));}
 add('workload','source-configuration',null,sourceUrlOK(d.workloadEvidenceUrl)?d.workloadEvidenceUrl??null:null,{workload:d.workload??null,provenance:d.workloadProvenance??null,rangeAssignment:d.rangeAssignment??null,hardwareVerified:false,coverageVerified:false});
 const last=d.entries[0],worker=d.workers.find(w=>w.workerId===last?.workerId),reportAge=now-Date.parse(last?.receivedAt);
 const freshness=!last?'never-seen':worker?.revoked?'revoked':worker&&now>=Date.parse(worker.expiresAt)?'expired':reportAge< -5000?'clock-unknown':reportAge<30000?'fresh':'stale';
 add('context','reporting-context',null,null,{freshness,reportsInWindow:d.entries.length,olderReportsExist:d.olderCursor!==null,controllerHistoryTruncated:Boolean(d.controllerEventsTruncated)});
 for(const w of d.entries)add('worker:'+w.reportUrl?.split('/').at(-1),'signed-worker-claim',w.receivedAt,w.reportUrl,Object.fromEntries(fields['signed-worker-claim'].map(k=>[k,w[k]??null])));
 for(const c of d.controllerEvents)add('controller:'+c.seq,'controller-event',new Date(c.at).toISOString(),null,{seq:c.seq,kind:c.kind,code:c.code??null});
 const e={schema:'bithash.gpu-activity-evidence.v1',podId:d.podId,observedAt:d.observedAt,fingerprint:hash({podId:d.podId,sources:sources.map(({at,...s})=>s)}),sources};return validateActivityEvidence(e);
}
export function validateActivityAdvice(advice,evidence){
 const ids=new Set(evidence.sources.map(s=>s.id));
 const check=s=>{if(!exact(s,['text','sourceIds'])||typeof s.text!=='string'||!s.text.trim()||s.text.length>900||/https?:|javascript:|<\/?[a-z]/i.test(s.text)||!Array.isArray(s.sourceIds)||!s.sourceIds.length||s.sourceIds.length>4||new Set(s.sourceIds).size!==s.sourceIds.length||s.sourceIds.some(id=>!ids.has(id)))throw Error('invalid_activity_advice');};
 if(!exact(advice,['summary','updates'])||!Array.isArray(advice.updates)||advice.updates.length>6)throw Error('invalid_activity_advice');check(advice.summary);advice.updates.forEach(check);return advice;
}
export function activityRecord(report){
 if(!exact(report,['schema','podId','generatedAt','model','responseId','readOnly','executionEnabled','evidence','advice'])||report.schema!=='bithash.gpu-activity-report.v1'||!podOK(report.podId)||!iso(report.generatedAt)||Date.parse(report.generatedAt)>Date.now()+5000||!/^gpt-[a-zA-Z0-9._-]{1,60}$/.test(report.model??'')||typeof report.responseId!=='string'||!/^resp_[a-zA-Z0-9_-]{1,180}$/.test(report.responseId)||report.readOnly!==true||report.executionEnabled!==false)throw Error('invalid_activity_report');
 validateActivityEvidence(report.evidence);if(report.evidence.podId!==report.podId)throw Error('activity_rental_mismatch');validateActivityAdvice(report.advice,report.evidence);
 if(Buffer.byteLength(JSON.stringify(report))>65536)throw Error('activity_report_too_large');return {schema:'bithash.gpu-activity-record.v1',digest:hash(report),report};
}

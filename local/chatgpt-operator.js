import {createHash} from 'node:crypto';
import {operatorInstructions,operatorSchema,validateAdvice} from './operator.js';
import {RESOURCE} from './chatgpt-auth.js';

export function fleetEvidence(fleet,progress,now=Date.now()){
 if(fleet?.schema!=='bithash.fleet-status.v1'||fleet.source!=='runpod-read-only'||fleet.scope!=='registered-bithash-pods'||!Array.isArray(fleet.items)||fleet.items.length>100)throw Error('invalid_fleet');
 if(progress?.schema!=='bithash.remote-progress.v1'||progress.source!=='hosted-collector'||!Array.isArray(progress.items)||progress.items.length>100)throw Error('invalid_progress');
 for(const s of [fleet,progress]){const age=now-Date.parse(s.observedAt);if(!Number.isFinite(age)||age< -5000||age>45000)throw Error('stale_evidence');}
 const facts=[{id:'source',kind:'source',mode:'registered-fleet-observations',freshness:'fresh',scope:'registered-bithash-pods'},
 {id:'funding',kind:'funding',availableBudget:null,actualSpend:null,treasuryConnected:false,spending:'owner-approved-runs'}];
 for(const p of fleet.items){
  if(!/^[a-z0-9]{10,32}$/.test(p.id)||!['UNKNOWN','PROVISIONING','STARTING','RUNNING','EXITED','ERROR','TERMINATED','DELETED'].includes(p.status))throw Error('invalid_fleet');
  const age=now-Date.parse(p.observedAt);const fresh=Number.isFinite(age)&&age>=-5000&&age<=45000;
  facts.push({id:'rental:'+p.id,kind:'provider-observation',status:fresh?p.status:'UNKNOWN',observedAt:p.observedAt,proof:'https://bithash.online/api/fleet-status',proofType:'current-observation-not-immutable-receipt'});
 }
 for(const p of progress.items){
  if(p.kind!=='gpu')continue;
  if(!/^[a-f0-9]{32}$/.test(p.id)||!/^\/api\/gpu-proof\/[a-f0-9]{64}$/.test(p.proof??'')||(p.reported?.candidatesChecked!==null&&!/^\d{1,30}$/.test(p.reported?.candidatesChecked??''))||!['computing','idle','error'].includes(p.reported.state))throw Error('invalid_progress');
  const age=now-Date.parse(p.lastReceivedAt),fresh=Number.isFinite(age)&&age>=0&&age<30000&&Date.parse(p.expiresAt)>now;
  const rate=p.reported.candidatesPerSecond,util=p.reported.utilizationPercent;
  facts.push({id:'worker:'+p.id,kind:'authenticated-worker-claim',state:p.reported.state,freshness:fresh?'fresh':'historical',reportedCandidates:p.reported.candidatesChecked,reportedCandidatesPerSecond:typeof rate==='string'&&/^\d{1,30}$/.test(rate)?rate:null,reportedUtilizationPercent:Number.isInteger(util)&&util>=0&&util<=100?util:null,workload:p.build==='sha256:17e6a74ec89099ef934493871b380ae52fac22a67611b667849f132ab8b4021b'?'fixed-synthetic-known-answer':'unverified',hardwareVerified:false,coverageVerified:false,proof:'https://bithash.online'+p.proof});
 }
 const e={schema:'bithash.operator-evidence.v1',observedAt:new Date(now).toISOString(),facts};
 return {...e,digest:createHash('sha256').update(JSON.stringify(e)).digest('hex')};
}
export async function listModels(accessToken,fetcher=fetch){
 const r=await fetcher(RESOURCE+'/models',{headers:{Authorization:'Bearer '+accessToken},redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error('models_unavailable');const data=await r.json();
 if(!Array.isArray(data.models))throw Error('models_unavailable');
 return data.models.filter(m=>m.visibility==='list'&&typeof m.slug==='string'&&typeof m.display_name==='string').map(m=>({slug:m.slug,name:m.display_name}));
}
// Accept only a terminal completed event. A streamed delta is never a report.
export async function completedResponse(response){
 const contentType=response.headers.get('content-type');
 if(!response.ok||(contentType&&!contentType.includes('text/event-stream')))throw Error('model_request_failed');
 const reader=response.body.getReader(),decoder=new TextDecoder(),items=new Map();let buffer='',bytes=0,result=null;
 try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>1048576)throw Error('model_response_too_large');buffer+=decoder.decode(value,{stream:true});buffer=buffer.replace(/\r\n/g,'\n');
  let at;while((at=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,at);buffer=buffer.slice(at+2);const data=frame.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(!data||data==='[DONE]')continue;
   const event=JSON.parse(data);
   if(event.type==='response.output_item.done'){
    if(result||!Number.isSafeInteger(event.output_index)||event.output_index<0||event.output_index>20||!event.item||items.has(event.output_index))throw Error('invalid_model_output');
    items.set(event.output_index,event.item);
   }
   if(['error','response.failed','response.incomplete'].includes(event.type)){const code=event.response?.error?.code??event.error?.code??event.code;throw Error('model_stream_'+(/^[a-z_]{1,80}$/.test(code??'')?code:'failed'));}
   if(event.type==='response.completed'){if(result)throw Error('duplicate_completion');result=event.response;}
  }
 }}finally{await reader.cancel().catch(()=>{});}
 if(!result||result.status!=='completed')throw Error('model_incomplete');
 // Some plan responses leave terminal output empty; completed item events carry
 // the answer. Never promote partial text deltas to accepted output.
 if(Array.isArray(result.output)&&result.output.length===0&&items.size){const indices=[...items.keys()].sort((a,b)=>a-b);if(indices.some((n,i)=>n!==i))throw Error('invalid_model_output');result={...result,output:indices.map(n=>items.get(n))};}
 return result;
}
export async function planOperator(evidence,{accessToken,model,fetcher=fetch,now=Date.now()}={}){
 const age=now-Date.parse(evidence?.observedAt);
 if(evidence?.schema!=='bithash.operator-evidence.v1'||!Array.isArray(evidence.facts)||!Number.isFinite(age)||age< -5000||age>45000)throw Error('stale_evidence');
 if(!accessToken||typeof model!=='string'||!model)throw Error('chatgpt_plan_not_connected');
 const schema=structuredClone(operatorSchema);schema.properties.summary.maxLength=1600;schema.properties.proposals.maxItems=8;schema.properties.proposals.items.properties.reason.maxLength=500;schema.properties.proposals.items.properties.evidence.enum=evidence.facts.map(f=>f.id);
 try{
  const response=await fetcher(RESOURCE+'/responses',{method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),headers:{Authorization:'Bearer '+accessToken,'Content-Type':'application/json'},body:JSON.stringify({model,store:false,stream:true,instructions:operatorInstructions+' Write a summary under 1000 characters and at most 4 proposals, each reason under 300 characters. Each evidence field must be exactly ONE supplied fact ID, not a list or a citation sentence. Provider observations describe registered rentals only. Historical reports do not show current computation. Preserve those distinctions.',input:[{role:'user',content:JSON.stringify(evidence)}],text:{format:{type:'json_schema',name:'bithash_operator',strict:true,schema}}})});
  if(!response.ok){let code='unknown';try{const body=await response.json();if(/^[a-z_]{1,80}$/.test(body.error?.code??''))code=body.error.code;}catch{}throw Error('model_http_'+response.status+'_'+code);}
  const data=await completedResponse(response);
  if(!Array.isArray(data.output)||data.output.some(o=>!['message','reasoning'].includes(o.type)))throw Error('invalid_model_output');
  const content=data.output.filter(o=>o.type==='message').flatMap(o=>o.content??[]);
  if(content.some(c=>c.type==='refusal'))throw Error('model_refused');const texts=content.filter(c=>c.type==='output_text');
  if(texts.length!==1||typeof texts[0].text!=='string'||texts[0].text.length>8000)throw Error('invalid_model_output');
  return {schema:'bithash.operator-report.v1',mode:'model-review',authMode:'chatgpt-plan',modelConnected:true,model,readOnly:true,executionEnabled:false,generatedAt:new Date().toISOString(),evidence,advice:validateAdvice(JSON.parse(texts[0].text),evidence),warning:'AI interpretation; proposals require owner review. No actions executed.'};
 }catch(e){throw Error(/^(model_http_\d{3}_[a-z_]{1,80}|model_stream_[a-z_]{1,80}|model_request_failed|model_incomplete|invalid_model_output|invalid_advice|model_response_too_large|model_refused)$/.test(e.message)?e.message:'chatgpt_review_unavailable');}
}

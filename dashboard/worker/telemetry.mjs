// Only fixed read routes may reach the reporting bridge. No browser headers forward.
export async function telemetry(request,env,fetcher=fetch){
 const u=new URL(request.url),proof=/^\/api\/gpu-proof\/([a-f0-9]{64})$/.exec(u.pathname);
 const fleet=u.pathname==='/api/fleet-status';
 const gpuDetail=/^\/api\/gpu-detail\/([a-z0-9]{10,32})(?:\/([1-9][0-9]{0,14}))?$/.exec(u.pathname);
 const gpuActivity=/^\/api\/gpu-activity\/([a-z0-9]{10,32})$/.exec(u.pathname),gpuActivityProof=/^\/api\/gpu-activity-proof\/([a-f0-9]{64})$/.exec(u.pathname);
 const approvals=u.pathname==='/api/approvals',approvalProof=/^\/api\/approval-evidence\/([1-9][0-9]{0,8})$/.exec(u.pathname);
 const operator=u.pathname==='/api/operator',operatorProof=/^\/api\/operator-proof\/([a-f0-9]{64})$/.exec(u.pathname);
 const executor=u.pathname==='/api/executor/status',executorProof=/^\/api\/executor\/proof\/([a-f0-9]{64})$/.exec(u.pathname);
 const executorLog=/^\/api\/executor\/log\/([a-f0-9]{64})$/.exec(u.pathname);
 if(u.pathname!=='/api/gpu-progress'&&!proof&&!fleet&&!gpuDetail&&!gpuActivity&&!gpuActivityProof&&!operator&&!operatorProof&&!approvals&&!approvalProof&&!executor&&!executorProof&&!executorLog)return null;
 const reply=(data,status)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
 if(request.method!=='GET')return reply({error:'method_not_allowed'},405);
 if(u.search)return reply({error:'invalid_query'},400);
 if(!/^[a-f0-9]{64}$/.test(env.BITHASH_TELEMETRY_READ_TOKEN??''))return reply({error:'remote_collector_unavailable'},503);
 try{
  const r=await fetcher('https://telemetry.bithash.online'+u.pathname,{method:'GET',headers:{Authorization:'Bearer '+env.BITHASH_TELEMETRY_READ_TOKEN,Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(5000),cache:'no-store'});
  if(r.status===404&&(proof||operatorProof||approvalProof||gpuDetail||gpuActivity||gpuActivityProof||executorProof||executorLog))return reply({error:gpuDetail?'gpu_not_found':'proof_not_found'},404);
  if(!r.ok||!r.headers.get('content-type')?.includes('application/json'))throw Error();
  const reader=r.body.getReader();let chunks=[],size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>(executorLog?600000:executor?1000000:262144)){await reader.cancel();throw Error();}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  const data=JSON.parse(new TextDecoder().decode(bytes));
  if(executorLog){
   if(data.evidence!=='authenticated-worker-claim'||data.coverageVerified!==false||typeof data.envelope?.payload!=='string'||JSON.parse(data.envelope.payload).schema!=='bithash.worker-archive.v1')throw Error();
   const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(data.envelope)))),b=>b.toString(16).padStart(2,'0')).join('');if(digest!==data.digest||digest!==executorLog[1])throw Error();
  }else if(executor){
   const age=Date.now()-Date.parse(data.observedAt);if(data.schema!=='bithash.live-executor.v1'||data.mode!=='real-provider'||!Array.isArray(data.runs)||data.runs.length>100||!Number.isFinite(age)||age< -5000||age>15000)throw Error();
  }else if(executorProof){
   if(data.record?.schema!=='bithash.live-executor-event.v1')throw Error();
   const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(data.record)))),b=>b.toString(16).padStart(2,'0')).join('');if(digest!==data.digest||digest!==executorProof[1])throw Error();
  }else if(gpuActivity||gpuActivityProof){
   const rec=gpuActivity?data.record:data,p=rec?.report;
   if(rec?.schema!=='bithash.gpu-activity-record.v1'||p?.schema!=='bithash.gpu-activity-report.v1'||p.readOnly!==true||p.executionEnabled!==false||!Array.isArray(p.evidence?.sources)||p.evidence.sources.length>154||gpuActivity&&p.podId!==gpuActivity[1])throw Error();
   const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(p)))),b=>b.toString(16).padStart(2,'0')).join('');if(digest!==rec.digest||gpuActivityProof&&digest!==gpuActivityProof[1])throw Error();
   if(gpuActivity){const age=Date.now()-Date.parse(data.observedAt);if(data.schema!=='bithash.gpu-activity-snapshot.v1'||!Number.isFinite(Date.parse(data.syncReceivedAt))||!Number.isFinite(age)||age< -5000||age>15000)throw Error();}
  }else if(gpuDetail){
   const age=Date.now()-Date.parse(data.observedAt);
   if(data.schema!=='bithash.gpu-detail.v1'||data.podId!==gpuDetail[1]||data.hardwareVerified!==false||data.coverageVerified!==false||!Array.isArray(data.entries)||data.entries.length>50||!Array.isArray(data.workers)||data.workers.length>100||!Array.isArray(data.controllerEvents)||data.controllerEvents.length>100||!Number.isFinite(age)||age< -5000||age>15000)throw Error();
   if(data.entries.some(e=>!Number.isSafeInteger(e.cursor)||e.cursor<1||!/^\/api\/gpu-proof\/[a-f0-9]{64}$/.test(e.reportUrl))||!(data.olderCursor===null||Number.isSafeInteger(data.olderCursor)&&data.olderCursor>0))throw Error();
  }else if(approvals){
   if(data.schema!=='bithash.spending-approvals.v1'||data.mode!=='local-simulation'||data.readOnly!==true||data.liveExecutionEnabled!==false||!Array.isArray(data.proposals)||!Array.isArray(data.events)||!Number.isFinite(Date.parse(data.exportedAt))||!Number.isFinite(Date.parse(data.syncReceivedAt)))throw Error();
  }else if(approvalProof){
   if(data.proof?.schema!=='bithash.public-approval-proof.v1'||data.proof.seq!==Number(approvalProof[1])||data.proof.mode!=='local-simulation')throw Error();
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(data.proof)))),b=>b.toString(16).padStart(2,'0')).join('');
   if(hash!==data.digest)throw Error();
  }else if(operator||operatorProof){
   const record=operator?data.record:data;
   if(record?.schema!=='bithash.operator-record.v1'||! /^[a-f0-9]{64}$/.test(record.digest??'')||record.report?.schema!=='bithash.operator-report.v1'||record.report.executionEnabled!==false||record.report.readOnly!==true)throw Error();
   const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(record.report)))),b=>b.toString(16).padStart(2,'0')).join('');
   if(digest!==record.digest||(operatorProof&&digest!==operatorProof[1]))throw Error();
   if(operator){const age=Date.now()-Date.parse(data.observedAt);if(data.schema!=='bithash.operator-snapshot.v1'||!Number.isFinite(age)||age< -5000||age>15000)throw Error();}
  }else if(proof){
   if(data.schema!=='bithash.gpu-proof.v1'||data.digest!==proof[1]||data.hardwareVerified!==false||data.coverageVerified!==false)throw Error();
  }else if(fleet){
   if(data.schema!=='bithash.fleet-status.v1'||data.source!=='runpod-read-only'||data.scope!=='registered-bithash-pods'||!Array.isArray(data.items)||data.items.length>100)throw Error();
   const age=Date.now()-Date.parse(data.observedAt);if(!Number.isFinite(age)||age< -5000||age>45000)throw Error();
  }else{
   if(data.schema!=='bithash.remote-progress.v1'||data.source!=='hosted-collector'||!Array.isArray(data.items)||data.items.length>100||!Number.isSafeInteger(data.history?.records)||!Number.isSafeInteger(data.history?.capacity))throw Error();
   const age=Date.now()-Date.parse(data.observedAt);if(!Number.isFinite(age)||age< -5000||age>15000)throw Error();
  }
  return reply(data,200);
 }catch(error){console.warn('telemetry_proxy_failure');return reply({error:'remote_collector_unavailable'},503);}
}

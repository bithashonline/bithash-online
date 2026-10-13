// Only fixed read routes may reach the reporting bridge. No browser headers forward.
export async function telemetry(request,env,fetcher=fetch){
 const u=new URL(request.url),proof=/^\/api\/gpu-proof\/([a-f0-9]{64})$/.exec(u.pathname);
 const fleet=u.pathname==='/api/fleet-status';
 const operator=u.pathname==='/api/operator',operatorProof=/^\/api\/operator-proof\/([a-f0-9]{64})$/.exec(u.pathname);
 if(u.pathname!=='/api/gpu-progress'&&!proof&&!fleet&&!operator&&!operatorProof)return null;
 const reply=(data,status)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
 if(request.method!=='GET')return reply({error:'method_not_allowed'},405);
 if(u.search)return reply({error:'invalid_query'},400);
 if(!/^[a-f0-9]{64}$/.test(env.BITHASH_TELEMETRY_READ_TOKEN??''))return reply({error:'remote_collector_unavailable'},503);
 try{
  const r=await fetcher('https://telemetry.bithash.online'+u.pathname,{method:'GET',headers:{Authorization:'Bearer '+env.BITHASH_TELEMETRY_READ_TOKEN,Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(5000),cache:'no-store'});
  if(r.status===404&&(proof||operatorProof))return reply({error:'proof_not_found'},404);
  if(!r.ok||!r.headers.get('content-type')?.includes('application/json'))throw Error();
  const reader=r.body.getReader();let chunks=[],size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>262144){await reader.cancel();throw Error();}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  const data=JSON.parse(new TextDecoder().decode(bytes));
  if(operator||operatorProof){
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

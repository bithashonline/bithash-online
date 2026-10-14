import {createServer} from 'node:http';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {join,resolve} from 'node:path';
import {authorization,validateCallback,verifyIdentity,tokenRequest,tokenRecord,hasPlan,openStore,ISSUER} from './chatgpt-auth.js';
import {listModels,planOperator} from './chatgpt-operator.js';
import {readHostedEvidence} from './operator-evidence-ssh.js';
import {publishOperator} from './operator-publish.js';
import {chooseMission} from './operator-choice.js';
import {observeTestTreasury} from './treasury-devnet.js';
import {openGpuReporter} from './gpu-activity-reporter.js';
import {writeGpuActivity} from './gpu-activity-model.js';
import {readGpuActivities,publishGpuActivities} from './gpu-activity-transport.js';
import {executorConnection} from './live-executor-api.js';
import {draftLive} from './operator-live.js';

const [directory,configPath]=process.argv.slice(2);
if(!directory||!configPath)throw Error('Usage: chatgpt-operator-server.js PRIVATE_DIRECTORY CONNECTION_CONFIG');
const store=await openStore(directory),config=JSON.parse(await readFile(configPath,'utf8'));
const origin='http://127.0.0.1:4185',csrf=randomBytes(32).toString('hex'),session=randomBytes(32).toString('hex');
let pending=null,models=[],report=null,busy=false,lastReview=0,notice='Connect your ChatGPT plan to review fleet evidence.';
const gpuReporter=await openGpuReporter(directory,{enabled:config.gpuActivityReporting?.enabled===true,watchUntil:config.gpuActivityReporting?.watchUntil??0,model:config.gpuActivityReporting?.model??'gpt-6.1-sol',access:()=>store.access(),isBusy:()=>busy,setBusy:v=>{busy=v;},write:writeGpuActivity,publish:records=>publishGpuActivities(records,config),read:async()=>{
 const evidence=await readHostedEvidence(config),ids=evidence.facts.filter(f=>f.id.startsWith('rental:')).map(f=>f.id.slice(7)),details=[];
 for(let i=0;i<ids.length;i+=8)details.push(...await readGpuActivities(config,ids.slice(i,i+8)));return details;
}});
const reportFile=join(resolve(directory),'operator-report.json');
const missionFile=join(resolve(directory),'mission-draft.json');
const liveFile=join(resolve(directory),'live-proposal-draft.json'),liveCall=executorConnection(config);
try{report=JSON.parse(await readFile(reportFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw Error('invalid_saved_report');}
let publishedAt=null,publishTimer;
async function syncReport(){try{if(config.publishReports&&report&&hasPlan(store.state.accounts.find(a=>a.client_id===store.state.active))){await publishOperator(report,config);publishedAt=new Date().toISOString();}}catch{console.log('operator_status: report_sync_unavailable');}finally{publishTimer=setTimeout(syncReport,20000);}}
if(config.publishReports)syncReport();
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function page(){const active=store.state.accounts.find(a=>a.client_id===store.state.active);return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>BitHash · Operator connection</title><style>body{margin:0;background:#0d1210;color:#e6eddf;font:16px system-ui}main{max-width:780px;margin:7vh auto;padding:28px}small{color:#a3b789;letter-spacing:2px}h1{font-size:44px;letter-spacing:-2px;margin:14px 0}section{border:1px solid #354135;background:#141c17;padding:24px;margin:20px 0;border-radius:14px}p{line-height:1.65;color:#b8c6b6}button,select{padding:13px 18px;border-radius:8px;border:1px solid #52694d;background:#c4eea5;color:#152413;font:inherit;margin:6px 6px 6px 0}select{background:#202c23;color:#e6eddf;max-width:100%}a{color:#c4eea5}button:disabled{opacity:.4}label{display:block;margin:12px 0}li{margin:12px 0;line-height:1.5}</style><main><small>BITHASH / LOCAL OPERATOR</small><h1>Your plan. Your greenlight.</h1><p>The operator reads fleet observations and signed reports. It can explain activity and propose reviews. Rental and spending authority stay with your existing approval controls.</p><section><small>CHATGPT CONNECTION</small><p>${escape(notice)}</p><p>${active?escape(active.email??active.subject)+' · '+(hasPlan(active)?'Plan permission connected':'Sign-in required'):'No account connected'}</p><form method="post" action="/auth/start"><input type="hidden" name="csrf" value="${csrf}"><select name="account"><option value="">Add a ChatGPT account</option>${store.state.accounts.map(a=>`<option value="${escape(a.client_id)}" ${a.client_id===store.state.active?'selected':''}>${escape(a.email??a.subject)} · ${escape(a.client_id.slice(-8))}</option>`).join('')}</select><button>Continue with ChatGPT</button></form><p>Uses your ChatGPT allowance. No API-key billing fallback. Manage app limits and disable extra credits in <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">ChatGPT Usage settings</a>.</p>${active?`<form method="post" action="/disconnect"><input type="hidden" name="csrf" value="${csrf}"><button>Disconnect locally</button></form>`:''}</section><section><small>EVIDENCE REVIEW</small><p>Fleet review makes one model request; a test mission draft makes two. Page refreshes and dashboard polling never call the model. Reports remain visible with their timestamps when the operator is offline.</p><form method="post" action="/models"><input type="hidden" name="csrf" value="${csrf}"><button ${hasPlan(active)?'':'disabled'}>Load available models</button></form><form method="post" action="/review"><input type="hidden" name="csrf" value="${csrf}"><select name="model">${models.map(m=>`<option value="${escape(m.slug)}">${escape(m.name)}</option>`).join('')}</select><button ${models.length&&!busy?'':'disabled'}>Review current fleet</button><button formaction="/mission-plan" ${models.length&&!busy?'':'disabled'}>Draft test mission · 2 model requests</button></form><p>Drafts use synthetic pricing, up to 5 workers, and require separate Google owner approval. A draft does not rent or search.</p><a href="/api/mission-draft">Latest mission draft</a> · <a href="/api/test-treasury">Devnet test treasury</a></section><section><small>REAL GPU PROPOSAL</small><p>The Operator prefers RTX A5000, falls back to RTX 4090, then RTX 5090 when earlier GPUs are unavailable. It selects an unfinished owned range to resume, or reserves the next unsearched range. A known-answer benchmark uses the one-GPU selection. It holds if no option fits the cap. The exact GPU and price are shown before approval. A successful draft appears in the public dashboard; only your Google owner approval can start it.</p><form method="post" action="/live-plan"><input type="hidden" name="csrf" value="${csrf}"><label>Workload <select name="workload"><option value="own-range">Puzzle #71 · next unsearched range</option><option value="benchmark">Known-answer benchmark</option></select></label><label>Model <select name="model">${models.map(m=>`<option value="${escape(m.slug)}">${escape(m.name)}</option>`).join('')}</select></label><label>GPU count <select name="count"><option value="1">1 GPU</option><option value="2" selected>2 GPUs · separate rentals</option></select></label><label>Maximum rental <select name="minutes"><option value="10">10 minutes</option><option value="5">5 minutes</option><option value="15">15 minutes</option></select></label><label>Maximum USD <select name="cap"><option value="0.30">$0.30</option><option value="0.10">$0.10</option><option value="0.50">$0.50</option><option value="1.00">$1.00</option></select></label><button ${models.length&&!busy?'':'disabled'}>Draft / reconcile GPU proposal</button></form><p>At most one model request per new draft. Retrying a pending submission reuses its saved choice. One fleet at a time, with up to two separate one-GPU rentals. The total cap and each exact range/checkpoint bind to one Google owner approval.</p><a href="/api/live-proposal-draft">Latest single-GPU choice</a> · <a href="/api/live-fleet-proposal-draft">Latest two-GPU choice and quote</a> · <a href="http://127.0.0.1:4173/#approvals">Google owner approval console</a> · <a href="https://bithash.online/#approvals">Public proposals</a></section>${report?`<section><small>LATEST AI REPORT · ${escape(report.generatedAt)}</small><p>${escape(report.advice.summary)}</p><ul>${report.advice.proposals.map(p=>`<li>${escape(p.reason)} <small>[${escape(p.evidence)}]</small></li>`).join('')}</ul><p>${escape(report.warning)}</p><a href="/api/operator">Report and supporting evidence</a></section>`:''}<p><a href="https://bithash.online/#fleet">Open fleet dashboard</a></p></main></html>`;}
const server=createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://auth.openai.com; frame-ancestors 'none'; base-uri 'none'");
 if(req.headers.host!=='127.0.0.1:4185'){res.writeHead(403).end();return;}
 const url=new URL(req.url,origin),send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'}).end(JSON.stringify(data));};
 const sessionOK=(req.headers.cookie??'').split(';').some(c=>c.trim()==='bithash_operator='+session);
 const redirect=()=>res.writeHead(303,{Location:'/'}).end();
 try{
  if(req.method==='GET'&&url.pathname==='/'&&!url.search){res.setHeader('Set-Cookie',`bithash_operator=${session}; HttpOnly; SameSite=Lax; Path=/`);res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(page());return;}
  if(req.method==='GET'&&url.pathname==='/api/operator'&&!url.search){send(report?200:503,report??{error:'operator_not_connected',executionEnabled:false});return;}
  if(req.method==='GET'&&url.pathname==='/api/test-treasury'&&!url.search){if(!config.testTreasuryAddress){send(503,{error:'test_treasury_not_configured'});return;}try{send(200,await observeTestTreasury(config.testTreasuryAddress));}catch{send(503,{error:'test_treasury_unavailable'});}return;}
  if(req.method==='GET'&&url.pathname==='/api/mission-draft'&&!url.search){try{send(200,JSON.parse(await readFile(missionFile,'utf8')));}catch{send(404,{error:'no_mission_draft'});}return;}
  if(req.method==='GET'&&url.pathname==='/api/live-fleet-proposal-draft'&&!url.search){try{send(200,JSON.parse(await readFile(join(resolve(directory),'live-fleet-proposal-draft.json'),'utf8')));}catch{send(404,{error:'no_live_fleet_draft'});}return;}
  if(req.method==='GET'&&url.pathname==='/api/live-proposal-draft'&&!url.search){try{send(200,JSON.parse(await readFile(liveFile,'utf8')));}catch{send(404,{error:'no_live_draft'});}return;}
  if(req.method==='GET'&&url.pathname==='/api/connection'&&!url.search){const a=store.state.accounts.find(a=>a.client_id===store.state.active);send(200,{connected:hasPlan(a),busy,modelCount:models.length,hasReport:!!report,executionEnabled:false});return;}
  if(req.method==='GET'&&url.pathname==='/api/gpu-activity-status'&&!url.search){send(200,gpuReporter.status());return;}
  if(req.method==='GET'&&url.pathname==='/auth/callback'){
   const attempt=pending;pending=null;if(!sessionOK)throw Error('invalid_signin_session');
   const {client,code}=validateCallback(url,attempt);
   const t=await tokenRequest({grant_type:'authorization_code',client_id:client,code,code_verifier:attempt.verifier,redirect_uri:attempt.redirectUri});
   const identity=await verifyIdentity(t.id_token,client,attempt.nonce,attempt.account?.subject);
   const record=tokenRecord(t,{client_id:client,...identity});
   const at=store.state.accounts.findIndex(a=>a.client_id===client);if(at>=0)store.state.accounts[at]=record;else store.state.accounts.push(record);
   store.state.active=client;await store.save();models=[];notice=hasPlan(record)?'ChatGPT connected. Load models, then review the fleet.':'Identity connected, but ChatGPT plan permission was not granted.';redirect();return;
  }
  if(req.method!=='POST'){send(404,{error:'not_found'});return;}
  if(!sessionOK||req.headers.origin!==origin||req.headers['content-type']?.split(';')[0]!=='application/x-www-form-urlencoded'){send(403,{error:'forbidden'});return;}
  let body='';for await(const chunk of req){body+=chunk;if(body.length>4096)throw Error('invalid_request');}
  const form=new URLSearchParams(body);if(form.get('csrf')!==csrf)throw Error('invalid_request');
  if(url.pathname==='/auth/start'){
   if(busy)throw Error('review_in_progress');const id=form.get('account');const a=id?store.state.accounts.find(a=>a.client_id===id):null;if(id&&!a)throw Error('unknown_account');
   const attempt=authorization(store.state.hostId,origin+'/auth/callback',a);pending=attempt.pending;res.writeHead(303,{Location:attempt.url}).end();return;
  }
  if(url.pathname==='/disconnect'){
   if(busy)throw Error('review_in_progress');const a=store.state.accounts.find(a=>a.client_id===store.state.active);let revoked=false;
   try{if(a?.refresh_token){const d=await fetch(ISSUER+'/.well-known/openid-configuration',{redirect:'error',signal:AbortSignal.timeout(10000)}).then(r=>r.json());const u=new URL(d.revocation_endpoint);if(u.origin!==ISSUER)throw Error();const r=await fetch(u,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:a.refresh_token,token_type_hint:'refresh_token',client_id:a.client_id})});revoked=r.status===200;}}catch{}
   if(a)for(const k of ['access_token','refresh_token','id_token','expiresAt','scopes'])delete a[k];await store.save();models=[];pending=null;notice=revoked?'Disconnected; renewable session revoked.':'Disconnected locally. Remote revocation was not confirmed; disconnect BitHash in ChatGPT Settings.';redirect();return;
  }
  if(url.pathname==='/models'){models=await listModels(await store.access());notice='Choose an available model for one read-only review.';redirect();return;}
  if(url.pathname==='/review'){
   if(busy||Date.now()-lastReview<60000)throw Error('review_rate_limited');const model=form.get('model');if(!models.some(m=>m.slug===model))throw Error('choose_available_model');
   busy=true;lastReview=Date.now();try{const token=await store.access();const evidence=await readHostedEvidence(config);const next=await planOperator(evidence,{accessToken:token,model});await writeFile(reportFile+'.tmp',JSON.stringify(next,null,2),{mode:0o600});await rename(reportFile+'.tmp',reportFile);report=next;notice='Review complete. No rental, payment or approval was executed.';}finally{busy=false;}
   redirect();return;
  }
  if(url.pathname==='/mission-plan'){
   if(busy||Date.now()-lastReview<60000)throw Error('review_rate_limited');const model=form.get('model');if(!models.some(m=>m.slug===model))throw Error('choose_available_model');
   busy=true;lastReview=Date.now();try{
    const token=await store.access(),evidence=await readHostedEvidence(config);
    // A fresh report and one bounded choice are two explicit model requests.
    const reviewed=await planOperator(evidence,{accessToken:token,model});
    const limits=config.missionLimits??{maxCount:5,maxDurationSeconds:600,maxCostMicrousd:'100000'};
    const choice=await chooseMission(reviewed,limits,{accessToken:token,model});
    await writeFile(missionFile+'.tmp',JSON.stringify({report:reviewed,limits,choice},null,2),{mode:0o600});await rename(missionFile+'.tmp',missionFile);
    notice=choice.selected?'Simulation mission drafted. Import into the Google owner approval flow; no run approved or executed.':'Operator recommended holding. No mission created.';
   }finally{busy=false;}redirect();return;
  }
  if(url.pathname==='/live-plan'){
   if(busy||Date.now()-lastReview<60000)throw Error('review_rate_limited');const model=form.get('model');if(!models.some(m=>m.slug===model))throw Error('choose_available_model');
   const dollars=form.get('cap');if(!/^0\.[0-9]{2}$|^1\.00$/.test(dollars??''))throw Error('invalid_live_limits');
   const limits={maxDurationSeconds:Number(form.get('minutes'))*60,capMicrousd:String(Math.round(Number(dollars)*1000000))};
   busy=true;lastReview=Date.now();try{
    const workload=form.get('workload');if(workload!==null&&!['own-range','benchmark'].includes(workload))throw Error('invalid_range_terms');
    const draft=await draftLive(directory,limits,{call:liveCall,accessToken:await store.access(),model,rangeJobId:form.get('rangeJobId')||null,ownRange:workload==='own-range',fleetCount:Number(form.get('count')||1)});
    notice=draft.state==='held'?'Operator held: '+(draft.reason??draft.choice.reason):'GPU proposal saved on the server. Review exact terms and approve in the Google owner console; no GPU rented.';
   }finally{busy=false;}redirect();return;
  }
  send(404,{error:'not_found'});
 }catch(e){const code=/^(model_http_\d{3}_[a-z_]{1,80}|model_stream_[a-z_]{1,80}|model_request_failed|model_incomplete|invalid_model_output|invalid_advice|model_response_too_large|model_refused|invalid_fleet|invalid_progress|stale_evidence|chatgpt_review_unavailable|chatgpt_plan_not_connected|signin_required|review_rate_limited|invalid_live_limits|invalid_fleet_terms|fleet_in_progress|range_run_in_progress|range_job_unavailable|invalid_planning_ticket|invalid_live_choice|planning_choice_expired_or_invalid|gpu_unavailable|cap_too_small|executor_outcome_unknown|executor_unavailable|live_model_http_\d{3})$/.test(e.message)?e.message:'connection_failed';console.log('operator_status: '+code);notice='Connection or review unavailable ('+code+'). No rental approval or paid API fallback was used. A pending proposal submission remains saved for reconciliation. Reconnect or refresh models before retrying.';redirect();}
});
server.listen(4185,'127.0.0.1',()=>console.log('BitHash operator: '+origin));
gpuReporter.start();
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{gpuReporter.stop();clearTimeout(publishTimer);server.close();store.close().finally(()=>process.exit());});

import {localTime} from './time.mjs';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const states=['PROVISIONING','STARTING','RUNNING','EXITED','ERROR','TERMINATED','DELETED','UNKNOWN'];
export function validFleet(s){return s?.schema==='bithash.fleet-status.v1'&&s.source==='runpod-read-only'&&s.scope==='registered-bithash-pods'&&Number.isFinite(Date.parse(s.observedAt))&&Array.isArray(s.items)&&s.items.length<=100&&new Set(s.items.map(p=>p.id)).size===s.items.length&&s.items.every(p=>/^[a-z0-9]{10,32}$/.test(p.id)&&states.includes(p.status)&&Number.isFinite(Date.parse(p.observedAt))&&(p.status==='DELETED'?p.evidence==='provider-get-404':p.status==='UNKNOWN'?p.evidence==='provider-unavailable':p.evidence==='provider-get'&&typeof p.gpuModel==='string'&&p.gpuModel.length<=100&&Number.isSafeInteger(p.gpuCount)&&p.gpuCount>=1&&p.gpuCount<=64&&/^\d+(\.\d{1,6})?$/.test(p.hourlyUsd)));}
export function fleetView(s,reports,now=Date.now(),connected=true){
 const fresh=t=>{const age=now-Date.parse(t);return age>=-5000&&age<45000;};
 if(!validFleet(s))return {count:'—',heading:'/ UNKNOWN',hint:'Provider observations unavailable',html:'<div class="panel-empty"><h3>Rental status unavailable</h3><p>Waiting for the provider connection. Saved worker reports remain below.</p></div>'};
 const rows=s.items.map(p=>({...p,current:connected&&fresh(s.observedAt)&&fresh(p.observedAt)&&p.status!=='UNKNOWN'}));
 const complete=connected&&fresh(s.observedAt)&&rows.every(p=>p.current);
 const running=rows.filter(p=>p.current&&p.status==='RUNNING').reduce((n,p)=>n+p.gpuCount,0);
 const reportRows=Array.isArray(reports?.items)?reports.items:[];
 const html=rows.length?'<div class="fleet-rentals">'+rows.map(p=>{
  const r=reportRows.filter(r=>r.kind==='gpu'&&r.providerPodId===p.id&&r.reported).sort((a,b)=>Date.parse(b.lastReceivedAt)-Date.parse(a.lastReceivedAt))[0];
  const t=r?.reported,reportAge=now-Date.parse(r?.lastReceivedAt);
  const active=p.current&&p.status==='RUNNING'&&r?.freshness==='fresh'&&reportAge>=-5000&&reportAge<30000&&now<Date.parse(r.expiresAt)&&t?.state==='computing';
  const status=p.current?p.status:'UNKNOWN';
  const proof=typeof r?.proof==='string'&&/^\/api\/gpu-proof\/[a-f0-9]{64}$/.test(r.proof)?r.proof:null;
  const number=v=>typeof v==='string'&&/^\d{1,30}$/.test(v)?BigInt(v).toLocaleString():'—';
  return `<article class="rental-card ${active?'is-computing':''}"><div class="rental-header"><span>RUNPOD · ${esc(p.id)}</span><span class="rental-status">${status==='DELETED'?'DELETED · SESSION RECORD':esc(status)}</span></div><div class="rental-body"><span class="rental-rig"><img src="${active?'rig-active.png':'rig.png'}" width="128" height="128" alt="${active?'GPU fans spinning - worker reports computing':'Inactive GPU illustration'}">${active?'<span class="rotor rotor-top" aria-hidden="true"></span><span class="rotor rotor-bottom" aria-hidden="true"></span>':''}</span><div><h3>${esc(p.gpuModel??'GPU rental')}</h3><p>${p.current?(status==='DELETED'?'Provider confirms rental deleted':`${p.gpuCount} GPU · $${esc(p.hourlyUsd)}/hour quoted`):'Current rental state cannot be confirmed'}</p><p class="rental-worker">${active?'WORKER REPORTS COMPUTING':t?'LAST WORKER STATE · '+esc(t.state??'unknown'):'NO WORKER REPORT'}</p></div></div>${t?`<div class="rental-stats"><span>Last reported candidates<b>${number(t.candidatesChecked)}</b></span><span>Last reported speed<b>${number(t.candidatesPerSecond)}${t.candidatesPerSecond!==null?' /s':''}</b></span></div><p class="rental-time">Worker report · ${esc(localTime(r.lastReceivedAt))} · ${active?'fresh':'historical / inactive'}</p>`:''}<p class="rental-time">Provider checked · ${esc(localTime(p.observedAt))}</p><div class="rental-links"><a class="open-gpu" href="#gpu/${esc(p.id)}">Open GPU record →</a><a href="/api/fleet-status" target="_blank" rel="noopener">Provider observation ↗</a>${proof?`<a href="${proof}" target="_blank" rel="noopener">Signed worker report ↗</a>`:''}</div></article>`;
 }).join('')+'</div>':'<div class="panel-empty"><h3>No registered rentals</h3><p>No BitHash Pods are registered with the controller.</p></div>';
 const display=complete&&rows.length&&rows.every(p=>p.status==='DELETED')?'<div class="panel-empty"><h3>No active rentals.</h3><p>The provider confirms these registered rentals were deleted. Their machine files and signed reports remain available.</p></div><details class="rental-history"><summary>Deleted rentals ('+rows.length+') · open machine records</summary>'+html+'</details>':html;
 return {count:complete?String(running):'—',heading:complete?`/ ${running} RUNNING`:'/ UNKNOWN',hint:complete?'Registered BitHash rentals · provider checked':'Provider observation stale or unavailable',html:display};
}
export function mountFleet(update){
 let stopped=false,timer;
 const read=async path=>{const r=await fetch(path,{cache:'no-store',signal:AbortSignal.timeout(7000)});if(!r.ok)throw Error();return r.json();};
 const poll=async()=>{const [fleet,reports]=await Promise.allSettled([read('/api/fleet-status'),read('/api/gpu-progress')]);if(stopped)return;update(fleet.status==='fulfilled'?fleet.value:null,reports.status==='fulfilled'?reports.value:null,fleet.status==='fulfilled');timer=setTimeout(poll,10000);};
 poll();window.addEventListener('pagehide',()=>{stopped=true;clearTimeout(timer);},{once:true});
}

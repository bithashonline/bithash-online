const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function validProgress(s){return s?.schema==='bithash.remote-progress.v1'&&s.source==='hosted-collector'&&Number.isFinite(Date.parse(s.observedAt))&&Array.isArray(s.items)&&s.items.length<=100&&s.items.every(r=>/^[a-f0-9]{32}$/.test(r.id)&&['gpu','transport-test'].includes(r.kind)&&['fresh','stale','expired','revoked','never-seen','clock-unknown'].includes(r.freshness)&&(r.proof===null||/^\/api\/gpu-proof\/[a-f0-9]{64}$/.test(r.proof))&&(r.lastReceivedAt===null||Number.isFinite(Date.parse(r.lastReceivedAt))));}
export function remoteCards(s,connected=true,elapsed=0){
 if(!validProgress(s))return '<p class="detail-note">Hosted collector unavailable. Current GPU activity cannot be confirmed.</p>';
 if(!s.items.length)return '<p class="detail-note">Collector connected. No GPU reporters enrolled.</p>';
 return '<div class="rack">'+s.items.map(r=>{
  const age=Date.parse(s.observedAt)-Date.parse(r.lastReceivedAt)+elapsed;
  const status=!connected||elapsed>=15000?'unavailable':r.freshness==='fresh'?(age<0?'clock-unknown':age>=30000?'stale':'fresh'):r.freshness;
  const p=r.reported,rate=typeof p?.candidatesPerSecond==='string'&&/^\d{1,30}$/.test(p.candidatesPerSecond)?BigInt(p.candidatesPerSecond).toLocaleString()+' /s':'Not reported';
  const checked=typeof p?.candidatesChecked==='string'&&/^\d{1,30}$/.test(p.candidatesChecked)?BigInt(p.candidatesChecked).toLocaleString():'Not reported';
  const util=Number.isInteger(p?.utilizationPercent)&&p.utilizationPercent>=0&&p.utilizationPercent<=100?p.utilizationPercent+'%':'Not reported';
  return `<article class="rig worker-card"><div class="rig-top"><span>${r.kind==='gpu'?'GPU REPORTER':'TRANSPORT TEST · NO GPU'}</span><span class="status">${esc(status.toUpperCase())}</span></div><div class="rig-meta"><h3>${esc(r.id.slice(0,8))}</h3><div class="rig-stats"><span>Reported speed<b>${rate}</b></span><span>Reported utilization<b>${util}</b></span><span>Reported candidates checked<b>${checked}</b></span><span>Reported state<b>${esc(p?.state??'Not reported')}</b></span></div><p>Last received: ${esc(r.lastReceivedAt??'Never')}</p><p class="worker-disclaimer">Signed worker claim · Hardware and search coverage unverified</p>${r.proof?`<a href="${r.proof}" target="_blank" rel="noopener">Open signed report & verification key ↗</a>`:'<p>No report evidence yet</p>'}</div></article>`;
 }).join('')+'</div>';
}
if(typeof document!=='undefined'){
 const cards=document.getElementById('remote-cards'),tag=document.getElementById('remote-status'),history=document.getElementById('remote-history');let snapshot=null,received=0,connected=false;
 const render=()=>{if(!cards)return;cards.innerHTML=remoteCards(snapshot,connected,Date.now()-received);tag.textContent=connected&&Date.now()-received<15000?'SERVER CONNECTED':'SERVER UNAVAILABLE';history.textContent=snapshot?`Retained reports: ${snapshot.history.records.toLocaleString()} / ${snapshot.history.capacity.toLocaleString()}. Reports are preserved; ingestion stops at capacity.`:'';};
 const poll=async()=>{try{const r=await fetch('/api/gpu-progress',{cache:'no-store',signal:AbortSignal.timeout(6000)});if(!r.ok)throw Error();const s=await r.json();if(!validProgress(s))throw Error();snapshot=s;received=Date.now();connected=true;}catch{connected=false;}render();};
 poll();setInterval(poll,10000);setInterval(render,1000);
}

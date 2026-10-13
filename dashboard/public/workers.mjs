const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function validateSnapshot(v){
 if(v?.schema!=='bithash.dashboard.v1'||v.source!=='local-controller'||!Number.isFinite(Date.parse(v.observedAt))||!['available','unavailable','not-configured'].includes(v.fixtures?.status))return false;
 if(!['jobs','checkpoints'].every(k=>v.fixtures[k]===null||(Number.isSafeInteger(v.fixtures[k])&&v.fixtures[k]>=0)))return false;
 return Array.isArray(v.fixtures.items)&&v.fixtures.items.length<=100&&v.fixtures.items.every(r=>
  /^[a-f0-9]{24}$/.test(r.id)&&typeof r.fixture==='string'&&typeof r.status==='string'&&
  /^(0|[1-9][0-9]*)$/.test(r.progress?.completed)&&/^(0|[1-9][0-9]*)$/.test(r.progress?.total)&&
  Number.isSafeInteger(r.authenticatedReceipts)&&r.authenticatedReceipts>=0&&
  ['fresh','stale','inactive','never-seen','clock-unknown'].includes(r.activity?.freshness)&&
  (r.activity.lastReceivedAt===null||Number.isFinite(Date.parse(r.activity.lastReceivedAt))));
}
export function workerState(r,observedAt,receivedAt,now,connected){
 if(!connected||now<receivedAt||now-receivedAt>=15000)return 'unavailable';
 if(r.activity.freshness!=='fresh')return r.activity.freshness;
 const age=Date.parse(observedAt)-Date.parse(r.activity.lastReceivedAt)+now-receivedAt;
 return age<0?'clock-unknown':age>=30000?'stale':'fresh';
}
export function workerCards(snapshot,receivedAt,now,connected){
 if(!snapshot)return '<p class="detail-note">Worker API unavailable. No current activity can be confirmed.</p>';
 if(snapshot.fixtures.status!=='available')return '<p class="detail-note">Worker database '+esc(snapshot.fixtures.status)+'.</p>';
 if(!snapshot.fixtures.items.length)return '<p class="detail-note">No fixture workers registered.</p>';
 return '<div class="rack">'+snapshot.fixtures.items.map(r=>{
  const status=workerState(r,snapshot.observedAt,receivedAt,now,connected),p=r.activity.reported;
  const rate=typeof p?.candidatesPerSecond==='string'&&/^[0-9]{1,20}$/.test(p.candidatesPerSecond)?BigInt(p.candidatesPerSecond).toLocaleString('en-US')+' /s':'Not reported';
  const util=Number.isInteger(p?.utilizationPercent)&&p.utilizationPercent>=0&&p.utilizationPercent<=100?p.utilizationPercent+'%':'Not reported';
  return `<article class="rig worker-card ${status==='fresh'?'fresh':'stale'}"><div class="rig-top"><span>WORKER ${esc(r.id.slice(0,8))}</span><span class="status">${esc(status.toUpperCase())}</span></div><div class="rig-meta"><h3>${esc(r.fixture)} / LOCAL FIXTURE</h3><div class="rig-stats"><span>Accepted work<b>${esc(r.progress.completed)} / ${esc(r.progress.total)}</b></span><span>Signed receipts<b>${r.authenticatedReceipts}</b></span><span>Reported speed${status!=='fresh'?' (last known)':''}<b>${rate}</b></span><span>Reported utilization<b>${util}</b></span><span>Reported device<b>${esc(p?.device??'Not reported')}</b></span><span>Reported state<b>${esc(p?.state??'Not reported')}</b></span></div><p class="worker-time">Last activity: ${esc(r.activity.lastReceivedAt??'Never received')}</p><p class="worker-disclaimer">Signed worker claims · Hardware unverified · No billing attached</p></div></article>`;
 }).join('')+'</div>';
}

const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const decimal=v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(v);
const rangeStates=['running','accepted','completed','failed','interrupted'];
export function validRangeWorker(r){
 if(r==null)return true;
 if(r.schema!=='bithash.range-worker.v1'||!['node-openssl-cpu-fixture','bitcrack-cuda-bounded-fixture','other'].includes(r.backend)||
    !rangeStates.includes(r.state)||!decimal(r.assigned?.start)||!decimal(r.assigned?.end)||!decimal(r.next)||
    BigInt(r.assigned.start)>=BigInt(r.assigned.end)||BigInt(r.next)<BigInt(r.assigned.start)||BigInt(r.next)>BigInt(r.assigned.end)||
    !['acceptedChunks','failedAttempts','interruptedAttempts'].every(k=>Number.isSafeInteger(r[k])&&r[k]>=0)||
    r.hardwareVerified!==false||r.coverageVerified!==false||r.evidence!=='local-known-answer-validation'||
    !(r.lastFinishedAt===null||Number.isFinite(Date.parse(r.lastFinishedAt)))||
    !(r.lastError===null||typeof r.lastError==='string'&&/^[a-z_]{1,40}$/.test(r.lastError)))return false;
 return Array.isArray(r.records)&&r.records.length<=20&&r.records.every(v=>decimal(v.start)&&decimal(v.end)&&
   BigInt(v.start)<BigInt(v.end)&&BigInt(v.start)>=BigInt(r.assigned.start)&&BigInt(v.end)<=BigInt(r.assigned.end)&&
   rangeStates.includes(v.state)&&(v.error===null||typeof v.error==='string'&&/^[a-z_]{1,40}$/.test(v.error))&&
   (v.state==='accepted'?/^[a-f0-9]{64}$/.test(v.digest):v.digest===null));
}
export function rangeWorkerPanel(r,connected,jobId=''){
 if(!r||!validRangeWorker(r))return '';
 const mode=r.backend==='node-openssl-cpu-fixture'?'CPU / OpenSSL':'CUDA fixture adapter';
 const rows=r.records.map(v=>`<tr><td>[${esc(v.start)}, ${esc(v.end)})</td><td>${esc(v.state)}${v.error?' · '+esc(v.error.replaceAll('_',' ')):''}</td><td>${v.digest?`<a href="/range-result.html#${v.digest}" target="_blank" rel="noopener">Result ↗</a>`:'No completed result'}</td></tr>`).join('');
 return `<div class="range-summary"><span class="micro-label">BOUNDED FIXTURE SEARCH / ${esc(mode)}</span><p><strong>${esc(connected?r.state.toUpperCase():'LAST KNOWN · '+r.state.toUpperCase())}</strong> · Assigned [${esc(r.assigned.start)}, ${esc(r.assigned.end)}) · Resume at ${esc(r.next)}</p><p>${r.acceptedChunks} completed chunks · ${r.failedAttempts} failed attempts · ${r.interruptedAttempts} interrupted attempts</p>${r.lastError?`<p class="range-error">Last failure: ${esc(r.lastError.replaceAll('_',' '))}</p>`:''}<details data-range-details="${esc(jobId)}"><summary>Completed ranges & failures</summary><div class="range-table-wrap"><table class="range-table"><thead><tr><th>Range · end excluded</th><th>Outcome</th><th>Evidence</th></tr></thead><tbody>${rows}</tbody></table></div><p class="worker-disclaimer">Last 20 attempts · Known-answer validation · Hardware unverified · Puzzle #71 work: zero</p></details></div>`;
}
export function validateSnapshot(v){
 if(v?.schema!=='bithash.dashboard.v1'||v.source!=='local-controller'||!Number.isFinite(Date.parse(v.observedAt))||!['available','unavailable','not-configured'].includes(v.fixtures?.status))return false;
 if(!['jobs','checkpoints'].every(k=>v.fixtures[k]===null||(Number.isSafeInteger(v.fixtures[k])&&v.fixtures[k]>=0)))return false;
 return Array.isArray(v.fixtures.items)&&v.fixtures.items.length<=100&&v.fixtures.items.every(r=>
  /^[a-f0-9]{24}$/.test(r.id)&&typeof r.fixture==='string'&&typeof r.status==='string'&&
  /^(0|[1-9][0-9]*)$/.test(r.progress?.completed)&&/^(0|[1-9][0-9]*)$/.test(r.progress?.total)&&
  Number.isSafeInteger(r.authenticatedReceipts)&&r.authenticatedReceipts>=0&&
  ['fresh','stale','inactive','never-seen','clock-unknown'].includes(r.activity?.freshness)&&
  (r.activity.lastReceivedAt===null||Number.isFinite(Date.parse(r.activity.lastReceivedAt)))&&validRangeWorker(r.rangeWorker));
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
  return `<article class="rig worker-card ${status==='fresh'?'fresh':'stale'}"><div class="rig-top"><span>WORKER ${esc(r.id.slice(0,8))}</span><span class="status">${esc(status.toUpperCase())}</span></div><div class="rig-meta"><h3>${esc(r.fixture)} / LOCAL FIXTURE</h3><div class="rig-stats"><span>Accepted work<b>${esc(r.progress.completed)} / ${esc(r.progress.total)}</b></span><span>Signed receipts<b>${r.authenticatedReceipts}</b></span><span>Reported speed${status!=='fresh'?' (last known)':''}<b>${rate}</b></span><span>Reported utilization<b>${util}</b></span><span>Reported device<b>${esc(p?.device??'Not reported')}</b></span><span>Reported state<b>${esc(p?.state??'Not reported')}</b></span></div>${rangeWorkerPanel(r.rangeWorker,connected&&now>=receivedAt&&now-receivedAt<15000,r.id)}<p class="worker-time">Last signed activity: ${esc(r.activity.lastReceivedAt??'Never received')}</p><p class="worker-disclaimer">${r.rangeWorker?'Local fixture results; signed activity is separate':'Signed worker claims'} · Hardware unverified · No billing attached</p></div></article>`;
 }).join('')+'</div>';
}

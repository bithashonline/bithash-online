const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const closed=new Set(['completed','failed','cancelled','expired','rejected']);
const terminal=new Set(['deleted','cancelled','expired','rejected']);
const number=s=>/^(0|[1-9][0-9]*)$/.test(String(s))?BigInt(s).toLocaleString():'—';
export function productView(feed,connected=true,now=Date.now()){
 if(feed?.schema!=='bithash.live-executor.v1'||feed.mode!=='real-provider'||!Array.isArray(feed.runs)||!Array.isArray(feed.fleets)||!Array.isArray(feed.ownRanges?.items))return null;
 const age=now-Date.parse(feed.observedAt),fresh=connected&&Number.isFinite(age)&&age>=-5000&&age<30000;
 const fleets=feed.fleets,active=fleets.filter(f=>!closed.has(f.state)&&f.state!=='proposed'),singles=feed.runs.filter(r=>!r.terms?.fleetId&&!terminal.has(r.state)&&r.state!=='proposed'),pending=fleets.filter(f=>f.state==='proposed'&&f.terms.expiresAt>now).length+feed.runs.filter(r=>!r.terms?.fleetId&&r.state==='proposed'&&r.terms.expiresAt>now).length;
 const attention=active.some(f=>f.requiresAttention||['unresolved','review_required'].includes(f.state))||feed.ownRanges.items.some(j=>j.state==='private-review');
 const pods=new Set([...active.flatMap(f=>f.members.filter(m=>m.podId&&!terminal.has(m.state)).map(m=>m.podId)),...singles.filter(r=>r.podId).map(r=>r.podId)]);
 const status=!fresh?'Saved state':attention?'Review required':active.some(f=>['draining'].includes(f.state))?'Stopping':active.length||singles.length?'Session active':pending?'Awaiting approval':'Ready';
 const latest=fleets.find(f=>f.state==='completed');
 return {fresh,status,pending,activePods:fresh?String(pods.size):'—',checkpointed:number(feed.ownRanges.puzzle71CheckpointedCandidates),completedAssignments:feed.ownRanges.items.filter(j=>j.state==='completed').length,sessionCount:fleets.length+feed.runs.filter(r=>!r.terms?.fleetId).length,attention,observedAt:feed.observedAt,latest};
}
export function productMarkup(feed,connected=true,now=Date.now()){
 const v=productView(feed,connected,now);if(!v)return '<div class="product-intro"><b>Connecting to the executor</b><p>The last saved records remain available below.</p></div>';
 return '<div class="product-intro"><div><span class="micro-label">BITHASH / OPERATIONS</span><h2>'+esc(v.status)+'</h2><p>'+(v.fresh?(v.attention?'A session needs owner review. Further rentals stay blocked.':v.activePods==='0'?(v.pending?'Review the exact proposal below to start a session.':'No GPUs rented. Completed work and machine records are retained.'):'The server manages the approved session and records accepted chunks.'):'The executor could not be refreshed. These are saved checkpoints; current rental activity is unknown.')+'</p></div><a class="product-action" href="#approvals">'+(v.pending?'Review proposal':'Session controls')+' ↗</a></div><div class="product-metrics"><div><span>Accepted #71 checkpoints</span><strong>'+v.checkpointed+'</strong><small>Own ledger · signed worker receipts</small></div><div><span>Active rentals</span><strong>'+v.activePods+'</strong><small>'+(v.fresh?'Executor lifecycle records':'Current state unavailable')+'</small></div><div><span>Completed assignments</span><strong>'+v.completedAssignments+'</strong><small>Disjoint bounded ranges</small></div><div><span>Waiting for approval</span><strong>'+(v.fresh?v.pending:'—')+'</strong><small>One exact owner decision per session</small></div></div><p class="product-evidence-note">'+(v.fresh?'Updated ':'Saved observation ')+esc(new Date(v.observedAt).toLocaleString())+' · Checkpoints are authenticated worker claims; exhaustive coverage is not independently verified.</p>';
}
export function mountProduct(){
 const area=document.createElement('section');area.id='operations';area.className='product-overview';area.setAttribute('aria-label','Current search operations');area.setAttribute('aria-live','polite');document.querySelector('.page-title')?.after(area);
 let latest=null,connected=false;
 const render=()=>{area.innerHTML=productMarkup(latest,connected);};
 document.addEventListener('bithash:executor-status',e=>{latest=e.detail.feed??latest;window.bithashLatestPublicSnapshot=latest;connected=e.detail.connected;render();});render();
 const timer=setInterval(render,5000);window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
 document.querySelector('#simulation')?.addEventListener('click',()=>{area.hidden=true;document.body.dataset.simulation='true';});document.querySelector('#actual')?.addEventListener('click',()=>{area.hidden=false;document.body.dataset.simulation='false';});
 // The auth widget remains owned by its existing Google session code.
 const auth=document.querySelector('.owner-session');if(auth){auth.id='owner-signin';document.querySelector('.live-executor-panel')?.prepend(auth);}
}

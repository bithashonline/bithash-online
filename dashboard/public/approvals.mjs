import {localTime} from './time.mjs';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function evidenceLink(url){return typeof url==='string'&&/^\/api\/approval-evidence\/[1-9][0-9]*$/.test(url)?`<a href="${url}" target="_blank" rel="noopener">View audit record ↗</a>`:'Evidence missing · unverified';}
export function approvalMarkup(s,now=Date.now()){
 if(s?.schema!=='bithash.spending-approvals.v1'||s.mode!=='local-simulation'||s.liveExecutionEnabled!==false||!Array.isArray(s.proposals)||!Array.isArray(s.events))throw Error('Invalid approval feed');
 const date=t=>localTime(t*1000);
 const money=v=>(Number(v)/1e6).toFixed(6);
 return {cards:s.proposals.map(p=>{
  const state=esc(p.state),canApprove=s.readOnly!==true&&p.state==='proposed'&&now<p.terms.expiresAt*1000;
  return `<article class="approval-card proposal-record"><div class="panel-caption"><span class="micro-label">RUN PROPOSAL</span><span class="badge" data-state="${['proposed','reserved','running','settled','expired'].includes(p.state)?p.state:'other'}">${state}</span></div><h3>${esc(p.terms.count)} × ${esc(p.terms.gpu.toUpperCase())}</h3><p class="record-id">${esc(p.id)}</p><div class="proposal-numbers"><div><span>Spending cap</span><strong>$${money(p.terms.capMicrousd)}</strong><small>Synthetic USD</small></div><div><span>Runtime</span><strong>${esc(p.terms.durationSeconds/60)}<small> min</small></strong><small>${esc(p.terms.provider)} provider</small></div></div>${p.actual!==null&&p.actual!==undefined?`<p class="settlement-line">Settled <b>$${money(p.actual)} synthetic USD</b></p>`:''}<p class="record-expiry">Expires ${esc(date(p.terms.expiresAt))}</p>${p.sourceEvidenceUrl?`<div class="record-proof">${evidenceLink(p.sourceEvidenceUrl)}<small>Proposal source & pricing</small></div>`:''}<details data-record="${esc(p.id)}"><summary>Exact terms & approval record <span aria-hidden="true">+</span></summary><pre>${esc(JSON.stringify({ledgerId:s.ledgerId,domain:s.signingDomain,digest:p.digest,terms:p.terms},null,2))}</pre><p class="panel-copy">Google owner approval binds this exact digest. It is recorded by the backend; no wallet signature or transfer occurs.</p></details>${canApprove?`<form data-approval="${esc(p.id)}"><button class="approve-run" type="submit">Approve exact terms · Google owner</button></form>`:'<p class="approval-unavailable">Read-only record · approval controls remain on the owner console.</p>'}</article>`;
 }).join('')||'<div class="panel-empty"><span aria-hidden="true">◇</span><h3>No proposals yet</h3><p>Configure a test run above to create the first reviewable proposal.</p></div>',events:[...s.events].reverse().map(e=>`<div class="row action-row"><span class="ref">${esc(String(e.seq).padStart(2,'0'))}</span><div><b>${esc(e.kind.replaceAll('_',' '))}</b><p>${esc(e.proposal??'Treasury / request')}</p><time>${esc(date(e.at))}</time></div><div class="event-proof">${evidenceLink(e.evidenceUrl)}<span>LOCAL RECORD</span></div></div>`).join('')||'<div class="panel-empty"><h3>No actions recorded</h3><p>Proposal and approval activity will appear here.</p></div>'};
}
export function mountApprovals(){
 const $=id=>document.getElementById(id);
 const status=document.createElement('p');status.className='panel-copy';status.setAttribute('role','status');$('approval-status').parentElement.after(status);
 let last=null;
 function freshness(){if(!last)return;const age=Date.now()-Date.parse(last.exportedAt);const online=age>=-5000&&age<45000;
 $('approval-status').textContent=online?'SYNCED · SIMULATION':'SYNC OFFLINE · SAVED RECORDS';
 status.textContent='Read-only run history · '+(online?'Sync connected. ':'Latest saved state; your computer is offline or the sync is delayed. ')+ 'Last exported '+localTime(last.exportedAt)+'. Owner approvals stay on the local console. Test credits are not real spending.';}
 async function refresh(){try{const r=await fetch('/api/approvals',{cache:'no-store',signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error();const feed=await r.json();if(feed.readOnly!==true)throw Error();const html=approvalMarkup(feed);last=feed;
 const open=new Set([...$('approval-cards').querySelectorAll('details[open]')].map(d=>d.dataset.record));$('approval-cards').innerHTML=html.cards;for(const d of $('approval-cards').querySelectorAll('details'))d.open=open.has(d.dataset.record);
 $('approval-events').innerHTML=html.events;freshness();
 }catch{freshness();$('approval-status').textContent='SYNC UNAVAILABLE · SAVED RECORDS';status.textContent='Could not refresh the run ledger. Any records below show the last received state, not current activity.';}}
 refresh();const timer=setInterval(refresh,5000);window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
}

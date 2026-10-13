import {operatorCharacter} from './operator-character.mjs';
import {localTime} from './time.mjs';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function operatorView(snapshot,connected,now=Date.now()){
 const record=snapshot?.record,r=record?.report;
 if(snapshot?.schema!=='bithash.operator-snapshot.v1'||record?.schema!=='bithash.operator-record.v1'||! /^[a-f0-9]{64}$/.test(record.digest??'')||r?.schema!=='bithash.operator-report.v1'||r.mode!=='model-review'||r.executionEnabled!==false||r.readOnly!==true||typeof r.advice?.summary!=='string'||r.advice.summary.length>1600||!Array.isArray(r.advice.proposals)||r.advice.proposals.length>8||!Array.isArray(r.evidence?.facts))return null;
 const observed=now-Date.parse(snapshot.observedAt),heartbeat=now-Date.parse(snapshot.heartbeatAt),age=now-Date.parse(r.generatedAt),evidenceAge=now-Date.parse(r.evidence.observedAt);
 if(![observed,heartbeat,age,evidenceAge].every(Number.isFinite)||[observed,heartbeat,age,evidenceAge].some(x=>x< -5000))return null;
 const facts=new Map(r.evidence.facts.map(f=>[f.id,f]));
 if(r.advice.proposals.some(p=>!['inspect_worker','refresh_evidence','review_funding','review_capacity'].includes(p.action)||!facts.has(p.evidence)||typeof p.reason!=='string'||p.reason.length>500))return null;
 return {report:r,digest:record.digest,online:connected&&observed<30000&&heartbeat<90000,historical:age>300000||evidenceAge>300000,age,facts};
}
export function renderOperator(element,snapshot,connected,sim=false,now=Date.now()){
 const v=sim?null:operatorView(snapshot,connected,now),r=v?.report;
 const status=sim?'SIMULATION':!connected?'BRIDGE UNAVAILABLE':v?.online?'LAPTOP ONLINE':'LAPTOP OFFLINE';
 const proof=f=>{const url=f?.proof;if(typeof url!=='string'||!/^https:\/\/bithash\.online\/api\/(fleet-status|gpu-proof\/[a-f0-9]{64})$/.test(url))return '';return `<a href="${esc(new URL(url).pathname)}" target="_blank" rel="noopener">${f.kind==='provider-observation'?'Current provider observation':'Signed worker report'} ↗</a>`;};
 const markup=`<div class="section-head"><div><span class="eyebrow">02 / FLEET INTELLIGENCE</span><h2>The Operator</h2></div><span class="operator-mark"><img src="bithash-logo.png" width="40" height="40" alt=""></span></div><div class="overseer-avatar">${operatorCharacter()}<span>${status}</span></div><div class="operator-presence">${v?.online?'●':'○'} LOCAL PROCESS / ${v?.online?'REPORT SYNC ACTIVE':'NO RECENT HEARTBEAT'}</div><div class="operator-message"><span class="prompt">${r?esc(r.model)+' / READ-ONLY':'OPERATOR.LOG'}</span><h3 id="operator-title">${sim?'Simulation preview':r?v.historical?'Saved assessment':'Latest assessment':'Awaiting an AI report'}</h3><p id="operator-body">${r?esc(r.advice.summary):sim?'Synthetic fleet controls do not call the AI or spend funds.':'The local operator publishes completed reports here. Its last report will remain available when the laptop is offline.'}</p></div>${r?`<div class="operator-meta"><span>${esc(localTime(r.generatedAt))}</span><b>${v.historical?'HISTORICAL EVIDENCE':'RECENT REPORT'}</b></div><div class="operator-proposals">${r.advice.proposals.map((p,i)=>`<article><span class="micro-label">REVIEW ${String(i+1).padStart(2,'0')} · NOT EXECUTED</span><p>${esc(p.reason)}</p><small>${esc(p.evidence)}</small>${proof(v.facts.get(p.evidence))}</article>`).join('')}</div><a class="operator-record" href="/api/operator-proof/${v.digest}" target="_blank" rel="noopener">Assessment + captured evidence ↗</a>`:''}<div class="policy"><span>Mode <b>Read-only analyst</b></span><span>New reviews <b>Owner-triggered on laptop</b></span><span>Spending <b>Owner approval required</b></span></div><div class="operator-note"><b>Evidence in. Explanation out.</b><p>Process heartbeat is separate from report freshness. AI interpretation can be wrong. Archived records show the captured assessment and evidence; they do not independently attest model execution or exhaustive GPU work.</p></div>`;
 // Keep the avatar in the live tree: polling must not restart its animation clock.
 if(!element.ownerDocument){element.innerHTML=markup;return;}
 const next=element.ownerDocument.createElement('div');next.innerHTML=markup;
 const children=[...next.children];
 for(let i=0;i<children.length;i++){
  const current=element.children[i],child=children[i];
  if(current?.classList.contains('overseer-avatar')&&child.classList.contains('overseer-avatar')&&current.querySelector('.operator-puppet')){
   current.querySelector(':scope > span').textContent=status;
  }else if(current){current.replaceWith(child);}else{element.append(child);}
 }
 while(element.children.length>children.length)element.lastElementChild.remove();

}

import {mountApprovals} from './approvals.mjs';
import {initial,fund,advance,fault,available} from './engine.mjs';
import {validateSnapshot,workerCards} from './workers.mjs';
let backendReceivedAt=0,backendConnected=false;
let operatorReport=null;
let state=initial(),sim=false,selected=null,backend=null;
const $=id=>document.getElementById(id),money=n=>'$'+(n/1e6).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:4}),esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const real=[
 {id:'LOCAL / 68',title:'CPU reference and controller tests',detail:'68 passing local backend tests, including signed activity and receipt validation. GPU benchmark evidence is recorded separately; these local tests do not attest hardware.',status:'LOCAL TESTS',link:'https://github.com/bithashonline/bithash-online/tree/main/experiments'},
 {id:'BTC / 71',title:'Target funding observed',detail:'October 7, 2026 · 23:09 UTC: two explorers agreed on 7.1019168 BTC unspent. Historical snapshot only; current status must be refreshed before any search.',status:'DATED SNAPSHOT',link:'target-evidence.json'},
 {id:'GPU / 00',title:'Runpod Secure Cloud selected',detail:'RTX 4090 is the integration target. Historical GPU fixture and benchmark runs completed. No production fleet is connected to this dashboard.',status:'NOT CONNECTED'},
 {id:'SOL / —',title:'Treasury and fee routing',detail:'Creator fees accumulate in treasury. Each compute run needs owner approval of GPU count, runtime and budget. Wallet and provider funding are not connected.',status:'NOT CONNECTED'}
];
function render(){
 $('worker-evidence').hidden=sim;
 $('worker-status').textContent=backendConnected?'LOCAL API CONNECTED':'API UNAVAILABLE';
 $('worker-cards').innerHTML=workerCards(backend,backendReceivedAt,Date.now(),backendConnected);
 $('actual').classList.toggle('active',!sim);$('simulation').classList.toggle('active',sim);$('actual').setAttribute('aria-pressed',String(!sim));$('simulation').setAttribute('aria-pressed',String(sim));$('controls').hidden=!sim;
 $('notice').innerHTML=sim?'<strong>SIMULATION MODE</strong> / Synthetic funds, instances and worker reports. No blockchain, provider or AI requests are sent.':'<strong>CURRENT EVIDENCE</strong> / GPU test reports are connected below. No token launched or treasury connected. Rental status is not yet synchronized. <a href="#gpu-progress">View GPU reports ↗</a>';
 const values=sim?[[money(state.fees),'Test fees received','Synthetic USD; no SOL conversion'],[money(state.compute),'Legacy 80% simulation',money(state.other)+' remains unassigned'],[String(state.rigs.filter(r=>r.status==='running').length),'Running test rigs',state.rigs.length+' total simulated instances'],[money(state.spent),'Simulated spend',money(available(state))+' unreserved compute']]:[['—','Creator fees received','Treasury not connected'],['Approval','Compute spending','Owner approves each bounded run'],['—','Rental status','Not synchronized · see GPU reports'],['68','Local backend tests','GPU runs recorded separately']];
 $('metrics').innerHTML=values.map(([v,l,h])=>`<div class="metric"><label>${l}</label><strong>${v}</strong><small>${h}</small></div>`).join('');
 $('count').textContent=sim?`/ ${state.rigs.filter(r=>r.status!=='stopped').length} INSTANCES`:'/ STATUS PENDING';
 $('rigs').innerHTML=sim&&state.rigs.length?`<div class="rack">${state.rigs.map(r=>`<article class="rig ${r.status}"><div class="rig-top"><span>${r.id} / SIM</span><span class="status">${r.status.toUpperCase()}</span></div><div class="rig-visual"><span class="visual-label">COMPUTE NODE / ${String(r.work).padStart(3,'0')}</span><div class="rig-sprite"><img src="${r.status==='running'?'rig-active.png':'rig.png'}" width="185" height="185" alt="${r.status==='running'?'Powered-on colored GPU, simulated activity':'Inactive grey GPU, no motion'}">${r.status==='running'?'<span class="rotor rotor-top" aria-hidden="true"></span><span class="rotor rotor-bottom" aria-hidden="true"></span>':''}</div></div><div class="rig-meta"><h3>NVIDIA RTX 4090</h3><div class="rig-stats"><span>Reserved<b>${money(r.remaining)}</b></span><span>Test spend<b>${money(r.spent)}</b></span></div><div class="rig-bottom"><small><span class="heartbeat" aria-hidden="true"><i></i><i></i><i></i></span>${r.heartbeat===null?'Awaiting report':'T+'+r.heartbeat+'m report'}</small><button data-detail="${r.id}" aria-label="Inspect ${r.id}">Inspect rig</button></div></div></article>`).join('')}</div>`:`<div class="empty"><img src="rig.png" alt="Inactive 8-bit GPU tower illustration" width="150" height="150"><h3>${sim?'Awaiting test funds':'GPU reports are connected below'}</h3><p>${sim?'Add test fees to reserve your first rig. Each machine needs six hours of funded runtime.':'The rental inventory is not synchronized yet. Open GPU progress for signed test activity, timestamps and proof links.'}</p>${!sim?'<a href="#gpu-progress" class="primary">View GPU progress ↗</a>':''}</div>`;
 $('budget').innerHTML=(sim?[[money(available(state)),'Available'],[money(state.reserved),'Reserved'],[money(state.spent),'Spent']]:[['—','Available'],['—','Reserved'],['—','Spent']]).map(([v,k])=>`<span>${k}<b>${v}</b></span>`).join('');
 $('operator-title').textContent=sim?(state.rigs.some(r=>r.status==='unknown')?'Reconcile before retrying.':state.rigs.some(r=>r.status==='stale')?'A worker needs attention.':state.rigs.length?'Budget reserved. Fleet staged.':'Waiting for test fees.'):'Ready to connect the evidence.';
 $('operator-body').textContent=sim?`${money(state.reserved)} is reserved for existing rigs. ${money(available(state))} remains available. New instances require a six-hour reservation and stay within the four-rig test limit. Advance time to receive simulated reports.`:'Signed activity and accepted fixture receipts are connected below. GPU benchmarks were completed separately; production GPU reporting, billing and automatic shutdown still need end-to-end validation.';
 if(!sim&&operatorReport){
  $('operator-title').textContent='Read-only evidence review';
  $('operator-body').textContent=operatorReport.advice.summary+' '+operatorReport.advice.proposals.map(p=>p.reason+' ['+p.evidence+']').join(' ')+' Local rules preview; AI model not connected. No actions executed.';
 }
 const rows=sim?state.events.slice(0,30).map(e=>({id:e.id+' / T+'+e.minute+'m',title:e.kind,detail:e.detail,status:'SIMULATED'})):[...(backend?[{id:'LOCAL / API',title:'Read-only controller connected',detail:`Observed ${backend.observedAt}. Fixture database: ${backend.fixtures.status}. Local fixture jobs: ${backend.fixtures.jobs??'unknown'}; checkpoints: ${backend.fixtures.checkpoints??'unknown'}. These are not live GPU rentals.`,status:'LOCAL BACKEND'}]:[]),...real];
 $('ledger').innerHTML=rows.length?rows.map(r=>`<div class="row"><span class="ref">${esc(r.id)}</span><div><b>${esc(r.title)}</b><p>${esc(r.detail)} ${r.link?`<a href="${r.link}" target="_blank" rel="noopener">Inspect record ↗</a>`:''}</p></div><span class="badge">${esc(r.status)}</span></div>`).join(''):'<div class="row"><p>No simulated events yet. Add test fees to begin.</p></div>';
}
function demo(){sim=true;if(!state.fees){fund(state,25000000);advance(state);}render()}
$('actual').onclick=()=>{sim=false;render()};$('simulation').onclick=demo;$('add').onclick=()=>{fund(state,10000000);render()};$('tick').onclick=()=>{advance(state);render()};$('reset').onclick=()=>{state=initial();render()};
$('rigs').onclick=e=>{const b=e.target.closest('[data-detail]');if(b)showRig(b.dataset.detail);if(e.target.closest('#empty-demo'))demo()};
function showRig(id){const r=state.rigs.find(r=>r.id===id);if(!r)return;selected=id;$('detail-title').textContent=id+' / '+r.status.toUpperCase();$('detail-content').innerHTML=`<div class="detail-grid"><span>GPU model<b>NVIDIA RTX 4090</b></span><span>Provider instance ID<b>Not rented / simulation</b></span><span>Remaining reservation<b>${money(r.remaining)}</b></span><span>Simulated billed usage<b>${money(r.spent)}</b></span><span>Worker checkpoints<b>${r.work} simulated reports</b></span><span>Measured hashrate<b>Not available</b></span></div><p class="detail-note">This is a test instance. Visual activity reflects simulated status, not a live GPU. Production records will link the provider instance, worker build, lease and invoice.</p><div class="detail-events">${state.events.filter(e=>e.detail.includes(id)).slice(0,5).map(e=>`${esc(e.id)} · T+${e.minute}m<br>${esc(e.detail)}`).join('<br><br>')}</div>${r.status!=='stopped'?`<div class="detail-actions"><button data-fault="stale">Simulate missed heartbeat</button><button data-fault="unknown">Simulate unknown outcome</button></div>`:''}`;if(!$('rig-dialog').open)$('rig-dialog').showModal()}
$('close-dialog').onclick=()=>$('rig-dialog').close();$('detail-content').onclick=e=>{const b=e.target.closest('[data-fault]');if(b){fault(state,selected,b.dataset.fault);render();showRig(selected)}};
$('download').onclick=()=>{const blob=new Blob([JSON.stringify({mode:sim?'simulation':'dated-local-evidence',exportedAt:new Date().toISOString(),data:sim?state:real},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='bithash-evidence.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};
render();
// Static hosting safely retains dated evidence when no backend is mounted.
async function pollBackend(){
 try{const response=await fetch('/api/status',{signal:AbortSignal.timeout(3000),cache:'no-store'});
  if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))throw Error('API unavailable');
  const data=await response.json();if(!validateSnapshot(data))throw Error('Invalid status');
  backend=data;backendReceivedAt=Date.now();backendConnected=true;
  operatorReport=null;
  try{const reviewResponse=await fetch('/api/operator',{signal:AbortSignal.timeout(2000),cache:'no-store'});
   if(reviewResponse.ok){const r=await reviewResponse.json();if(r.schema==='bithash.operator-report.v1'&&r.mode==='rules-preview'&&r.executionEnabled===false&&typeof r.advice?.summary==='string'&&Array.isArray(r.advice.proposals))operatorReport=r;}
  }catch{}
 }catch{backendConnected=false;operatorReport=null;}
 render();
}
pollBackend();const pollTimer=setInterval(pollBackend,5000);
const freshnessTimer=setInterval(()=>{if(!sim){$('worker-cards').innerHTML=workerCards(backend,backendReceivedAt,Date.now(),backendConnected)}},1000);
window.addEventListener('pagehide',()=>{clearInterval(pollTimer);clearInterval(freshnessTimer)},{once:true});
if(document.modelContext?.registerTool){const life=new AbortController();const tool={name:'add_bithash_test_fees',description:'Switch to simulation and add synthetic USD test fees. Reserves simulated rigs only; makes no payments.',inputSchema:{type:'object',properties:{dollars:{type:'integer',minimum:1,maximum:1000}},required:['dollars'],additionalProperties:false},annotations:{readOnlyHint:false},execute(input){if(!input||Object.keys(input).length!==1||!Number.isInteger(input.dollars)||input.dollars<1||input.dollars>1000)throw Error('Expected dollars integer 1–1000');fund(state,input.dollars*1000000);sim=true;render();return {simulation:true,fees:state.fees,rigs:state.rigs.length}}};try{Promise.resolve(document.modelContext.registerTool(tool,{signal:life.signal})).catch(()=>{});}catch{}window.addEventListener('pagehide',()=>life.abort(),{once:true});}

mountApprovals();


import {RECONCILIATION_CASES} from './reconciliation-simulation.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dollars=v=>{const n=BigInt(v);return '$'+n/1000000n+'.'+(n%1000000n).toString().padStart(6,'0').slice(0,2);};
export function reconciliationSimulationPanel(s,form){
 if(!s)return '';
 const control=(id,action,label)=>form('reconciliation-sim',`<input type="hidden" name="id" value="${esc(id)}"><input type="hidden" name="action" value="${action}">`,label);
 return `<section class="accent" id="reconciliation-simulation"><small>AUTOMATIC BOOKKEEPING · SIMULATION ONLY</small><h2>Reconcile the balances. Review the exceptions.</h2>
 <p>Each independent case starts with invented $20 card / $10 provider funds that stay excluded, plus 0.01 WBTC of sample project funds. One pending funding job at a time. Routine records reconcile automatically; uncertain results hold without another submission.</p>
 <p class="notice">These cases use invented records, an assumed $100,000/WBTC rate and example limits: $500 per batch, $1,000 per rolling day, $10 total fees per job. Records must be fresh within five simulated minutes, history complete and the match unique. No actual provider or wallet is connected to this ledger. Signing and broadcasting stay disabled.</p>
 ${form('reconciliation-sim','<input type="hidden" name="action" value="create"><label>Sample scenario<select name="scenario">'+RECONCILIATION_CASES.map(c=>`<option value="${c}">${esc(c.replaceAll('-',' '))}</option>`).join('')+'</select></label>','Start or reopen simulation case')}
 <p>Cases do not share funds or add up to a real treasury. One step every three seconds while running; one step represents a simulated minute. Successful matches are labelled “policy-reconciled simulation,” not exact provider-reference proof.</p>
 ${s.workerError?'<p class="notice">Simulation worker held. Saved accounting is retained.</p>':''}
 ${s.cases.map(w=>`<article><h3>${esc(w.caseId.replace('sim-','').replaceAll('-',' '))} · ${w.hold?'Review required':w.paused?'Paused':esc(w.jobs[0]?.state??'Ready')}</h3>
 ${w.hold?`<p class="notice">${esc(w.hold.replaceAll('_',' '))}. No retry or extra credit. Resolution uses synthetic evidence and stays paused.</p>`:''}
 <div class="grid"><div><p>Project card / provider</p><strong>${dollars(w.cardProject)} / ${dollars(w.providerProject)}</strong></div><div><p>Funds in transit</p><strong>${dollars(w.inTransit)}</strong></div><div><p>Recorded fees / usage</p><strong>${dollars(String(BigInt(w.conversionFees)+BigInt(w.cardFees)+BigInt(w.providerFees)))} / ${dollars(w.spent)}</strong></div></div>
 <p>Excluded starting funds: ${dollars(w.opening.cardMicrousd)} card / ${dollars(w.opening.providerMicrousd)} provider. ${w.receipts.length} unique sample records; ${w.jobs.reduce((a,j)=>a+j.attempts,0)} simulated transfer attempt(s).</p>
 <p>${w.jobs.map(j=>`${esc(j.id)}: ${esc(j.state)}${j.proof?' · '+esc(j.proof):''}`).join('<br>')}</p>
 ${!w.hold?control(w.caseId,w.paused?'resume':'pause',w.paused?'Resume simulation':'Pause simulation')+control(w.caseId,'step','Advance one simulation step'):w.hold==='sim_reversal_or_spend_shortfall'?'<p>The requested reversal exceeds this job’s remaining provider credit. This case stays held; it cannot be cleared by inventing a credit.</p>':control(w.caseId,'resolve','Resolve using corrected sample evidence')}
 <details><summary>Ledger entries</summary>${w.events.map(e=>`<p>${e.time}s · ${esc(e.kind)} · ${esc(e.id)} · ${esc(e.proof)}</p>`).join('')||'<p>No accepted sample records yet.</p>'}</details></article>`).join('')||'<p>No sample cases started yet.</p>'}</section>`;
}
export function reconciliationSimulationAction(sim,form){
 if(!sim)throw Error('simulation_not_connected');const a=form.get('action'),id=form.get('id');
 if(a==='create')sim.create(form.get('scenario'));else if(a==='step')sim.step(id);else if(a==='resolve')sim.step(id,{resolve:true});else sim.control(id,a);
 return 'Simulation bookkeeping updated. No real funds, signatures, broadcasts or GPU actions.';
}

import {SIMULATION_CASES} from './funding-jobs.js';
import {formatAmount} from './treasury-compute.js';
import {sampleFunding} from './automatic-funding.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const states={'awaiting-fees':'Awaiting simulated fees',proposed:'Funding reserved', 'awaiting-chain':'Awaiting chain confirmation', 'awaiting-card':'Awaiting SolCard credit','awaiting-provider':'Awaiting Runpod credit',complete:'Completed · simulation',failed:'Failed · reservation held',cancelled:'Cancelled',held:'Held by funding rules'};
export function fundingJobsPanel(s,form){
 if(!s)return '';
 return `<section class="accent" id="funding-jobs"><small>FUNDING JOB MANAGER / SIMULATION ONLY</small><h2>Follow one funding job from fees to compute credit.</h2><p>Standard cases use an invented 0.01 WBTC batch; operating presets can use a larger labelled batch. Each case has independent balances and $10 starting non-project Runpod credit. Nothing enters your real accounting. The worker advances one stage every three seconds while the local Operator is running; refresh this page to see progress.</p><div class="flow">Fees → 70/30 distribution → Funding rules → Transfer → SolCard → Runpod</div><p>Uses a frozen copy of your dry-run rules, with a clearly simulated $1/hour cost when the current rate is zero. Conversion uses the assumed price, with no simulated fees or spread. No wallet key, payment adapter or GPU executor is connected.</p>
 ${form('jobs-create',`<label>Simulation case<select name="scenario" style="display:block;padding:12px;background:#091321;color:white;font:inherit;border:1px solid #50657c;max-width:100%">${Object.entries(SIMULATION_CASES).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label><label class="check"><input type="checkbox" name="paused" value="yes"> Create paused so I can inspect each stage</label>`,'Create or reopen simulated job')}
 <p>Repeating the same case and rules reopens its existing job. Cases are separate scenarios; their balances must not be added together.</p>${s.workerError?'<p class="notice">Simulation worker is held after an error. Existing jobs are retained.</p>':''}
 ${s.jobs.length?s.jobs.map(j=>{
  const done=['complete','cancelled','failed','held'].includes(j.state),controls=(action,title)=>form('jobs-control',`<input type="hidden" name="id" value="${esc(j.id)}"><input type="hidden" name="action" value="${action}">`,title);
  const resolvable=!j.resolved&&({'transfer-unknown':'awaiting-chain','card-delayed':'awaiting-card','card-mismatch':'awaiting-card','provider-delayed':'awaiting-provider','provider-mismatch':'awaiting-provider'}[j.terms.scenario]===j.state);
  return `<article><small>${esc(SIMULATION_CASES[j.terms.scenario])} · ${esc(j.id)}</small><h3>${esc(states[j.state]??j.state)}${j.paused?' · PAUSED':''}</h3>${j.reason?`<p class="notice">${esc(j.reason.replaceAll('_',' '))}</p>`:''}
   <div class="grid"><div><p>WBTC reserved</p><strong>${formatAmount(j.balances.reservedUnits,8)}</strong></div><div><p>Simulated card balance</p><strong>$${formatAmount(j.balances.cardMicrousd,6)}</strong></div><div><p>Simulated project Runpod credit</p><strong>$${formatAmount(j.balances.projectProviderMicrousd,6)}</strong></div></div>
   <p>Invented fee batch: ${formatAmount(j.terms.totalFeeUnits,8)} WBTC. Transfer attempts: ${j.transferAttempts} · Reload attempts: ${j.providerReloadAttempts}. Other treasury: ${formatAmount(j.balances.otherUnits,8)} WBTC. These are invented records; real transfers and charges: 0.</p>
   <ol>${j.events.map(e=>`<li><strong>${esc(e.kind.replaceAll('-',' '))}</strong> · ${esc(e.at)}${e.netMicrousd?` · $${formatAmount(e.netMicrousd,6)}`:''}${e.amountUnits?` · ${formatAmount(e.amountUnits,8)} WBTC`:''}</li>`).join('')}</ol>
   ${!done?controls(j.paused?'resume':'pause',j.paused?'Resume simulated job':'Pause simulated job'):''}${['awaiting-fees','proposed'].includes(j.state)?controls('cancel','Cancel before simulated submission'):''}${resolvable?controls('resolve','Supply matching simulated confirmation'):''}
  </article>`;
 }).join(''):'<p>No simulated jobs yet.</p>'}</section>`;
}
export function fundingJobsAction(manager,automatic,action,form){
 if(!manager)throw Error('simulation_jobs_unavailable');
 if(action==='jobs-create'){
  if(!automatic)throw Error('automatic_funding_unavailable');
  const policy=sampleFunding(automatic.status().policy).policy,j=manager.create(policy,form.get('scenario')??'success');
  if(form.get('paused')==='yes'&&!['complete','cancelled','failed','held'].includes(j.state))manager.control(j.id,'pause');
  return 'Simulation job '+j.id+' is saved. Repeated requests reuse this case; real balances are unchanged.';
 }
 if(action==='jobs-control'){manager.control(form.get('id'),form.get('action'));return 'Simulation job updated. No real transfer, charge or GPU action.';}
 throw Error('unknown_simulation_action');
}

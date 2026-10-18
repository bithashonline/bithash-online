import {formatAmount} from './treasury-compute.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const usd=n=>'$'+formatAmount(n,6);
const descriptions={'start-simulated-session':'Automatic session admitted',hold:'Monitoring budget',paused:'Paused for review','request-funding':'Additional funding requested','wait-daily-window':'Waiting for daily budget to reopen'};
export function fleetBudgetPanel(s,form){
 if(!s)return '';
 return `<section class="accent" id="fleet-budget"><small>AUTONOMOUS FLEET BUDGET / SIMULATION</small><h2>Set the operating limits. Let routine work run.</h2><p>The Operator automatically reserves affordable sessions, renews within its budget and requests more funding when credit gets low. Abnormal price, stale data or inconsistent balances pause the simulation for review. These are deterministic checks; no AI model call or real fraud monitoring is running.</p>
 <div class="flow">Confirmed project credit → Reserve → Affordable fleet → Simulated spending → Next session</div><p>Try a $500 or $1,000 operating target. Each starts an independent invented fee-to-card-to-provider job. The initial $10 non-project credit is excluded, so new project credit is $490 or $990. These presets do not change any live budget or authority.</p>
 ${['500','1000'].map(amount=>form('fleet-preset',`<input type="hidden" name="amount" value="${amount}">`,`Run $${amount} autonomous simulation`)).join('')}
 <p>Example policy: 8 simulated GPUs maximum, $1/GPU-hour assumed, 6-hour sessions, $100/session, $12/hour, $50 reserve, and a daily cap equal to the operating target. A price increase above 20% triggers review. No real GPU availability or performance is implied.</p>
 <p>Clock: one simulated minute every three real seconds. Manual advance uses the same accounting. Rentals, transfers and card charges are disabled.</p>${s.workerError?'<p class="notice">Simulation worker held after an error; saved budgets remain intact.</p>':''}
 ${s.worlds.map(w=>{
  const active=w.sessions.find(v=>v.state==='running'),reserved=active?String(BigInt(active.reservationMicrousd)-BigInt(active.spentMicrousd)):'0',available=String([BigInt(w.creditMicrousd)-BigInt(w.spentMicrousd)-BigInt(reserved)-BigInt(w.policy.reserveMicrousd),0n].reduce((a,b)=>a>b?a:b));
  const control=(action,title)=>form('fleet-control',`<input type="hidden" name="id" value="${esc(w.id)}"><input type="hidden" name="action" value="${action}">`,title);
  return `<article><small>${usd(w.policy.operatingCapMicrousd)} TARGET · ${esc(w.id)}</small><h3>${esc(descriptions[w.decision?.action]??'Waiting for funding job')}</h3><p>${esc((w.decision?.reasons??[]).join(' · ').replaceAll('_',' '))}</p>${w.latch?`<p class="notice">Review required: ${esc(w.latch.replaceAll('_',' '))}. Clearing the simulated fault does not automatically resume spending.</p>`:''}
   <div class="grid"><div><p>Confirmed simulated project credit</p><strong class="value">${usd(w.creditMicrousd)}</strong></div><div><p>Spent / still reserved</p><strong>${usd(w.spentMicrousd)} / ${usd(reserved)}</strong></div><div><p>Free above ${usd(w.policy.reserveMicrousd)} reserve</p><strong class="value">${usd(available)}</strong></div></div>
   <p>${active?`${active.gpuCount} simulated GPUs · ${usd(active.hourlyMicrousd)}/hour · ${Math.max(0,Math.ceil((active.durationSeconds-active.elapsed)/60))} simulated minutes remaining`:'No active simulated session'} · Simulation time ${Math.floor(w.time/3600)}h ${Math.floor(w.time%3600/60)}m.</p>
   <p>${active?`Estimated runway at the active rate, retaining the reserve: ${formatAmount(String((BigInt(w.creditMicrousd)-BigInt(w.spentMicrousd)-BigInt(w.policy.reserveMicrousd))*100n/BigInt(active.hourlyMicrousd)),2)} simulated hours.`:''}</p><p>Funding source: ${esc(w.jobId)}. ${w.fundingRequest?`Replenishment requested: ${usd(w.fundingRequest.amountMicrousd)}. This request is recorded only; another payment or credit is not invented.`:'Only this case’s matched provider receipt funds its sessions.'}</p>
   ${control(w.paused||w.latch?'resume':'pause',w.paused||w.latch?'Acknowledge and resume simulation':'Pause simulated fleet')}${form('fleet-advance',`<input type="hidden" name="id" value="${esc(w.id)}"><input type="hidden" name="seconds" value="21600">`,'Advance 6 simulated hours')}
   <details><summary>Test abnormal activity</summary><p>Inject an artificial fault into this case. These buttons never change real provider records.</p>${['price-spike','balance-mismatch','stale-feed'].map(a=>control(a,'Simulate '+a.replaceAll('-',' '))).join('')}${control('clear-fault','Clear simulated fault')}</details>
   <details><summary>Session and budget history</summary>${w.sessions.slice(-12).map(v=>`<p>${esc(v.id)} · ${esc(v.state)} · ${v.gpuCount} simulated GPUs · ${usd(v.spentMicrousd)} spent / ${usd(v.reservationMicrousd)} admitted</p>`).join('')}${w.events.slice(-15).map(e=>`<p>${e.atSimulationSecond}s · ${esc(e.kind)}${e.reason?' · '+esc(e.reason):''}</p>`).join('')}</details></article>`;
 }).join('')||'<p>No fleet-budget simulation selected yet.</p>'}</section>`;
}
export function fleetBudgetAction(manager,action,form){
 if(!manager)throw Error('fleet_budget_unavailable');
 if(action==='fleet-preset'){manager.createPreset(form.get('amount'));return 'Autonomous operating simulation created or reopened. Live budget and rental authority are unchanged.';}
 if(action==='fleet-control'){manager.control(form.get('id'),form.get('action'));manager.step(form.get('id'));return 'Simulation control applied. No real GPU or payment action.';}
 if(action==='fleet-advance'){const seconds=form.get('seconds');if(!/^[0-9]{1,5}$/.test(seconds??''))throw Error('invalid_simulation_time_step');manager.step(form.get('id'),Number(seconds));return 'Simulated time advanced with budget accounting. No real compute used.';}
 throw Error('unknown_fleet_action');
}

import {formatAmount} from './treasury-compute.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const usd=v=>'$'+formatAmount(v,6),btc=v=>formatAmount(v,8)+' WBTC';
export function continuousFundingPanel(status,form){
 if(!status)return '';
 const w=status.world,active=w.sessions.find(s=>s.state==='running'),pending=w.jobs.find(j=>j.state!=='complete');
 const control=(action,label)=>form('continuous-control',`<input type="hidden" name="action" value="${action}">`,label);
 return `<section class="accent" id="continuous-funding"><small>CONTINUOUS REPLENISHMENT · SIMULATION ONLY</small><h2>Keep the fleet funded. Keep surplus in WBTC.</h2>
 <p>One shared sample treasury funds repeated cycles. The Operator checks runway, reserves a $100–$500 batch when needed, waits for matching simulated card/provider records, then funds the next affordable session.</p>
 <div class="flow">70% compute wallet → Needed batch → SolCard → Runpod credit → Fleet → Check runway again</div>
 <div class="grid"><div><p>Retained compute treasury</p><strong class="value">${btc(w.treasuryUnits)}</strong><p>${btc(w.reservedUnits)} reserved for a pending batch</p></div><div><p>Simulated card / Runpod balance</p><strong class="value">${usd(w.cardMicrousd)} / ${usd(w.providerMicrousd)}</strong><p>${usd(w.spentMicrousd)} simulated compute consumed</p></div><div><p>Affordable fleet</p><strong class="value">${active?.gpuCount??0} simulated GPUs</strong><p>${active?usd(active.hourlyMicrousd)+'/hour':'Waiting or paused'} · ${w.jobs.filter(j=>j.state==='complete').length} completed refills</p></div></div>
 <h3>${w.paused?'Simulation paused':w.latch?'Review required':esc(w.decision)}</h3>${w.latch?`<p class="notice">${esc(w.latch)}. No additional submission; saved funds and pending identity are retained.</p>`:''}${status.workerError?'<p class="notice">Worker error: simulated updates held.</p>':''}
 <p>${pending?`Pending ${esc(pending.id)} · ${esc(pending.state)} · ${usd(pending.amountMicrousd)} · ${pending.attempts} submission attempt(s).`:'No pending funding batch.'} Virtual time: ${Math.floor(w.time/3600)}h ${Math.floor(w.time%3600/60)}m. The 30% treasury retains ${btc(w.otherUnits)}.</p>
 <p><strong>Example limits:</strong> $500 maximum committed operating float, $1,000 converted per rolling day, $100 retained in WBTC and $50 provider reserve. Refill near 12 hours of runway; aim for 48 hours. Spending remains capped at 8 GPUs and $500/day. These are simulation settings, not live authority.</p>
 <p>Assumptions: $100,000/WBTC, $1/GPU-hour, zero conversion fees. Fleet budget uses confirmed sample fees over 72 hours or a seven-day reserve drawdown, constrained by available cash. It shrinks as funding dries up; fee inflow never raises the accepted GPU price. No future fee income is assumed.</p>
 ${form('continuous-fees','<label>Unique sample fee ID<input name="id" required maxlength="64" pattern="[a-zA-Z0-9_-]+" value="sample-launch-1"></label><label>Invented total fee batch<select name="units"><option value="10000000">0.1 WBTC · $10,000 assumed total</option><option value="1000000">0.01 WBTC · $1,000 assumed total</option><option value="100000">0.001 WBTC · $100 assumed total</option></select></label>','Add labelled sample fees · 70/30')}
 <p>Repeating the same ID cannot add money twice. No sample funds are generated in the background. Clock advances one simulated minute every three real seconds while this local Operator runs.</p>
 ${control(w.paused?'resume':'pause',w.paused?'Resume continuous simulation':'Pause continuous simulation')}${form('continuous-advance','<input type="hidden" name="seconds" value="21600">','Advance 6 simulated hours')}
 <details><summary>Test an exception</summary>${['unknown-transfer','receipt-mismatch','stale-feed','price-spike'].map(a=>control(a,'Simulate '+a.replaceAll('-',' '))).join('')}${control('resolve','Resolve with synthetic evidence · stay paused')}<p>Unknown-transfer and receipt-mismatch faults take effect when the next funding cycle reaches that stage. Resolving a fixture is not real reconciliation.</p></details>
 <details><summary>Shared funding history</summary>${w.jobs.slice(-10).map(j=>`<p>${esc(j.id)} · ${usd(j.amountMicrousd)} · ${esc(j.state)}${j.providerReceipt?' · matched synthetic provider receipt':''}</p>`).join('')||'<p>No refills yet.</p>'}</details>
 <p>Runpod prepaid credits cannot be withdrawn or refunded under its published policy. Keep excess treasury assets outside provider credit. <a href="https://docs.runpod.io/accounts-billing/billing#refunds-and-credits" target="_blank" rel="noreferrer">Billing policy</a></p></section>`;
}
export function continuousFundingAction(manager,action,form){
 if(!manager)throw Error('continuous_funding_unavailable');
 if(action==='continuous-fees')manager.addFees(form.get('id'),form.get('units'));
 else if(action==='continuous-control')manager.control(form.get('action'));
 else if(action==='continuous-advance'){if(form.get('seconds')!=='21600')throw Error('invalid_continuous_time_step');manager.step(21600);}
 else throw Error('unknown_continuous_action');
 return 'Continuous simulation updated. No real transfer, card charge or GPU action.';
}

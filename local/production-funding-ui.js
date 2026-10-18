import {formatAmount} from './treasury-compute.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function productionFundingPanel(s,form){
 if(!s)return '';
 return `<section class="accent" id="production-funding"><small>PRODUCTION FUNDING PATH · OBSERVE ONLY</small><h2>Inspect the transfer. Follow the evidence.</h2>
 <p>Existing owner-recorded WBTC funding plans now become durable observation jobs. The restricted signer interface checks the permitted transfer structure without loading a key. Supplied transaction signatures are verified against the exact wallet, destination, mint and amount before entering read-only reconciliation.</p>
 <div class="grid"><div><p>Restricted signer</p><strong class="value">Inspection only</strong><p>No wallet key loaded. Signing and broadcasting disabled.</p></div><div><p>SolCard records</p><strong class="value">${esc(s.connections.solcard.state)}</strong><p>${s.connections.solcard.fresh?'Fresh read':'Unavailable or stale'} · transfer-signature attribution missing.</p></div><div><p>Runpod records</p><strong class="value">${esc(s.connections.runpod.state)}</strong><p>${s.connections.runpod.fresh?'Fresh read':'Unavailable or stale'} · project-card attribution missing.</p></div></div>
 <p class="notice">Real balances and matching amounts do not prove project funding. Card/provider linkage remains incomplete; this path cannot post spendable credit, send funds or rent GPUs.</p>
 <p>${s.jobs.length} real-plan observation jobs. ${s.readiness.ownerLimitsConfigured?'Funding limits are configured; no signing authority is enabled.':'Owner funding limits are not configured.'} Live token-account/fee checks and authenticated fee origin remain prerequisites. A structural check uses an offline placeholder blockhash, not a live transaction preflight.</p>
 ${s.lastError?`<p class="notice">Observer held: ${esc(s.lastError)}</p>`:''}
 ${form('production-refresh','','Recheck production funding jobs · read only')}
 ${s.jobs.map(j=>`<article><h3>${esc(j.planId)} · ${esc(j.state.replaceAll('-',' '))}</h3><p>${formatAmount(j.terms.amount,8)} WBTC → ${esc(j.terms.recipient)}</p><p>${esc(j.reasons.join(' · ').replaceAll('_',' '))}</p><p>Transfer structure: ${esc(j.inspection?.structuralCheck??'not checked')}. Chain: ${esc(j.reconciliation?.chain?.state??'not verified')}. No credit posted.</p>${j.signature?`<p class="wallet">Observed signature: ${esc(j.signature)}</p>`:form('production-signature',`<input type="hidden" name="id" value="${esc(j.id)}"><label>Existing transaction signature (read-only lookup)<input name="signature" required maxlength="100" autocomplete="off"></label>`,'Track existing signature · does not send')}<details><summary>Observation history</summary>${j.events.map(e=>`<p>${esc(e.at)} · ${esc(e.kind)}</p>`).join('')}</details></article>`).join('')||'<p>No real funding plans exist yet. Simulation jobs are excluded; this worker does not create fees, plans or transfers.</p>'}
 <p>Checks every minute while the local Operator runs. Existing simulation controls remain below.</p></section>`;
}
export async function productionFundingAction(manager,action,form){
 if(!manager)throw Error('production_funding_unavailable');
 if(action==='production-refresh')await manager.tick();
 else if(action==='production-signature'){manager.attachSignature(form.get('id'),form.get('signature'));await manager.tick();}
 else throw Error('unknown_production_funding_action');
 return 'Production funding observation updated. Signing, broadcasting, credit posting and GPU actions remain disabled.';
}

// Pure shadow accounting. No payment, signer, treasury or provider-write access.
// Provider adjustments describe account effects, never proof of a card refund.
export const PROVIDER_ACCOUNTING_POLICY=Object.freeze({version:'runpod-account-shadow-v1',source:'authenticated-rest-billing-fixed-window',roundingPerObservationMicrousd:'2',roundingAbsoluteBudgetMicrousd:'100',balanceGraceMs:900000});
const n=v=>{if(typeof v!=='string'||! /^-?(0|[1-9][0-9]{0,17})$/.test(v))throw Error('shadow_provider_amount_invalid');return BigInt(v);};
const abs=v=>v<0n?-v:v;
export function usageCounter(data){
 if(data.usage?.source!==PROVIDER_ACCOUNTING_POLICY.source)throw Error('shadow_provider_usage_unavailable');
 if(data.usage.bucketSize!=='day'||!Number.isFinite(Date.parse(data.usage.start))||Date.parse(data.usage.start)%86400000!==0)throw Error('shadow_provider_usage_window_invalid');
 const value=n(data.usage.counterMicrousd);if(value<0n)throw Error('shadow_provider_usage_invalid');return value;
}
export function providerMovement(r){
 const value=n(r.amountMicrousd);
 if(!['STRIPE','CRYPTO','RUNPOD','COINBASE','WIRE','REFERRAL'].includes(r.medium))throw Error('shadow_provider_adjustment_needs_review');
 if(r.type==='RELOAD'&&r.medium==='STRIPE'&&value>0n)return {kind:'provider-reload-unattributed',delta:value};
 if(r.type==='CREDIT'&&value>0n)return {kind:'provider-credit-adjustment',delta:value};
 if(r.type==='DEBIT'&&value!==0n)return {kind:'provider-debit-adjustment',delta:-abs(value)};
 throw Error('shadow_provider_adjustment_needs_review');
}
export function openingProviderAccounting(data,at){
 const counter=String(usageCounter(data));return {policy:{...PROVIDER_ACCOUNTING_POLICY},windowStart:data.usage.start,bucketSize:data.usage.bucketSize,startedAt:at,openingCounter:counter,lastCounter:counter,usage:'0',usageReversals:'0',creditAdjustments:'0',debitAdjustments:'0',reloadReversals:'0',matchedReloadReversals:'0',rounding:'0',roundingAbsolute:'0',reducedReloads:{}};
}
export function reconcileProviderAccounting(w,data,rows,revisions,at){
 const p=w.providerAccounting;
 if(JSON.stringify(p.policy)!==JSON.stringify(PROVIDER_ACCOUNTING_POLICY))throw Error('shadow_provider_policy_mismatch');
 const counter=usageCounter(data),usageDelta=counter-n(p.lastCounter),events=[];
 if(data.usage.start!==p.windowStart||data.usage.bucketSize!==p.bucketSize)throw Error('shadow_provider_usage_window_changed');
 let recordDelta=0n;
 for(const r of rows){const movement=providerMovement(r);recordDelta+=movement.delta;events.push({id:'provider-'+r.id,recordId:r.id,kind:movement.kind,amount:String(movement.delta),at:r.occurredAt});}
 for(const r of revisions){const reduction=n(r.reduction);if(reduction<=0n)throw Error('shadow_provider_reversal_invalid');recordDelta-=reduction;events.push({id:'provider-reduction-'+r.id+'-'+r.nextAmount,recordId:r.id,kind:'provider-reload-amount-reduction',amount:String(-reduction),at,previousAmount:r.previousAmount,nextAmount:r.nextAmount});}
 if(usageDelta<0n&&-usageDelta>n(p.usage)-n(p.usageReversals))throw Error('shadow_provider_usage_reversal_exceeds_tracked');
 const expected=n(w.observation.providerBalance)+recordDelta-usageDelta,residual=n(data.balanceMicrousd)-expected;
 // Provider floats are truncated independently to microdollars. Keep bounded
 // rounding visible rather than silently crediting an unexplained difference.
 if(abs(residual)>n(p.policy.roundingPerObservationMicrousd))throw Error('shadow_provider_balance_pending');
 if(n(p.roundingAbsolute)+abs(residual)>n(p.policy.roundingAbsoluteBudgetMicrousd))throw Error('shadow_provider_rounding_budget_exceeded');
 if(usageDelta!==0n)events.push({id:'provider-usage-'+at,kind:usageDelta>0n?'provider-account-usage':'provider-usage-counter-reversal',amount:String(-usageDelta),at,source:p.policy.source});
 if(residual!==0n)events.push({id:'provider-rounding-'+at,kind:'provider-microdollar-rounding',amount:String(residual),at});
 for(const e of events){const amount=n(e.amount);if(e.kind==='provider-credit-adjustment')p.creditAdjustments=String(n(p.creditAdjustments)+amount);if(e.kind==='provider-debit-adjustment')p.debitAdjustments=String(n(p.debitAdjustments)-amount);if(e.kind==='provider-reload-amount-reduction')p.reloadReversals=String(n(p.reloadReversals)-amount);}
 for(const r of revisions){p.reducedReloads['record-'+r.id]=true;if(w.pairs.some(pair=>pair.reloadId===r.id))p.matchedReloadReversals=String(n(p.matchedReloadReversals)+n(r.reduction));}
 if(usageDelta>0n)p.usage=String(n(p.usage)+usageDelta);else p.usageReversals=String(n(p.usageReversals)-usageDelta);
 if(n(p.matchedReloadReversals)>n(w.proposedProviderFunding))throw Error('shadow_provider_reversal_exceeds_matched');
 p.lastCounter=String(counter);p.rounding=String(n(p.rounding)+residual);p.roundingAbsolute=String(n(p.roundingAbsolute)+abs(residual));
 return events;
}


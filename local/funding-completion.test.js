import test from 'node:test';
import assert from 'node:assert/strict';
import {FundingCoordinator} from './funding-coordinator.js';
import {coordinatorFixture} from './funding-coordinator-sample.js';
import {handoffEnvelope} from './funding-handoff.js';
import {WBTC} from './treasury-compute.js';
function setup(t){
 let now=Date.parse('2026-10-19T00:00:00Z');const d=coordinatorFixture(now);d.evidenceKind='real-records';d.treasury.plans=[];
 for(const p of ['solcard','runpod'])Object.assign(d.records.feeds[p].data,{connection:'authenticated-api',accountRef:(p==='solcard'?'a':'b').repeat(64),records:[],coverage:{invoiceDetailsIncomplete:false},assetMint:WBTC.mint});
 d.shadow.ledger.baseline={solcard:{accountRef:'a'.repeat(64)},runpod:{accountRef:'b'.repeat(64)}};d.shadow.ledger.pairs=[];
 const c=new FundingCoordinator(':memory:',{observe:()=>structuredClone(d),clock:()=>now});t.after(()=>c.close());const j=c.tick().jobs[0];
 return {c,d,j,settle(){now+=1000;const at=new Date(now).toISOString();for(const p of ['solcard','runpod'])d.records.feeds[p].data.observedAt=at;d.shadow.ledger.lastCheck=at;
 d.production.jobs=[{id:'observed-one',planId:j.id,mode:'observe-only',terms:{owner:j.owner,recipient:j.recipient,amount:j.amount,mint:j.mint},signature:'3'.repeat(88),state:'awaiting-card',reconciliation:{chain:{state:'finalized',signature:'3'.repeat(88),amount:j.amount,slot:123}}}];
 d.records.feeds.solcard.data.records=[{id:'credit',occurredAt:at,status:'COMPLETED',amountMicrousd:'100000000',invoice:{id:'invoice',asset:'WBTC',status:'SUCCESS',paymentStatus:'PAID',detail:{state:'read',status:'PAID',network:'SOLANA',address:j.recipient,paidAmount:'0.001',refundPresent:false}}},{id:'debit',occurredAt:at,status:'COMPLETED',amountMicrousd:'-100000000',description:'RunPod'}];
 d.records.feeds.runpod.data.records=[{id:'reload',occurredAt:at,status:'provider-reported-completed',amountMicrousd:'100000000',type:'RELOAD',medium:'STRIPE'}];
 d.shadow.ledger.pairs=[{reloadId:'reload',cardId:'debit',amount:'100000000'}];d.shadow.ledger.proposedProviderFunding='100000000';
 d.automatic.input.provider.balanceMicrousd=d.records.feeds.runpod.data.balanceMicrousd='110000000';
 }};
}
test('production records close observation and retain consumed allocations without real credit',t=>{
 const f=setup(t);f.settle();let s=f.c.tick();assert.equal(s.jobs[0].state,'policy-complete-observation');assert.equal(s.jobs[0].completion.exactCrossProviderProof,false);assert.equal(s.view.dryReservedWbtcUnits,'0');assert.equal(s.realCreditPostedMicrousd,'0');
 f.c.tick();f.d.automatic.input.provider.balanceMicrousd=f.d.records.feeds.runpod.data.balanceMicrousd='10000000';s=f.c.tick();assert.equal(s.jobs.length,2);assert.equal(s.jobs[1].allocations[0].startUnits,'100000');assert.doesNotThrow(()=>handoffEnvelope(f.c.handoffSnapshot(),Date.parse(s.view.evaluatedAt)));
});
test('missing, stale, baseline, refunded or partial data never closes production observation',t=>{
 for(const mutate of [f=>f.d.records.feeds.solcard.data.records[0].invoice.detail.refundPresent=true,f=>f.d.shadow.ledger.pairs=[],f=>f.d.records.feeds.solcard.data.coverage.invoiceDetailsIncomplete=true,f=>f.d.records.feeds.solcard.data.records[0].occurredAt='2026-10-18T00:00:00Z',f=>f.d.records.feeds.solcard.data.accountRef='c'.repeat(64)]){
  const f=setup(t);f.settle();mutate(f);const s=f.c.tick();assert.notEqual(s.jobs[0].state,'policy-complete-observation');assert.equal(s.view.dryReservedWbtcUnits,'100000');
 }
});
test('reversal or changed accepted completion holds instead of allowing further funding',t=>{
 const f=setup(t);f.settle();assert.equal(f.c.tick().jobs[0].state,'policy-complete-observation');f.d.records.feeds.runpod.data.records[0].amountMicrousd='80000000';const s=f.c.tick();assert.equal(s.hold.reason,'coordinator_completion_changed');assert.equal(s.jobs.length,1);
});
test('definitively failed finalized transfer releases WBTC allocation with history retained',t=>{
 const f=setup(t);f.settle();f.d.production.jobs[0].state='chain-failed';f.d.production.jobs[0].reconciliation.chain={state:'failed',slot:123};let s=f.c.tick();assert.equal(s.jobs[0].state,'finalized-transfer-failed');assert.equal(s.view.dryReservedWbtcUnits,'0');
 f.d.automatic.input.provider.balanceMicrousd='0';s=f.c.tick();assert.equal(s.jobs.length,2);assert.equal(s.jobs[1].allocations[0].startUnits,'0');assert.notEqual(s.jobs[1].id,s.jobs[0].id);
});

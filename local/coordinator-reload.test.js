import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FundingCoordinator,COORDINATOR_FLAGS} from './funding-coordinator.js';
import {coordinatorFixture,coordinatorRecoveryWalkthrough} from './funding-coordinator-sample.js';
import {decideCoordinatorFunding} from './coordinator-reload-policy.js';
const now=Date.parse('2026-10-19T00:00:00Z');
function setup(t,{persistent=false,kind='sample-fixtures'}={}){
 const dir=persistent?mkdtempSync(join(tmpdir(),'reload-coord-')):null,data=coordinatorFixture(now);data.evidenceKind=kind;
 const options={observe:()=>structuredClone(data),clock:()=>now,evidenceKind:kind},path=dir?join(dir,'sample.sqlite'):':memory:';let c=new FundingCoordinator(path,options),serial=0;
 t.after(()=>{c.close();if(dir)rmSync(dir,{recursive:true,force:true});});
 return {data,get c(){return c;},restart(){c.close();c=new FundingCoordinator(path,options);},send(j,kind,extra={}){const e={source:'sample-fixtures',eventId:'sample-event-'+(++serial),kind,...extra};c.applySampleOutcome(j.id,e);return e;}};
}
function deposit(f,j,id='sample-deposit-one'){
 const e=f.send(j,'deposit-confirmed',{depositId:id,amountWbtcUnits:j.amount,cardCreditMicrousd:j.estimatedUsdMicros});
 f.data.automatic.input.wallet.amountUnits=String(BigInt(f.data.automatic.input.wallet.amountUnits)-BigInt(j.amount));
 f.data.automatic.input.card.balanceMicrousd=f.data.records.feeds.solcard.data.balanceMicrousd=j.estimatedUsdMicros;return e;
}
function complete(f,j,depositId='sample-deposit-one',reloadId='sample-reload-one'){
 const e=f.send(j,'complete',{depositId,reloadId,cardDebitMicrousd:'100000000',providerCreditMicrousd:'100000000'});
 f.data.automatic.input.card.balanceMicrousd=f.data.records.feeds.solcard.data.balanceMicrousd='0';
 f.data.automatic.input.provider.balanceMicrousd=f.data.records.feeds.runpod.data.balanceMicrousd='110000000';return e;
}
const decision=(mutate=()=>{})=>{const d=coordinatorFixture(now);mutate(d);return decideCoordinatorFunding(d.automatic.input,d.automatic.policy,now);};

test('reload sizing is $100 regardless of provider deficit; existing card float is retained',()=>{
 for(const provider of ['0','10000000','52000000'])for(const card of ['0','3160000','49999999']){
  const r=decision(d=>{d.automatic.input.provider.balanceMicrousd=provider;d.automatic.input.card.balanceMicrousd=card;});
  assert.equal(r.action,'would_top_up_solcard');assert.equal(r.amountWbtcUnits,'100000');assert.equal(r.estimatedUsdMicros,'100000000');assert.equal(r.reloadMicrousd,'100000000');
 }
 assert.equal(decision(d=>d.automatic.input.provider.balanceMicrousd='52000001').action,'hold');
 assert.equal(decision(d=>d.automatic.input.card.balanceMicrousd='100000000').action,'would_review_provider_reload');
});
test('full batch requires eligible fees, retained WBTC, daily allowance and card limits',()=>{
 for(const mutate of [d=>d.automatic.input.wallet.amountUnits='199999',d=>d.automatic.input.feeComputeUnits='99999',d=>d.automatic.policy.maxTransferUnits='99999',d=>d.automatic.input.dailyCommittedUnits='400001',d=>d.automatic.input.cardLimits.maxUnits='99999',d=>d.automatic.input.cardLimits.minUnits='100001']){
  const r=decision(mutate);assert.equal(r.action,'hold');assert.equal(r.amountWbtcUnits,'0');
 }
});
test('readiness safeguards are preserved by reload alignment',()=>{
 for(const mutate of [d=>d.automatic.input.routingVerified=false,d=>d.automatic.input.historyComplete=false,d=>d.automatic.input.gas.lamports='0',d=>d.automatic.input.card.status='LOCKED',d=>d.automatic.input.wallet.observedAt='2026-10-18T00:00:00Z',d=>d.automatic.input.pendingFunding=true,d=>d.automatic.input.cardLimits.observedAt=null])assert.equal(decision(mutate).action,'hold');
});
test('rounding up WBTC cannot overrun card float or USD daily limit',()=>{
 const d=coordinatorFixture(now);d.automatic.policy.assumedWbtcPriceMicrousd='99999000000';
 let r=decideCoordinatorFunding(d.automatic.input,d.automatic.policy,now);assert.equal(r.amountWbtcUnits,'100002');assert.ok(BigInt(r.estimatedUsdMicros)>=100000000n);
 r=decideCoordinatorFunding(d.automatic.input,d.automatic.policy,now,{dailyDepositMicrousd:'900000000'});assert.equal(r.action,'hold');
 d.automatic.input.card.balanceMicrousd='50000000';assert.equal(decideCoordinatorFunding(d.automatic.input,d.automatic.policy,now).action,'hold');
});
test('coordinator uses requested burn and freezes the effective reload policy',t=>{
 const f=setup(t);f.data.automatic.policy.hourlyMicrousd='0';f.data.planningHourlyMicrousd='1000000';const j=f.c.tick().jobs[0];assert.equal(j.amount,'100000');
 f.data.planningHourlyMicrousd='2000000';assert.equal(f.c.tick().hold.reason,'coordinator_job_terms_changed');
});
test('completion consumes allocations and subsequent low balance creates a new nonoverlapping job',t=>{
 const f=setup(t),j=f.c.tick().jobs[0];deposit(f,j);complete(f,j);let s=f.c.tick();assert.equal(s.jobs.length,1);assert.equal(s.view.dryReservedWbtcUnits,'0');assert.equal(s.view.sampleConsumedWbtcUnits,'100000');
 f.data.automatic.input.provider.balanceMicrousd=f.data.records.feeds.runpod.data.balanceMicrousd='10000000';s=f.c.tick();assert.equal(s.jobs.length,2);assert.notEqual(s.jobs[1].id,j.id);assert.equal(s.jobs[1].allocations[0].startUnits,'100000');assert.equal(s.view.dryReservedWbtcUnits,'100000');
 for(const k of Object.keys(COORDINATOR_FLAGS))assert.equal(s[k],false);assert.equal(s.realCreditPostedMicrousd,'0');
});
test('unknown outcome survives restart; delayed evidence completes same job without retry',t=>{
 const f=setup(t,{persistent:true}),j=f.c.tick().jobs[0];f.send(j,'unknown');f.restart();
 for(let i=0;i<3;i++){const s=f.c.tick();assert.equal(s.jobs.length,1);assert.equal(s.jobs[0].state,'sample-unknown');assert.equal(s.view.dryReservedWbtcUnits,j.amount);}
 deposit(f,j);const e=complete(f,j);f.c.tick();f.restart();const before=f.c.get();f.c.applySampleOutcome(j.id,e);assert.deepEqual(f.c.get(),before);assert.equal(f.c.tick().jobs.length,1);
});
test('declined reload retains deposited funds; cancellation cannot release or send them twice',t=>{
 const f=setup(t),j=f.c.tick().jobs[0];deposit(f,j);f.send(j,'reload-declined');
 assert.throws(()=>f.send(j,'failed-before-deposit',{evidence:'confirmed-no-transfer-no-card-credit'}),/release_not_proven/);
 for(let i=0;i<3;i++){const s=f.c.tick();assert.equal(s.jobs.length,1);assert.equal(s.jobs[0].state,'sample-reload-declined');}
 complete(f,j);assert.equal(f.c.tick().jobs[0].state,'sample-complete');
});
test('definite pre-deposit failure releases allocation but retains history and counts daily attempt',t=>{
 const f=setup(t),j=f.c.tick().jobs[0];f.send(j,'unknown');assert.throws(()=>f.send(j,'failed-before-deposit'),/release_not_proven/);
 f.send(j,'failed-before-deposit',{evidence:'confirmed-no-transfer-no-card-credit'});const s=f.c.tick();assert.equal(s.jobs.length,2);assert.equal(s.jobs[0].state,'sample-cancelled');assert.notEqual(s.jobs[1].id,j.id);assert.equal(s.jobs[1].allocations[0].startUnits,'0');assert.equal(s.view.dryReservedWbtcUnits,'100000');
});
test('mismatched and conflicting sample evidence fails atomically without releasing pending funds',t=>{
 const f=setup(t),j=f.c.tick().jobs[0],before=f.c.get();assert.throws(()=>f.send(j,'complete',{depositId:'sample-no',reloadId:'sample-no',cardDebitMicrousd:'100000000',providerCreditMicrousd:'100000000'}),/settlement_mismatch/);assert.deepEqual(f.c.get(),before);
 const e=deposit(f,j),saved=f.c.get();assert.throws(()=>f.c.applySampleOutcome(j.id,{...e,cardCreditMicrousd:'99999999'}),/event_changed/);assert.deepEqual(f.c.get(),saved);
 assert.throws(()=>f.send(j,'complete',{depositId:'sample-deposit-one',reloadId:'sample-reload-one',cardDebitMicrousd:'100000000',providerCreditMicrousd:'80000000'}),/settlement_mismatch/);
 assert.equal(f.c.tick().view.dryReservedWbtcUnits,j.amount);
});
test('a sample reload reference cannot settle multiple jobs',t=>{
 const f=setup(t),j=f.c.tick().jobs[0];deposit(f,j);complete(f,j);f.data.automatic.input.provider.balanceMicrousd='0';const next=f.c.tick().jobs.at(-1);deposit(f,next,'sample-deposit-two');
 assert.throws(()=>complete(f,next,'sample-deposit-two','sample-reload-one'),/evidence_reused/);assert.equal(f.c.tick().jobs.at(-1).state,'sample-awaiting-reload');
});
test('real-record coordinator rejects every fixture lifecycle action without changes',t=>{
 const f=setup(t,{kind:'real-records'}),j=f.c.tick().jobs[0],before=f.c.get();
 for(const kind of ['unknown','deposit-confirmed','reload-declined','complete','failed-before-deposit'])assert.throws(()=>f.send(j,kind),/sample_only/);
 assert.deepEqual(f.c.get(),before);
});
test('lifecycle cannot clear a policy hold or overwrite terminal outcomes',t=>{
 const f=setup(t),j=f.c.tick().jobs[0];f.data.automatic.policy.hourlyMicrousd='2000000';f.c.tick();assert.throws(()=>f.send(j,'unknown'),/observation_unready/);
 const g=setup(t),other=g.c.tick().jobs[0];g.send(other,'failed-before-deposit',{evidence:'confirmed-no-transfer-no-card-credit'});assert.throws(()=>g.send(other,'unknown'),/job_terminal/);
});
test('four complete cycles and failure recovery conserve finite sample funds and stop at daily attempt limit',()=>{
 const s=coordinatorRecoveryWalkthrough(),w=s.result;
 assert.equal(w.jobs.length,5);assert.equal(w.jobs.filter(j=>j.state==='sample-complete').length,4);assert.equal(w.jobs.filter(j=>j.state==='sample-cancelled').length,1);assert.equal(w.view.dryReservedWbtcUnits,'0');assert.equal(w.view.sampleConsumedWbtcUnits,'400000');
 assert.equal(s.remainingComputeWbtcUnits,'300000');assert.equal(s.otherTreasuryWbtcUnits,'300000');assert.equal(s.simulatedUsageMicrousd,'400000000');assert.equal(BigInt(s.remainingComputeWbtcUnits)*1000n+BigInt(s.simulatedUsageMicrousd),700000000n);
 assert.equal(w.view.decision.action,'hold');assert.ok(w.view.decision.reasons.includes('full_reload_batch_not_available_within_limits'));assert.equal(w.realPlansCreated,0);assert.equal(w.realCreditPostedMicrousd,'0');
});


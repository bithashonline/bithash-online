import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ReconciliationSimulation,RECONCILIATION_POLICY} from './reconciliation-simulation.js';
import {reconciliationSimulationPanel,reconciliationSimulationAction} from './reconciliation-simulation-ui.js';
import {ComputeTreasury} from './treasury-compute.js';
import {treasuryAction} from './treasury-console.js';
function fixture(t,name='normal'){const sim=new ReconciliationSimulation(':memory:');t.after(()=>sim.close());sim.create(name);return sim;}
const complete=(sim,id='sim-normal')=>{for(let i=0;i<4;i++)sim.step(id);return sim.get(id);};
const base=(w,kind,fields={})=>({source:'simulation',id:'sim-custom-'+kind,jobId:w.jobs[0].id,kind,at:w.time,completeHistory:true,matches:1,card:'sim-project-card',provider:'sim-project-runpod',...fields});
const card=(w,fields={})=>base(w,'card',{invoiceId:'sim-invoice-'+w.jobs[0].id,paidUnits:'100000',status:'settled',net:'98000000',fee:'2000000',cardBalance:'118000000',...fields});

test('normal case accounts for net conversion, card fee and provider fee while excluding starting funds',t=>{
 const sim=fixture(t),w=complete(sim);assert.equal(w.jobs[0].state,'complete');assert.equal(w.jobs[0].proof,'policy-reconciled-simulation');assert.equal(w.cardProject,'7000000');assert.equal(w.providerProject,'89000000');assert.equal(w.walletUnits,'900000');assert.equal(w.inTransit,'0');assert.equal(w.conversionFees,'2000000');assert.equal(w.cardFees,'1000000');assert.equal(w.providerFees,'1000000');assert.equal(w.opening.cardMicrousd,'20000000');assert.equal(w.opening.providerMicrousd,'10000000');assert.equal(w.receipts.length,4);
});
test('one pending operation, fixed policy and idempotent job identity prevent duplicate submissions',t=>{
 const sim=fixture(t);assert.deepEqual(sim.create('normal'),sim.get('sim-normal'));assert.throws(()=>sim.begin('sim-normal','sim-job-2','100000'),/pending_job/);assert.equal(sim.begin('sim-normal','sim-job-1','100000').jobs.length,1);assert.throws(()=>sim.begin('sim-normal','sim-job-1','100001'),/job_conflict/);assert.equal(sim.get('sim-normal').jobs[0].attempts,1);
});
test('duplicate receipt applies once; changed replay latches review without posting',t=>{
 const sim=fixture(t);sim.step('sim-normal');const w=sim.get('sim-normal'),e=w.receipts[0].event;assert.deepEqual(sim.observe('sim-normal',e),w);const out=sim.observe('sim-normal',{...e,units:'1'});assert.equal(out.hold,'sim_receipt_conflict');assert.equal(out.walletUnits,w.walletUnits);assert.equal(out.receipts.length,1);
});
test('freshness, complete history, account identity and unique match are required',t=>{
 for(const patch of [{at:999},{at:-1},{completeHistory:false},{matches:2},{card:'sim-other-card'},{provider:'sim-other-provider'},{paidUnits:'1'},{invoiceId:'sim-other-invoice'},{net:'0'},{status:'pending'}]){
  const sim=fixture(t);sim.step('sim-normal');const w=sim.get('sim-normal');const out=sim.observe('sim-normal',card(w,patch));assert.ok(out.hold);assert.equal(out.cardProject,'0');assert.equal(out.inTransit,'100000000');assert.equal(out.receipts.length,1);
 }
});
test('stale observations stay held even when the amount matches',t=>{
 const sim=fixture(t);sim.step('sim-normal');const w=sim.get('sim-normal');sim.advance('sim-normal',301);const out=sim.observe('sim-normal',card(w));assert.equal(out.hold,'sim_stale_or_future_evidence');assert.equal(out.cardProject,'0');
});
test('unknown transfer cannot be retried and corrected synthetic proof stays paused',t=>{
 const sim=fixture(t,'unknown-transfer');sim.step('sim-unknown-transfer');const w=sim.get('sim-unknown-transfer');assert.equal(w.hold,'sim_chain_unconfirmed');assert.equal(w.walletUnits,'1000000');for(let i=0;i<5;i++)sim.step(w.caseId);assert.deepEqual(sim.get(w.caseId),w);assert.throws(()=>sim.control(w.caseId,'resume'),/review_required/);sim.step(w.caseId,{resolve:true});const resolved=sim.get(w.caseId);assert.equal(resolved.hold,null);assert.equal(resolved.paused,true);assert.equal(resolved.jobs[0].attempts,1);sim.control(w.caseId,'resume');for(let i=0;i<3;i++)sim.step(w.caseId);assert.equal(sim.get(w.caseId).jobs[0].state,'complete');
});
test('ambiguous and inconsistent balances never post credit; invalid resolution preserves hold',t=>{
 for(const name of ['ambiguous','balance-gap']){const sim=fixture(t,name),key='sim-'+name;sim.step(key);sim.step(key);const w=sim.get(key);assert.ok(w.hold);assert.equal(w.cardProject,'0');const bad=sim.observe(key,card(w,{cardBalance:'999'}),{resolve:true});assert.ok(bad.hold);assert.equal(bad.receipts.length,1);sim.step(key,{resolve:true});assert.equal(sim.get(key).paused,true);assert.equal(sim.get(key).cardProject,'98000000');}
});
test('delayed records do not invent a retry, then reconcile when the sample arrives',t=>{
 const sim=fixture(t,'delayed');for(let i=0;i<4;i++)sim.step('sim-delayed');assert.equal(sim.get('sim-delayed').jobs[0].state,'awaiting-card');for(let i=0;i<3;i++)sim.step('sim-delayed');const w=sim.get('sim-delayed');assert.equal(w.jobs[0].state,'complete');assert.equal(w.jobs[0].attempts,1);
});
test('timeout holds uncertain commitments and never replenishes automatically',t=>{
 const sim=fixture(t);sim.advance('sim-normal',86401);assert.equal(sim.get('sim-normal').hold,'sim_settlement_timeout');assert.throws(()=>sim.begin('sim-normal','sim-new','100000'),/review_or_pause/);assert.equal(sim.get('sim-normal').jobs.length,1);
});
test('settled refund reverses provider credit once and keeps nonrefunded fees',t=>{
 const sim=fixture(t,'refund');complete(sim,'sim-refund');sim.step('sim-refund');const w=sim.get('sim-refund');assert.equal(w.jobs[0].state,'refunded');assert.equal(w.cardProject,'96000000');assert.equal(w.providerProject,'0');assert.equal(w.inTransit,'0');assert.equal(w.jobs[0].fees,'4000000');const refund=w.receipts.at(-1).event;assert.deepEqual(sim.observe('sim-refund',refund),w);const bad=sim.observe('sim-refund',{...refund,id:'sim-second-refund'});assert.ok(bad.hold);assert.equal(bad.cardProject,'96000000');
});
test('refund after spent credit is held without borrowing personal starting funds',t=>{
 const sim=fixture(t,'refund-after-spend');for(let i=0;i<6;i++)sim.step('sim-refund-after-spend');const w=sim.get('sim-refund-after-spend');assert.equal(w.hold,'sim_reversal_or_spend_shortfall');assert.equal(w.spent,'5000000');assert.equal(w.providerProject,'84000000');assert.equal(w.cardProject,'7000000');assert.equal(w.opening.providerMicrousd,'10000000');
});
test('cumulative fees cannot exceed the per-job cap',t=>{
 const sim=fixture(t);sim.step('sim-normal');let w=sim.get('sim-normal');sim.observe('sim-normal',card(w,{net:'91000000',fee:'9000000',cardBalance:'111000000'}));w=sim.get('sim-normal');const out=sim.observe('sim-normal',base(w,'charge',{status:'settled',merchant:'RUNPOD',principal:'80000000',fee:'2000000',cardBalance:'29000000'}));assert.equal(out.hold,'sim_fee_limit');assert.equal(out.cardProject,'91000000');assert.equal(out.cardFees,'0');
});
test('batch limits are enforced; completed cases do not mint new funds',t=>{
 const sim=fixture(t);complete(sim);assert.throws(()=>sim.begin('sim-normal','sim-big','500001'),/batch_limit/);const next=sim.begin('sim-normal','sim-job-2','500000');assert.equal(next.walletUnits,'900000');assert.equal(next.jobs.length,2);assert.equal(next.jobs[1].attempts,1);
});
test('late synthetic proof resolves timeout without resubmission and restarts the observation deadline',t=>{
 const sim=fixture(t);sim.advance('sim-normal',86401);sim.step('sim-normal',{resolve:true});assert.equal(sim.get('sim-normal').paused,true);sim.control('sim-normal','resume');for(let i=0;i<3;i++)sim.step('sim-normal');const w=sim.get('sim-normal');assert.equal(w.hold,null);assert.equal(w.jobs[0].state,'complete');assert.equal(w.jobs[0].attempts,1);
});
test('partial refunds preserve the remaining job allocation and require the original charge',t=>{
 const sim=fixture(t);let w=complete(sim);w=sim.observe('sim-normal',base(w,'refund',{status:'settled',amount:'10000000',originalChargeId:'sim-charge-1',providerBalance:'89000000',cardBalance:'37000000'}));assert.equal(w.providerProject,'79000000');assert.equal(w.cardProject,'17000000');assert.equal(w.jobs[0].refunded,'10000000');const bad=sim.observe('sim-normal',base(w,'refund',{id:'sim-another-refund',status:'settled',amount:'10000000',originalChargeId:'sim-other-charge',providerBalance:'79000000',cardBalance:'47000000'}));assert.equal(bad.hold,'sim_refund_reference_mismatch');assert.equal(bad.providerProject,'79000000');
});
test('real evidence and malformed IDs are rejected before ledger mutation',t=>{
 const sim=fixture(t),before=sim.get('sim-normal');assert.throws(()=>sim.observe('sim-normal',{source:'authenticated-api',id:'sim-evidence'}),/real_evidence_forbidden/);assert.throws(()=>sim.observe('sim-normal',{source:'simulation',id:'real-tx'}),/simulation_id_required/);assert.deepEqual(sim.get('sim-normal'),before);assert.throws(()=>sim.create('real'),/unknown_case/);
});
test('database refuses real schemas; pending state and hold survive restart',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'bithash-reconcile-'));let sim;t.after(async()=>{sim?.close();await rm(dir,{recursive:true,force:true});});
 const wrong=join(dir,'wrong.sqlite'),db=new DatabaseSync(wrong);db.exec('CREATE TABLE treasury_plans(id TEXT)');db.close();assert.throws(()=>new ReconciliationSimulation(wrong),/simulation_database_required/);
 const path=join(dir,'sim.sqlite');sim=new ReconciliationSimulation(path);sim.create('unknown-transfer');sim.step('sim-unknown-transfer');const before=sim.get('sim-unknown-transfer');sim.close();sim=new ReconciliationSimulation(path);assert.deepEqual(sim.get('sim-unknown-transfer'),before);sim.step('sim-unknown-transfer');assert.deepEqual(sim.get('sim-unknown-transfer'),before);
});
test('failed durable save rolls back credit and receipt identity together',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'bithash-reconcile-rollback-')),path=join(dir,'sim.sqlite');const sim=new ReconciliationSimulation(path);t.after(async()=>{sim.close();await rm(dir,{recursive:true,force:true});});sim.create('normal');sim.step('sim-normal');const before=sim.get('sim-normal'),db=new DatabaseSync(path);db.exec("CREATE TRIGGER reject_update BEFORE UPDATE ON reconciliation_sim_cases BEGIN SELECT RAISE(ABORT,'fixture-save-failure'); END;");db.close();assert.throws(()=>sim.observe('sim-normal',card(before)),/fixture-save-failure/);assert.deepEqual(sim.get('sim-normal'),before);
});
test('simulation UI actions and completed bookkeeping cannot alter the real treasury',async t=>{
 const sim=new ReconciliationSimulation(':memory:'),ledger=new ComputeTreasury(':memory:',{clock:()=>0});t.after(()=>{sim.close();ledger.close();});const before=ledger.snapshot();await treasuryAction(ledger,'reconciliation-sim',new URLSearchParams({action:'create',scenario:'normal'}),{reconciliationSim:sim});complete(sim);assert.deepEqual(ledger.snapshot(),before);for(const key of ['signingEnabled','broadcastEnabled','paymentsEnabled','gpuExperimentsEnabled','automaticCreditPosting'])assert.equal(sim.status()[key],false);const html=reconciliationSimulationPanel(sim.status(),()=>'<button>sample</button>');assert.ok(html.includes('SIMULATION ONLY'));assert.ok(html.includes('policy-reconciled-simulation'));assert.ok(html.includes('$89.00'));assert.equal(RECONCILIATION_POLICY.maxPending,1);assert.throws(()=>reconciliationSimulationAction(sim,new URLSearchParams({action:'send',id:'sim-normal'})),/unknown_control/);
});

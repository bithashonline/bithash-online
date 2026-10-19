import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {FundingCoordinator,COORDINATOR_FLAGS} from './funding-coordinator.js';
import {coordinatorFixture,coordinatorWalkthrough} from './funding-coordinator-sample.js';
import {fundingCoordinatorPanel} from './funding-coordinator-ui.js';
const initial=Date.parse('2026-10-19T00:00:00Z');
function fixture(t,path=':memory:',kind='sample-fixtures'){
 let now=initial;const data=coordinatorFixture(now);data.evidenceKind=kind;
 const options={clock:()=>now,observe:()=>structuredClone(data),evidenceKind:kind};let coordinator=new FundingCoordinator(path,options);
 t.after(()=>coordinator.close());
 return {data,get coordinator(){return coordinator;},advance(ms=1000){now+=ms;return now;},restart(){coordinator.close();coordinator=new FundingCoordinator(path,options);}};
}
function pool(d){d.shadow.ledger.proposedProviderFunding='100000000';d.records.feeds.runpod.data.balanceMicrousd='110000000';d.quote={source:'provider-read-only',observedAt:new Date(initial).toISOString(),hourlyMicrousd:'1000000',baselineMicrousd:'1000000'};}
function link(d,j){d.production.jobs=[{id:'observer-1',planId:j.id,mode:'observe-only',terms:{owner:j.owner,recipient:j.recipient,amount:j.amount,mint:j.mint},signature:'3'.repeat(88),state:'awaiting-card',reconciliation:{chain:{state:'finalized'}}}];}
test('unlaunched real path stays empty and cannot consume sample observations',t=>{
 const f=fixture(t,':memory:','real-records');f.data.automatic.configuration=null;f.data.collection.configuration=null;let s=f.coordinator.tick();assert.equal(s.state,'awaiting-token-launch');assert.equal(s.jobs.length,0);assert.equal(s.receiptCount,0);
 f.data.evidenceKind='sample-fixtures';s=f.coordinator.tick();assert.equal(s.hold.reason,'coordinator_source_mode_mismatch');assert.equal(s.jobs.length,0);
});
test('one durable intent reserves exact receipt units without mutating source snapshots',t=>{
 const f=fixture(t),before=structuredClone(f.data);let s=f.coordinator.tick();assert.equal(s.state,'intent-recorded');assert.equal(s.jobs.length,1);const j=s.jobs[0];assert.equal(j.amount,'100000');assert.equal(j.allocations.reduce((v,r)=>v+BigInt(r.units),0n),100000n);assert.equal(j.inspection.structuralCheck,'passed');assert.equal(j.inspection.livePreflightVerified,false);
 for(let i=0;i<5;i++){f.advance();s=f.coordinator.tick();assert.equal(s.jobs.length,1);assert.equal(s.jobs[0].id,j.id);assert.equal(s.view.dryReservedWbtcUnits,j.amount);}
 assert.deepEqual(f.data,before);assert.equal(s.realPlansCreated,0);assert.equal(s.realCreditPostedMicrousd,'0');for(const key of Object.keys(COORDINATOR_FLAGS))assert.equal(s[key],false);
});
test('new receipts cannot cause another intent while the first is unresolved',t=>{
 const f=fixture(t);f.coordinator.tick();const r=structuredClone(f.data.automatic.receipts[0]);r.signature='4'.repeat(88);r.id=r.signature+':0';f.data.automatic.receipts.push(r);f.data.automatic.receiptCount=2;f.data.automatic.detectedComputeUnits=f.data.automatic.input.feeComputeUnits='1400000';const s=f.coordinator.tick();assert.equal(s.receiptCount,2);assert.equal(s.jobs.length,1);assert.ok(s.view.decision.reasons.includes('reconcile_existing_funding'));
});
test('receipt mutations, disappearance, duplicate rows and aggregate mismatch hold atomically',t=>{
 for(const change of [d=>{d.automatic.receipts[0].slot++;},d=>{d.automatic.receipts=[];d.automatic.receiptCount=0;d.automatic.detectedComputeUnits=d.automatic.input.feeComputeUnits='0';},d=>{d.automatic.receipts.push({...d.automatic.receipts[0]});d.automatic.receiptCount++;},d=>{d.automatic.detectedComputeUnits='700001';}]){
  const f=fixture(t);f.coordinator.tick();const before=f.coordinator.get();change(f.data);const s=f.coordinator.tick();assert.equal(s.state,'held');assert.equal(s.hold.latched,true);assert.deepEqual(f.coordinator.get().receipts,before.receipts);assert.deepEqual(s.jobs,before.jobs);assert.equal(s.view.budget.action,'hold');
 }
});
test('receipt source, mint and 70/30 split must agree with configuration',t=>{
 for(const mutate of [r=>r.source='owner-recorded',r=>r.quoteMint='wrong',r=>r.computeWallet='wrong',r=>r.computeUnits='700001',r=>r.slot=0,r=>r.id='fake']){const f=fixture(t);mutate(f.data.automatic.receipts[0]);const s=f.coordinator.tick();assert.equal(s.state,'held');assert.equal(s.jobs.length,0);assert.equal(s.receiptCount,0);}
});
test('changed destination and funding/decision policies never rebind an existing intent',t=>{
 for(const mutate of [d=>d.profile.depositAddress=d.automatic.configuration.otherWallet,d=>d.profile.policy.maxTransferWbtcUnits='900000',d=>d.automatic.policy.hourlyMicrousd='2000000']){const f=fixture(t);const j=f.coordinator.tick().jobs[0];mutate(f.data);const s=f.coordinator.tick();assert.equal(s.hold.reason,'coordinator_job_terms_changed');assert.deepEqual(s.jobs[0],j);}
});
test('owner limit, missing policy and existing manual commitment prevent new intents',t=>{
 for(const mutate of [d=>d.profile.policy=null,d=>d.profile.policy.maxTransferWbtcUnits='10000',d=>d.profile.policy.maxTransferWbtcUnits=d.profile.policy.maxDailyWbtcUnits='50000',d=>d.automatic.input.committedUnits='10000']){const f=fixture(t);mutate(f.data);assert.equal(f.coordinator.tick().jobs.length,0);}
});
test('freshness, busy, incomplete fee history and shadow holds pause without losing reservations',t=>{
 for(const mutate of [d=>d.records.busy=true,d=>d.automatic.busy=true,d=>d.records.feeds.runpod.fresh=false,d=>d.automatic.feeObservation.complete=false,d=>d.shadow.state='held']){
  const f=fixture(t);const j=f.coordinator.tick().jobs[0],before=structuredClone(f.data);mutate(f.data);const s=f.coordinator.tick();assert.equal(s.state,'held');assert.equal(s.hold.latched,false);assert.deepEqual(s.jobs[0],j);Object.assign(f.data,before);assert.equal(f.coordinator.tick().state,'intent-recorded');
 }
});
test('stale UI never exposes an actionable previous budget',t=>{
 const f=fixture(t);pool(f.data);assert.equal(f.coordinator.tick().view.budget.action,'would-propose-fleet');f.advance(300001);const s=f.coordinator.status();assert.equal(s.stale,true);assert.equal(s.view.budget.action,'hold');assert.equal(s.view.budget.gpuCount,0);assert.equal(s.view.decision.amountWbtcUnits,'0');
});
test('only an explicit production plan id with exact frozen terms links an existing observation',t=>{
 const f=fixture(t);const j=f.coordinator.tick().jobs[0];link(f.data,j);f.data.production.jobs[0].planId='unrelated-same-amount';assert.equal(f.coordinator.tick().jobs[0].signature,null);f.data.production.jobs[0].planId=j.id;let s=f.coordinator.tick();assert.equal(s.jobs[0].state,'awaiting-settlement-attribution');assert.equal(s.jobs[0].productionJobId,'observer-1');assert.equal(s.realCreditPostedMicrousd,'0');f.data.production.jobs[0].signature='4'.repeat(88);s=f.coordinator.tick();assert.equal(s.hold.reason,'coordinator_signature_changed');
});
test('conflicting or missing production observations stay held; no guessed completion',t=>{
 for(const mutate of [d=>d.production.jobs[0].terms.amount='123',d=>d.production.jobs.push({...d.production.jobs[0]}),d=>d.production.jobs[0].state='complete',d=>d.production.jobs=[]]){const f=fixture(t);const j=f.coordinator.tick().jobs[0];link(f.data,j);f.coordinator.tick();mutate(f.data);assert.equal(f.coordinator.tick().state,'held');}
});
test('pooled budget excludes opening credit, subtracts account usage/debits and matched reversals',t=>{
 const f=fixture(t);pool(f.data);Object.assign(f.data.shadow.ledger.providerAccounting,{usage:'10000000',usageReversals:'2000000',debitAdjustments:'3000000',matchedReloadReversals:'4000000'});let s=f.coordinator.tick();assert.equal(s.view.budget.projectedCreditMicrousd,'85000000');assert.equal(s.view.budget.spendableCreditMicrousd,'0');assert.equal(s.view.budget.action,'would-propose-fleet');
 f.data.records.feeds.runpod.data.balanceMicrousd='1000000';s=f.coordinator.tick();assert.equal(s.view.budget.projectedCreditMicrousd,'1000000');assert.equal(s.view.budget.gpuCount,0);
});
test('no live quote, abnormal pricing or unallocated spend prevents a fleet proposal',t=>{
 for(const mutate of [d=>d.quote=null,d=>d.quote.hourlyMicrousd='9000000',d=>d.treasury.spentMicrousd='1000000']){const f=fixture(t);pool(f.data);mutate(f.data);const s=f.coordinator.tick();assert.equal(s.view.budget.action,'hold');assert.equal(s.view.budget.gpuCount,0);}
});
test('latched review survives restart without replaying receipts or releasing intents',t=>{
 const dir=mkdtempSync(join(tmpdir(),'coordinator-'));const f=fixture(t,join(dir,'journal.sqlite'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const before=f.coordinator.tick();f.restart();const after=f.coordinator.tick();assert.deepEqual(after.jobs,before.jobs);assert.equal(after.receiptCount,1);f.data.profile.depositAddress=f.data.automatic.configuration.otherWallet;const held=f.coordinator.tick();f.restart();assert.deepEqual(f.coordinator.tick().jobs,held.jobs);assert.equal(f.coordinator.status().hold.latched,true);
});
test('clock rollback and runtime execution capabilities are rejected',t=>{
 const f=fixture(t);f.coordinator.tick();f.advance(-1);assert.equal(f.coordinator.tick().hold.reason,'coordinator_clock_rollback');const g=fixture(t);g.data.production.signer.keyLoaded=true;assert.equal(g.coordinator.tick().hold.reason,'coordinator_execution_enabled');
});
test('coordinator database cannot be shared with production or sample storage',t=>{
 const dir=mkdtempSync(join(tmpdir(),'coordinator-mode-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'journal.sqlite'),d=coordinatorFixture(initial);const c=new FundingCoordinator(path,{observe:()=>d,evidenceKind:'sample-fixtures'});c.close();assert.throws(()=>new FundingCoordinator(path,{observe:()=>d}),/database_mode/);const other=join(dir,'other.sqlite'),db=new DatabaseSync(other);db.exec('CREATE TABLE treasury_plans(id TEXT)');db.close();assert.throws(()=>new FundingCoordinator(other,{observe:()=>d}),/separate_database/);
});
test('same-engine isolated walkthrough reaches budget projection without resolving missing payment attribution',()=>{
 const sample=coordinatorWalkthrough();assert.equal(sample.mode,'sample-fixtures');assert.equal(sample.result.jobs.length,1);assert.equal(sample.result.jobs[0].state,'awaiting-settlement-attribution');assert.equal(sample.result.view.budget.projectedCreditMicrousd,'95000000');assert.equal(sample.result.view.budget.gpuCount,7);assert.equal(sample.result.realCreditPostedMicrousd,'0');
});
test('console escapes provider-derived content and labels sample and projected credit',t=>{
 const f=fixture(t),s=f.coordinator.tick();s.view.reasons=['<script>'];const html=fundingCoordinatorPanel(s,()=>'<button>Refresh</button>',coordinatorWalkthrough());assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('ISOLATED WALKTHROUGH'));assert.ok(html.includes('$0 posted'));assert.ok(html.includes('not live preflight'));
});




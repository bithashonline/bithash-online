import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {FLEET_POLICY,FleetBudgetSimulation,planFleetBudget,validateFleetPolicy} from './fleet-budget.js';
import {SimulationFundingJobs} from './funding-jobs.js';
import {fleetBudgetPanel,fleetBudgetAction} from './fleet-budget-ui.js';
import {ComputeTreasury} from './treasury-compute.js';
import {treasuryAction} from './treasury-console.js';
const now=Date.parse('2026-10-18T23:00:00Z');
const input=()=>({creditMicrousd:'490000000',spentMicrousd:'0',reservedMicrousd:'0',dayCommittedMicrousd:'0',gpuHourlyMicrousd:'1000000',baselineHourlyMicrousd:'1000000',fundingVerified:true,feedFresh:true,balanceConsistent:true,activeSession:false});
function setup(t){const jobs=new SimulationFundingJobs(':memory:',{clock:()=>now}),fleet=new FleetBudgetSimulation(':memory:',{fundingJobs:jobs});t.after(()=>{fleet.close();jobs.close();});return {jobs,fleet};}
function complete(jobs,id){for(let i=0;i<5;i++)jobs.step(id);}
test('planner reserves affordable count and reports rate/runway with no rental authority',()=>{
 const p=planFleetBudget(input());assert.equal(p.action,'start-simulated-session');assert.equal(p.gpuCount,8);assert.equal(p.reservationMicrousd,'48000000');assert.equal(p.availableMicrousd,'440000000');assert.equal(p.hourlyMicrousd,'8000000');assert.equal(p.rentalExecutionEnabled,false);
});
test('credit, reserve, daily, session, hourly and GPU-count caps constrain independently',()=>{
 for(const [i,p,count] of [[{...input(),creditMicrousd:'65000000'},FLEET_POLICY,2],[{...input(),dayCommittedMicrousd:'490000000'},FLEET_POLICY,1],[input(),{...FLEET_POLICY,sessionCapMicrousd:'18000000'},3],[input(),{...FLEET_POLICY,hourlyCapMicrousd:'2000000'},2],[input(),{...FLEET_POLICY,maxGpus:1},1]])assert.equal(planFleetBudget(i,p).gpuCount,count);
 assert.equal(planFleetBudget({...input(),dayCommittedMicrousd:'500000000'}).action,'wait-daily-window');assert.equal(planFleetBudget({...input(),creditMicrousd:'50000000'}).action,'request-funding');
});
test('unverified credit, stale data, balance mismatch and abnormal quote never start a session',()=>{
 for(const x of [{fundingVerified:false},{feedFresh:false},{balanceConsistent:false},{gpuHourlyMicrousd:'1210000'},{creditMicrousd:'1000000000'},{spentMicrousd:'490000001'}])assert.equal(planFleetBudget({...input(),...x}).action,'hold');
 assert.equal(planFleetBudget({...input(),gpuHourlyMicrousd:'1200000'}).action,'start-simulated-session');
});
test('invalid policies and duplicate active-session proposals fail closed',()=>{
 for(const p of [{...FLEET_POLICY,maxGpus:0},{...FLEET_POLICY,durationSeconds:Infinity},{...FLEET_POLICY,reserveMicrousd:'500000000'},{...FLEET_POLICY,maxPriceIncreaseBps:-1}])assert.throws(()=>validateFleetPolicy(p));
 assert.equal(planFleetBudget({...input(),activeSession:true}).action,'hold');
});
test('500 preset completes funding then automatically reserves a fleet, excluding starting personal credit',t=>{
 const {jobs,fleet}=setup(t),w=fleet.createPreset('500');fleet.step(w.id);assert.equal(fleet.get(w.id).sessions.length,0);complete(jobs,w.jobId);fleet.step(w.id);
 const done=fleet.get(w.id);assert.equal(done.creditMicrousd,'490000000');assert.equal(done.sessions.length,1);assert.equal(done.sessions[0].gpuCount,8);assert.equal(jobs.get(w.jobId).balances.providerMicrousd,'500000000');assert.equal(jobs.get(w.jobId).balances.cardMicrousd,'25000000');
 assert.equal(fleet.createPreset('500').id,w.id);fleet.step(w.id);assert.equal(fleet.get(w.id).sessions.length,1);assert.equal(fleet.get(w.id).events.filter(e=>e.kind==='project-credit-imported').length,1);
});
test('1000 preset has its own larger fee fixture and never combines independent cases',t=>{
 const {jobs,fleet}=setup(t),a=fleet.createPreset('500'),b=fleet.createPreset('1000');complete(jobs,a.jobId);complete(jobs,b.jobId);fleet.step(a.id);fleet.step(b.id);assert.equal(fleet.get(a.id).creditMicrousd,'490000000');assert.equal(fleet.get(b.id).creditMicrousd,'990000000');assert.equal(jobs.get(b.jobId).terms.totalFeeUnits,'2000000');assert.equal(fleet.status().creditMicrousd,undefined);
});
test('sessions renew autonomously, spend settles once and reserve survives depleted budget',t=>{
 const {jobs,fleet}=setup(t),w=fleet.createPreset('500');complete(jobs,w.jobId);fleet.step(w.id);fleet.step(w.id,21600);let a=fleet.get(w.id);assert.equal(a.spentMicrousd,'48000000');assert.equal(a.sessions.length,2);
 for(let i=0;i<15;i++)fleet.step(w.id,21600);a=fleet.get(w.id);assert.ok(BigInt(a.creditMicrousd)-BigInt(a.spentMicrousd)>=50000000n);assert.equal(a.decision.action,'request-funding');assert.equal(a.sessions.filter(s=>s.state==='running').length,0);assert.equal(a.events.filter(e=>e.kind==='funding-requested').length,1);assert.equal(jobs.status().jobs.length,1);
});
test('daily admission cap survives multiple renewals and reopens conservatively',t=>{
 const {jobs,fleet}=setup(t);const base=fleet.createPreset('1000');complete(jobs,base.jobId);
 // A separate fleet store allows a deliberately smaller frozen policy on the same fixture.
 const f=new FleetBudgetSimulation(':memory:',{fundingJobs:jobs});t.after(()=>f.close());const w=f.attach(base.jobId,{...FLEET_POLICY,operatingCapMicrousd:'1000000000',dailyCapMicrousd:'48000000'});f.step(w.id);f.step(w.id,21600);assert.equal(f.get(w.id).decision.action,'wait-daily-window');for(let i=0;i<4;i++)f.step(w.id,21600);assert.equal(f.get(w.id).sessions.length,2);
});
test('pause settles elapsed cost and releases only unspent reservation; resume needs no per-session approval',t=>{
 const {jobs,fleet}=setup(t),w=fleet.createPreset('500');complete(jobs,w.jobId);fleet.step(w.id);fleet.step(w.id,3600);fleet.control(w.id,'pause');fleet.step(w.id,3600);let p=fleet.get(w.id);assert.equal(p.spentMicrousd,'8000000');assert.equal(p.sessions[0].state,'stopped');assert.equal(p.sessions.length,1);fleet.control(w.id,'resume');fleet.step(w.id);assert.equal(fleet.get(w.id).sessions.length,2);
});
for(const fault of ['price-spike','balance-mismatch','stale-feed'])test(`${fault} latches a review hold and stops simulated fleet until acknowledged`,t=>{
 const {jobs,fleet}=setup(t),w=fleet.createPreset('500');complete(jobs,w.jobId);fleet.step(w.id);fleet.control(w.id,fault);fleet.step(w.id);assert.ok(fleet.get(w.id).latch);assert.equal(fleet.get(w.id).sessions[0].state,'stopped');assert.throws(()=>fleet.control(w.id,'resume'),/clear_simulated/);fleet.control(w.id,'clear-fault');fleet.step(w.id);assert.equal(fleet.get(w.id).sessions.length,1);fleet.control(w.id,'resume');fleet.step(w.id);assert.equal(fleet.get(w.id).sessions.length,2);
});
test('changed imported receipts stop spending rather than crediting twice',t=>{
 const {jobs,fleet}=setup(t),w=fleet.createPreset('500');complete(jobs,w.jobId);fleet.step(w.id);const original=jobs.get.bind(jobs);jobs.get=id=>{const j=original(id);j.providerReceipt.netMicrousd='490000001';return j;};fleet.step(w.id);assert.equal(fleet.get(w.id).latch,'funding_receipt_mismatch');assert.equal(fleet.get(w.id).creditMicrousd,'490000000');assert.equal(fleet.get(w.id).sessions[0].state,'stopped');
});
test('restart preserves reservation, spending, anomaly latch and one receipt import',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'bithash-fleet-budget-')),path=join(dir,'fleet.sqlite'),jobs=new SimulationFundingJobs(':memory:',{clock:()=>now});let fleet=new FleetBudgetSimulation(path,{fundingJobs:jobs});
 try{const w=fleet.createPreset('500');complete(jobs,w.jobId);fleet.step(w.id);fleet.step(w.id,3600);fleet.close();fleet=new FleetBudgetSimulation(path,{fundingJobs:jobs});fleet.step(w.id);assert.equal(fleet.get(w.id).sessions.length,1);assert.equal(fleet.get(w.id).spentMicrousd,'8000000');fleet.control(w.id,'price-spike');fleet.step(w.id);fleet.close();fleet=new FleetBudgetSimulation(path,{fundingJobs:jobs});fleet.step(w.id);assert.equal(fleet.get(w.id).decision.action,'paused');assert.equal(fleet.get(w.id).events.filter(e=>e.kind==='project-credit-imported').length,1);}finally{fleet.close();jobs.close();await rm(dir,{recursive:true,force:true});}
});
test('failed durable save cannot leak a debit or reservation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'bithash-fleet-budget-')),path=join(dir,'fleet.sqlite'),jobs=new SimulationFundingJobs(':memory:',{clock:()=>now}),fleet=new FleetBudgetSimulation(path,{fundingJobs:jobs});let db;
 try{const w=fleet.createPreset('500');complete(jobs,w.jobId);fleet.step(w.id);db=new DatabaseSync(path);db.exec("CREATE TRIGGER fail_save BEFORE UPDATE ON fleet_sim_worlds BEGIN SELECT RAISE(ABORT,'test storage failure'); END;");assert.throws(()=>fleet.step(w.id,3600),/test storage failure/);assert.equal(fleet.get(w.id).spentMicrousd,'0');assert.equal(fleet.get(w.id).time,0);db.exec('DROP TRIGGER fail_save');fleet.step(w.id,3600);assert.equal(fleet.get(w.id).spentMicrousd,'8000000');}finally{db?.close();fleet.close();jobs.close();await rm(dir,{recursive:true,force:true});}
});
test('simulation UI actions cannot post real credit or enable rentals',async t=>{
 const {jobs,fleet}=setup(t),treasury=new ComputeTreasury(':memory:');t.after(()=>treasury.close());await treasuryAction(treasury,'fleet-preset',new URLSearchParams({amount:'500'}),{fleet});const w=fleet.status().worlds[0];complete(jobs,w.jobId);fleet.step(w.id);assert.equal(treasury.snapshot().providerCreditMicrousd,'0');assert.equal(treasury.snapshot().plans.length,0);const s=fleet.status();s.worlds[0].latch='<script>x</script>';const html=fleetBudgetPanel(s,()=>'<form></form>');assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('SIMULATION'));assert.equal(s.rentalExecutionEnabled,false);assert.equal(s.paymentsEnabled,false);
});

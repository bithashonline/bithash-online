import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {SimulationFundingJobs} from './funding-jobs.js';
import {DEFAULT_DRY_RULES} from './automatic-funding.js';
import {fundingJobsPanel,fundingJobsAction} from './funding-jobs-ui.js';
import {treasuryPage,treasuryAction} from './treasury-console.js';
import {ComputeTreasury} from './treasury-compute.js';

const now=Date.parse('2026-10-18T23:00:00Z'),policy={...DEFAULT_DRY_RULES,hourlyMicrousd:'1000000'};
function setup(t,path=':memory:',clock=()=>now){const m=new SimulationFundingJobs(path,{clock});t.after(()=>m.close());return m;}
function steps(m,id,n){let j;for(let i=0;i<n;i++)j=m.step(id);return j;}
test('whole simulation connects 70/30 fees, rules, chain, card and net project provider credit',t=>{
 const m=setup(t),j=m.create(policy);assert.equal(j.state,'awaiting-fees');
 const planned=m.step(j.id);assert.equal(planned.state,'proposed');assert.equal(planned.amountUnits,'95000');assert.equal(planned.balances.computeUnits,'700000');assert.equal(planned.balances.otherUnits,'300000');
 assert.equal(m.step(j.id).state,'awaiting-chain');assert.equal(m.step(j.id).state,'awaiting-card');assert.equal(m.step(j.id).state,'awaiting-provider');
 const done=m.step(j.id);assert.equal(done.state,'complete');assert.equal(done.balances.computeUnits,'605000');assert.equal(done.balances.cardMicrousd,'5000000');assert.equal(done.balances.projectProviderMicrousd,'90000000');assert.equal(done.balances.providerMicrousd,'100000000');assert.equal(done.transferAttempts,1);assert.equal(done.providerReloadAttempts,1);
 assert.deepEqual(m.step(j.id),done);assert.equal(m.status().paymentsEnabled,false);assert.equal(m.status().realCreditPosting,false);
});
test('duplicate recommendations, submits and completion checks do not create extra funding',t=>{
 const m=setup(t),j=m.create(policy);for(let i=0;i<5;i++)assert.equal(m.create(policy).id,j.id);steps(m,j.id,12);assert.equal(m.status().jobs.length,1);assert.equal(m.get(j.id).transferAttempts,1);assert.equal(m.get(j.id).providerReloadAttempts,1);assert.equal(m.status().jobs[0].events.filter(e=>e.kind==='provider-credited').length,1);
});
test('zero burn, insufficient fee budget and restrictive limits stop before submission',t=>{
 const m=setup(t);
 for(const p of [DEFAULT_DRY_RULES,{...policy,walletReserveUnits:'700000'},{...policy,maxTransferUnits:'1'}]){const j=m.create(p);const held=m.step(j.id);assert.equal(held.state,'held');assert.equal(held.transferAttempts,0);assert.equal(held.balances.reservedUnits,'0');}
});
test('paused job and frozen policy survive changes to caller settings',t=>{
 const m=setup(t),p={...policy},j=m.create(p);p.maxTransferUnits='1';m.control(j.id,'pause');m.tick();assert.equal(m.get(j.id).state,'awaiting-fees');assert.equal(m.get(j.id).terms.policy.maxTransferUnits,'200000');m.control(j.id,'resume');m.tick();assert.equal(m.get(j.id).amountUnits,'95000');
});
test('cancel releases only unsubmitted reservations and never allows cancelling a sent job',t=>{
 const m=setup(t),j=m.create(policy);m.step(j.id);m.control(j.id,'cancel');assert.equal(m.get(j.id).balances.reservedUnits,'0');assert.equal(m.get(j.id).state,'cancelled');assert.equal(m.create(policy).state,'cancelled');
 const other=m.create(policy,'transfer-unknown');steps(m,other.id,2);assert.throws(()=>m.control(other.id,'cancel'),/cannot_cancel/);assert.equal(m.get(other.id).balances.reservedUnits,'95000');
});
test('lost response retains one transfer and reservation until its matching confirmation',t=>{
 const m=setup(t),j=m.create(policy,'transfer-unknown');steps(m,j.id,10);assert.equal(m.get(j.id).state,'awaiting-chain');assert.equal(m.get(j.id).transferAttempts,1);assert.equal(m.get(j.id).balances.reservedUnits,'95000');m.control(j.id,'resolve');steps(m,j.id,8);assert.equal(m.get(j.id).state,'complete');assert.equal(m.get(j.id).transferAttempts,1);
});
test('final chain failure credits neither provider and retains reservation for review',t=>{
 const m=setup(t),j=m.create(policy,'chain-failed');steps(m,j.id,10);const failed=m.get(j.id);assert.equal(failed.state,'failed');assert.equal(failed.balances.computeUnits,'700000');assert.equal(failed.balances.reservedUnits,'95000');assert.equal(failed.balances.cardMicrousd,'0');assert.equal(failed.balances.projectProviderMicrousd,'0');assert.throws(()=>m.control(j.id,'resolve'),/not_resolvable/);
});
for(const stage of ['card','provider'])for(const scenario of ['delayed','mismatch'])test(`${stage} ${scenario} holds without invented credit, then resumes same job`,t=>{
 const m=setup(t),j=m.create(policy,stage+'-'+scenario);steps(m,j.id,10);const held=m.get(j.id);assert.equal(held.state,stage==='card'?'awaiting-card':'awaiting-provider');assert.equal(held.balances.projectProviderMicrousd,'0');assert.equal(held.balances.cardMicrousd,stage==='card'?'0':'95000000');const eventCount=m.status().jobs[0].events.length;steps(m,j.id,5);assert.equal(m.status().jobs[0].events.length,eventCount);m.control(j.id,'resolve');steps(m,j.id,4);assert.equal(m.get(j.id).state,'complete');assert.equal(m.get(j.id).balances.projectProviderMicrousd,'90000000');assert.equal(m.get(j.id).transferAttempts,1);
});
test('restart after uncertain transfer retains identity and prevents a replacement send',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'bithash-jobs-')),path=join(dir,'jobs.sqlite');let m=new SimulationFundingJobs(path,{clock:()=>now});
 try{const j=m.create(policy,'transfer-unknown');steps(m,j.id,2);m.close();m=new SimulationFundingJobs(path,{clock:()=>now});assert.equal(m.create(policy,'transfer-unknown').id,j.id);steps(m,j.id,5);assert.equal(m.get(j.id).transferAttempts,1);m.control(j.id,'resolve');steps(m,j.id,5);assert.equal(m.get(j.id).state,'complete');}finally{m.close();await rm(dir,{recursive:true,force:true});}
});
test('receipt and balance changes roll back together when durable event save fails',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'bithash-jobs-')),path=join(dir,'jobs.sqlite'),m=new SimulationFundingJobs(path,{clock:()=>now});let db;
 try{const j=m.create(policy);steps(m,j.id,3);db=new DatabaseSync(path);db.exec("CREATE TRIGGER fail_credit BEFORE INSERT ON sim_job_events WHEN json_extract(NEW.body,'$.kind')='card-credited' BEGIN SELECT RAISE(ABORT,'test storage failure'); END;");assert.throws(()=>m.step(j.id),/test storage failure/);assert.equal(m.get(j.id).state,'awaiting-card');assert.equal(m.get(j.id).balances.cardMicrousd,'0');assert.equal(db.prepare('SELECT count(*) AS n FROM sim_job_receipts').get().n,0);db.exec('DROP TRIGGER fail_credit');steps(m,j.id,2);assert.equal(m.get(j.id).state,'complete');assert.equal(db.prepare('SELECT count(*) AS n FROM sim_job_receipts').get().n,2);}finally{db?.close();m.close();await rm(dir,{recursive:true,force:true});}
});
test('production or unknown database schemas are rejected before simulation tables are written',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'bithash-jobs-')),path=join(dir,'real.sqlite'),db=new DatabaseSync(path);db.exec('CREATE TABLE treasury_events(id TEXT)');
 try{assert.throws(()=>new SimulationFundingJobs(path),/simulation_database_required/);assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='sim_funding_jobs'").get().n,0);}finally{db.close();await rm(dir,{recursive:true,force:true});}
});
test('clock rollback holds progress; invalid case/control requests fail',t=>{
 let clock=now;const m=setup(t,':memory:',()=>clock),j=m.create(policy);clock--;assert.throws(()=>m.step(j.id),/clock_rollback/);assert.equal(m.get(j.id).state,'awaiting-fees');assert.throws(()=>m.create(policy,'live'),/unknown_simulation_case/);assert.throws(()=>m.control(j.id,'send'),/unknown_simulation_control/);
});
test('console actions use simulation rules and cannot change the real ledger',async t=>{
 const m=setup(t),real=new ComputeTreasury(':memory:');t.after(()=>real.close());real.configure({computeWallet:'11111111111111111111111111111111',otherWallet:'So11111111111111111111111111111111111111112'});const automatic={status:()=>({policy:DEFAULT_DRY_RULES})};
 await treasuryAction(real,'jobs-create',new URLSearchParams({scenario:'success',paused:'yes'}),{jobs:m,automatic});const j=m.status().jobs[0];assert.equal(j.paused,true);assert.equal(j.terms.policy.hourlyMicrousd,'1000000');m.control(j.id,'resume');steps(m,j.id,6);assert.equal(real.snapshot().feesReported,'0');assert.equal(real.snapshot().plans.length,0);assert.equal(real.snapshot().providerCreditMicrousd,'0');
 const s=m.status();s.jobs[0].reason='<script>bad</script>';const html=treasuryPage(real,{csrf:'fixture',jobs:s});assert.ok(html.includes('SIMULATION ONLY'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('Simulated project Runpod credit'));assert.ok(html.includes('/treasury/jobs-create'));
});
test('different cases use independent invented balances and never aggregate project credit',t=>{
 const m=setup(t),a=m.create(policy),b=m.create(policy,'card-delayed');steps(m,a.id,6);steps(m,b.id,6);assert.equal(m.get(a.id).balances.projectProviderMicrousd,'90000000');assert.equal(m.get(b.id).balances.projectProviderMicrousd,'0');assert.equal(m.get(b.id).balances.computeUnits,'605000');assert.equal(m.status().projectProviderMicrousd,undefined);
});

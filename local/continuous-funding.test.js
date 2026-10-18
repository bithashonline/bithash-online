import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {ContinuousFundingSimulation as Sim} from './continuous-funding.js';
import {continuousFundingPanel} from './continuous-funding-ui.js';
import {treasuryAction} from './treasury-console.js';
import {ComputeTreasury} from './treasury-compute.js';
const setup=t=>{const sim=new Sim(':memory:');t.after(()=>sim.close());return sim;};
const complete=sim=>{for(let i=0;i<5;i++)sim.step(0);};
const advance=(sim,hours)=>{for(let h=0;h<hours;h+=6)sim.step(Math.min(6,hours-h)*3600);};
const sum=(xs,key)=>xs.reduce((a,x)=>a+BigInt(x[key]),0n);
function invariant(w){
 assert.equal(sum(w.fees,'computeUnits'),BigInt(w.treasuryUnits)+sum(w.jobs.filter(j=>['awaiting-card','awaiting-provider','complete'].includes(j.state)),'units'));
 assert.equal(sum(w.fees,'otherUnits'),BigInt(w.otherUnits));
 assert.equal(BigInt(w.creditedMicrousd),BigInt(w.providerMicrousd)+BigInt(w.spentMicrousd));
 assert.ok(BigInt(w.providerMicrousd)+BigInt(w.cardMicrousd)+BigInt(w.reservedUnits)*1000n+sum(w.jobs.filter(j=>j.state==='awaiting-card'),'amountMicrousd')<=500000000n);
 assert.ok(w.jobs.filter(j=>j.state!=='complete').length<=1);
 for(const j of w.jobs){assert.ok(BigInt(j.amountMicrousd)>=100000000n&&BigInt(j.amountMicrousd)<=500000000n);assert.ok(j.attempts<=1);assert.ok(sum(w.jobs.filter(x=>x.created<=j.created&&j.created-x.created<86400),'amountMicrousd')<=1000000000n);}
}
test('idle worker cannot invent income, credit or rentals',t=>{const sim=setup(t);advance(sim,48);const w=sim.get();assert.equal(w.fees.length,0);assert.equal(w.jobs.length,0);assert.equal(w.sessions.length,0);assert.equal(w.providerMicrousd,'0');invariant(w);});
test('70/30 sample allocation is deduplicated and conflicting replay rejected',t=>{const sim=setup(t);sim.addFees('batch','10000000');sim.addFees('batch','10000000');assert.equal(sim.get().treasuryUnits,'7000000');assert.equal(sim.get().otherUnits,'3000000');assert.throws(()=>sim.addFees('batch','1'),/conflict/);invariant(sim.get());});
test('one shared treasury replenishes repeatedly, preserving surplus and caps',t=>{
 const sim=setup(t);sim.addFees('initial','10000000');complete(sim);let w=sim.get();assert.equal(w.jobs[0].amountMicrousd,'434000000');assert.equal(w.jobs[0].state,'complete');assert.equal(w.treasuryUnits,'6566000');assert.equal(w.sessions[0].gpuCount,8);
 advance(sim,6);assert.equal(sim.get().jobs.length,1);sim.addFees('surplus','10000000');sim.step(0);assert.equal(sim.get().jobs.length,1); // Fee arrival alone cannot top up.
 advance(sim,96);w=sim.get();assert.ok(w.jobs.length>=3);assert.ok(BigInt(w.treasuryUnits)>12000000n);assert.ok(BigInt(w.creditedMicrousd)>500000000n);invariant(w);
 for(const j of w.jobs.filter(j=>j.state==='complete')){assert.equal(j.providerReceipt.cardReceiptId,j.cardReceipt.id);assert.equal(j.cardReceipt.chainId,j.chainReceipt.id);}
});
test('finite fees dry up: adaptive fleet shrinks and retained reserves remain',t=>{
 const sim=setup(t);sim.addFees('small','1000000');complete(sim);advance(sim,240);const w=sim.get();assert.ok(w.budget.gpuCount<8);assert.ok(BigInt(w.treasuryUnits)>=100000n);assert.ok(BigInt(w.providerMicrousd)>=50000000n);assert.equal(w.fees.length,1);invariant(w);
});
test('below minimum funding leaves WBTC unconverted and fleet stopped',t=>{const sim=setup(t);sim.addFees('tiny','100000');advance(sim,24);assert.equal(sim.get().jobs.length,0);assert.equal(sim.get().treasuryUnits,'70000');assert.equal(sim.get().sessions.length,0);});
test('pause stops spending immediately and holds pending funding',t=>{const sim=setup(t);sim.addFees('initial','10000000');complete(sim);advance(sim,1);sim.control('pause');const before=sim.get();advance(sim,6);assert.equal(sim.get().spentMicrousd,before.spentMicrousd);assert.equal(sim.get().jobs.length,before.jobs.length);assert.ok(!sim.get().sessions.some(s=>s.state==='running'));sim.control('resume');sim.step(0);assert.ok(sim.get().sessions.some(s=>s.state==='running'));});
test('unknown transfer retains one attempt and reservation until synthetic resolution',t=>{
 const sim=setup(t);sim.addFees('initial','10000000');sim.control('unknown-transfer');complete(sim);let w=sim.get();assert.equal(w.latch,'unknown-transfer');assert.equal(w.jobs[0].attempts,1);assert.equal(w.jobs[0].state,'awaiting-chain');assert.equal(w.treasuryUnits,'7000000');assert.equal(w.reservedUnits,'434000');advance(sim,48);assert.equal(sim.get().jobs.length,1);assert.throws(()=>sim.control('resume'));sim.control('resolve');sim.step();assert.equal(sim.get().jobs[0].state,'awaiting-chain');sim.control('resume');complete(sim);w=sim.get();assert.equal(w.jobs[0].state,'complete');assert.equal(w.jobs[0].attempts,1);invariant(w);
});
test('receipt mismatch retains card funds without inventing provider credit',t=>{const sim=setup(t);sim.addFees('initial','10000000');sim.control('receipt-mismatch');complete(sim);let w=sim.get();assert.equal(w.latch,'receipt-mismatch');assert.equal(w.cardMicrousd,'434000000');assert.equal(w.providerMicrousd,'0');assert.equal(w.jobs[0].state,'awaiting-provider');advance(sim,24);assert.equal(sim.get().jobs.length,1);sim.control('resolve');sim.control('resume');sim.step(0);assert.equal(sim.get().providerMicrousd,'434000000');invariant(sim.get());});
for(const fault of ['stale-feed','price-spike'])test(fault+' pauses fleet and funding without repricing GPUs',t=>{const sim=setup(t);sim.addFees('initial','10000000');complete(sim);sim.control(fault);sim.step();const w=sim.get();assert.equal(w.latch,fault);assert.ok(!w.sessions.some(s=>s.state==='running'));assert.equal(w.jobs.length,1);const spent=w.spentMicrousd;advance(sim,12);assert.equal(sim.get().spentMicrousd,spent);});
test('restart retains unknown outcome, fee dedupe and completed receipt identity',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'continuous-')),path=join(dir,'simulation.sqlite');let sim=new Sim(path);t.after(async()=>{sim.close();await rm(dir,{recursive:true,force:true});});sim.addFees('initial','10000000');sim.control('unknown-transfer');complete(sim);const before=sim.get();sim.close();sim=new Sim(path);sim.addFees('initial','10000000');sim.step();assert.equal(sim.get().jobs[0].id,before.jobs[0].id);assert.equal(sim.get().jobs[0].attempts,1);sim.control('resolve');sim.control('resume');complete(sim);const credit=sim.get().creditedMicrousd;sim.close();sim=new Sim(path);sim.step(0);assert.equal(sim.get().creditedMicrousd,credit);assert.equal(sim.get().fees.length,1);invariant(sim.get());
});
test('failed SQLite commit rolls back credit, transfer and event changes together',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'continuous-')),path=join(dir,'simulation.sqlite');const sim=new Sim(path),db=new DatabaseSync(path);t.after(async()=>{db.close();sim.close();await rm(dir,{recursive:true,force:true});});sim.addFees('initial','10000000');for(let i=0;i<4;i++)sim.step(0);const before=sim.get();db.exec("CREATE TRIGGER reject_update BEFORE UPDATE ON continuous_sim_state BEGIN SELECT RAISE(ABORT,'test_failure'); END;");assert.throws(()=>sim.step(0));assert.deepEqual(sim.get(),before);db.exec('DROP TRIGGER reject_update');sim.step(0);assert.equal(sim.get().jobs[0].state,'complete');invariant(sim.get());
});
test('simulation cannot open an unrelated database',async()=>{const dir=await mkdtemp(join(tmpdir(),'continuous-')),path=join(dir,'real.sqlite'),db=new DatabaseSync(path);db.exec('CREATE TABLE actual_funds(id INTEGER)');db.close();try{assert.throws(()=>new Sim(path),/simulation_database_required/);}finally{await rm(dir,{recursive:true,force:true});}});
test('console actions affect only simulation; no transfer, GPU or real credit authority',async t=>{
 const sim=setup(t),treasury=new ComputeTreasury(':memory:');t.after(()=>treasury.close());const before=treasury.snapshot();await treasuryAction(treasury,'continuous-fees',new URLSearchParams({id:'sample',units:'10000000'}),{continuous:sim});await treasuryAction(treasury,'continuous-advance',new URLSearchParams({seconds:'21600'}),{continuous:sim});assert.deepEqual({...treasury.snapshot(),observedAt:before.observedAt},before);const s=sim.status();assert.equal(s.paymentsEnabled,false);assert.equal(s.broadcastEnabled,false);assert.equal(s.rentalExecutionEnabled,false);assert.match(continuousFundingPanel(s,()=>''),/SIMULATION ONLY/);assert.match(continuousFundingPanel(s,()=>''),/cannot be withdrawn/);
});

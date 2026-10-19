import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {RunpodAutoPaySimulation,planAutoPay,autoPayObservation,AUTOPAY_FLAGS,AUTOPAY_POLICY} from './runpod-autopay-simulation.js';
import {autoPayPanel} from './runpod-autopay-ui.js';
import {FundingCoordinator} from './funding-coordinator.js';
import {coordinatorFixture} from './funding-coordinator-sample.js';
const input=overrides=>({cardMicrousd:'0',providerMicrousd:'75000000',hourlyMicrousd:'20000000',fresh:true,availableTreasuryMicrousd:'600000000',...overrides});
function sim(t){const s=new RunpodAutoPaySimulation(':memory:');t.after(()=>s.close());return s;}
const advance=(s,id,minutes)=>{while(minutes>0){const step=Math.min(360,minutes);s.step(id,step);minutes-=step;}return s.get(id);};

test('fund card ahead of $50 threshold, preserve surplus, use fixed $100 reloads',()=>{
 assert.equal(planAutoPay(input()).cardFundingMicrousd,'100000000');assert.equal(planAutoPay(input()).earlyTriggerMicrousd,'90000000');
 assert.equal(planAutoPay(input({providerMicrousd:'91000000'})).action,'wait');
 assert.equal(planAutoPay(input({cardMicrousd:'100000000'})).action,'ready');
 assert.equal(planAutoPay(input({cardMicrousd:'100000000',providerMicrousd:'50000000'})).action,'would-observe-reload');
 assert.equal(planAutoPay(input({hourlyMicrousd:'0'})).action,'idle');
});
test('pending deposit/reload, stale data and caps prevent duplicate funding',()=>{
 for(const flag of ['pendingDeposit','pendingReload'])assert.equal(planAutoPay(input({[flag]:true})).cardFundingMicrousd,'0');
 assert.equal(planAutoPay(input({fresh:false})).action,'hold');
 assert.equal(planAutoPay(input({availableTreasuryMicrousd:'99000000'})).reason,'insufficient_treasury');
 assert.equal(planAutoPay(input({dailyDepositMicrousd:'950000000'})).reason,'daily_deposit_limit');
 assert.equal(planAutoPay(input({cardMicrousd:'100000000',providerMicrousd:'10000000',dailyReloadMicrousd:'1000000000'})).reason,'daily_reload_limit');
 assert.equal(planAutoPay(input({cardMicrousd:'100000000',providerMicrousd:'10000000',cooldown:true})).reason,'hourly_reload_cooldown');
 assert.equal(planAutoPay(input({hourlyMicrousd:'300000000',providerMicrousd:'450000000'})).reason,'float_limit');
 assert.throws(()=>planAutoPay(input({cardMicrousd:'-1'})),/invalid_amount/);
});
test('normal repeated cycles conserve finite funds and keep opening credit separate',t=>{
 const s=sim(t),c=s.create('normal'),w=advance(s,c.id,360);
 assert.equal(w.hold,null);assert.ok(w.reloads.length>=1);assert.ok(w.reloads.every(r=>r.amount==='100000000'&&r.attempts===1));
 assert.ok(w.deposits.every(d=>d.amount==='100000000'&&d.attempts===1));assert.ok(BigInt(w.treasuryUnits)>=100000n);assert.equal(w.otherUnits,'300000');
 assert.equal(w.legacy,'0');assert.equal(w.spent,'120000000');assert.equal(w.provider,w.funded);
 const before=s.get(c.id);s.create('normal');assert.deepEqual(s.get(c.id),before,'reopen must not reset funds');
});
test('card credit precedes reload and reload remains pending until its receipt',t=>{
 const s=sim(t),id=s.create('normal').id;let w=s.step(id);assert.equal(w.deposits.length,1);assert.equal(w.card,'0');
 w=s.step(id,30);assert.equal(w.card,'100000000');assert.equal(w.treasuryUnits,'600000');assert.equal(w.reloads.length,0);
 w=s.step(id,44);assert.equal(w.reloads.length,1);assert.equal(w.reloads[0].state,'pending');assert.equal(w.card,'0');assert.equal(w.funded,'0');
 w=s.step(id,2);assert.equal(w.reloads[0].state,'complete');assert.equal(w.funded,'100000000');
});
test('delayed reload has one debit and no duplicate deposit while pending',t=>{
 const s=sim(t),id=s.create('delayed-reload').id;let w=s.step(id,160);assert.equal(w.reloads.length,1);assert.equal(w.reloads[0].state,'pending');assert.equal(w.deposits.length,1);assert.equal(w.funded,'0');
 w=s.step(id,5);assert.equal(w.reloads[0].state,'complete');assert.equal(w.funded,'100000000');
});
test('declines keep card funds, hold local funding and never retry automatically',t=>{
 const s=sim(t),id=s.create('declined-card').id;let w=s.step(id,360);assert.equal(w.hold,'card_declined_no_operator_retry');assert.equal(w.card,'100000000');assert.equal(w.reloads.length,1);assert.equal(w.funded,'0');
 const before=w;s.step(id,360);assert.deepEqual(s.get(id),before);assert.throws(()=>s.control(id,'resume'),/review_required/);
});
test('unknown and mismatched reloads never become available credit',t=>{
 const s=sim(t);for(const scenario of ['unknown-reload','mismatched-reload']){const id=s.create(scenario).id,w=s.step(id,360);assert.ok(w.hold);assert.equal(w.reloads.length,1);assert.equal(w.reloads[0].state,'pending');assert.equal(w.card,'0');assert.equal(w.funded,'0');assert.equal(w.deposits.length,1);}
});
test('receipt replay deduplicates and changed amount rejects without accounting changes',t=>{
 const s=sim(t),id=s.create('normal').id,w=s.step(id,77),r=w.reloads[0],receipt={id:r.id,jobId:r.id,source:'simulation',amount:r.amount};
 s.observeSampleReceipt(id,receipt);assert.deepEqual(s.get(id),w);assert.throws(()=>s.observeSampleReceipt(id,{...receipt,amount:'1'}),/receipt_changed/);assert.deepEqual(s.get(id),w);
 assert.throws(()=>s.observeSampleReceipt(id,{...receipt,source:'real'}),/sample_receipt_required/);
});
test('insufficient reserve and exhausted daily budget do not create deposits',t=>{
 const s=sim(t);for(const scenario of ['insufficient-treasury','daily-limit']){const w=s.step(s.create(scenario).id,60);assert.equal(w.deposits.length,0);assert.equal(w.reloads.length,0);assert.equal(w.decision.action,'hold');}
});
test('restart preserves pending identity, balances, pause and failed holds',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'autopay-test-')),path=join(dir,'sim.sqlite');let s=new RunpodAutoPaySimulation(path);
 t.after(async()=>{s.close();await rm(dir,{recursive:true,force:true});});
 const id=s.create('delayed-reload').id;s.step(id,100);s.control(id,'pause');const before=s.get(id);s.close();s=new RunpodAutoPaySimulation(path);assert.deepEqual(s.get(id),before);s.step(id,60);assert.deepEqual(s.get(id),before);
 s.control(id,'resume');const after=s.step(id,65);assert.equal(after.reloads.length,1);assert.equal(after.reloads[0].state,'complete');
 const failed=s.create('declined-card').id;s.step(failed,100);s.close();s=new RunpodAutoPaySimulation(path);assert.equal(s.get(failed).hold,'card_declined_no_operator_retry');
});
test('database isolation and disabled flags are structural',async t=>{
 const s=sim(t);for(const k of Object.keys(AUTOPAY_FLAGS))assert.equal(s.status()[k],false);assert.equal(s.status().realAutoPayControl,'not-connected');assert.equal(s.status().cases.length,0);
 assert.throws(()=>s.create('live'),/invalid_scenario/);assert.throws(()=>s.step('none',361),/invalid_step/);
 const dir=await mkdtemp(join(tmpdir(),'autopay-schema-')),path=join(dir,'real.sqlite'),db=new DatabaseSync(path);db.exec('CREATE TABLE treasury(id TEXT)');db.close();assert.throws(()=>new RunpodAutoPaySimulation(path),/separate_database/);await rm(dir,{recursive:true,force:true});
});
test('real-record preview never produces sample records or hides stale data',()=>{
 const now=Date.now(),f=()=>({state:'connected',fresh:true,data:{observedAt:new Date(now).toISOString(),balanceMicrousd:'3160000'}}),records={feeds:{solcard:f(),runpod:f()}},before=structuredClone(records);
 const p=autoPayObservation(records,'20000000',now);assert.equal(p.action,'would-fund-card');assert.equal(p.cardFundingMicrousd,'100000000');assert.equal(p.settingsVerified,false);assert.equal(p.actualAutoPayState,'not-polled');assert.deepEqual(records,before);
 assert.equal(autoPayObservation(records,'0',now+300001).action,'hold');records.feeds.solcard.data.balanceMicrousd='-1';assert.equal(autoPayObservation(records,'1',now).reason,'invalid_observation');
});
test('coordinator exposes read-only preview before launch without creating an intent',()=>{
 const now=Date.now(),data=coordinatorFixture(now);data.automatic.configuration=null;data.collection.configuration=null;
 const c=new FundingCoordinator(':memory:',{observe:()=>data,evidenceKind:'sample-fixtures',clock:()=>now});try{const s=c.tick();assert.ok(s.view.autopay);assert.equal(s.jobs.length,0);assert.equal(s.state,'awaiting-token-launch');}finally{c.close();}
});
test('console separates simulation from real auto-pay and shows $100 assumption',t=>{
 const s=sim(t);s.create('normal');const html=autoPayPanel(s.status(),null,()=>'<button>simulation</button>');assert.ok(html.includes('$100 reloads'));assert.ok(html.includes('Real auto-pay must stay OFF'));assert.ok(html.includes('cases')||html.includes('Cases'));assert.equal(AUTOPAY_POLICY.reloadMicrousd,'100000000');
});

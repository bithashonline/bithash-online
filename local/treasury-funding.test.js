import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {ComputeTreasury,WBTC} from './treasury-compute.js';
import {previewFunding,prepareSimulatedFunding,stepSimulatedFunding,rehearsalFixture,runFundingRehearsal} from './treasury-funding.js';
import {treasuryAction,treasuryPage,createTreasuryServer} from './treasury-console.js';

function setup(t,{path=':memory:',mode='simulation'}={}){
 let now=Date.now();const ledger=new ComputeTreasury(path,{mode,clock:()=>now}),{wallets,profile}=rehearsalFixture(now);
 ledger.configure(wallets);ledger.recordFees({reference:'fixture',amount:'10000000'});
 const refresh=()=>ledger.observeWallets({...wallets,mint:WBTC.mint,decimals:8,computeAmount:'7000000',otherAmount:'3000000',observedAt:new Date(now).toISOString(),source:mode==='simulation'?'simulation':'finalized-rpc'});
 refresh();if(t)t.after(()=>ledger.close());return {ledger,profile,refresh,tick:ms=>now+=ms};
}
test('direct WBTC accounting does not invent a USDC swap or provider credit',t=>{
 const {ledger}=setup(t);ledger.plan({id:'direct',amount:'1000000',route:'solcard-wbtc'});
 assert.throws(()=>ledger.advance({id:'direct',stage:'converted',amount:'1',reference:'bad'}),/transition/);
 assert.throws(()=>ledger.advance({id:'direct',stage:'card-funded',amount:'1',reference:'bad'}),/transition/);
 assert.throws(()=>ledger.advance({id:'direct',stage:'deposit-submitted',amount:'999',reference:'chain'}),/mismatch/);
 ledger.advance({id:'direct',stage:'deposit-submitted',amount:'1000000',reference:'chain'});
 assert.equal(ledger.snapshot().availableWbtcUnits,null);
 assert.throws(()=>ledger.cancel({id:'direct',noTransferMade:true}),/cannot_cancel/);
 ledger.advance({id:'direct',stage:'card-funded',amount:'600000000',reference:'card'});
 ledger.observeProvider({availableMicrousd:'900000000'});assert.equal(ledger.snapshot().availableProviderMicrousd,'0');
 ledger.advance({id:'direct',stage:'provider-credited',amount:'500000000',reference:'provider'});
 assert.equal(ledger.snapshot().availableProviderMicrousd,'500000000');
});
test('preview is read-only and requires the exact token and matching destination',t=>{
 const {ledger,profile}=setup(t);const before=ledger.snapshot();
 assert.equal(previewFunding(ledger,profile,{amount:'1000000'}).state,'review-ready');assert.deepEqual(ledger.snapshot().plans,before.plans);
 assert.equal(previewFunding(ledger,{...profile,mint:'5XZw2LKTyrfvfiskJ78AMpackRjPcyCif1WhUsPDuVqQ'},{amount:'1000000'}).state,'held');
 assert.ok(previewFunding(ledger,{...profile,confirmedDepositAddress:profile.mint},{amount:'1000000'}).reasons.includes('deposit_address_mismatch'));
 assert.ok(previewFunding(ledger,{...profile,policy:null},{amount:'1000000'}).reasons.includes('owner_funding_limits_not_set'));
});
test('card range, per-payment cap, available allocation and gas reserve all constrain the preview',t=>{
 const {ledger,profile}=setup(t);
 assert.ok(previewFunding(ledger,profile,{amount:'9999'}).reasons.includes('outside_card_limits'));
 assert.ok(previewFunding(ledger,profile,{amount:'1000001'}).reasons.includes('per_transfer_cap_exceeded'));
 assert.ok(previewFunding(ledger,profile,{amount:'8000000'}).reasons.includes('insufficient_fee_allocated_wbtc'));
 assert.ok(previewFunding(ledger,{...profile,gasObservation:{...profile.gasObservation,lamports:'0'}},{amount:'1000000'}).reasons.includes('insufficient_sol_reserve'));
 assert.ok(previewFunding(ledger,{...profile,gasObservation:{...profile.gasObservation,wallet:profile.depositAddress}},{amount:'1000000'}).reasons.includes('refresh_sol_balance'));
});
test('stale, future and failed observations hold funding',t=>{
 const {ledger,profile,tick}=setup(t);tick(300001);
 const r=previewFunding(ledger,profile,{amount:'1000000'});assert.ok(r.reasons.includes('refresh_solcard_observation'));assert.ok(r.reasons.includes('refresh_wallet_observation'));assert.ok(r.reasons.includes('refresh_sol_balance'));
 assert.ok(previewFunding(ledger,{...profile,observedAt:'2099-01-01T00:00:00Z'},{amount:'1000000'}).reasons.includes('refresh_solcard_observation'));
});
test('all simulation execution entry points reject the real accounting database',t=>{
 const {ledger,profile}=setup(t,{mode:'owner-recorded'});
 assert.throws(()=>prepareSimulatedFunding(ledger,profile,{id:'p',amount:'1000000'}),/real_funding_execution_disabled/);
 assert.throws(()=>stepSimulatedFunding(ledger,'p','submit'),/real_funding_execution_disabled/);
 assert.equal(ledger.snapshot().plans.length,0);
});
test('durable unknown outcome cannot submit twice, change destination or create another plan',async t=>{
 let reopened;const parent=resolve(tmpdir()),dir=await mkdtemp(join(parent,'funding-restart-'));t.after(async()=>{reopened?.close();assert.ok(resolve(dir).startsWith(parent+sep));await rm(dir,{recursive:true,force:true});});
 const path=join(dir,'simulation.sqlite'),{ledger:a,profile}=setup(null,{path});
 prepareSimulatedFunding(a,profile,{id:'p',amount:'1000000'});stepSimulatedFunding(a,'p','submit');a.close();
 const b=reopened=new ComputeTreasury(path,{mode:'simulation'});
 assert.equal(stepSimulatedFunding(b,'p','submit').funding.submitAttempts,1);
 assert.throws(()=>prepareSimulatedFunding(b,{...profile,depositAddress:WBTC.mint,confirmedDepositAddress:WBTC.mint},{id:'p',amount:'1000000'}),/terms_changed/);
 assert.throws(()=>prepareSimulatedFunding(b,profile,{id:'p2',amount:'1000000'}),/funding_held/);
 assert.throws(()=>stepSimulatedFunding(b,'p','credit-card',{amount:'1000000'}),/transition/);
 stepSimulatedFunding(b,'p','confirm-chain');stepSimulatedFunding(b,'p','credit-card',{amount:'600000000'});
 assert.throws(()=>stepSimulatedFunding(b,'p','credit-provider',{amount:'600000001'}),/exceeds/);
 stepSimulatedFunding(b,'p','credit-provider',{amount:'500000000'});stepSimulatedFunding(b,'p','credit-provider',{amount:'500000000'});
 assert.equal(b.snapshot().providerCreditMicrousd,'500000000');
 assert.throws(()=>stepSimulatedFunding(b,'p','credit-provider',{amount:'500000001'}),/conflicting_replay/);
});
test('failed chain payment stays reserved and cannot credit or silently retry',t=>{
 const {ledger,profile}=setup(t);prepareSimulatedFunding(ledger,profile,{id:'p',amount:'1000000'});
 stepSimulatedFunding(ledger,'p','submit');stepSimulatedFunding(ledger,'p','fail-chain');
 assert.equal(stepSimulatedFunding(ledger,'p','submit').funding.submitAttempts,1);
 assert.equal(ledger.snapshot().committedWbtcUnits,'1000000');
 assert.throws(()=>stepSimulatedFunding(ledger,'p','confirm-chain'),/transition/);
 assert.throws(()=>stepSimulatedFunding(ledger,'p','credit-card',{amount:'1'}),/transition/);
});
test('rolling daily cap includes completed transfers, not just pending ones',t=>{
 const {ledger,profile,refresh}=setup(t);profile.policy.maxDailyWbtcUnits='1000000';
 prepareSimulatedFunding(ledger,profile,{id:'p',amount:'1000000'});
 for(const action of ['submit','confirm-chain'])stepSimulatedFunding(ledger,'p',action);
 stepSimulatedFunding(ledger,'p','credit-card',{amount:'600000000'});stepSimulatedFunding(ledger,'p','credit-provider',{amount:'500000000'});refresh();
 assert.ok(previewFunding(ledger,profile,{amount:'10000'}).reasons.includes('daily_cap_exceeded'));
});
test('offline rehearsal completes without network access and cannot add real credit',async t=>{
 const {ledger,profile}=setup(t,{mode:'owner-recorded'});ledger.set('fundingProfile',profile);
 const before=ledger.snapshot(),originalFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('network_forbidden');};
 try{const r=runFundingRehearsal();assert.equal(r.paymentsSent,0);assert.equal(r.gpuActions,0);assert.equal(r.submitAttempts,1);assert.equal(r.availableProjectCreditMicrousd,'500000000');
  await treasuryAction(ledger,'rehearsal',new URLSearchParams());
 }finally{globalThis.fetch=originalFetch;}
 assert.equal(ledger.snapshot().providerCreditMicrousd,before.providerCreditMicrousd);assert.deepEqual(ledger.snapshot().plans,before.plans);
 await treasuryAction(ledger,'preview',new URLSearchParams({amount:'0.0001'}));
 const html=treasuryPage(ledger,{csrf:'fixture'});assert.match(html,/Simulation completed/);assert.match(html,/WBTC goes straight to SolCard/);assert.match(html,/GPU proposals paused/);
});
test('direct-route console records the WBTC transfer with eight decimals',async t=>{
 const {ledger}=setup(t),act=(action,data)=>treasuryAction(ledger,action,new URLSearchParams(data));
 await act('plan',{id:'direct-ui',amount:'0.00010001',route:'solcard-wbtc'});
 await act('advance',{id:'direct-ui',stage:'deposit-submitted',amount:'0.00010001',reference:'simulation-transfer'});
 assert.equal(ledger.getPlan('direct-ui')['deposit-submitted'].amount,'10001');
 assert.match(treasuryPage(ledger,{csrf:'fixture'}),/0.00010001 WBTC/);
});
test('funding HTTP actions enforce CSRF; status exposes preview without enabling payments',async t=>{
 const {ledger,profile}=setup(t,{mode:'owner-recorded'});ledger.set('fundingProfile',profile);
 const server=createTreasuryServer(ledger);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const origin='http://127.0.0.1:'+server.address().port,page=await fetch(origin),cookie=page.headers.get('set-cookie').split(';')[0],html=await page.text(),csrf=html.match(/name="csrf" value="([a-f0-9]+)"/)[1];
 const headers={'Content-Type':'application/x-www-form-urlencoded',Origin:origin,Cookie:cookie};
 assert.equal((await fetch(origin+'/treasury/rehearsal',{method:'POST',headers,body:new URLSearchParams({csrf:'bad'})})).status,403);
 assert.equal((await fetch(origin+'/treasury/rehearsal',{method:'POST',headers,body:new URLSearchParams({csrf}),redirect:'manual'})).status,303);
 const state=await (await fetch(origin+'/treasury/status',{headers:{Cookie:cookie}})).json();assert.equal(state.funding.paymentsEnabled,false);assert.equal(state.treasury.providerCreditMicrousd,'0');
});

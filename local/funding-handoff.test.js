import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Transaction,SystemProgram} from '@solana/web3.js';
import {ComputeTreasury,WBTC} from './treasury-compute.js';
import {rehearsalFixture} from './treasury-funding.js';
import {FundingCoordinator} from './funding-coordinator.js';
import {coordinatorFixture} from './funding-coordinator-sample.js';
import {ProductionFundingJobs} from './production-funding-jobs.js';
import {FundingReconciler} from './funding-reconciler.js';
import {ReadOnlyFundingPreflight} from './funding-preflight.js';
import {inspectRestrictedTransfer} from './restricted-wallet-signer.js';
import {productionFundingPanel} from './production-funding-ui.js';

// All records below are invented test inputs in separate test databases. No
// private key or real RPC transport is supplied, even for the real-record lane.
async function fixture(t,{persistent=false}={}){
 let now=Date.parse('2026-10-19T06:00:00Z'),manager,coordinator,override=null,midflight=null;const clock=()=>now;
 const dir=persistent?await mkdtemp(join(tmpdir(),'handoff-')):null;
 const data=coordinatorFixture(now);data.evidenceKind='real-records';
 const ledger=new ComputeTreasury(':memory:',{clock});ledger.configure(data.treasury.wallets);
 const profile={...rehearsalFixture(now).profile,...data.profile,confirmedDepositAddress:data.profile.depositAddress,policy:{...data.profile.policy,minRetainedWbtcUnits:'0'}};
 ledger.set('fundingProfile',profile);data.profile=profile;
 ledger.observeWallets({...data.treasury.wallets,mint:WBTC.mint,decimals:8,computeAmount:'700000',otherAmount:'300000',observedAt:new Date(now).toISOString(),source:'finalized-rpc'});
 const calls=[],records={status:()=>data.records};
 const reconciler=new FundingReconciler(':memory:',{clock,readChain:async()=>{throw Error('unexpected_chain_read');},readCard:async()=>{throw Error('unexpected_card_read');},readProvider:async()=>{throw Error('unexpected_provider_read');}});
 const preflight=new ReadOnlyFundingPreflight({clock,fetcher:async(url,options)=>{
  assert.equal(url,'https://api.mainnet-beta.solana.com');const q=JSON.parse(options.body);calls.push(q.method);
  const token=owner=>({owner:WBTC.program,executable:false,data:{parsed:{type:'account',info:{owner,mint:WBTC.mint,state:'initialized',isNative:false,tokenAmount:{amount:'700000',decimals:8}}}}});
  const blockhash=data.automatic.configuration.otherWallet,owner=data.automatic.configuration.computeWallet,recipient=profile.depositAddress;
  const responses={getGenesisHash:'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',getLatestBlockhash:{context:{slot:100},value:{blockhash,lastValidBlockHeight:200}},getMultipleAccounts:{context:{slot:101},value:[{owner:WBTC.program,executable:false,data:{parsed:{type:'mint',info:{decimals:8,isInitialized:true}}}},{owner:SystemProgram.programId.toBase58(),executable:false,data:['','base64'],lamports:20000000},token(owner),token(recipient)]},getFeeForMessage:{context:{slot:102},value:5000},simulateTransaction:{context:{slot:103},value:{err:null}},getBlockHeight:150};
  assert.ok(Object.hasOwn(responses,q.method),'No transaction submission or unexpected RPC allowed');
  if(q.method==='simulateTransaction'){
   const tx=Transaction.from(Buffer.from(q.params[0],'base64'));assert.ok(tx.signatures.every(s=>s.signature===null));
   inspectRestrictedTransfer(Buffer.from(q.params[0],'base64'),{owner,recipient,amount:coordinator.status().jobs[0].amount,blockhash});
  }
  if(midflight){const f=midflight;midflight=null;f();}
  return new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,result:responses[q.method]}));
 }});
 const observe=()=>({...data,treasury:ledger.snapshot(),profile:ledger.setting('fundingProfile'),production:manager?.status()??data.production});
 const open=()=>{
  coordinator=new FundingCoordinator(dir?join(dir,'coordinator.sqlite'):':memory:',{clock,observe});
  manager=new ProductionFundingJobs(dir?join(dir,'jobs.sqlite'):':memory:',{clock,treasury:ledger,records,reconciler,preflight,coordinator:()=>override??coordinator.handoffSnapshot(),readTransaction:async()=>{throw Error('unexpected_transaction_read');}});
 };
 open();t.after(async()=>{await manager.close();coordinator.close();await reconciler.close();ledger.close();if(dir)await rm(dir,{recursive:true,force:true});});
 return {data,ledger,calls,profile,get coordinator(){return coordinator;},get manager(){return manager;},job:()=>manager.status().jobs[0],source:()=>coordinator.handoffSnapshot(),override:s=>{override=s;},midflight:f=>{midflight=f;},advance:ms=>{now+=ms;},async restart(){await manager.close();coordinator.close();open();},async run(){coordinator.tick();await manager.tick();return coordinator.tick();}};
}

test('real coordinator intent hands off through the manager to exact unsigned preflight without treasury mutation',async t=>{
 const f=await fixture(t),before=f.ledger.snapshot(),s=await f.run(),j=f.job();
 assert.equal(j.origin,'coordinator-dry-run');assert.equal(j.reservation,'dry-run-only');assert.equal(j.state,'signing-disabled');assert.equal(j.preflight.state,'checks-passed');assert.equal(j.preflight.simulation,'passed');assert.equal(j.signature,null);
 assert.equal(s.jobs[0].productionJobId,j.id);assert.equal(s.jobs[0].amount,j.terms.amount);assert.deepEqual(f.ledger.snapshot(),before);
 assert.deepEqual(f.calls,['getLatestBlockhash','getGenesisHash','getMultipleAccounts','getFeeForMessage','simulateTransaction','getBlockHeight']);
 const status=f.manager.status();assert.equal(status.signer.keyLoaded,false);assert.equal(status.signer.signingEnabled,false);assert.equal(status.signer.broadcastEnabled,false);assert.equal(status.paymentsEnabled,false);assert.equal(status.automaticCreditPosting,false);assert.equal(status.gpuExperimentsEnabled,false);
});
test('restart between durable import and coordinator acknowledgement reuses the same production job',async t=>{
 const f=await fixture(t,{persistent:true});f.coordinator.tick();await f.manager.tick();const j=f.job();assert.equal(f.coordinator.status().jobs[0].productionJobId,null);
 await f.restart();await f.run();await f.run();assert.equal(f.manager.status().jobs.length,1);assert.equal(f.job().id,j.id);assert.equal(f.job().sourceHash,j.sourceHash);assert.equal(f.coordinator.status().jobs[0].productionJobId,j.id);assert.equal(f.ledger.snapshot().plans.length,0);
});
test('sample sources and execution-enabled sources cannot create production jobs',async t=>{
 for(const mutate of [s=>s.evidenceKind='sample-fixtures',s=>s.signingEnabled=true,s=>s.broadcastEnabled=true,s=>s.schema='unrecognized']){
  const f=await fixture(t);f.coordinator.tick();const source=f.source();mutate(source);f.override(source);await assert.rejects(()=>f.manager.tick());assert.equal(f.manager.status().jobs.length,0);assert.equal(f.calls.length,0);
 }
});
test('stale observations pause existing jobs and resume without duplicating or releasing the intent',async t=>{
 const f=await fixture(t);await f.run();const id=f.job().id,source=f.source();source.stale=true;f.override(source);await f.manager.tick();assert.equal(f.job().state,'handoff-waiting');assert.equal(f.job().preflight,null);assert.equal(f.job().reviewLatched,undefined);
 f.override(null);await f.manager.tick();assert.equal(f.job().state,'signing-disabled');assert.equal(f.job().id,id);assert.equal(f.manager.status().jobs.length,1);
});
test('changed source amount, destination, allocations and receipt hash latch review and preserve frozen terms',async t=>{
 for(const mutate of [s=>s.jobs[0].amount='123',s=>s.jobs[0].recipient=s.identity.otherWallet,s=>s.jobs[0].allocations[0].units='1',s=>Object.values(s.receipts)[0].hash='a'.repeat(64)]){
  const f=await fixture(t);await f.run();const frozen=f.job().termsHash,source=f.source();mutate(source);f.override(source);await f.manager.tick();assert.equal(f.job().state,'review-required');assert.equal(f.job().reviewLatched,true);assert.equal(f.job().termsHash,frozen);assert.equal(f.job().preflight,null);
  f.override(null);await f.manager.tick();assert.equal(f.job().state,'review-required');assert.throws(()=>f.manager.attachSignature(f.job().id,'3'.repeat(88)),/review_required/);
 }
});
test('missing intent latches review across restart',async t=>{
 const f=await fixture(t,{persistent:true});await f.run();const source=f.source();source.jobs=[];f.override(source);await f.manager.tick();assert.equal(f.job().reviewLatched,true);await f.restart();f.override(null);await f.manager.tick();assert.equal(f.job().state,'review-required');
});
test('changed owner funding policy or deposit destination holds the handoff',async t=>{
 for(const change of ['policy','recipient']){const f=await fixture(t);await f.run();const p=f.ledger.setting('fundingProfile');if(change==='policy')p.policy.maxDailyWbtcUnits='3000000';else p.depositAddress=p.confirmedDepositAddress=f.data.automatic.configuration.otherWallet;f.ledger.set('fundingProfile',p);await f.manager.tick();assert.equal(f.job().state,'review-required');assert.equal(f.job().preflight,null);}
});
test('terms changing during an asynchronous preflight invalidate its result',async t=>{
 const f=await fixture(t);f.coordinator.tick();f.midflight(()=>{const p=f.ledger.setting('fundingProfile');p.policy.maxDailyWbtcUnits='3000000';f.ledger.set('fundingProfile',p);});await f.manager.tick();assert.equal(f.job().state,'review-required');assert.equal(f.job().preflight,null);
});
test('existing manual commitments are included in preflight and cannot double fund',async t=>{
 const f=await fixture(t);f.coordinator.tick();f.ledger.savePlan({id:'other-owner-plan',amount:'100000',route:'solcard-wbtc',source:'owner-recorded',state:'planned',createdAt:'2026-10-19T05:59:00Z'});await f.manager.tick();const j=f.manager.status().jobs.find(j=>j.origin==='coordinator-dry-run');assert.equal(j.preflight.state,'held');assert.ok(j.preflight.reasons.includes('other_funding_job_pending'));assert.equal(j.signature,null);
});
test('collision with an owner plan is rejected instead of reusing its identity',async t=>{
 const f=await fixture(t);f.coordinator.tick();const j=f.source().jobs[0];f.ledger.savePlan({id:j.id,amount:j.amount,route:'solcard-wbtc',source:'owner-recorded',state:'planned',createdAt:j.createdAt});await assert.rejects(()=>f.manager.tick(),/collision/);assert.equal(f.manager.status().jobs.filter(j=>j.origin==='coordinator-dry-run').length,0);
});
test('unlaunched empty coordinator imports nothing and makes no preflight request',async t=>{
 const f=await fixture(t);f.data.automatic.configuration=null;f.data.collection.configuration=null;await f.run();assert.equal(f.manager.status().jobs.length,0);assert.equal(f.calls.length,0);assert.equal(f.coordinator.status().state,'awaiting-token-launch');
});
test('console identifies the dry-run source separately from manual plans',async t=>{
 const f=await fixture(t);await f.run();const html=productionFundingPanel(f.manager.status(),()=>'<button>read only</button>');assert.ok(html.includes('Coordinator intent · dry-run reservation only'));assert.ok(html.includes('connected · read only'));assert.ok(html.includes('Signing and broadcasting disabled'));
});

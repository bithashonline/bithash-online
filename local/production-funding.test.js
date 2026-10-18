import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,Transaction,SystemProgram} from '@solana/web3.js';
import bs58 from 'bs58';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {ComputeTreasury,WBTC} from './treasury-compute.js';
import {rehearsalFixture} from './treasury-funding.js';
import {DisabledRestrictedFundingSigner,buildRestrictedTransfer,OFFLINE_BLOCKHASH,transferAccounts} from './restricted-wallet-signer.js';
import {FundingReconciler,readFundingTransactionBySignature} from './funding-reconciler.js';
import {ProductionFundingJobs} from './production-funding-jobs.js';
import {productionFundingPanel} from './production-funding-ui.js';
import {treasuryAction} from './treasury-console.js';

const now=Date.parse('2026-10-18T23:40:00Z'),clock=()=>now;
function fixture(t,{jobPath=':memory:',recPath=':memory:',plans=true}={}){
 const key=Keypair.generate(),owner=key.publicKey.toBase58(),recipient=Keypair.generate().publicKey.toBase58(),other=Keypair.generate().publicKey.toBase58();
 const ledger=new ComputeTreasury(':memory:',{clock}),profile=rehearsalFixture(now).profile;
 Object.assign(profile,{depositAddress:recipient,confirmedDepositAddress:recipient});ledger.configure({computeWallet:owner,otherWallet:other});ledger.set('fundingProfile',profile);
 if(plans){ledger.recordFees({reference:'fixture-only',amount:'10000000'});ledger.observeWallets({computeWallet:owner,otherWallet:other,mint:WBTC.mint,decimals:8,computeAmount:'7000000',otherAmount:'3000000',observedAt:new Date(now).toISOString(),source:'finalized-rpc'});ledger.plan({id:'existing-plan',amount:'1000000',route:'solcard-wbtc'});}
 let result=null,reads=0;
 const records={status:()=>({feeds:{solcard:{state:'connected',fresh:true},runpod:{state:'connected',fresh:true}}})};
 const options={clock,readChain:async()=>result,readCard:async()=>({state:'unavailable',reason:'card_records_lack_transfer_signature'}),readProvider:async()=>({state:'unavailable',reason:'provider_records_lack_project_card_link'})};
 let reconciler=new FundingReconciler(recPath,options);
 const managerOptions=()=>({treasury:ledger,records,reconciler,clock,readTransaction:async()=>{reads++;return result;}});
 let manager=new ProductionFundingJobs(jobPath,managerOptions());
 t.after(async()=>{await manager.close();await reconciler.close();ledger.close();});
 function proof({amount='1000000',extra=false}={}){
  const tx=buildRestrictedTransfer({owner,recipient,amount,blockhash:OFFLINE_BLOCKHASH});if(extra)tx.add(SystemProgram.transfer({fromPubkey:key.publicKey,toPubkey:Keypair.generate().publicKey,lamports:1}));tx.sign(key);
  const accounts=transferAccounts(owner,recipient),keys=tx.compileMessage().accountKeys.map(k=>k.toBase58());
  const bal=(address,wallet,amount)=>({accountIndex:keys.indexOf(address),mint:WBTC.mint,owner:wallet,programId:WBTC.program,uiTokenAmount:{amount,decimals:8}});
  return {signature:bs58.encode(tx.signature),chain:{slot:123,transaction:[tx.serialize().toString('base64'),'base64'],meta:{err:null,innerInstructions:[],preTokenBalances:[bal(accounts.sourceAccount,owner,'7000000'),bal(accounts.destinationAccount,recipient,'0')],postTokenBalances:[bal(accounts.sourceAccount,owner,String(7000000n-BigInt(amount))),bal(accounts.destinationAccount,recipient,amount)]}}};
 }
 return {ledger,profile,owner,recipient,proof,records,get manager(){return manager;},get reconciler(){return reconciler;},get reads(){return reads;},setResult:r=>{result=r;},async restart(){await manager.close();await reconciler.close();reconciler=new FundingReconciler(recPath,options);manager=new ProductionFundingJobs(jobPath,managerOptions());},job:()=>manager.status().jobs[0]};
}

test('keyless signer inspects exact structure but cannot sign or broadcast',t=>{
 const f=fixture(t),signer=new DisabledRestrictedFundingSigner();const r=signer.inspect({owner:f.owner,recipient:f.recipient,amount:'1000000',policy:f.profile.policy});assert.equal(r.structuralCheck,'passed');assert.equal(r.signingEnabled,false);assert.equal(r.broadcastEnabled,false);assert.equal(r.livePreflightVerified,false);assert.equal(r.wireBase64,undefined);assert.throws(()=>signer.sign(),/disabled/);assert.throws(()=>signer.broadcast(),/disabled/);
 assert.ok(signer.inspect({owner:f.owner,recipient:f.recipient,amount:'1000001',policy:f.profile.policy}).reasons.includes('per_transfer_cap_exceeded'));
});
test('imports real plans idempotently without changing treasury accounting',async t=>{
 const f=fixture(t),before=f.ledger.snapshot();await f.manager.tick();await f.manager.tick();assert.equal(f.manager.status().jobs.length,1);assert.equal(f.job().state,'signing-disabled');assert.equal(f.job().inspection.structuralCheck,'passed');assert.ok(f.job().reasons.includes('owner_recorded_fee_origin_unverified'));assert.deepEqual(f.ledger.snapshot(),before);assert.equal(f.reads,0);assert.equal(f.reconciler.status().jobs.length,0);
});
test('empty real ledger generates no jobs, invented fees or network requests',async t=>{
 const f=fixture(t,{plans:false});await f.manager.tick();assert.equal(f.manager.status().jobs.length,0);assert.equal(f.reads,0);assert.equal(f.ledger.snapshot().feesReported,'0');
});
test('simulation ledger and simulation reconciler cannot enter production path',async t=>{
 const f=fixture(t),sim=new ComputeTreasury(':memory:',{mode:'simulation'}),r=new FundingReconciler(':memory:',{mode:'simulation'});t.after(async()=>{sim.close();await r.close();});assert.throws(()=>new ProductionFundingJobs(':memory:',{treasury:sim,records:f.records,reconciler:f.reconciler}),/dependencies_required/);assert.throws(()=>new ProductionFundingJobs(':memory:',{treasury:f.ledger,records:f.records,reconciler:r}),/dependencies_required/);
 const p=f.ledger.getPlan('existing-plan');p.source='simulation';f.ledger.savePlan(p);await f.manager.tick();assert.equal(f.manager.status().jobs.length,0);
});
test('signature lookup is finalized getTransaction only',async()=>{
 const signature=bs58.encode(new Uint8Array(64));let count=0;assert.equal(await readFundingTransactionBySignature(signature,'job',{fetcher:async(url,o)=>{count++;assert.equal(url,'https://api.mainnet-beta.solana.com');assert.equal(o.redirect,'error');assert.deepEqual(JSON.parse(o.body),{jsonrpc:'2.0',id:'job',method:'getTransaction',params:[signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:0}]});return new Response(JSON.stringify({id:'job',result:null}));}}),null);assert.equal(count,1);
});
test('unknown transaction stays pending with immutable identity and no credit',async t=>{
 const f=fixture(t);await f.manager.tick();const {signature}=f.proof();f.manager.attachSignature(f.job().id,signature);await f.manager.tick();await f.manager.tick();assert.equal(f.job().state,'awaiting-chain');assert.equal(f.job().signature,signature);assert.equal(f.reconciler.status().jobs.length,0);assert.equal(f.ledger.snapshot().providerCreditMicrousd,'0');assert.throws(()=>f.manager.attachSignature(f.job().id,bs58.encode(new Uint8Array(64))),/locked/);
});
test('verified transfer enters real observe-only reconciler then holds at missing card attribution',async t=>{
 const f=fixture(t);await f.manager.tick();const proof=f.proof();f.setResult(proof.chain);f.manager.attachSignature(f.job().id,proof.signature);await f.manager.tick();assert.equal(f.reconciler.status().jobs.length,1);await f.reconciler.tick();await f.reconciler.tick();await f.manager.tick();assert.equal(f.job().state,'awaiting-card');assert.equal(f.job().reconciliation.chain.state,'finalized');assert.deepEqual(f.job().reasons,['card_records_lack_transfer_signature']);assert.equal(f.ledger.snapshot().providerCreditMicrousd,'0');assert.equal(f.ledger.getPlan('existing-plan').state,'planned');
});
test('existing owner-recorded deposit signature is picked up automatically without changing accounting',async t=>{
 const f=fixture(t),proof=f.proof();f.ledger.advance({id:'existing-plan',stage:'deposit-submitted',amount:'1000000',reference:proof.signature});const before=f.ledger.snapshot();f.setResult(proof.chain);await f.manager.tick();assert.equal(f.job().signature,proof.signature);assert.equal(f.reconciler.status().jobs.length,1);assert.deepEqual(f.ledger.snapshot(),before);
});
for(const kind of ['wrong-amount','extra-instruction','wrong-delta','wrong-signature'])test(kind+' cannot register unverified evidence',async t=>{
 const f=fixture(t);await f.manager.tick();const proof=f.proof({amount:kind==='wrong-amount'?'999999':'1000000',extra:kind==='extra-instruction'});if(kind==='wrong-delta')proof.chain.meta.postTokenBalances[1].uiTokenAmount.amount='999999';f.setResult(proof.chain);f.manager.attachSignature(f.job().id,kind==='wrong-signature'?bs58.encode(new Uint8Array(64)):proof.signature);await f.manager.tick();assert.equal(f.job().state,'review-required');assert.equal(f.reconciler.status().jobs.length,0);assert.equal(f.ledger.snapshot().providerCreditMicrousd,'0');
});
test('changed destination, amount or policy blocks jobs instead of rebinding them',async t=>{
 for(const change of ['recipient','amount','policy']){
  const f=fixture(t);await f.manager.tick();const terms=f.job().termsHash;
  if(change==='amount'){const p=f.ledger.getPlan('existing-plan');p.amount='999999';f.ledger.savePlan(p);}
  else {const p=f.ledger.setting('fundingProfile');if(change==='recipient')p.depositAddress=p.confirmedDepositAddress=Keypair.generate().publicKey.toBase58();else p.policy.maxDailyWbtcUnits='3000000';f.ledger.set('fundingProfile',p);}
  await f.manager.tick();assert.equal(f.job().state,'review-required');assert.equal(f.job().termsHash,terms);assert.equal(f.reads,0);
 }
});
test('one signature cannot be assigned to two jobs',async t=>{
 const f=fixture(t);f.ledger.plan({id:'second-plan',amount:'1000000',route:'solcard-wbtc'});await f.manager.tick();const jobs=f.manager.status().jobs,proof=f.proof();f.manager.attachSignature(jobs[0].id,proof.signature);assert.throws(()=>f.manager.attachSignature(jobs[1].id,proof.signature),/reused/);assert.equal(f.manager.get(jobs[1].id).signature,null);
});
test('restart replays registration after a crash between observer and reconciler databases',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'bithash-production-'));const f=fixture(t,{jobPath:join(dir,'jobs.sqlite'),recPath:join(dir,'reconcile.sqlite')});t.after(()=>rm(dir,{recursive:true,force:true}));await f.manager.tick();const proof=f.proof();f.setResult(proof.chain);f.manager.attachSignature(f.job().id,proof.signature);const register=f.reconciler.register.bind(f.reconciler);f.reconciler.register=input=>{register(input);throw Error('crash_after_registration');};await f.manager.tick();assert.equal(f.job().state,'review-required');assert.ok(f.job().reconciliationTerms);await f.restart();await f.manager.tick();assert.equal(f.reconciler.status().jobs.length,1);assert.equal(f.manager.status().jobs.length,1);await f.reconciler.tick();await f.manager.tick();assert.equal(f.job().state,'awaiting-card');assert.equal(f.reads,1);
});
test('failed observer save cannot publish an uncommitted reconciliation intent',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'bithash-production-'));const path=join(dir,'jobs.sqlite'),f=fixture(t,{jobPath:path});await f.manager.tick();const proof=f.proof();f.setResult(proof.chain);f.manager.attachSignature(f.job().id,proof.signature);const db=new DatabaseSync(path);t.after(async()=>{db.close();await rm(dir,{recursive:true,force:true});});db.exec("CREATE TRIGGER fail_intent BEFORE UPDATE ON production_funding_jobs WHEN json_extract(NEW.body,'$.reconciliationTerms') IS NOT NULL BEGIN SELECT RAISE(ABORT,'failed_save'); END;");await assert.rejects(()=>f.manager.tick());assert.equal(f.job().reconciliationTerms,undefined);assert.equal(f.reconciler.status().jobs.length,0);db.exec('DROP TRIGGER fail_intent');await f.manager.tick();assert.equal(f.reconciler.status().jobs.length,1);
});
test('unrelated database schemas are rejected',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'bithash-production-')),path=join(dir,'ledger.sqlite'),db=new DatabaseSync(path);db.exec('CREATE TABLE treasury_secret(id INTEGER)');db.close();try{assert.throws(()=>new ProductionFundingJobs(path,{treasury:{mode:'owner-recorded'},reconciler:{status:()=>({mode:'observe-only'})}}),/observer_database_required/);}finally{await rm(dir,{recursive:true,force:true});}
});
test('background overlap cannot race signature attachment',async t=>{
 const f=fixture(t);await f.manager.tick();const proof=f.proof();f.manager.attachSignature(f.job().id,proof.signature);const ticking=f.manager.tick();assert.equal((await f.manager.tick()).skipped,'busy');await ticking;assert.equal(f.reads,1);
});
test('console exposes inspection and evidence gaps without offering signing or credit posting',async t=>{
 const f=fixture(t);await treasuryAction(f.ledger,'production-refresh',new URLSearchParams(),{production:f.manager});const s=f.manager.status();assert.equal(s.signer.keyLoaded,false);assert.equal(s.signer.signingEnabled,false);assert.equal(s.signer.broadcastEnabled,false);assert.equal(s.automaticCreditPosting,false);assert.equal(s.paymentsEnabled,false);assert.equal(s.gpuExperimentsEnabled,false);const html=productionFundingPanel(s,()=>'<form>read only</form>');assert.match(html,/OBSERVE ONLY/);assert.match(html,/attribution missing/);assert.match(html,/offline placeholder blockhash/);
});

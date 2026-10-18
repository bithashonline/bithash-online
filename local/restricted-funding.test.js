import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {Keypair,Transaction,SystemProgram,PublicKey} from '@solana/web3.js';
import bs58 from 'bs58';
import {ComputeTreasury,WBTC} from './treasury-compute.js';
import {rehearsalFixture,prepareSimulatedFunding} from './treasury-funding.js';
import {OfflineRestrictedWalletSigner,OFFLINE_BLOCKHASH,buildRestrictedTransfer,transferAccounts,sha256} from './restricted-wallet-signer.js';
import {FundingReconciler,verifyFundingTransaction,readFinalizedFundingTransaction,assessSolCardInvoice} from './funding-reconciler.js';

function fixture(t){
 let now=Date.now();const clock=()=>now,recipient=Keypair.generate().publicKey.toBase58();
 const limits={maxTransferWbtcUnits:'1000000',maxDailyWbtcUnits:'2000000',minSolReserveLamports:'10000000',maxNetworkFeeLamports:'1000000'};
 const signer=new OfflineRestrictedWalletSigner({recipient,...limits,expiresAt:new Date(now+3600000).toISOString()},{clock});
 const ledger=new ComputeTreasury(':memory:',{mode:'simulation',clock});t.after(()=>{ledger.close();signer.destroy();});
 const {profile}=rehearsalFixture(now),owner=signer.publicKey,other=Keypair.generate().publicKey.toBase58();
 Object.assign(profile,{depositAddress:recipient,confirmedDepositAddress:recipient,policy:limits,gasObservation:{...profile.gasObservation,wallet:owner}});
 ledger.configure({computeWallet:owner,otherWallet:other});ledger.recordFees({reference:'fixture',amount:'10000000'});
 ledger.observeWallets({computeWallet:owner,otherWallet:other,mint:WBTC.mint,decimals:8,computeAmount:'7000000',otherAmount:'3000000',observedAt:new Date(now).toISOString(),source:'simulation'});
 prepareSimulatedFunding(ledger,profile,{id:'fixture',amount:'1000000'});
 const tx=buildRestrictedTransfer({owner,recipient,amount:'1000000',blockhash:OFFLINE_BLOCKHASH}),accounts=transferAccounts(owner,recipient);
 const wire=()=>tx.serialize({requireAllSignatures:false,verifySignatures:false});
 const account=(address,owner,amount)=>({address,owner,amount,mint:WBTC.mint,program:WBTC.program,decimals:8,frozen:false,delegate:null,closeAuthority:null});
 const evidence={source:'offline-fixture',observedAt:new Date(now).toISOString(),blockhash:OFFLINE_BLOCKHASH,sourceAccount:account(accounts.sourceAccount,owner,'7000000'),destinationAccount:account(accounts.destinationAccount,recipient,'0'),feePayer:owner,networkFeeLamports:'5000',solLamports:'20000000',messageHash:sha256(tx.serializeMessage())};
 const sign=()=>signer.signOffline(ledger,{planId:'fixture',wire:wire(),evidence});
 const receipt=()=>{
  const signed=sign(),signedTx=Transaction.from(Buffer.from(signed.wireBase64,'base64')),keys=signedTx.compileMessage().accountKeys.map(k=>k.toBase58());
  const balance=(a,o,n)=>({accountIndex:keys.indexOf(a),mint:WBTC.mint,owner:o,programId:WBTC.program,uiTokenAmount:{amount:n,decimals:8}});
  return {job:{id:'fixture',signature:bs58.encode(signedTx.signature),owner,recipient,mint:WBTC.mint,slotNumber:1,amount:'1000000',blockhash:OFFLINE_BLOCKHASH,messageHash:signed.messageHash},
   chain:{slot:123,transaction:[signed.wireBase64,'base64'],meta:{err:null,innerInstructions:[],preTokenBalances:[balance(accounts.sourceAccount,owner,'7000000'),balance(accounts.destinationAccount,recipient,'0')],postTokenBalances:[balance(accounts.sourceAccount,owner,'6000000'),balance(accounts.destinationAccount,recipient,'1000000')]}}};
 };
 return {ledger,signer,profile,tx,wire,evidence,sign,receipt,clock,tick:n=>now+=n};
}
test('offline signer produces a valid Ed25519 signature, stores one result and never imports a real key',t=>{
 const f=fixture(t),a=f.sign(),b=f.sign();assert.deepEqual(a,b);assert.equal(a.broadcastAllowed,false);
 assert.equal(Transaction.from(Buffer.from(a.wireBase64,'base64')).verifySignatures(),true);
 assert.equal(f.ledger.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='offline_signatures'").get().n,0);
 assert.throws(()=>f.signer.signLive(),/live_signing_disabled/);
 const real=new ComputeTreasury(':memory:');t.after(()=>real.close());assert.throws(()=>f.signer.signOffline(real,{planId:'fixture',wire:f.wire(),evidence:f.evidence}),/real_wallet_signing_disabled/);
});
test('byte inspection rejects extra SOL transfers, changed token amount, decimals, account and blockhash',t=>{
 for(const mutate of [
  tx=>tx.add(SystemProgram.transfer({fromPubkey:tx.feePayer,toPubkey:Keypair.generate().publicKey,lamports:1})),
  tx=>{tx.instructions[0].data[1]^=1;},tx=>{tx.instructions[0].data[9]=9;},
  tx=>{tx.instructions[0].keys[2].pubkey=Keypair.generate().publicKey;},
  tx=>{tx.recentBlockhash=Keypair.generate().publicKey.toBase58();},
  tx=>{tx.instructions[0].programId=SystemProgram.programId;}
 ]){const f=fixture(t);mutate(f.tx);assert.throws(()=>f.sign(),/policy_mismatch/);}
});
test('signer holds on stale reads, wrong token accounts, delegate, frozen funds, fee quote substitution and SOL shortage',t=>{
 for(const mutate of [
  f=>f.tick(60001),f=>{f.evidence.sourceAccount.frozen=true;},f=>{f.evidence.sourceAccount.delegate=f.signer.publicKey;},
  f=>{f.evidence.destinationAccount.owner=f.signer.publicKey;},f=>{f.evidence.sourceAccount.mint=f.profile.depositAddress;},
  f=>{f.evidence.solLamports='1';},f=>{f.evidence.networkFeeLamports='1000001';},f=>{f.evidence.messageHash='f'.repeat(64);}
 ]){const f=fixture(t);mutate(f);assert.throws(()=>f.sign());}
});
function signPlan(f,{ledger=f.ledger,id,amount}){
 const p=structuredClone(f.ledger.getPlan('fixture'));p.id=id;p.amount=amount;p.funding.terms.amount=amount;ledger.savePlan(p);
 const tx=buildRestrictedTransfer({owner:f.signer.publicKey,recipient:f.profile.depositAddress,amount,blockhash:OFFLINE_BLOCKHASH});
 return f.signer.signOffline(ledger,{planId:id,wire:tx.serialize({requireAllSignatures:false,verifySignatures:false}),evidence:{...f.evidence,observedAt:new Date(f.clock()).toISOString(),messageHash:sha256(tx.serializeMessage())}});
}
test('signer enforces expiry and rolling daily reservations independently of plan state',t=>{
 const f=fixture(t);f.sign();f.tick(3600000);assert.throws(()=>f.sign(),/policy_expired/);
 const g=fixture(t);g.sign();signPlan(g,{id:'second',amount:'600000'});signPlan(g,{id:'third',amount:'400000'});
 assert.throws(()=>signPlan(g,{id:'fourth',amount:'1'}),/daily_cap/);
});
test('replacing caller ledgers or erasing caller signature rows cannot reset signer caps or replay history',t=>{
 const f=fixture(t);f.sign();signPlan(f,{id:'second',amount:'600000'});
 const replacement=new ComputeTreasury(':memory:',{mode:'simulation',clock:f.clock});t.after(()=>replacement.close());replacement.configure(f.ledger.setting('wallets'));
 // The old caller-owned table must no longer be an authority for spending.
 f.ledger.db.exec('CREATE TABLE offline_signatures(id TEXT PRIMARY KEY,body TEXT NOT NULL); DELETE FROM offline_signatures;');
 assert.throws(()=>signPlan(f,{ledger:replacement,id:'third',amount:'500000'}),/daily_cap/);
 assert.throws(()=>signPlan(f,{ledger:replacement,id:'fixture',amount:'1'}),/replay_conflict/);
 assert.deepEqual(signPlan(f,{ledger:replacement,id:'fixture',amount:'1000000'}),f.sign());
});
test('one signed transaction cannot be reused for another plan and destruction is idempotent',t=>{
 const f=fixture(t);f.sign();assert.throws(()=>signPlan(f,{id:'duplicate',amount:'1000000'}),/transaction_reused/);
 f.signer.destroy();f.signer.destroy();assert.throws(()=>f.sign(),/signer_destroyed/);
});
test('clock rollback cannot reopen signed reservations',t=>{
 const f=fixture(t);f.sign();f.tick(-1);
 assert.throws(()=>signPlan(f,{id:'second',amount:'500000'}),/clock_rollback/);
});
test('altered saved plan cannot relax the signer transfer ceiling or the recipient',t=>{
 const f=fixture(t),p=f.ledger.getPlan('fixture');p.amount='1000001';p.funding.terms.amount=p.amount;f.ledger.savePlan(p);
 const tx=buildRestrictedTransfer({owner:f.signer.publicKey,recipient:f.profile.depositAddress,amount:p.amount,blockhash:OFFLINE_BLOCKHASH});
 const evidence={...f.evidence,messageHash:sha256(tx.serializeMessage())};
 assert.throws(()=>f.signer.signOffline(f.ledger,{planId:p.id,wire:tx.serialize({requireAllSignatures:false,verifySignatures:false}),evidence}),/transfer_cap/);
 p.amount='1000000';p.funding.terms.amount=p.amount;p.funding.terms.depositAddress=Keypair.generate().publicKey.toBase58();f.ledger.savePlan(p);assert.throws(()=>f.sign(),/terms_mismatch/);
});
test('chain verification binds signature, exact message and both token balance deltas',t=>{
 const f=fixture(t),{job,chain}=f.receipt();assert.equal(verifyFundingTransaction(job,chain).state,'finalized');assert.equal(verifyFundingTransaction(job,null).state,'pending');
 for(const mutate of [
  c=>{c.meta.postTokenBalances[1].uiTokenAmount.amount='999999';},
  c=>{c.meta.preTokenBalances[0].owner=job.recipient;},
  c=>{c.meta.innerInstructions=[{instructions:[{}]}];},
  c=>{c.meta.postTokenBalances.push(c.meta.postTokenBalances[1]);}
 ]){const c=structuredClone(chain);mutate(c);assert.throws(()=>verifyFundingTransaction(job,c));}
 assert.throws(()=>verifyFundingTransaction({...job,messageHash:'0'.repeat(64)},chain),/signature_mismatch/);
 const failed=structuredClone(chain);failed.meta.err={InstructionError:[0,'InsufficientFunds']};assert.equal(verifyFundingTransaction(job,failed).state,'failed');
});
test('read-only RPC adapter uses finalized getTransaction only and does not interpret null as failure',async t=>{
 const {job}=fixture(t).receipt();let calls=0;
 const result=await readFinalizedFundingTransaction(job,{fetcher:async(url,o)=>{calls++;assert.equal(url,'https://api.mainnet-beta.solana.com');const request=JSON.parse(o.body);assert.equal(request.method,'getTransaction');assert.equal(request.params[1].commitment,'finalized');return new Response(JSON.stringify({id:job.id,result:null}));}});
 assert.equal(calls,1);assert.equal(result,null);
});
const credit=(job,stage,now)=>({id:stage+'-fixture',state:'credited',source:'simulation',jobId:job.id,signature:job.signature,slotNumber:job.slotNumber,depositAddress:job.recipient,wbtcUnits:job.amount,netMicrousd:stage==='card'?'600000000':'500000000',observedAt:new Date(now).toISOString(),...(stage==='provider'?{cardReceiptId:'card-fixture'}:{})});
test('reconciliation survives restart, unknown status holds, and matching credits complete exactly once',async t=>{
 const f=fixture(t),{job,chain}=f.receipt();let ready=false,chainReads=0,cardReads=0,providerReads=0;
 const parent=resolve(tmpdir()),dir=await mkdtemp(join(parent,'bithash-reconcile-'));let r;
 t.after(async()=>{await r?.close();assert.ok(resolve(dir).startsWith(parent+sep));await rm(dir,{recursive:true,force:true});});
 const path=join(dir,'jobs.sqlite'),options={mode:'simulation',clock:f.clock,readChain:async()=>{chainReads++;return ready?chain:null;},readCard:async()=>{cardReads++;return credit(job,'card',f.clock());},readProvider:async()=>{providerReads++;return credit(job,'provider',f.clock());}};
 r=new FundingReconciler(path,options);r.register(job);await r.tick();assert.equal(r.get(job.id).state,'awaiting-chain');await r.close();
 r=new FundingReconciler(path,options);assert.throws(()=>r.register({...job,amount:'1'}),/terms_changed/);ready=true;
 await r.tick();assert.equal(r.get(job.id).state,'awaiting-card');await r.tick();assert.equal(r.get(job.id).state,'awaiting-provider');await r.tick();assert.equal(r.get(job.id).state,'complete');await r.tick();
 assert.equal(chainReads,2);assert.equal(cardReads,1);assert.equal(providerReads,1);assert.equal(f.ledger.snapshot().providerCreditMicrousd,'0');
});
test('unbound invoice and converted USD amount cannot become card credit',async t=>{
 const f=fixture(t),{job,chain}=f.receipt(),invoice={currency:'WBTC',network:'SOLANA',address:job.recipient,status:'PAID',payment:{swapUsdAmount:'600'}};
 assert.equal(assessSolCardInvoice(invoice,job).state,'unavailable');
 const r=new FundingReconciler(':memory:',{readChain:async()=>chain,readCard:async()=>credit(job,'card',f.clock())});t.after(()=>r.close());r.register(job);
 await r.tick();await r.tick();assert.equal(r.get(job.id).state,'awaiting-card');assert.equal(r.get(job.id).reason,'unverified_credit_receipt');
});
test('wrong signature or excessive provider credit cannot advance reconciliation',async t=>{
 const f=fixture(t),{job,chain}=f.receipt();let bad=true;
 const r=new FundingReconciler(':memory:',{mode:'simulation',readChain:async()=>chain,readCard:async()=>({...credit(job,'card',f.clock()),...(bad?{signature:'wrong'}:{})}),readProvider:async()=>({...credit(job,'provider',f.clock()),netMicrousd:'600000001'})});t.after(()=>r.close());r.register(job);
 await r.tick();await r.tick();assert.equal(r.get(job.id).state,'awaiting-card');bad=false;await r.tick();await r.tick();assert.equal(r.get(job.id).state,'awaiting-provider');assert.equal(r.get(job.id).reason,'provider_credit_mismatch');
});
test('background worker prevents overlapping ticks and stops scheduling on shutdown',async t=>{
 const {job}=fixture(t).receipt();let release,calls=0;const scheduled=[];
 const r=new FundingReconciler(':memory:',{intervalMs:1000,schedule:(fn,ms)=>{scheduled.push({fn,ms});return 1;},cancel:()=>{},readChain:()=>{calls++;return new Promise(resolve=>{release=resolve;});}});t.after(()=>r.close());r.register(job);r.start();
 assert.equal((await r.tick()).skipped,'busy');assert.equal(calls,1);release(null);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(scheduled.length,1);await r.stop();assert.equal(r.status().running,false);
});
test('failed or unavailable chain never advances to a credit read',async t=>{
 const f=fixture(t),{job,chain}=f.receipt();chain.meta.err={InstructionError:[0,'failure']};let cards=0;
 const r=new FundingReconciler(':memory:',{readChain:async()=>chain,readCard:async()=>{cards++;}});t.after(()=>r.close());r.register(job);await r.tick();await r.tick();assert.equal(r.get(job.id).state,'chain-failed');assert.equal(cards,0);
 const unavailable=new FundingReconciler(':memory:',{readChain:async()=>{throw Error('rpc_unavailable');}});t.after(()=>unavailable.close());unavailable.register(job);await unavailable.tick();assert.equal(unavailable.get(job.id).state,'awaiting-chain');
});
test('reconciliation signature cannot be assigned to a second job',async t=>{
 const {job}=fixture(t).receipt(),r=new FundingReconciler(':memory:');t.after(()=>r.close());r.register(job);
 assert.throws(()=>r.register({...job,id:'another'}),/UNIQUE constraint/);assert.equal(r.status().jobs.length,1);
});
test('failed database writes cannot resurrect rolled-back card or provider credits',async t=>{
 const f=fixture(t),{job,chain}=f.receipt(),parent=resolve(tmpdir()),dir=await mkdtemp(join(parent,'bithash-credit-rollback-'));
 const path=join(dir,'jobs.sqlite');let r,db;
 t.after(async()=>{db?.close();await r?.close();assert.ok(resolve(dir).startsWith(parent+sep));await rm(dir,{recursive:true,force:true});});
 r=new FundingReconciler(path,{mode:'simulation',clock:f.clock,readChain:async()=>chain,readCard:async()=>credit(job,'card',f.clock()),readProvider:async()=>credit(job,'provider',f.clock())});
 db=new DatabaseSync(path);r.register(job);await r.tick();
 for(const [stage,before,after,count] of [['card','awaiting-card','awaiting-provider',0],['provider','awaiting-provider','complete',1]]){
  db.exec(`CREATE TRIGGER fail_credit BEFORE UPDATE ON reconciliation_jobs WHEN json_extract(NEW.body,'$.state')='${after}' BEGIN SELECT RAISE(ABORT,'simulated_commit_failure'); END;`);
  const failed=await r.tick();assert.equal(failed.errors,1);assert.equal(r.get(job.id).state,before);assert.equal(r.get(job.id)[stage],undefined);
  assert.equal(db.prepare('SELECT count(*) AS n FROM reconciliation_receipts').get().n,count);
  db.exec('DROP TRIGGER fail_credit');await r.tick();assert.equal(r.get(job.id).state,after);
  assert.equal(db.prepare('SELECT count(*) AS n FROM reconciliation_receipts').get().n,count+1);
 }
 assert.equal(f.ledger.snapshot().providerCreditMicrousd,'0');
});

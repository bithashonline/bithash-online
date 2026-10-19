import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Keypair,Transaction} from '@solana/web3.js';
import bs58 from 'bs58';
import {HolderRewards,allocateHolderRewards} from './holder-rewards.js';
import {normalizeHolderSnapshot,HOLDER_PROGRAMS,readHolderSnapshot} from './holder-snapshot.js';
import {buildRewardTransfer} from './reward-transfer.js';
import {coordinatorFixture} from './funding-coordinator-sample.js';
import {WBTC} from './treasury-compute.js';
const now=Date.parse('2026-10-19T00:00:00Z'),at=new Date(now).toISOString();
function snapshotInput(){
 const mint=Keypair.generate().publicKey.toBase58(),owners=[Keypair.generate().publicKey.toBase58(),Keypair.generate().publicKey.toBase58()],program=HOLDER_PROGRAMS[0];
 const before={context:{slot:123},value:{owner:program,executable:false,data:{parsed:{type:'mint',info:{isInitialized:true,mintAuthority:null,decimals:6,supply:'1000'}}}}};
 const row=(owner,amount)=>({pubkey:Keypair.generate().publicKey.toBase58(),account:{owner:program,executable:false,data:{parsed:{type:'account',info:{mint,owner,isNative:false,state:'initialized',tokenAmount:{amount,decimals:6}}}}}});
 return {mint,before,after:structuredClone(before),accounts:{context:{slot:123},value:[row(owners[0],'200'),row(owners[0],'300'),row(owners[1],'500')]},observedAt:at};
}
async function setup(t,{persistent=false}={}){
 const raw=snapshotInput(),snap=normalizeHolderSnapshot(raw),data=coordinatorFixture(now),owner=Keypair.generate();data.automatic.configuration.projectMint=raw.mint;
 data.automatic.configuration.otherWallet=owner.publicKey.toBase58();for(const r of data.automatic.receipts){r.projectMint=raw.mint;r.otherWallet=owner.publicKey.toBase58();}
 data.treasury.walletFresh=true;data.treasury.walletObservation={otherAmount:'300000',source:'finalized-rpc',mint:WBTC.mint,otherWallet:owner.publicKey.toBase58(),computeWallet:data.automatic.configuration.computeWallet};
 const config={...data.automatic.configuration,excludedOwners:[owner.publicKey.toBase58(),data.automatic.configuration.computeWallet],policyConfirmed:true};
 const dir=persistent?mkdtempSync(join(tmpdir(),'holder-rewards-')):null,path=dir?join(dir,'rewards.sqlite'):':memory:';let rawTx=null;
 const options={configuration:config,observe:()=>data,clock:()=>now,readSnapshot:async()=>snap,readTransaction:async()=>rawTx};let rewards=new HolderRewards(path,options);
 t.after(()=>{rewards.close();if(dir)rmSync(dir,{recursive:true,force:true});});await rewards.refresh();
 return {data,owner,snap,config,get rewards(){return rewards;},restart(){rewards.close();rewards=new HolderRewards(path,options);},tx:v=>rawTx=v};
}
function signed(f,round,p,failed=false){
 const {tx,source,destination}=buildRewardTransfer({owner:round.owner,recipient:p.owner,amount:p.amount,blockhash:Keypair.generate().publicKey.toBase58()});tx.sign(f.owner);const keys=tx.compileMessage().accountKeys.map(k=>k.toBase58());
 const balance=(account,owner,amount)=>({accountIndex:keys.indexOf(account),owner,mint:WBTC.mint,programId:WBTC.program,uiTokenAmount:{amount,decimals:8}});
 return {signature:bs58.encode(tx.signature),raw:{slot:123,transaction:[tx.serialize().toString('base64'),'base64'],meta:{err:failed?{InstructionError:[1,'fixture-failure']}:null,preTokenBalances:[balance(source,round.owner,'300000')],postTokenBalances:[balance(source,round.owner,String(300000n-BigInt(p.amount))),balance(destination,p.owner,p.amount)]}}};
}
test('snapshot aggregates every token account by owner and verifies total supply',()=>{
 const raw=snapshotInput(),s=normalizeHolderSnapshot(raw);assert.equal(s.holders.length,2);assert.ok(s.holders.every(h=>h.units==='500'));
 raw.accounts.value.pop();assert.throws(()=>normalizeHolderSnapshot(raw),/supply_mismatch/);
});
test('snapshot rejects duplicate accounts, mixed slots, wrong mint and unsupported extensions',()=>{
 for(const mutate of [r=>r.accounts.value.push(r.accounts.value[0]),r=>r.accounts.context.slot=122,r=>r.accounts.value[0].account.data.parsed.info.mint=Keypair.generate().publicKey.toBase58(),r=>r.before.value.data.parsed.info.extensions=[{extension:'confidentialTransferMint'}]]){const r=snapshotInput();mutate(r);assert.throws(()=>normalizeHolderSnapshot(r));}
});
test('read adapter uses finalized full account scan and supply bracketing only',async()=>{
 const raw=snapshotInput(),calls=[];let mintReads=0;
 const s=await readHolderSnapshot(raw.mint,{clock:()=>now,fetcher:async(url,o)=>{assert.equal(url,'https://api.mainnet-beta.solana.com');const q=JSON.parse(o.body);calls.push(q.method);assert.equal(q.params[1].commitment,'finalized');const result=q.method==='getProgramAccounts'?raw.accounts:(mintReads++?raw.after:raw.before);return new Response(JSON.stringify({id:q.id,result}));}});
 assert.equal(s.holders.length,2);assert.deepEqual(calls,['getAccountInfo','getProgramAccounts','getAccountInfo']);
});
test('integer pro-rata allocation conserves every WBTC unit with deterministic rounding',()=>{
 const s=normalizeHolderSnapshot(snapshotInput()),a=allocateHolderRewards(s,'7',[]);assert.equal(a.reduce((v,p)=>v+BigInt(p.amount),0n),7n);assert.deepEqual(a,allocateHolderRewards({...s,holders:[...s.holders].reverse()},'7',[]));assert.equal(allocateHolderRewards(s,'7',[s.holders[0].owner])[0].amount,'7');
});
test('70/30 receipts reserve half the other treasury for rewards once across restart',async t=>{
 const f=await setup(t,{persistent:true});assert.equal(f.rewards.status().rewardUnits,'150000');assert.equal(f.rewards.status().devUnits,'150000');f.rewards.syncFees();f.restart();f.rewards.syncFees();assert.equal(f.rewards.status().rewardUnits,'150000');
 const r=f.rewards.prepareRound('round-1','150000');assert.equal(r.payouts.reduce((v,p)=>v+BigInt(p.amount),0n),150000n);assert.equal(f.rewards.status().availableUnits,'0');f.restart();assert.deepEqual(f.rewards.prepareRound('round-1','150000'),r);assert.throws(()=>f.rewards.prepareRound('round-1','1'),/replay_conflict/);
 assert.throws(()=>f.rewards.prepareRound('round-2','1'),/existing_round/);assert.equal(f.rewards.status().signingEnabled,false);
});
test('manifest cannot spend the development reserve or use incomplete fees',async t=>{
 const f=await setup(t);f.data.treasury.walletObservation.otherAmount='299999';assert.throws(()=>f.rewards.prepareRound('r1','150000'),/development_reserve/);f.data.automatic.receipts[0].otherUnits='999';assert.throws(()=>f.rewards.syncFees(),/receipt_invalid/);assert.equal(f.rewards.status().rewardUnits,'150000');
});
test('unsigned payout includes associated account creation and cannot sign or broadcast',async t=>{
 const f=await setup(t),r=f.rewards.prepareRound('r1','150000'),p=r.payouts[0],draft=f.rewards.unsignedPayout(r.id,p.id),tx=Transaction.from(Buffer.from(draft.wireBase64,'base64'));
 assert.equal(tx.instructions.length,2);assert.ok(tx.signatures.every(s=>s.signature===null));assert.equal(draft.requiresLiveFeeAndRentPreflight,true);assert.throws(()=>f.rewards.sign(),/disabled/);assert.throws(()=>f.rewards.broadcast(),/disabled/);
});
test('unknown payout retains its signature across restart; finalized payment is not paid twice',async t=>{
 const f=await setup(t,{persistent:true}),r=f.rewards.prepareRound('r1','150000'),p=r.payouts[0],tx=signed(f,r,p);f.rewards.attachExistingSignature(r.id,p.id,tx.signature);await f.rewards.reconcile();f.restart();assert.throws(()=>f.rewards.unsignedPayout(r.id,p.id),/not_available/);assert.throws(()=>f.rewards.attachExistingSignature(r.id,p.id,'3'.repeat(88)),/locked/);
 f.tx(tx.raw);await f.rewards.reconcile();await f.rewards.reconcile();const paid=f.rewards.status().rounds[0].payouts[0];assert.equal(paid.state,'paid');assert.equal(paid.attempts.length,1);assert.throws(()=>f.rewards.attachExistingSignature(r.id,r.payouts[1].id,tx.signature),/reused/);
});
test('definitive failed payout permits a new attempt while keeping its liability',async t=>{
 const f=await setup(t),r=f.rewards.prepareRound('r1','150000'),p=r.payouts[0],tx=signed(f,r,p,true);f.rewards.attachExistingSignature(r.id,p.id,tx.signature);f.tx(tx.raw);await f.rewards.reconcile();const pp=f.rewards.status().rounds[0].payouts[0];assert.equal(pp.state,'signing-disabled');assert.equal(pp.signature,null);assert.equal(pp.attempts[0].state,'failed');assert.equal(f.rewards.status().availableUnits,'0');assert.ok(f.rewards.unsignedPayout(r.id,p.id).wireBase64);
});
test('wrong net credit and pre-snapshot transactions never count as paid',async t=>{
 for(const change of [x=>x.slot=122,x=>x.meta.postTokenBalances[1].uiTokenAmount.amount='1']){const f=await setup(t),r=f.rewards.prepareRound('r1','150000'),p=r.payouts[0],tx=signed(f,r,p);change(tx.raw);f.rewards.attachExistingSignature(r.id,p.id,tx.signature);f.tx(tx.raw);await assert.rejects(()=>f.rewards.reconcile());assert.equal(f.rewards.status().rounds[0].payouts[0].state,'awaiting-finalized');}
});
test('unlaunched rewards manager performs no network requests or fee creation',async t=>{
 const r=new HolderRewards(':memory:',{observe:()=>{throw Error('unexpected');},readSnapshot:()=>{throw Error('unexpected');}});t.after(()=>r.close());await r.refresh();assert.equal(r.status().state,'awaiting-token-launch');assert.equal(r.status().rewardUnits,'0');assert.equal(r.status().rounds.length,0);
});

test('automatic preparation produces one persistent round and performs no payout execution',async t=>{
 const f=await setup(t);
 const r=new HolderRewards(':memory:',{configuration:{...f.config,automaticRounds:true,roundIntervalHours:24,minRoundUnits:'1000',maxRoundUnits:'10000'},observe:()=>f.data,clock:()=>now,readSnapshot:async()=>f.snap,readTransaction:async()=>{throw Error('unexpected transaction read');}});
 t.after(()=>r.close());await r.tick();await r.tick();assert.equal(r.status().rounds.length,1);assert.equal(r.status().rounds[0].budgetUnits,'10000');assert.equal(r.status().paymentsEnabled,false);
});

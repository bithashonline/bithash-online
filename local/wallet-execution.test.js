import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,Transaction} from '@solana/web3.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WalletExecution,RestrictedWalletCustody,WalletBroadcaster,executionTransaction} from './wallet-execution.js';
import {sha256} from './restricted-wallet-signer.js';
const start=Date.parse('2026-10-19T20:00:00Z');
function fixture(t,{enabled=true,persistent=false,kind='reward',changePolicy=()=>{}}={}){
 let now=start,loaded=0,sent=0,reads=0,notifications=0,result=null,lastWire=null,throwSend=false;
 const owner=Keypair.generate(),recipient=Keypair.generate().publicKey.toBase58(),blockhash=Keypair.generate().publicKey.toBase58();
 const intent={id:'test-payout',kind,owner:owner.publicKey.toBase58(),recipient,amount:'1000',manifestHash:'a'.repeat(64),rewardPolicyHash:'b'.repeat(64),minContextSlot:1},intents=[intent];
 const limits={kinds:['reward','funding'],depositAddress:recipient,rewardPolicyHashes:[intent.rewardPolicyHash],maxTransferWbtcUnits:'1000',maxDailyWbtcUnits:'2000',maxTransactionCostLamports:'10000',maxDailyCostLamports:'20000'};
 const policy={expiresAt:new Date(now+86400000).toISOString(),owners:{[intent.owner]:limits}};changePolicy(policy,limits);
 const preflight=()=>({state:'checks-passed',simulation:'passed',slot:10,observedAt:new Date(now).toISOString(),blockhash,lastValidBlockHeight:200,messageHash:sha256(executionTransaction(intent,blockhash).serializeMessage()),networkFeeLamports:'5000',totalCostLamports:'5000'});
 const dir=persistent?mkdtempSync(join(tmpdir(),'wallet-execution-')):null,path=dir?join(dir,'execution.sqlite'):':memory:';
 const options={source:()=>structuredClone(intents),prepare:async()=>preflight(),policy,signingEnabled:enabled,broadcastEnabled:enabled,clock:()=>now,custody:new RestrictedWalletCustody({signingEnabled:true,loadKey:async()=>{loaded++;return Uint8Array.from(owner.secretKey);}}),broadcaster:{send:async wire=>{sent++;lastWire=wire;if(throwSend)throw Error('wallet_submission_unknown');}},onSignature:async()=>{notifications++;},readTransaction:async()=>{reads++;return result;}};
 let manager=new WalletExecution(path,options);
 t.after(async()=>{await manager.close();if(dir)rmSync(dir,{recursive:true,force:true});});
 return {intent,intents,options,limits,preflight,get manager(){return manager;},get counts(){return {loaded,sent,reads,notifications};},get wire(){return lastWire;},advance:n=>{now+=n;},failSend:()=>{throwSend=true;},result:r=>{result=r;},restart:async()=>{await manager.close();manager=new WalletExecution(path,options);}};
}
test('disabled execution prepares jobs but never loads a key or submits, even with callable adapters',async t=>{const f=fixture(t,{enabled:false});await f.manager.tick();assert.equal(f.manager.status().jobs[0].state,'signing-disabled');assert.deepEqual(f.counts,{loaded:0,sent:0,reads:0,notifications:0});assert.equal(f.manager.status().signingEnabled,false);});
test('disabled custody and broadcaster reject before loader or fetch',async()=>{let calls=0;await assert.rejects(new RestrictedWalletCustody({loadKey:()=>calls++}).sign(),/disabled/);await assert.rejects(new WalletBroadcaster({fetcher:()=>calls++}).send(),/disabled/);assert.equal(calls,0);});
test('signed attempt is durable, unknown submission never resends after restart, exact receipt completes',async t=>{const f=fixture(t,{persistent:true});f.failSend();await f.manager.tick();assert.equal(f.counts.sent,1);assert.equal(f.counts.loaded,1);assert.ok(!JSON.stringify(f.manager.status()).includes('signedWire'));await f.restart();await f.manager.tick();assert.equal(f.counts.sent,1);assert.equal(f.counts.loaded,1);f.result({slot:11,transaction:[f.wire.toString('base64'),'base64'],meta:{err:null}});await f.manager.tick();assert.equal(f.manager.status().jobs[0].state,'finalized');await f.manager.tick();assert.equal(f.counts.sent,1);});
test('finalized failure is retained without new signature or automatic replacement',async t=>{const f=fixture(t);await f.manager.tick();f.result({slot:11,transaction:[f.wire.toString('base64'),'base64'],meta:{err:{InstructionError:[0,'failed']}}});await f.manager.tick();assert.equal(f.manager.status().jobs[0].state,'failed');await f.manager.tick();assert.equal(f.counts.sent,1);});
test('changed source across preflight never reaches custody',async t=>{const f=fixture(t);f.options.prepare=async()=>{f.intents[0].amount='999';return f.preflight();};await f.restart();await f.manager.tick();assert.equal(f.manager.status().jobs[0].reason,'wallet_source_intent_changed');assert.equal(f.counts.loaded,0);});
test('transaction and independent daily limits reject before signing',async t=>{const f=fixture(t,{changePolicy:(p,l)=>l.maxDailyCostLamports='4999'});await f.manager.tick();assert.equal(f.manager.status().jobs[0].reason,'wallet_daily_cap');assert.equal(f.counts.loaded,0);});
test('wrong reward policy and funding destination cannot sign',async t=>{for(const kind of ['reward','funding']){const f=fixture(t,{kind,changePolicy:(p,l)=>{l.rewardPolicyHashes=[];l.depositAddress=Keypair.generate().publicKey.toBase58();}});await f.manager.tick();assert.equal(f.counts.loaded,0);assert.equal(f.manager.status().jobs[0].state,'held');}});
test('key error after reservation requires review across restart without trying the key again',async t=>{const f=fixture(t,{persistent:true});f.options.custody.sign=async()=>{throw Error('wallet_key_unavailable');};await f.manager.tick();assert.equal(f.manager.status().jobs[0].state,'signing-outcome-review');await f.restart();await f.manager.tick();assert.equal(f.manager.status().jobs[0].state,'signing-outcome-review');assert.equal(f.counts.sent,0);});
test('preflight message mismatch and unsuccessful simulation reject before signing',async t=>{for(const changed of ['messageHash','simulation']){const f=fixture(t);const saved=f.options.prepare;f.options.prepare=async()=>({...await saved(),[changed]:'wrong'});await f.restart();await f.manager.tick();assert.equal(f.counts.loaded,0);}});

test('unresolved signed attempt prevents another job for the same owner',async t=>{const f=fixture(t);f.intents.push({...f.intent,id:'second-payout'});await f.manager.tick();assert.equal(f.counts.sent,1);assert.equal(f.manager.status().jobs[1].reason,'wallet_other_attempt_pending');});
test('wrong key and expired policy fail without submission',async t=>{
 const f=fixture(t,{changePolicy:p=>p.expiresAt=new Date(start-1).toISOString()});await f.manager.tick();assert.equal(f.counts.loaded,0);assert.equal(f.counts.sent,0);
 const i={...f.intent},wire=executionTransaction(i,f.preflight().blockhash).serialize({requireAllSignatures:false,verifySignatures:false});let secret=Uint8Array.from(Keypair.generate().secretKey);
 await assert.rejects(new RestrictedWalletCustody({signingEnabled:true,loadKey:async()=>secret}).sign(i,wire,f.preflight().blockhash),/identity_mismatch/);assert.ok(secret.every(n=>n===0));
});
test('broadcast adapter uses preflight with no RPC retry and detects unknown response',async t=>{
 const f=fixture(t);await f.manager.tick();let request;
 const b=new WalletBroadcaster({broadcastEnabled:true,fetcher:async(url,options)=>{assert.equal(url,'https://api.mainnet-beta.solana.com');request=JSON.parse(options.body);return new Response(JSON.stringify({jsonrpc:'2.0',id:'wallet-submit',result:f.manager.status().jobs[0].signature}));}});
 await b.send(f.wire);assert.equal(request.method,'sendTransaction');assert.deepEqual(request.params[1],{encoding:'base64',skipPreflight:false,preflightCommitment:'finalized',maxRetries:0});
 await assert.rejects(new WalletBroadcaster({broadcastEnabled:true,fetcher:async()=>new Response(JSON.stringify({result:'wrong'}))}).send(f.wire),/unknown/);
});
test('different signed finalized message cannot close an attempt',async t=>{const f=fixture(t);await f.manager.tick();f.result({slot:11,transaction:[executionTransaction({...f.intent,amount:'2'},f.preflight().blockhash).serialize({requireAllSignatures:false,verifySignatures:false}).toString('base64'),'base64'],meta:{err:null}});await f.manager.tick();assert.equal(f.manager.status().jobs[0].state,'submission-review');assert.equal(f.counts.sent,1);});

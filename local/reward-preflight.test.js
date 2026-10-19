import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,SystemProgram,Transaction} from '@solana/web3.js';
import {RewardPreflight,rewardReadRpc,MAINNET_GENESIS} from './reward-preflight.js';
import {WBTC} from './treasury-compute.js';
const now=Date.parse('2026-10-19T20:00:00Z');
export function rewardFixture(change=()=>{}){
 const key=()=>Keypair.generate().publicKey.toBase58(),owner=key(),recipient=key(),blockhash=key();
 const token=who=>({owner:WBTC.program,executable:false,data:{parsed:{type:'account',info:{owner:who,mint:WBTC.mint,state:'initialized',isNative:false,tokenAmount:{amount:'1000000',decimals:8}}}}});
 const terms={owner,recipient,amount:'10000',policy:{maxTransferWbtcUnits:'10000',maxNetworkFeeLamports:'10000',maxTotalCostLamports:'2100000',minSolReserveLamports:'1000000',retainedWbtcUnits:'100000'}};
 const responses={getGenesisHash:MAINNET_GENESIS,getLatestBlockhash:{context:{slot:100},value:{blockhash,lastValidBlockHeight:200}},getMultipleAccounts:{context:{slot:101},value:[{owner:WBTC.program,executable:false,data:{parsed:{type:'mint',info:{isInitialized:true,decimals:8}}}},{owner:SystemProgram.programId.toBase58(),executable:false,data:['','base64'],lamports:10000000},token(owner),null]},getMinimumBalanceForRentExemption:2039280,getFeeForMessage:{context:{slot:102},value:5000},simulateTransaction:{context:{slot:103},value:{err:null,accounts:[{lamports:7955720}]}},getBlockHeight:150};
 const calls=[];change(responses,terms,token);
 const service=new RewardPreflight({clock:()=>now,rpc:async(method,params)=>{calls.push({method,params});assert.ok(Object.hasOwn(responses,method));if(method==='simulateTransaction'){const tx=Transaction.from(Buffer.from(params[0],'base64'));assert.equal(tx.instructions.length,2);assert.ok(tx.signatures.every(s=>s.signature===null));assert.equal(params[1].sigVerify,false);assert.equal(params[1].replaceRecentBlockhash,false);assert.equal(tx.recentBlockhash,blockhash);}return responses[method];}});
 return {terms,responses,calls,service};
}
test('payout preflight includes exact network fee plus missing ATA rent, unsigned simulation and reserve',async()=>{
 const f=rewardFixture(),r=await f.service.check(f.terms);assert.equal(r.state,'checks-passed');assert.equal(r.accountRentLamports,'2039280');assert.equal(r.totalCostLamports,'2044280');assert.equal(r.spendingAuthorized,false);assert.equal(r.signingEnabled,false);assert.deepEqual(f.calls.find(c=>c.method==='getMinimumBalanceForRentExemption').params,[165,{commitment:'finalized'}]);
});
test('existing ATA needs no rent read',async()=>{const f=rewardFixture((r,t,token)=>{r.getMultipleAccounts.value[3]=token(t.recipient);r.simulateTransaction.value.accounts[0].lamports=9995000;});const r=await f.service.check(f.terms);assert.equal(r.state,'checks-passed');assert.equal(r.accountRentLamports,'0');assert.ok(!f.calls.some(c=>c.method==='getMinimumBalanceForRentExemption'));});
test('fee, rent, SOL and WBTC reserve caps hold independently',async()=>{
 for(const [change,reason] of [[(r,t)=>t.policy.maxNetworkFeeLamports='1','reward_network_fee_cap'],[(r,t)=>t.policy.maxTotalCostLamports='100','reward_total_cost_cap'],[(r,t)=>t.policy.minSolReserveLamports='9000000','reward_sol_reserve_shortfall'],[(r,t)=>t.policy.retainedWbtcUnits='1000000','reward_development_or_other_payout_reserve'],[(r,t)=>t.policy=null,'reward_limits_not_configured']]){const f=rewardFixture(change),r=await f.service.check(f.terms);assert.equal(r.state,'held');assert.ok(r.reasons.includes(reason));}
});
test('wrong network, frozen destination, stale context, missing fee and expired blockhash hold',async()=>{
 for(const change of [r=>r.getGenesisHash='wrong',(r,t,token)=>{r.getMultipleAccounts.value[3]=token(t.recipient);r.getMultipleAccounts.value[3].data.parsed.info.state='frozen';},r=>r.getFeeForMessage.context.slot=99,r=>r.getFeeForMessage.value=null,r=>r.getBlockHeight=201,r=>r.simulateTransaction.value.err={InstructionError:[0,'failed']},r=>r.simulateTransaction.value.accounts[0].lamports=1]){const f=rewardFixture(change),r=await f.service.check(f.terms);assert.equal(r.state,'held');}
});
test('missing source/payer are reported without simulation or money movement',async()=>{const f=rewardFixture(r=>{r.getMultipleAccounts.value[1]=null;r.getMultipleAccounts.value[2]=null;});const r=await f.service.check(f.terms);assert.equal(r.state,'held');assert.equal(r.simulation,'not-run');assert.ok(!f.calls.some(c=>c.method==='simulateTransaction'));});
test('read RPC rejects write methods before touching transport and bounds responses',async()=>{let calls=0;const rpc=rewardReadRpc(async()=>{calls++;return new Response('x'.repeat(131073));});await assert.rejects(rpc('sendTransaction',[]),/forbidden/);assert.equal(calls,0);await assert.rejects(rpc('getGenesisHash',[]),/too_large/);});

import {test} from 'node:test';import assert from 'node:assert/strict';
import {observeTestTreasury,encode58,DEVNET_RPC} from './treasury-devnet.js';import {decode58} from './solana-evidence.js';
test('test treasury uses finalized devnet and never treats SOL as provider credit',async()=>{
 const address=encode58(Buffer.alloc(32,7));assert.deepEqual(decode58(address,32),Buffer.alloc(32,7));
 const out=await observeTestTreasury(address,{fetcher:async(url,o)=>{assert.equal(url,DEVNET_RPC);assert.equal(o.redirect,'error');assert.equal(JSON.parse(o.body).params[1].commitment,'finalized');return {ok:true,json:async()=>({id:1,result:{value:123,context:{slot:50}}})};}});
 assert.equal(out.lamports,'123');assert.equal(out.realFunds,false);assert.equal(out.spendableProviderMicrousd,null);assert.match(out.proof,/cluster=devnet$/);
});
test('RPC failure, invalid address, overflow and malformed balance fail closed',async()=>{
 for(const data of [{error:{}},{id:1,result:{value:1.1,context:{slot:1}}},{id:1,result:{value:Number.MAX_SAFE_INTEGER+1,context:{slot:1}}},{id:1,result:{value:0,context:{slot:-1}}}])await assert.rejects(observeTestTreasury('1'.repeat(32),{fetcher:async()=>({ok:true,json:async()=>data})}));
 await assert.rejects(observeTestTreasury('bad'));await assert.rejects(observeTestTreasury('1'.repeat(32),{fetcher:async()=>({ok:false})}));
});

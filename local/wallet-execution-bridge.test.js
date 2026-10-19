import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import {connectDisabledWalletExecution} from './wallet-execution-bridge.js';
import {executionTransaction} from './wallet-execution.js';
import {sha256} from './restricted-wallet-signer.js';
const key=()=>Keypair.generate().publicKey.toBase58();
test('production bridge connects funding and reward checks with no signature notification',async t=>{
 const intents=['funding','reward'].map((kind,index)=>({id:'bridge-'+index,kind,owner:key(),recipient:key(),amount:'1000',...(kind==='reward'?{roundId:'round',payoutId:'payout',manifestHash:'a'.repeat(64),rewardPolicyHash:'b'.repeat(64)}:{})}));
 let fundingCalls=0,rewardCalls=0,notifications=0;
 const prepare=i=>{const blockhash=key();return {state:'checks-passed',simulation:'passed',observedAt:new Date().toISOString(),blockhash,messageHash:sha256(executionTransaction(i,blockhash).serializeMessage())};};
 const funding={executionIntents:()=>[intents[0]],executionPreflight:async()=>{fundingCalls++;return prepare(intents[0]);},attachSignature:()=>notifications++};
 const rewards={executionIntents:()=>[intents[1]],preflightPayout:async()=>{rewardCalls++;return prepare(intents[1]);},attachExistingSignature:()=>notifications++};
 const collection={status:()=>({configuration:null})};const e=connectDisabledWalletExecution(':memory:',{funding,rewards,collection});t.after(()=>e.close());await e.tick();
 assert.equal(fundingCalls,1);assert.equal(rewardCalls,1);assert.equal(notifications,0);assert.equal(e.status().jobs.length,2);assert.ok(e.status().jobs.every(j=>j.state==='signing-disabled'));assert.equal(e.status().broadcastEnabled,false);
});

test('collection draft identity survives blockhash refresh and changes after a new distribution',async t=>{
 const configuration={projectMint:key(),computeWallet:key(),otherWallet:key()},observation={fresh:true,state:'unsigned-preview',reasons:[],recipients:[{wallet:configuration.computeWallet,bps:7000},{wallet:configuration.otherWallet,bps:3000}],amounts:{curvePending:'0',poolPending:'0',pumpVault:'100',ammVault:'0',total:'100'},steps:['distribute'],initializeRecipientAtas:false,observedAt:new Date().toISOString(),simulation:'passed',blockhash:key()};let epoch=0;
 const collection={status:()=>({configuration,observation,receipts:{count:epoch}}),refresh:async()=>{}};
 const e=connectDisabledWalletExecution(':memory:',{funding:{executionIntents:()=>[]},rewards:{executionIntents:()=>[]},collection});t.after(()=>e.close());await e.tick();assert.equal(e.status().jobs.length,1);observation.blockhash=key();await e.tick();assert.equal(e.status().jobs.length,1);epoch=1;await e.tick();assert.equal(e.status().jobs.length,2);assert.equal(e.status().signingEnabled,false);
});

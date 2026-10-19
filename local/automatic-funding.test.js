import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import bs58 from 'bs58';
import {PublicKey} from '@solana/web3.js';
import {ComputeTreasury,WBTC} from './treasury-compute.js';
import {PUMP,PUMP_FEES,PUMP_AMM,feeAddresses,wbtcAta,verifyFeeRouting,inspectFeeTransaction,scanFees,publicFeeRpc,collectionAccounts} from './fee-detection.js';
import {AutomaticFunding,DEFAULT_DRY_RULES,decideFunding,sampleFunding,validateDryRules} from './automatic-funding.js';
import {automaticFundingPanel,automaticFundingAction,RULE_FIELDS} from './automatic-funding-ui.js';
import {treasuryPage,treasuryAction} from './treasury-console.js';

const now=Date.parse('2026-10-18T23:00:00Z'),at=new Date(now).toISOString();
const config={projectMint:new PublicKey(Buffer.alloc(32,4)).toBase58(),computeWallet:new PublicKey(Buffer.alloc(32,5)).toBase58(),otherWallet:new PublicKey(Buffer.alloc(32,6)).toBase58()};
const signature=bs58.encode(Buffer.alloc(64,7));
function fixture(){
 const a=feeAddresses(config),b=Buffer.alloc(1024),c=Buffer.alloc(166),copy=(buf,offset,key)=>new PublicKey(key).toBuffer().copy(buf,offset);
 Buffer.from([216,74,9,0,56,140,93,75]).copy(b);b[9]=2;b[10]=1;b[75]=1;copy(b,11,config.projectMint);b.writeUInt32LE(2,76);copy(b,80,config.computeWallet);b.writeUInt16LE(7000,112);copy(b,114,config.otherWallet);b.writeUInt16LE(3000,146);
 Buffer.from([23,183,248,55,96,216,172,96]).copy(c);copy(c,49,a.sharing);copy(c,83,WBTC.mint);
 const account=(buf,owner)=>({owner,executable:false,data:[buf.toString('base64'),'base64']});
 const accounts=[account(b,PUMP_FEES),account(c,PUMP)],routing=verifyFeeRouting(config,...accounts);
 const keys=[a.vaultAta,a.computeAta,a.otherAta];
 const balances=values=>values.map((value,i)=>({accountIndex:i,mint:WBTC.mint,owner:[a.vault,config.computeWallet,config.otherWallet][i],programId:WBTC.program,uiTokenAmount:{amount:String(value),decimals:8}}));
 const tx={slot:123,transaction:{signatures:[signature],message:{accountKeys:keys.map(pubkey=>({pubkey})),instructions:[{programId:PUMP,data:bs58.encode(Buffer.from([255,203,19,79,244,68,8,159,0])),accounts:[config.computeWallet,config.projectMint,a.curve,a.sharing,a.vault,'11111111111111111111111111111111',a.event,PUMP,a.vaultAta,WBTC.mint,WBTC.program,'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',config.computeWallet,config.otherWallet,a.computeAta,a.otherAta]}]}},meta:{err:null,preTokenBalances:balances([1000000,0,0]),postTokenBalances:balances([0,700000,300000]),innerInstructions:[{index:0,instructions:[[a.computeAta,'700000'],[a.otherAta,'300000']].map(([destination,amount])=>({programId:WBTC.program,stackHeight:2,parsed:{type:'transferChecked',info:{source:a.vaultAta,authority:a.vault,destination,mint:WBTC.mint,tokenAmount:{amount,decimals:8}}}}))}]}};
 return {accounts,routing,tx};
}
function input(){return {projectMint:config.projectMint,routingVerified:true,historyComplete:true,feeObservedAt:at,feeComputeUnits:'700000',committedUnits:'0',dailyCommittedUnits:'0',pendingFunding:false,wallet:{observedAt:at,amountUnits:'700000'},card:{observedAt:at,balanceMicrousd:'0',status:'ACTIVE'},provider:{observedAt:at,balanceMicrousd:'10000000'},gas:{observedAt:at,lamports:'10000000'},cardLimits:{observedAt:at,minUnits:'10000',maxUnits:'125310000'}};}
const policy={...DEFAULT_DRY_RULES,hourlyMicrousd:'1000000'};

test('recognizes a pinned finalized WBTC distribution with exact recipients and net deltas',()=>{
 const f=fixture(),r=inspectFeeTransaction(f.tx,signature,config,f.routing).receipts[0];
 assert.equal(r.computeUnits,'700000');assert.equal(r.otherUnits,'300000');assert.equal(r.totalUnits,'1000000');
});
test('rejects wrong quote mint, destination, program, amount, transaction failure and ambiguous balance changes',()=>{
 for(const mutate of [t=>t.transaction.message.instructions[0].accounts[9]=config.projectMint,t=>t.meta.innerInstructions[0].instructions[0].parsed.info.destination=config.otherWallet,t=>t.meta.innerInstructions[0].instructions[0].programId=PUMP,t=>t.meta.innerInstructions[0].instructions[0].parsed.info.tokenAmount.amount='900000',t=>t.meta.err={},t=>t.meta.postTokenBalances[1].uiTokenAmount.amount='700001']){
  const f=fixture();mutate(f.tx);assert.throws(()=>inspectFeeTransaction(f.tx,signature,config,f.routing));
 }
});
test('ordinary deposits and CPI distributions never count as supported fee receipts',()=>{
 const f=fixture();f.tx.transaction.message.instructions[0].programId=WBTC.program;
 assert.deepEqual(inspectFeeTransaction(f.tx,signature,config,f.routing).receipts,[]);
});
test('new recipient ATAs permit nested initialization but still require direct payouts',()=>{
 const f=fixture();f.tx.meta.preTokenBalances=f.tx.meta.preTokenBalances.slice(0,1);
 f.tx.meta.innerInstructions[0].instructions.unshift({programId:WBTC.program,stackHeight:3,parsed:{type:'initializeAccount3'}});
 assert.equal(inspectFeeTransaction(f.tx,signature,config,f.routing).receipts[0].computeUnits,'700000');
 f.tx.meta.innerInstructions[0].instructions[1].stackHeight=3;
 assert.throws(()=>inspectFeeTransaction(f.tx,signature,config,f.routing),/missing_fee_transfers/);
});
test('routing must be active, immutable 70/30 and use exact WBTC curve',()=>{
 for(const [account,offset,value] of [[0,75,0],[0,10,0],[0,112,1],[1,83,0]]){
  const f=fixture(),b=Buffer.from(f.accounts[account].data[0],'base64');b[offset]=value;f.accounts[account].data[0]=b.toString('base64');assert.throws(()=>verifyFeeRouting(config,...f.accounts));
 }
});
test('bounded history scan retries missing transactions and refuses nonfinalized responses',async()=>{
 const f=fixture(),calls=[];let missing=false,finalized=true;
 const rpc=async(method)=>{calls.push(method);if(method==='getMultipleAccounts')return {value:f.accounts};if(method==='getSignaturesForAddress')return [{signature,err:null,confirmationStatus:finalized?'finalized':'confirmed'}];if(method==='getTransaction')return missing?null:f.tx;throw Error('unexpected');};
 const r=await scanFees(config,{rpc});assert.equal(r.complete,true);assert.equal(r.receipts.length,1);
 calls.length=0;await scanFees(config,{rpc,knownSignatures:[signature]});assert.ok(!calls.includes('getTransaction'));
 missing=true;await assert.rejects(scanFees(config,{rpc}),/unavailable/);finalized=false;await assert.rejects(scanFees(config,{rpc}),/invalid_fee_history/);
});
test('more than 75 unseen history rows is incomplete, not silently assumed complete',async()=>{
 const f=fixture();let page=0;
 const rpc=async(method)=>method==='getMultipleAccounts'?{value:f.accounts}:method==='getSignaturesForAddress'?Array.from({length:25},(_,i)=>({signature:bs58.encode(Buffer.alloc(64,1+page*25+i)),err:{failed:true},confirmationStatus:'finalized'})).map((r,i)=>{if(i===24)page++;return r;}):null;
 const r=await scanFees(config,{rpc});assert.equal(r.complete,false);assert.equal(r.processed.length,75);
});
test('public RPC adapter cannot broadcast or mutate',async()=>{
 let called=0;const rpc=publicFeeRpc(async()=>{called++;});await assert.rejects(rpc('sendTransaction',[]),/forbidden/);assert.equal(called,0);
});
test('funding decision uses actual 70% receipt once and calculates a bounded USD shortfall',()=>{
 const r=decideFunding(input(),policy,now);assert.equal(r.action,'would_top_up_solcard');assert.equal(r.amountWbtcUnits,'95000');assert.equal(r.availableFeeWbtcUnits,'690000');assert.equal(r.estimatedUsdMicros,'95000000');assert.equal(r.paymentsEnabled,false);
});
test('idle keeps fees in treasury; sufficient provider runway needs no top-up',()=>{
 assert.deepEqual(decideFunding(input(),DEFAULT_DRY_RULES,now).reasons,['idle_no_compute_budget_requested']);const i=input();i.provider.balanceMicrousd='50000000';assert.deepEqual(decideFunding(i,policy,now).reasons,['provider_balance_sufficient']);
});
test('stale reads, routing gaps, pending funds, absent SOL and limits hold decisions',()=>{
 for(const mutate of [i=>i.projectMint=null,i=>i.historyComplete=false,i=>i.routingVerified=false,i=>i.wallet.observedAt='2026-10-17T00:00:00Z',i=>i.card.error='offline',i=>i.provider.observedAt='2026-10-19T00:00:00Z',i=>i.pendingFunding=true,i=>i.gas.lamports='0',i=>i.cardLimits=null]){const i=input();mutate(i);assert.equal(decideFunding(i,policy,now).action,'hold');}
});
test('per-transfer, daily cap, wallet reserve and deposit minimum constrain recommendations',()=>{
 const p={...policy,maxTransferUnits:'40000'},i=input();assert.equal(decideFunding(i,p,now).amountWbtcUnits,'40000');i.dailyCommittedUnits='490001';assert.equal(decideFunding(i,p,now).action,'hold');i.dailyCommittedUnits='0';i.wallet.amountUnits='19999';assert.equal(decideFunding(i,p,now).action,'hold');i.wallet.amountUnits='700000';i.committedUnits='695000';assert.equal(decideFunding(i,p,now).action,'hold');
});
test('card balance can avoid a crypto top-up but never posts Runpod credit',()=>{
 const i=input();i.card.balanceMicrousd='100000000';const r=decideFunding(i,policy,now);assert.equal(r.action,'would_review_provider_reload');assert.equal(r.amountWbtcUnits,'0');assert.equal(r.paymentsEnabled,false);
});
test('invalid/contradictory policies are rejected',()=>{
 for(const p of [{...policy,maxDailyUnits:'1'},{...policy,assumedWbtcPriceMicrousd:'0'},{...policy,providerTargetMicrousd:'1'},{...policy,maxCardFloatMicrousd:'1'},{...policy,minRunwayHours:Infinity},{...policy,paymentsEnabled:true}])assert.throws(()=>validateDryRules(p));
});
test('sample is explicitly separate and does not double-apply the allocation',()=>{
 const s=sampleFunding(policy,now);assert.equal(s.allocation.compute,'700000');assert.equal(s.decision.sample,true);assert.equal(s.decision.availableFeeWbtcUnits,'690000');
});
function setup(path=':memory:',options={}){
 const treasury=new ComputeTreasury(':memory:',{clock:()=>now});treasury.configure(config);
 const records={status:()=>({feeds:{solcard:{},runpod:{}}})};
 return {treasury,service:new AutomaticFunding(path,{treasury,records,clock:()=>now,...options})};
}
test('unlaunched token does no chain calls; samples and rules never change real ledger',async()=>{
 let calls=0;const {treasury,service}=setup(':memory:',{scan:async()=>{calls++;}});
 try{const before=treasury.snapshot();await service.refresh();service.sample();service.savePolicy(policy);assert.equal(calls,0);assert.deepEqual(treasury.snapshot(),before);assert.equal(service.status().state,'awaiting-token-launch');assert.ok(service.status().decision.reasons.includes('awaiting_project_token_mint'));assert.equal(service.status().history.length,1);}finally{await service.close();treasury.close();}
});
test('receipt dedupe survives restart and never posts owner fees or project provider credits',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'bithash-auto-')),path=join(dir,'fees.sqlite'),f=fixture(),receipt=inspectFeeTransaction(f.tx,signature,config,f.routing).receipts[0];
 const options={projectMint:config.projectMint,scan:async()=>({receipts:[receipt],processed:[signature],excluded:[],head:signature,complete:true,routingVerified:true}),readWallets:async()=>({...config,mint:WBTC.mint,decimals:8,computeAmount:'700000',otherAmount:'300000',observedAt:at,source:'finalized-rpc'}),readGas:async()=>({wallet:config.computeWallet,lamports:'10000000',observedAt:at})};
 try{for(let i=0;i<2;i++){const {treasury,service}=setup(path,options);try{await service.refresh();assert.equal(service.status().receiptCount,1);assert.equal(service.status().detectedComputeUnits,'700000');assert.equal(treasury.snapshot().feesReported,'0');assert.equal(treasury.snapshot().providerCreditMicrousd,'0');assert.equal(treasury.snapshot().plans.length,0);}finally{await service.close();treasury.close();}}}finally{await rm(dir,{recursive:true,force:true});}
});
test('failed scan holds old receipts without erasing history or treating it as fresh',async()=>{
 let clock=now,fail=false;const f=fixture(),receipt=inspectFeeTransaction(f.tx,signature,config,f.routing).receipts[0];
 const {treasury,service}=setup(':memory:',{clock:()=>clock,projectMint:config.projectMint,scan:async()=>{if(fail)throw Error('fee_rpc_unavailable');return {receipts:[receipt],processed:[signature],head:signature,complete:true,routingVerified:true};},readWallets:async()=>{throw Error('offline');},readGas:async()=>{throw Error('offline');}});
 try{await service.refresh();fail=true;clock+=60000;await service.refresh();assert.equal(service.status().detectedComputeUnits,'700000');assert.equal(service.status().feeError,'fee_rpc_unavailable');assert.equal(service.status().decision.action,'hold');}finally{await service.close();treasury.close();}
});
test('console integrates a labelled sample and escapes observed errors',async()=>{
 const {treasury,service}=setup();try{await service.refresh();await treasuryAction(treasury,'automatic-sample',new URLSearchParams(),{automatic:service});const s=service.status();s.feeError='<script>bad</script>';const html=treasuryPage(treasury,{csrf:'fixture',automatic:s});assert.ok(html.includes('SAMPLE ONLY'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('70% → Compute wallet'));assert.ok(html.includes('/treasury/automatic-policy'));assert.equal(treasury.snapshot().plans.length,0);}finally{await service.close();treasury.close();}
});

for(const kind of ['curveSweep','bridge'])test('receipt credits only the distribution after '+kind+' replenishes its vault',()=>{
 const f=fixture(),a=f.routing.addresses,layout=collectionAccounts(config,f.routing),source=kind==='curveSweep'?a.curveAta:a.ammVaultAta,authority=kind==='curveSweep'?a.curve:a.ammVault;
 f.tx.transaction.message.instructions.unshift({programId:kind==='curveSweep'?PUMP:PUMP_AMM,data:bs58.encode(Buffer.from(kind==='curveSweep'?[32,246,191,52,8,201,73,186]:[1,33,78,185,33,67,44,92])),accounts:layout[kind]});
 f.tx.meta.innerInstructions[0].index=1;f.tx.meta.innerInstructions.unshift({index:0,instructions:[{programId:WBTC.program,stackHeight:2,parsed:{type:'transferChecked',info:{source,authority,destination:a.vaultAta,mint:WBTC.mint,tokenAmount:{amount:'1000000',decimals:8}}}}]});
 f.tx.meta.preTokenBalances[0].uiTokenAmount.amount='0';
 const r=inspectFeeTransaction(f.tx,signature,config,f.routing);assert.equal(r.receipts.length,1);assert.equal(r.receipts[0].computeUnits,'700000');assert.equal(r.receipts[0].instructionIndex,1);
 f.tx.meta.innerInstructions[0].instructions[0].parsed.info.source=a.otherAta;assert.throws(()=>inspectFeeTransaction(f.tx,signature,config,f.routing),/unsupported_fee_sweep_transfer/);
});
test('unknown incoming vault transfer never masks an ambiguous distribution delta',()=>{
 const f=fixture();f.tx.meta.preTokenBalances[0].uiTokenAmount.amount='0';assert.throws(()=>inspectFeeTransaction(f.tx,signature,config,f.routing),/ambiguous_fee_balance_change/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,Transaction,SystemProgram} from '@solana/web3.js';
import {WBTC} from './treasury-compute.js';
import {ReadOnlyFundingPreflight,preflightView} from './funding-preflight.js';
import {inspectRestrictedTransfer} from './restricted-wallet-signer.js';

function fixture({change=()=>{},fetchChange=null}={}){
 let now=Date.parse('2026-10-19T00:00:00Z');const calls=[];
 const terms={owner:Keypair.generate().publicKey.toBase58(),recipient:Keypair.generate().publicKey.toBase58(),amount:'1000000',policy:{maxTransferWbtcUnits:'1000000',maxDailyWbtcUnits:'2000000',minSolReserveLamports:'10000000',maxNetworkFeeLamports:'100000',minRetainedWbtcUnits:'100000'}};
 const blockhash=Keypair.generate().publicKey.toBase58();
 const token=owner=>({owner:WBTC.program,executable:false,data:{parsed:{type:'account',info:{owner,mint:WBTC.mint,state:'initialized',isNative:false,tokenAmount:{amount:'7000000',decimals:8}}}}});
 const responses={getGenesisHash:'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',getLatestBlockhash:{context:{slot:100},value:{blockhash,lastValidBlockHeight:200}},getMultipleAccounts:{context:{slot:101},value:[{owner:WBTC.program,executable:false,data:{parsed:{type:'mint',info:{decimals:8,isInitialized:true}}}},{owner:SystemProgram.programId.toBase58(),executable:false,data:['','base64'],lamports:20000000},token(terms.owner),token(terms.recipient)]},getFeeForMessage:{context:{slot:102},value:5000},simulateTransaction:{context:{slot:103},value:{err:null,logs:['private-provider-log-not-for-storage']}},getBlockHeight:150};
 change(responses,terms);
 const service=new ReadOnlyFundingPreflight({clock:()=>now,fetcher:async(url,o)=>{
  const request=JSON.parse(o.body);calls.push(request);
  assert.equal(url,'https://api.mainnet-beta.solana.com');assert.equal(o.method,'POST');assert.equal(o.redirect,'error');assert.ok(o.signal);assert.equal(o.headers.Authorization,undefined);
  assert.ok(Object.hasOwn(responses,request.method),'unexpected RPC method');
  if(request.method==='simulateTransaction'){
   const [wire,config]=request.params;assert.deepEqual(config,{encoding:'base64',commitment:'finalized',minContextSlot:102,sigVerify:false,replaceRecentBlockhash:false});
   const inspected=inspectRestrictedTransfer(Buffer.from(wire,'base64'),{...terms,blockhash});assert.ok(inspected.tx.signatures.every(s=>s.signature===null));
   assert.equal(Transaction.from(Buffer.from(wire,'base64')).instructions.length,1);
  }
  if(fetchChange)return fetchChange(request,responses);
  return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result:responses[request.method]}));
 }});
 return {terms,service,responses,calls,clock:()=>now,advance:ms=>{now+=ms;}};
}
test('exact unsigned mainnet transfer is simulated, with message-bound fee and no execution surface',async()=>{
 const f=fixture(),r=await f.service.check(f.terms);
 assert.equal(r.state,'checks-passed');assert.equal(r.simulation,'passed');assert.equal(r.fresh,true);assert.equal(r.networkFeeLamports,'5000');assert.deepEqual(r.reasons,[]);
 assert.equal(r.signingEnabled,false);assert.equal(r.broadcastEnabled,false);assert.equal(r.spendingAuthorized,false);
 assert.deepEqual(f.calls.map(c=>c.method),['getLatestBlockhash','getGenesisHash','getMultipleAccounts','getFeeForMessage','simulateTransaction','getBlockHeight']);
 assert.ok(f.calls[3].params[0]);assert.equal(f.calls[2].params[1].minContextSlot,100);
 assert.equal(f.service.sign,undefined);assert.equal(f.service.broadcast,undefined);assert.ok(!JSON.stringify(r).includes('private-provider-log'));assert.equal(r.wireBase64,undefined);
});
for(const [label,change,reason] of [
 ['wrong network',r=>r.getGenesisHash='devnet','preflight_wrong_network'],
 ['wrong mint',r=>r.getMultipleAccounts.value[0].data.parsed.info.decimals=9,'preflight_mint_mismatch'],
 ['frozen source',r=>r.getMultipleAccounts.value[2].data.parsed.info.state='frozen','source_account_policy_mismatch'],
 ['delegated source',r=>r.getMultipleAccounts.value[2].data.parsed.info.delegate=Keypair.generate().publicKey.toBase58(),'source_account_policy_mismatch'],
 ['destination owner',r=>r.getMultipleAccounts.value[3].data.parsed.info.owner=Keypair.generate().publicKey.toBase58(),'destination_account_policy_mismatch'],
 ['close authority',r=>r.getMultipleAccounts.value[3].data.parsed.info.closeAuthority=Keypair.generate().publicKey.toBase58(),'destination_account_policy_mismatch'],
 ['wrong fee payer',r=>r.getMultipleAccounts.value[1].owner=WBTC.program,'fee_payer_not_plain_system_account'],
 ['missing source',r=>r.getMultipleAccounts.value[2]=null,'source_account_missing'],
 ['missing destination',r=>r.getMultipleAccounts.value[3]=null,'destination_account_missing'],
 ['SOL reserve',r=>r.getMultipleAccounts.value[1].lamports=10000000,'insufficient_sol_reserve'],
 ['WBTC balance',r=>r.getMultipleAccounts.value[2].data.parsed.info.tokenAmount.amount='9','insufficient_source_wbtc'],
 ['retained reserve',r=>r.getMultipleAccounts.value[2].data.parsed.info.tokenAmount.amount='1000000','retained_wbtc_reserve_shortfall'],
 ['network fee',r=>r.getFeeForMessage.value=100001,'network_fee_cap_exceeded'],
 ['unknown fee',r=>r.getFeeForMessage.value=null,'preflight_fee_unavailable'],
 ['simulation failure',r=>r.simulateTransaction.value.err={InstructionError:[0,'InsufficientFunds']},'transaction_simulation_failed'],
 ['malformed simulation',r=>delete r.simulateTransaction.value.err,'preflight_simulation_invalid'],
 ['expired blockhash',r=>r.getBlockHeight=200,'preflight_blockhash_expired'],
 ['stale account slot',r=>r.getMultipleAccounts.context.slot=99,'preflight_slot_regression'],
 ['unsafe lamports',r=>r.getMultipleAccounts.value[1].lamports=Number.MAX_SAFE_INTEGER+1,'invalid_rpc_integer'],
 ['missing limits',(r,t)=>t.policy=null,'owner_funding_limits_not_set'],
 ['missing retained reserve',(r,t)=>delete t.policy.minRetainedWbtcUnits,'retained_wbtc_reserve_not_set'],
 ['transfer cap',(r,t)=>t.amount='1000001','per_transfer_cap_exceeded']
])test(label+' holds preflight',async()=>{const f=fixture({change}),r=await f.service.check(f.terms);assert.equal(r.state,'held');assert.ok(r.reasons.includes(reason),JSON.stringify(r.reasons));});
test('pending jobs and rolling commitments hold even when chain simulation passes',async()=>{
 const f=fixture(),r=await f.service.check(f.terms,{otherPending:true,rolling24hOtherWbtcUnits:'1000001'});assert.equal(r.simulation,'passed');assert.equal(r.state,'held');assert.ok(r.reasons.includes('daily_cap_exceeded'));assert.ok(r.reasons.includes('other_funding_job_pending'));
});
test('missing accounts diagnostics never invent a transaction or create accounts',async()=>{
 const f=fixture({change:r=>{r.getMultipleAccounts.value[1]=null;r.getMultipleAccounts.value[2]=null;}}),r=await f.service.accounts(f.terms);
 assert.equal(r.state,'held');assert.equal(r.accounts.solLamports,'0');assert.equal(r.accounts.sourceWbtcUnits,null);assert.deepEqual(f.calls.map(c=>c.method),['getGenesisHash','getMultipleAccounts']);
});
test('expired and future observations never display passed',async()=>{
 const f=fixture(),r=await f.service.check(f.terms);f.advance(60001);assert.equal(preflightView(r,f.clock()).state,'stale');assert.equal(preflightView(r,0).fresh,false);
});
test('bounded and sanitized HTTP failures fail closed',async()=>{
 for(const response of [new Response('secret',{status:429}),new Response('x'.repeat(131073)),new Response(JSON.stringify({jsonrpc:'2.0',id:'other',result:{}}))]){
  const f=fixture({fetchChange:()=>response}),r=await f.service.check(f.terms);assert.equal(r.state,'held');assert.ok(!JSON.stringify(r).includes('secret'));
 }
 const f=fixture({fetchChange:()=>{throw Error('https://credential:secret@example.invalid');}});assert.deepEqual((await f.service.check(f.terms)).reasons,['preflight_read_unavailable']);
});

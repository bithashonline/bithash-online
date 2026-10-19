import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PublicKey,Keypair,Transaction,SystemProgram} from '@solana/web3.js';
import {AccountLayout,MintLayout} from '@solana/spl-token';
import {WBTC,ComputeTreasury} from './treasury-compute.js';
import {PUMP,PUMP_AMM,PUMP_FEES,feeAddresses,collectionAccounts} from './fee-detection.js';
import {FeeCollection,inspectCollectionAccounts,buildCollectionTransaction,inspectCollectionTransaction,previewFeeCollection,collectionRpc,collectionView} from './fee-collection.js';
import {feeCollectionPanel} from './fee-collection-ui.js';
import {treasuryAction} from './treasury-console.js';

const schema=JSON.parse(readFileSync(new URL('./fixtures/pump-collection-schema.json',import.meta.url))),now=Date.parse('2026-10-19T00:25:00Z'),clock=()=>now;
const key=()=>Keypair.generate().publicKey.toBase58(),zero=PublicKey.default,pk=s=>new PublicKey(s);
// Independent account encoding follows the pinned upstream IDL field names/types.
function encodeStruct(program,name,values){const type=schema.programs[program].types.find(t=>t.name===name),disc=schema.programs[program].accounts.find(t=>t.name===name).discriminator;return Buffer.concat([Buffer.from(disc),...type.type.fields.map(f=>{const v=values[f.name];if(f.type==='pubkey')return pk(v??zero).toBuffer();const b=Buffer.alloc({bool:1,u8:1,u16:2,u64:8,i128:16}[f.type]);if(f.type==='bool'||f.type==='u8')b[0]=v??0;else if(f.type==='u16')b.writeUInt16LE(v??0);else if(f.type==='u64')b.writeBigUInt64LE(BigInt(v??0));return b;})]);}
const account=(data,owner,lamports=2039280)=>({owner,lamports,executable:false,data:[data.toString('base64'),'base64']});
function token(owner,amount){const b=Buffer.alloc(165);AccountLayout.encode({mint:pk(WBTC.mint),owner:pk(owner),amount:BigInt(amount),delegateOption:0,delegate:zero,state:1,isNativeOption:0,isNative:0n,delegatedAmount:0n,closeAuthorityOption:0,closeAuthority:zero},b);return account(b,WBTC.program);}
function fixture({pool=false,empty=false}={}){
 const config={projectMint:key(),computeWallet:key(),otherWallet:key()},a=feeAddresses(config),sharing=Buffer.alloc(1024);Buffer.from([216,74,9,0,56,140,93,75]).copy(sharing);sharing[9]=2;sharing[10]=1;sharing[75]=1;pk(config.projectMint).toBuffer().copy(sharing,11);sharing.writeUInt32LE(2,76);pk(config.computeWallet).toBuffer().copy(sharing,80);sharing.writeUInt16LE(7000,112);pk(config.otherWallet).toBuffer().copy(sharing,114);sharing.writeUInt16LE(3000,146);
 const curve=encodeStruct('pump','BondingCurve',{creator:a.sharing,quote_mint:WBTC.mint,complete:pool,creator_fee:empty?0:1000000});
 const poolBytes=pool?encodeStruct('pump_amm','Pool',{creator:a.poolAuthority,base_mint:config.projectMint,quote_mint:WBTC.mint,pool_quote_token_account:a.poolAta,coin_creator:a.sharing,creator_fees:empty?0:2000000}):null;
 const mint=Buffer.alloc(82);MintLayout.encode({mintAuthorityOption:0,mintAuthority:zero,supply:100000000n,decimals:8,isInitialized:true,freezeAuthorityOption:0,freezeAuthority:zero},mint);
 const response={context:{slot:101},value:[account(sharing,PUMP_FEES),account(curve,PUMP),pool?account(poolBytes,PUMP_AMM):null,token(a.vault,empty?0:3000000),pool?token(a.ammVault,empty?0:4000000):null,token(a.curve,10000000),pool?token(a.pool,10000000):null,token(config.computeWallet,0),token(config.otherWallet,0),account(mint,WBTC.program),account(Buffer.alloc(0),zero.toBase58(),20000000)]};
 const calls=[],blockhash=key(),policy={maxNetworkFeeLamports:'10000',maxTotalCostLamports:'3000000',minSolReserveLamports:'5000000'};
 const rpc=async(method,params)=>{calls.push({method,params});switch(method){case 'getGenesisHash':return '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';case 'getLatestBlockhash':return {context:{slot:100},value:{blockhash,lastValidBlockHeight:300}};case 'getMultipleAccounts':return response;case 'getFeeForMessage':return {context:{slot:102},value:5000};case 'simulateTransaction':return {context:{slot:103},value:{err:null,accounts:[{lamports:19995000}],logs:['private-log']}};case 'getBlockHeight':return 200;default:throw Error('unexpected_rpc_method');}};
 return {config,a,response,rpc,calls,blockhash,policy};
}
test('unlaunched token does not request RPC or fabricate collectible fees',async()=>{const r=await previewFeeCollection(null,{rpc:()=>{throw Error('no_rpc');},clock});assert.equal(r.state,'awaiting-token-launch');assert.equal(r.amounts,undefined);});
test('curve sweep and split preview is unsigned and leaves execution disabled',async()=>{
 const f=fixture(),r=await previewFeeCollection(f.config,{rpc:f.rpc,policy:f.policy,clock});assert.equal(r.state,'unsigned-preview');assert.deepEqual(r.steps,['curveSweep','distribute']);assert.equal(r.amounts.total,'4000000');assert.equal(r.amounts.estimatedCompute,'2800000');assert.equal(r.totalCostLamports,'5000');
 const call=f.calls.find(c=>c.method==='simulateTransaction'),tx=Transaction.from(Buffer.from(call.params[0],'base64'));assert.equal(tx.signatures.length,1);assert.equal(tx.signatures[0].signature,null);assert.equal(tx.instructions.length,2);assert.equal(call.params[1].sigVerify,false);assert.equal(call.params[1].replaceRecentBlockhash,false);assert.equal(r.signingEnabled,false);assert.equal(r.broadcastEnabled,false);assert.equal(r.wireBase64,undefined);assert.ok(!JSON.stringify(r).includes('private-log'));
});
test('canonical migrated pool uses both sweeps, bridge and 70/30 distribution in order',async()=>{
 const f=fixture({pool:true}),o=inspectCollectionAccounts(f.config,f.response),tx=buildCollectionTransaction(f.config,o,f.blockhash),r=await previewFeeCollection(f.config,{rpc:f.rpc,policy:f.policy,clock});assert.equal(r.state,'unsigned-preview');assert.deepEqual(r.steps,['curveSweep','poolSweep','bridge','distribute']);assert.equal(r.amounts.total,'10000000');assert.equal(r.amounts.estimatedCompute,'7000000');assert.equal(tx.instructions[1].programId.toBase58(),PUMP_AMM);
 for(const [i,step]of r.steps.entries())assert.deepEqual(tx.instructions[i].keys.map(k=>k.pubkey.toBase58()),collectionAccounts(f.config,o.routing)[step]);assert.ok(tx.serialize({requireAllSignatures:false,verifySignatures:false}).length<=1232);
});
test('empty vaults do not prepare an unnecessary collection',async()=>{const f=fixture({empty:true}),r=await previewFeeCollection(f.config,{rpc:f.rpc,clock});assert.equal(r.amounts.total,'0');assert.deepEqual(r.steps,[]);assert.ok(r.reasons.includes('no_distributable_wbtc'));assert.equal(f.calls.length,3);});
test('missing recipient ATA is explicit in draft and simulated rent cost is capped',async()=>{
 const f=fixture();f.response.value[8]=null;
 const rpc=async(m,p)=>m==='simulateTransaction'?{context:{slot:103},value:{err:null,accounts:[{lamports:15000000}]}}:f.rpc(m,p);
 const r=await previewFeeCollection(f.config,{rpc,policy:f.policy,clock});assert.equal(r.initializeRecipientAtas,true);assert.equal(r.totalCostLamports,'5000000');assert.ok(r.reasons.includes('collection_total_cost_cap'));assert.equal(r.state,'held');
});
for(const [label,change]of [
 ['wrong split',f=>{const b=Buffer.from(f.response.value[0].data[0],'base64');b.writeUInt16LE(6000,112);f.response.value[0].data[0]=b.toString('base64');}],
 ['wrong mint',f=>{const b=Buffer.from(f.response.value[1].data[0],'base64');pk(key()).toBuffer().copy(b,83);f.response.value[1].data[0]=b.toString('base64');}],
 ['wrong pool',f=>{f.response.value[2].owner=PUMP;}],
 ['holder rewards',f=>{const b=Buffer.from(f.response.value[1].data[0],'base64');b[124]=1;f.response.value[1].data[0]=b.toString('base64');}],
 ['underfunded fee bucket',f=>{f.response.value[5]=token(f.a.curve,0);}],
 ['wrong source authority',f=>{f.response.value[3]=token(key(),999);}],
 ['stale slot',f=>{f.response.context.slot=99;}]
])test(label+' prevents a collection simulation',async()=>{const f=fixture({pool:true});change(f);const r=await previewFeeCollection(f.config,{rpc:f.rpc,policy:f.policy,clock});assert.equal(r.state,'held');assert.equal(r.simulation,'not-run');assert.ok(!f.calls.some(c=>c.method==='simulateTransaction'));});
test('missing policy never reports ready even with successful simulation',async()=>{const f=fixture(),r=await previewFeeCollection(f.config,{rpc:f.rpc,clock});assert.equal(r.simulation,'passed');assert.equal(r.state,'held');assert.ok(r.reasons.includes('collection_cost_limits_not_configured'));});
test('failed simulation and expired blockhash hold the preview',async()=>{
 const f=fixture(),rpc=async(m,p)=>m==='simulateTransaction'?{context:{slot:103},value:{err:{InstructionError:[0,'Custom']}}}:m==='getBlockHeight'?300:f.rpc(m,p);const r=await previewFeeCollection(f.config,{rpc,policy:f.policy,clock});assert.equal(r.state,'held');assert.ok(r.reasons.includes('collection_simulation_failed'));assert.ok(r.reasons.includes('collection_blockhash_expired'));
});
test('RPC transport has no write method, rejects redirects and sanitizes provider errors',async()=>{
 let calls=0;const rpc=collectionRpc(async(url,o)=>{calls++;assert.equal(url,'https://api.mainnet-beta.solana.com');assert.equal(o.redirect,'error');return new Response(JSON.stringify({jsonrpc:'2.0',id:'getGenesisHash',result:'test'}));});await assert.rejects(()=>rpc('sendTransaction',[]),/forbidden/);assert.equal(calls,0);assert.equal(await rpc('getGenesisHash',[]),'test');
 const f=fixture(),r=await previewFeeCollection(f.config,{rpc:()=>{throw Error('private provider data');},clock});assert.deepEqual(r.reasons,['collection_read_unavailable']);
});
test('journal restart, idempotent refresh, receipt linkage and UI never mutate the treasury',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'bithash-collection-')),ledger=new ComputeTreasury(':memory:',{clock}),f=fixture();ledger.configure({computeWallet:f.config.computeWallet,otherWallet:f.config.otherWallet});const before=ledger.snapshot(),automatic={status:()=>({receiptCount:1,detectedComputeUnits:'700',feeObservation:{complete:true}})},options={treasury:ledger,automatic,clock};let manager=new FeeCollection(join(dir,'collection.sqlite'),options);
 t.after(async()=>{await manager.close();ledger.close();await rm(dir,{recursive:true,force:true});});await treasuryAction(ledger,'collection-refresh',new URLSearchParams(),{collection:manager});await manager.refresh();assert.equal(manager.status().events.length,1);assert.equal(manager.status().receipts.computeUnits,'700');assert.equal(manager.status().receipts.creditPosted,false);assert.deepEqual(ledger.snapshot(),before);await manager.close();manager=new FeeCollection(join(dir,'collection.sqlite'),options);assert.equal(manager.status().observation.state,'awaiting-token-launch');assert.match(feeCollectionPanel(manager.status(),()=>'<form>read only</form>'),/Signing and broadcasting are disabled/);assert.equal(collectionView(manager.status().observation,now+60001).state,'stale');
});
test('message inspector rejects added instructions, changed recipients and changed sequence',()=>{
 const f=fixture(),o=inspectCollectionAccounts(f.config,f.response),tx=buildCollectionTransaction(f.config,o,f.blockhash);
 inspectCollectionTransaction(tx.serialize({requireAllSignatures:false,verifySignatures:false}),f.config,o,f.blockhash);
 tx.add(SystemProgram.transfer({fromPubkey:pk(f.config.computeWallet),toPubkey:pk(key()),lamports:1}));assert.throws(()=>inspectCollectionTransaction(tx.serialize({requireAllSignatures:false,verifySignatures:false}),f.config,o,f.blockhash),/collection_transaction_mismatch/);
 const changed=structuredClone(o);changed.routing.recipients[0].wallet=key();assert.throws(()=>buildCollectionTransaction(f.config,changed,f.blockhash),/routing_mismatch/);
 const reordered=structuredClone(o);reordered.steps.reverse();assert.throws(()=>buildCollectionTransaction(f.config,reordered,f.blockhash),/steps_mismatch/);
});

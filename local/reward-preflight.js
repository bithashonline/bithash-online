import {PublicKey,SystemProgram} from '@solana/web3.js';
import {ACCOUNT_SIZE} from '@solana/spl-token';
import {WBTC} from './treasury-compute.js';
import {buildRewardTransfer} from './reward-transfer.js';
import {fundingUnits,sha256,OFFLINE_BLOCKHASH} from './restricted-wallet-signer.js';
import {preflightView} from './funding-preflight.js';

export const MAINNET_GENESIS='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const integer=n=>{if(!Number.isSafeInteger(n)||n<0)throw Error('reward_rpc_integer_invalid');return n;};
const slot=(r,min=0)=>{const n=integer(r?.context?.slot);if(n<min)throw Error('reward_slot_regression');return n;};
const safe=e=>/^[a-z_]{1,80}$/.test(e?.message)?e.message:'reward_preflight_unavailable';
const METHODS=new Set(['getGenesisHash','getMultipleAccounts','getLatestBlockhash','getFeeForMessage','getMinimumBalanceForRentExemption','simulateTransaction','getBlockHeight']);
export function rewardReadRpc(fetcher=fetch){return async(method,params)=>{
 if(!METHODS.has(method))throw Error('reward_rpc_method_forbidden');
 const response=await fetcher('https://api.mainnet-beta.solana.com',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:method,method,params})});
 if(!response.ok)throw Error('reward_rpc_unavailable');const reader=response.body.getReader(),chunks=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>131072)throw Error('reward_rpc_too_large');chunks.push(Buffer.from(value));}}finally{await reader.cancel();}
 const body=JSON.parse(Buffer.concat(chunks));if(body.jsonrpc!=='2.0'||body.id!==method||body.error||!Object.hasOwn(body,'result'))throw Error('reward_rpc_invalid');return body.result;
};}

// This adapter only reads and simulates an unsigned, canonical ATA + WBTC transfer.
export class RewardPreflight {
 constructor({rpc=rewardReadRpc(),clock=Date.now}={}){this.rpc=rpc;this.clock=clock;}
 async check(terms){
  const started=this.clock(),r={kind:'reward',mode:'read-only',state:'held',observedAt:new Date(started).toISOString(),reasons:[],simulation:'not-run',signingEnabled:false,broadcastEnabled:false,spendingAuthorized:false};
  try{
   const amount=fundingUnits(terms.amount);if(!amount)throw Error('reward_amount_invalid');
   if(await this.rpc('getGenesisHash',[])!==MAINNET_GENESIS)throw Error('reward_wrong_network');
   const latest=await this.rpc('getLatestBlockhash',[{commitment:'finalized'}]),start=slot(latest,terms.minContextSlot??0),{blockhash,lastValidBlockHeight}=latest.value??{};
   new PublicKey(blockhash);integer(lastValidBlockHeight);if(blockhash===OFFLINE_BLOCKHASH)throw Error('reward_offline_blockhash');
   const {tx,source,destination}=buildRewardTransfer({...terms,blockhash});
   const accounts=await this.rpc('getMultipleAccounts',[[WBTC.mint,terms.owner,source,destination],{encoding:'jsonParsed',commitment:'finalized',minContextSlot:start}]);
   r.slot=slot(accounts,start);if(!Array.isArray(accounts.value)||accounts.value.length!==4)throw Error('reward_accounts_invalid');
   const [mint,wallet,src,dst]=accounts.value,mi=mint?.data?.parsed?.info;
   if(mint?.owner!==WBTC.program||mint.executable!==false||mint.data?.parsed?.type!=='mint'||mi?.isInitialized!==true||mi.decimals!==8)throw Error('reward_mint_mismatch');
   if(wallet===null)r.reasons.push('reward_fee_payer_missing');
   else if(wallet.owner!==SystemProgram.programId.toBase58()||wallet.executable!==false||!Array.isArray(wallet.data)||wallet.data[0]!=='')throw Error('reward_fee_payer_invalid');
   const token=(a,owner,missing)=>{
    if(a===null){if(!missing)r.reasons.push('reward_source_account_missing');return 0n;}
    const i=a.data?.parsed?.info;
    if(a.owner!==WBTC.program||a.executable!==false||a.data?.parsed?.type!=='account'||i?.owner!==owner||i.mint!==WBTC.mint||i.state!=='initialized'||i.delegate!=null||i.closeAuthority!=null||i.isNative!==false||i.tokenAmount?.decimals!==8)throw Error('reward_token_account_invalid');
    return fundingUnits(i.tokenAmount.amount);
   };
   const sourceUnits=token(src,terms.owner,false);token(dst,terms.recipient,true);
   r.accounts={owner:terms.owner,recipient:terms.recipient,source,destination,sourceWbtcUnits:String(sourceUnits),solLamports:String(wallet===null?0:integer(wallet.lamports)),createsDestination:dst===null};
   const p=terms.policy;
   if(!p)r.reasons.push('reward_limits_not_configured');
   else {
    for(const k of ['maxTransferWbtcUnits','maxNetworkFeeLamports','maxTotalCostLamports','minSolReserveLamports','retainedWbtcUnits'])fundingUnits(p[k]);
    if(amount>BigInt(p.maxTransferWbtcUnits))r.reasons.push('reward_transfer_cap');
    if(sourceUnits<amount+BigInt(p.retainedWbtcUnits))r.reasons.push('reward_development_or_other_payout_reserve');
   }
   if(sourceUnits<amount)r.reasons.push('reward_wbtc_shortfall');
   const wire=tx.serialize({requireAllSignatures:false,verifySignatures:false});
   r.messageHash=sha256(tx.serializeMessage());r.blockhash=blockhash;r.lastValidBlockHeight=lastValidBlockHeight;
   const fee=await this.rpc('getFeeForMessage',[tx.serializeMessage().toString('base64'),{commitment:'finalized',minContextSlot:r.slot}]);r.feeSlot=slot(fee,r.slot);
   if(fee.value===null)throw Error('reward_fee_unavailable');r.networkFeeLamports=String(integer(fee.value));
   // Charge conservatively for the full account rent; prefunding does not lower the cap.
   r.accountRentLamports=dst===null?String(integer(await this.rpc('getMinimumBalanceForRentExemption',[ACCOUNT_SIZE,{commitment:'finalized'}]))):'0';
   r.totalCostLamports=String(BigInt(r.networkFeeLamports)+BigInt(r.accountRentLamports));
   if(p){
    if(BigInt(r.networkFeeLamports)>BigInt(p.maxNetworkFeeLamports))r.reasons.push('reward_network_fee_cap');
    if(BigInt(r.totalCostLamports)>BigInt(p.maxTotalCostLamports))r.reasons.push('reward_total_cost_cap');
    if(BigInt(r.accounts.solLamports)<BigInt(r.totalCostLamports)+BigInt(p.minSolReserveLamports))r.reasons.push('reward_sol_reserve_shortfall');
   }
   if(wallet!==null&&src!==null&&sourceUnits>=amount){
    const sim=await this.rpc('simulateTransaction',[wire.toString('base64'),{encoding:'base64',commitment:'finalized',minContextSlot:r.feeSlot,sigVerify:false,replaceRecentBlockhash:false,accounts:{encoding:'base64',addresses:[terms.owner]}}]);r.simulationSlot=slot(sim,r.feeSlot);
    if(!sim.value||!Object.hasOwn(sim.value,'err'))throw Error('reward_simulation_invalid');
    r.simulation=sim.value.err===null?'passed':'failed';
    if(sim.value.err!==null)r.reasons.push('reward_simulation_failed');
    else {
     const post=sim.value.accounts?.[0];if(sim.value.accounts?.length!==1||!post)throw Error('reward_simulated_cost_missing');
     const spent=BigInt(r.accounts.solLamports)-BigInt(integer(post.lamports));
     if(spent<BigInt(r.networkFeeLamports)||spent>BigInt(r.totalCostLamports))throw Error('reward_simulated_cost_mismatch');
     r.simulatedCostLamports=String(spent);
    }
   }
   const height=integer(await this.rpc('getBlockHeight',[{commitment:'finalized',minContextSlot:r.simulationSlot??r.feeSlot}]));if(height>=lastValidBlockHeight)r.reasons.push('reward_blockhash_expired');
   if(this.clock()<started||this.clock()-started>60000)r.reasons.push('reward_preflight_expired');
   r.state=!r.reasons.length&&r.simulation==='passed'?'checks-passed':'held';
  }catch(e){r.state='held';r.reasons.push(safe(e));}
  return preflightView(r,this.clock());
 }
}

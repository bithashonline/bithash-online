import {PublicKey,SystemProgram} from '@solana/web3.js';
import {WBTC} from './treasury-compute.js';
import {buildRestrictedTransfer,inspectRestrictedTransfer,transferAccounts,fundingUnits,OFFLINE_BLOCKHASH} from './restricted-wallet-signer.js';

const RPC='https://api.mainnet-beta.solana.com';
const GENESIS='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const METHODS=new Set(['getGenesisHash','getMultipleAccounts','getLatestBlockhash','getFeeForMessage','simulateTransaction','getBlockHeight']);
const safe=e=>/^[a-z_]{1,80}$/.test(e?.message)?e.message:'preflight_read_unavailable';
const integer=n=>{if(!Number.isSafeInteger(n)||n<0)throw Error('invalid_rpc_integer');return n;};
const slot=(r,min=0)=>{const n=integer(r?.context?.slot);if(n<min)throw Error('preflight_slot_regression');return n;};
const base=clock=>({mode:'read-only',state:'held',observedAt:new Date(clock()).toISOString(),reasons:[],signingEnabled:false,broadcastEnabled:false,spendingAuthorized:false});
export function preflightView(result,now=Date.now()){
 if(!result)return null;
 const age=now-Date.parse(result.observedAt),fresh=Number.isFinite(age)&&age>=0&&age<=60000;
 return {...result,fresh,state:fresh?result.state:'stale',reasons:fresh?result.reasons:[...new Set([...result.reasons,'preflight_expired'])]};
}

// Fixed mainnet RPC, bounded read methods only. No signer, key import, transaction
// submission method or caller-supplied endpoint is accepted by this adapter.
export class ReadOnlyFundingPreflight {
 #fetch;#clock;
 constructor({fetcher=fetch,clock=Date.now}={}){this.#fetch=fetcher;this.#clock=clock;}
 async #rpc(method,params,signal){
  if(!METHODS.has(method))throw Error('preflight_method_forbidden');
  const r=await this.#fetch(RPC,{method:'POST',redirect:'error',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:method,method,params})});
  if(!r.ok)throw Error('preflight_rpc_unavailable');
  const reader=r.body.getReader();let size=0;const chunks=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>131072)throw Error('preflight_rpc_too_large');chunks.push(Buffer.from(value));}}finally{await reader.cancel();}
  const b=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(b.jsonrpc!=='2.0'||b.id!==method||b.error||!Object.hasOwn(b,'result'))throw Error('preflight_rpc_invalid');return b.result;
 }
 async #accounts({owner,recipient},signal,minSlot=0){
  if(owner===recipient)throw Error('self_transfer_forbidden');
  new PublicKey(owner);new PublicKey(recipient);
  if(await this.#rpc('getGenesisHash',[],signal)!==GENESIS)throw Error('preflight_wrong_network');
  const a=transferAccounts(owner,recipient),r=await this.#rpc('getMultipleAccounts',[[WBTC.mint,owner,a.sourceAccount,a.destinationAccount],{encoding:'jsonParsed',commitment:'finalized',minContextSlot:minSlot}],signal);
  const at=slot(r,minSlot);if(!Array.isArray(r.value)||r.value.length!==4)throw Error('preflight_accounts_invalid');
  const [mint,wallet,source,destination]=r.value,mi=mint?.data?.parsed?.info;
  if(mint?.owner!==WBTC.program||mint.executable!==false||mint.data?.parsed?.type!=='mint'||mi?.decimals!==8||mi.isInitialized!==true)throw Error('preflight_mint_mismatch');
  const reasons=[];
  if(wallet===null)reasons.push('fee_payer_missing');
  else if(wallet.owner!==SystemProgram.programId.toBase58()||wallet.executable!==false||!Array.isArray(wallet.data)||wallet.data[0]!=='')throw Error('fee_payer_not_plain_system_account');
  const token=(account,expected,label)=>{
   if(account===null){reasons.push(label+'_account_missing');return null;}
   const p=account.data?.parsed,info=p?.info,amount=info?.tokenAmount;
   if(account.owner!==WBTC.program||account.executable!==false||p?.type!=='account'||info?.owner!==expected||info?.mint!==WBTC.mint||amount?.decimals!==8||info.state!=='initialized'||info.delegate!=null||info.closeAuthority!=null||info.isNative!==false)throw Error(label+'_account_policy_mismatch');
   return fundingUnits(amount.amount).toString();
  };
  return {slot:at,owner,recipient,mint:WBTC.mint,...a,solLamports:wallet===null?'0':String(integer(wallet.lamports)),sourceWbtcUnits:token(source,owner,'source'),destinationWbtcUnits:token(destination,recipient,'destination'),reasons};
 }
 async accounts(terms){
  const result=base(this.#clock);result.kind='accounts';
  try{result.accounts=await this.#accounts(terms,AbortSignal.timeout(20000));result.reasons=result.accounts.reasons;result.state=result.reasons.length?'held':'accounts-checked';}
  catch(e){result.reasons=[safe(e)];}
  return preflightView(result,this.#clock());
 }
 async check(terms,{otherPending=false,rolling24hOtherWbtcUnits='0'}={}){
  const r=base(this.#clock);r.kind='transaction';r.amount=terms.amount;r.simulation='not-run';
  try{
   const amount=fundingUnits(terms.amount);if(!amount)throw Error('invalid_preflight_amount');
   const signal=AbortSignal.timeout(45000),latest=await this.#rpc('getLatestBlockhash',[{commitment:'finalized'}],signal),startSlot=slot(latest);
   const {blockhash,lastValidBlockHeight}=latest.value??{};new PublicKey(blockhash);integer(lastValidBlockHeight);if(blockhash===OFFLINE_BLOCKHASH)throw Error('preflight_offline_blockhash');
   r.accounts=await this.#accounts(terms,signal,startSlot);r.reasons.push(...r.accounts.reasons);
   const policy=terms.policy;
   if(!policy)r.reasons.push('owner_funding_limits_not_set');
   else {
    for(const k of ['maxTransferWbtcUnits','maxDailyWbtcUnits','minSolReserveLamports','maxNetworkFeeLamports'])if(!fundingUnits(policy[k]))throw Error('invalid_preflight_policy');
    if(BigInt(policy.maxTransferWbtcUnits)>BigInt(policy.maxDailyWbtcUnits))throw Error('invalid_preflight_policy');
    if(amount>BigInt(policy.maxTransferWbtcUnits))r.reasons.push('per_transfer_cap_exceeded');
    if(amount+fundingUnits(rolling24hOtherWbtcUnits)>BigInt(policy.maxDailyWbtcUnits))r.reasons.push('daily_cap_exceeded');
    if(policy.minRetainedWbtcUnits===undefined)r.reasons.push('retained_wbtc_reserve_not_set');
    else if(r.accounts.sourceWbtcUnits!==null&&BigInt(r.accounts.sourceWbtcUnits)<amount+fundingUnits(policy.minRetainedWbtcUnits))r.reasons.push('retained_wbtc_reserve_shortfall');
   }
   if(otherPending)r.reasons.push('other_funding_job_pending');
   if(r.accounts.sourceWbtcUnits!==null&&BigInt(r.accounts.sourceWbtcUnits)<amount)r.reasons.push('insufficient_source_wbtc');
   const expected={owner:terms.owner,recipient:terms.recipient,amount:terms.amount,blockhash},tx=buildRestrictedTransfer(expected),wire=tx.serialize({requireAllSignatures:false,verifySignatures:false});
   const inspected=inspectRestrictedTransfer(wire,expected);if(inspected.tx.signatures.some(s=>s.signature!==null))throw Error('pre_signed_transaction_forbidden');
   r.messageHash=inspected.messageHash;r.blockhash=blockhash;r.lastValidBlockHeight=lastValidBlockHeight;
   const fee=await this.#rpc('getFeeForMessage',[tx.serializeMessage().toString('base64'),{commitment:'finalized',minContextSlot:r.accounts.slot}],signal);r.feeSlot=slot(fee,r.accounts.slot);
   if(fee.value===null)throw Error('preflight_fee_unavailable');r.networkFeeLamports=String(integer(fee.value));
   if(policy){if(BigInt(r.networkFeeLamports)>BigInt(policy.maxNetworkFeeLamports))r.reasons.push('network_fee_cap_exceeded');if(BigInt(r.accounts.solLamports)<BigInt(r.networkFeeLamports)+BigInt(policy.minSolReserveLamports))r.reasons.push('insufficient_sol_reserve');}
   if(!r.accounts.reasons.length){
    const sim=await this.#rpc('simulateTransaction',[wire.toString('base64'),{encoding:'base64',commitment:'finalized',minContextSlot:r.feeSlot,sigVerify:false,replaceRecentBlockhash:false}],signal);
    r.simulationSlot=slot(sim,r.feeSlot);
    if(!sim.value||!Object.hasOwn(sim.value,'err'))throw Error('preflight_simulation_invalid');
    r.simulation=sim.value.err===null?'passed':'failed';if(r.simulation==='failed')r.reasons.push('transaction_simulation_failed');
    // Provider logs and transaction wire never enter storage or the browser.
   }
   const height=integer(await this.#rpc('getBlockHeight',[{commitment:'finalized',minContextSlot:r.simulationSlot??r.feeSlot}],signal));
   if(height>=lastValidBlockHeight)r.reasons.push('preflight_blockhash_expired');
   r.state=!r.reasons.length&&r.simulation==='passed'?'checks-passed':'held';
  }catch(e){r.reasons.push(safe(e));r.state='held';}
  r.reasons=[...new Set(r.reasons)];return preflightView(r,this.#clock());
 }
}

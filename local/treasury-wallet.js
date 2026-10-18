import {WBTC} from './treasury-compute.js';
import {decode58} from './solana-evidence.js';
const RPC='https://api.mainnet-beta.solana.com';

// Public mainnet reads only. Symbol matches never establish token identity.
export async function readTreasuryWallets({computeWallet,otherWallet},{fetcher=fetch,clock=Date.now}={}){
 for(const key of [computeWallet,otherWallet])decode58(key,32);
 async function rpc(method,params){const r=await fetcher(RPC,{method:'POST',redirect:'error',signal:AbortSignal.timeout(12000),headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:method,method,params})});if(!r.ok)throw Error('treasury_rpc_unavailable');const raw=await r.text();if(raw.length>1048576)throw Error('treasury_rpc_too_large');const b=JSON.parse(raw);if(b.error||b.id!==method)throw Error('treasury_rpc_invalid');return b.result;}
 const mint=await rpc('getAccountInfo',[WBTC.mint,{encoding:'jsonParsed',commitment:'finalized'}]);
 if(mint?.value?.owner!==WBTC.program||mint.value.data?.parsed?.type!=='mint'||mint.value.data.parsed.info?.decimals!==WBTC.decimals||mint.value.data.parsed.info.isInitialized!==true)throw Error('wbtc_mint_mismatch');
 async function balance(owner){const r=await rpc('getTokenAccountsByOwner',[owner,{mint:WBTC.mint},{encoding:'jsonParsed',commitment:'finalized'}]);if(!Array.isArray(r?.value)||r.value.length>1000||!Number.isSafeInteger(r.context?.slot))throw Error('invalid_token_accounts');let total=0n;const seen=new Set();for(const row of r.value){const info=row.account?.data?.parsed?.info,a=info?.tokenAmount;if(typeof row.pubkey!=='string'||seen.has(row.pubkey)||row.account.owner!==WBTC.program||row.account.data.parsed.type!=='account'||info.owner!==owner||info.mint!==WBTC.mint||a?.decimals!==WBTC.decimals||typeof a.amount!=='string'||!/^(0|[1-9][0-9]{0,23})$/.test(a.amount)||info.state!=='initialized')throw Error('invalid_token_account');seen.add(row.pubkey);total+=BigInt(a.amount);}return {amount:total.toString(),slot:r.context.slot};}
 const [compute,other]=await Promise.all([balance(computeWallet),balance(otherWallet)]);
 return {mint:WBTC.mint,decimals:WBTC.decimals,computeWallet,otherWallet,computeAmount:compute.amount,otherAmount:other.amount,computeSlot:compute.slot,otherSlot:other.slot,observedAt:new Date(clock()).toISOString(),source:'finalized-rpc'};
}

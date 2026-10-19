import {PublicKey} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID} from '@solana/spl-token';
import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const units=x=>{if(typeof x!=='string'||!/^(0|[1-9][0-9]{0,19})$/.test(x))throw Error('rewards_invalid_units');return BigInt(x);};
const address=x=>new PublicKey(x).toBase58();
export const HOLDER_PROGRAMS=[TOKEN_PROGRAM_ID.toBase58(),TOKEN_2022_PROGRAM_ID.toBase58()];
async function rpc(method,params,fetcher){
 const response=await fetcher('https://api.mainnet-beta.solana.com',{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:method,method,params})});
 if(!response.ok)throw Error('holder_rpc_unavailable');const text=await response.text();if(text.length>20000000)throw Error('holder_snapshot_too_large');const r=JSON.parse(text);
 if(r.error||r.id!==method||!r.result)throw Error('holder_rpc_incomplete');return r.result;
}
export function normalizeHolderSnapshot({mint,before,accounts,after,observedAt}){
 address(mint);const b=before?.value,a=after?.value,info=b?.data?.parsed?.info;
 if(!HOLDER_PROGRAMS.includes(b?.owner)||a?.owner!==b.owner||b.executable||a.executable||b.data.parsed.type!=='mint'||!info?.isInitialized||info.mintAuthority!==null||JSON.stringify(b.data)!==JSON.stringify(a.data))throw Error('holder_mint_changed_or_unsupported');
 if(!Number.isInteger(info.decimals)||info.decimals<0||info.decimals>18||!units(info.supply))throw Error('holder_supply_invalid');
 if((info.extensions??[]).some(e=>!['metadataPointer','tokenMetadata'].includes(e.extension)))throw Error('holder_mint_extension_unsupported');
 const slots=[before.context?.slot,accounts?.context?.slot,after.context?.slot];
 if(slots.some(x=>!Number.isSafeInteger(x)||x<1)||slots[0]>slots[1]||slots[1]>slots[2]||!Array.isArray(accounts.value)||accounts.value.length>100000)throw Error('holder_snapshot_context_invalid');
 const seen=new Set(),holders=new Map();let sum=0n;
 for(const row of accounts.value){
  address(row.pubkey);if(seen.has(row.pubkey))throw Error('holder_account_duplicate');seen.add(row.pubkey);
  const x=row.account?.data?.parsed,i=x?.info;
  if(row.account?.owner!==b.owner||row.account.executable||x?.type!=='account'||i?.mint!==mint||i.isNative!==false||!['initialized','frozen'].includes(i.state)||i.tokenAmount?.decimals!==info.decimals||(i.extensions??[]).some(e=>e.extension!=='immutableOwner'))throw Error('holder_account_invalid');
  const owner=address(i.owner),amount=units(i.tokenAmount.amount);sum+=amount;holders.set(owner,(holders.get(owner)??0n)+amount);
 }
 if(sum!==units(info.supply))throw Error('holder_snapshot_supply_mismatch');
 const result={source:'finalized-rpc',mint,tokenProgram:b.owner,decimals:info.decimals,supply:info.supply,slot:slots[1],observedAt,accountCount:seen.size,holders:[...holders].filter(([,n])=>n>0n).sort(([a],[b])=>a.localeCompare(b)).map(([owner,n])=>({owner,units:String(n)}))};
 return {...result,digest:hash({...result,observedAt:null})};
}
export async function readHolderSnapshot(mint,{fetcher=fetch,clock=Date.now,minContextSlot=1}={}){
 address(mint);const cfg={commitment:'finalized',encoding:'jsonParsed',minContextSlot};
 const before=await rpc('getAccountInfo',[mint,cfg],fetcher);
 if(!HOLDER_PROGRAMS.includes(before.value?.owner))throw Error('holder_program_unsupported');
 const accounts=await rpc('getProgramAccounts',[before.value.owner,{...cfg,minContextSlot:before.context.slot,withContext:true,filters:[{memcmp:{offset:0,bytes:mint}}]}],fetcher);
 const after=await rpc('getAccountInfo',[mint,{...cfg,minContextSlot:accounts.context?.slot??before.context.slot}],fetcher);
 return normalizeHolderSnapshot({mint,before,accounts,after,observedAt:new Date(clock()).toISOString()});
}

import {decode58} from './solana-evidence.js';

export const DEVNET_RPC='https://api.devnet.solana.com';
export function encode58(bytes){
 const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
 let n=BigInt('0x'+Buffer.from(bytes).toString('hex')),s='';
 while(n){s=alphabet[Number(n%58n)]+s;n/=58n;}
 for(const b of bytes){if(b)break;s='1'+s;}return s;
}
// Read-only, fixed devnet endpoint. Never converts test SOL to a compute budget.
export async function observeTestTreasury(address,{fetcher=fetch,now=Date.now()}={}){
 decode58(address,32);
 const r=await fetcher(DEVNET_RPC,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getBalance',params:[address,{commitment:'finalized'}]})});
 if(!r.ok)throw Error('treasury_rpc_unavailable');const data=await r.json();
 if(data.error||data.id!==1||!Number.isSafeInteger(data.result?.value)||data.result.value<0||!Number.isSafeInteger(data.result?.context?.slot)||data.result.context.slot<0)throw Error('invalid_treasury_observation');
 return {schema:'bithash.test-treasury.v1',network:'devnet',address,lamports:String(data.result.value),slot:data.result.context.slot,observedAt:new Date(now).toISOString(),verification:'finalized-rpc-observation',proof:'https://solscan.io/account/'+address+'?cluster=devnet',realFunds:false,spendableProviderMicrousd:null,limitations:'Test SOL only. Balance does not establish fee origin, USD value, provider credit or transfer authority.'};
}

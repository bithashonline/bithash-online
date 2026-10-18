import {PublicKey} from '@solana/web3.js';
import {getAssociatedTokenAddressSync} from '@solana/spl-token';
import bs58 from 'bs58';
import {WBTC} from './treasury-compute.js';

export const PUMP='6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
export const PUMP_FEES='pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ';
const ATA='ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const DISC=Buffer.from([255,203,19,79,244,68,8,159]);
const amount=v=>{if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,19})$/.test(v))throw Error('invalid_fee_amount');return BigInt(v);};
const pk=v=>new PublicKey(v);
const pda=(program,...seeds)=>PublicKey.findProgramAddressSync(seeds,pk(program))[0].toBase58();
export const wbtcAta=owner=>getAssociatedTokenAddressSync(pk(WBTC.mint),pk(owner),true).toBase58();
export function feeAddresses({projectMint,computeWallet,otherWallet}){
 for(const v of [projectMint,computeWallet,otherWallet])pk(v);
 if(new Set([projectMint,computeWallet,otherWallet]).size!==3||projectMint===WBTC.mint)throw Error('invalid_fee_configuration');
 const sharing=pda(PUMP_FEES,Buffer.from('sharing-config'),pk(projectMint).toBuffer());
 const vault=pda(PUMP,Buffer.from('creator-vault'),pk(sharing).toBuffer());
 return {sharing,vault,vaultAta:wbtcAta(vault),computeAta:wbtcAta(computeWallet),otherAta:wbtcAta(otherWallet),curve:pda(PUMP,Buffer.from('bonding-curve'),pk(projectMint).toBuffer()),event:pda(PUMP,Buffer.from('__event_authority'))};
}
function bytes(account,owner,disc,size){
 if(account?.owner!==owner||account.executable!==false||account.data?.[1]!=='base64')throw Error('fee_account_identity_mismatch');
 const b=Buffer.from(account.data[0],'base64');
 if(b.length!==size||b.toString('base64')!==account.data[0]||!b.subarray(0,8).equals(Buffer.from(disc)))throw Error('unsupported_fee_account_layout');return b;
}
export function verifyFeeRouting(config,sharingAccount,curveAccount){
 const a=feeAddresses(config),b=bytes(sharingAccount,PUMP_FEES,[216,74,9,0,56,140,93,75],1024),c=bytes(curveAccount,PUMP,[23,183,248,55,96,216,172,96],166);
 const key=(x,o)=>new PublicKey(x.subarray(o,o+32)).toBase58();
 if(b[9]!==2||b[10]!==1||key(b,11)!==config.projectMint||b[75]!==1||b.readUInt32LE(76)!==2||b.subarray(148).some(x=>x!==0))throw Error('fee_routing_not_final_70_30');
 const recipients=[{wallet:key(b,80),bps:b.readUInt16LE(112)},{wallet:key(b,114),bps:b.readUInt16LE(146)}];
 if(!recipients.some(r=>r.wallet===config.computeWallet&&r.bps===7000)||!recipients.some(r=>r.wallet===config.otherWallet&&r.bps===3000)||key(c,49)!==a.sharing||key(c,83)!==WBTC.mint)throw Error('fee_routing_not_final_70_30');
 return {addresses:a,recipients};
}

// Narrow receipt adapter: finalized, successful top-level Pump v2 distributions.
// CPI distributions, legacy versions and ambiguous net balance changes stay excluded.
export function inspectFeeTransaction(tx,signature,config,routing){
 if(!tx||tx.meta?.err!==null||tx.transaction?.signatures?.[0]!==signature||!Number.isSafeInteger(tx.slot))throw Error('fee_transaction_unavailable');
 const keys=tx.transaction.message.accountKeys.map(k=>typeof k==='string'?k:k.pubkey),instructions=tx.transaction.message.instructions,a=routing.addresses;
 const expected=[null,config.projectMint,a.curve,a.sharing,a.vault,'11111111111111111111111111111111',a.event,PUMP,a.vaultAta,WBTC.mint,WBTC.program,ATA,...routing.recipients.map(r=>r.wallet),...routing.recipients.map(r=>wbtcAta(r.wallet))];
 const matches=[];
 for(let index=0;index<instructions.length;index++){
  const ix=instructions[index];if(ix.programId!==PUMP||typeof ix.data!=='string')continue;
  const data=Buffer.from(bs58.decode(ix.data));if(!data.subarray(0,8).equals(DISC))continue;
  if(data.length!==9||data[8]>1||ix.accounts?.length!==expected.length||expected.some((v,i)=>v!==null&&ix.accounts[i]!==v))throw Error('unsupported_fee_distribution');
  matches.push(index);
 }
 if(matches.length===0)return {receipts:[],excluded:true};
 if(matches.length!==1)throw Error('ambiguous_fee_distribution');
 const index=matches[0],inner=tx.meta.innerInstructions?.filter(g=>g.index===index);
 if(inner?.length!==1)throw Error('missing_fee_transfers');
 const paid=new Map();
 for(const ix of inner[0].instructions){
  if(ix.programId!==WBTC.program)continue;
  // ATA creation invokes token initialization one level deeper. Only direct
  // Pump token transfers establish a payout; final balances still bind all effects.
  if(Number.isInteger(ix.stackHeight)&&ix.stackHeight>2)continue;
  const p=ix.parsed;if(!['transfer','transferChecked'].includes(p?.type))throw Error('unsupported_fee_token_instruction');
  const i=p.info,n=amount(p.type==='transfer'?i.amount:i.tokenAmount?.amount);
  if(ix.stackHeight!==2||i.source!==a.vaultAta||i.authority!==a.vault||![a.computeAta,a.otherAta].includes(i.destination)||paid.has(i.destination)||n===0n)throw Error('fee_transfer_identity_mismatch');
  if(p.type==='transferChecked'&&(i.mint!==WBTC.mint||i.tokenAmount.decimals!==8))throw Error('fee_asset_mismatch');
  paid.set(i.destination,n);
 }
 if(paid.size!==2)throw Error('missing_fee_transfers');
 function balance(rows,address,owner,allowMissing=false){
  const list=rows?.filter(r=>keys[r.accountIndex]===address);if(!list)throw Error('missing_fee_balances');
  if(!list.length&&allowMissing)return 0n;
  if(list.length!==1||list[0].mint!==WBTC.mint||list[0].owner!==owner||list[0].programId!==WBTC.program||list[0].uiTokenAmount?.decimals!==8)throw Error('fee_balance_identity_mismatch');
  return amount(list[0].uiTokenAmount.amount);
 }
 const compute=paid.get(a.computeAta),other=paid.get(a.otherAta),total=compute+other;
 // Allow at most one base unit of integer distribution dust, never a second 70% cut.
 if(compute<total*70n/100n-1n||compute>total*70n/100n+1n)throw Error('fee_split_mismatch');
 for(const [address,owner,n] of [[a.computeAta,config.computeWallet,compute],[a.otherAta,config.otherWallet,other],[a.vaultAta,a.vault,-total]]){
  const delta=balance(tx.meta.postTokenBalances,address,owner)-balance(tx.meta.preTokenBalances,address,owner,address!==a.vaultAta);
  if(delta!==n)throw Error('ambiguous_fee_balance_change');
 }
 return {excluded:false,receipts:[{id:signature+':'+index,signature,instructionIndex:index,slot:tx.slot,projectMint:config.projectMint,quoteMint:WBTC.mint,computeWallet:config.computeWallet,otherWallet:config.otherWallet,totalUnits:String(total),computeUnits:String(compute),otherUnits:String(other),source:'finalized-pump-v2'}]};
}

export function publicFeeRpc(fetcher=fetch){return async(method,params)=>{
 if(!['getMultipleAccounts','getSignaturesForAddress','getTransaction','getBalance'].includes(method))throw Error('fee_rpc_method_forbidden');
 const response=await fetcher('https://api.mainnet-beta.solana.com',{method:'POST',redirect:'error',signal:AbortSignal.timeout(12000),headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:method,method,params})});
 if(!response.ok)throw Error('fee_rpc_unavailable');const raw=await response.text();if(raw.length>2000000)throw Error('fee_rpc_too_large');const body=JSON.parse(raw);if(body.error||body.id!==method)throw Error('fee_rpc_invalid');return body.result;
};}

export async function readComputeGas(config,{rpc=publicFeeRpc(),clock=Date.now}={}){
 pk(config.computeWallet);const r=await rpc('getBalance',[config.computeWallet,{commitment:'finalized'}]);
 if(!Number.isSafeInteger(r?.value)||r.value<0||!Number.isSafeInteger(r.context?.slot))throw Error('invalid_gas_observation');
 return {wallet:config.computeWallet,lamports:String(r.value),observedAt:new Date(clock()).toISOString(),source:'finalized-rpc'};
}

export async function scanFees(config,{rpc=publicFeeRpc(),knownSignatures=[],previousHead=null,previousComplete=false}={}){
 const a=feeAddresses(config),accounts=await rpc('getMultipleAccounts',[[a.sharing,a.curve],{commitment:'finalized',encoding:'base64'}]);
 const routing=verifyFeeRouting(config,accounts?.value?.[0],accounts?.value?.[1]);
 const seen=new Set(),known=new Set(knownSignatures),receipts=[],processed=[],excluded=[];let before,head=null,complete=false,anchorFound=false;
 for(let page=0;page<3;page++){
  const rows=await rpc('getSignaturesForAddress',[a.sharing,{commitment:'finalized',limit:25,...(before?{before}:{})}]);
  if(!Array.isArray(rows)||rows.length>25)throw Error('invalid_fee_history');
  for(const row of rows){
   if(typeof row.signature!=='string'||bs58.decode(row.signature).length!==64||seen.has(row.signature)||row.confirmationStatus!=='finalized')throw Error('invalid_fee_history');
   seen.add(row.signature);head??=row.signature;
   if(row.signature===previousHead)anchorFound=true;
   if(known.has(row.signature))continue;
   if(row.err!==null){processed.push(row.signature);excluded.push({signature:row.signature,reason:'failed_transaction'});continue;}
   const tx=await rpc('getTransaction',[row.signature,{commitment:'finalized',encoding:'jsonParsed',maxSupportedTransactionVersion:0}]);
   // Missing/pruned RPC data aborts this batch; it is retried rather than skipped.
   if(!tx)throw Error('fee_transaction_unavailable');
   const found=inspectFeeTransaction(tx,row.signature,config,routing);
   receipts.push(...found.receipts);processed.push(row.signature);
   if(found.excluded)excluded.push({signature:row.signature,reason:'not_supported_top_level_distribution'});
  }
  if(rows.length<25){complete=true;break;}
  if(anchorFound&&previousComplete){complete=true;break;}
  before=rows.at(-1).signature;
 }
 return {receipts,processed,excluded,head,complete,routingVerified:true,coverage:'Up to 75 recent sharing-config transactions; top-level WBTC v2 distributions only. RPC history completeness is not archival proof.'};
}

import {PublicKey,Transaction} from '@solana/web3.js';
import {getAssociatedTokenAddressSync,createAssociatedTokenAccountIdempotentInstruction,createTransferCheckedInstruction,TOKEN_PROGRAM_ID} from '@solana/spl-token';
import bs58 from 'bs58';
import {WBTC} from './treasury-compute.js';
export function buildRewardTransfer({owner,recipient,amount,blockhash}){
 const payer=new PublicKey(owner),holder=new PublicKey(recipient),mint=new PublicKey(WBTC.mint);
 if(owner===recipient||!PublicKey.isOnCurve(holder.toBytes())||!/^([1-9][0-9]{0,19})$/.test(amount)||BigInt(amount)>18446744073709551615n)throw Error('rewards_transfer_invalid');
 const source=getAssociatedTokenAddressSync(mint,payer),destination=getAssociatedTokenAddressSync(mint,holder);
 const tx=new Transaction({feePayer:payer,recentBlockhash:blockhash});
 tx.add(createAssociatedTokenAccountIdempotentInstruction(payer,destination,holder,mint),createTransferCheckedInstruction(source,mint,destination,payer,BigInt(amount),8,[],TOKEN_PROGRAM_ID));
 return {tx,source:source.toBase58(),destination:destination.toBase58()};
}
export function verifyRewardTransfer(expected,signature,result,minSlot){
 if(result===null)return {state:'pending'};
 if(!Number.isSafeInteger(result.slot)||result.slot<minSlot||result.transaction?.[1]!=='base64'||typeof result.transaction[0]!=='string'||result.transaction[0].length>1700||!result.meta||result.meta.err===undefined)throw Error('rewards_chain_evidence_invalid');
 const tx=Transaction.from(Buffer.from(result.transaction[0],'base64')),canonical=buildRewardTransfer({...expected,blockhash:tx.recentBlockhash});
 if(!tx.serializeMessage().equals(canonical.tx.serializeMessage())||!tx.verifySignatures()||bs58.encode(tx.signature)!==signature)throw Error('rewards_transaction_mismatch');
 if(result.meta.err!==null)return {state:'failed',slot:result.slot};
 const keys=tx.compileMessage().accountKeys.map(k=>k.toBase58());
 const balance=(rows,account,owner,missing=false)=>{
  if(!Array.isArray(rows))throw Error('rewards_missing_balances');const rs=rows.filter(r=>keys[r.accountIndex]===account);
  if(missing&&rs.length===0)return 0n;const r=rs[0];
  if(rs.length!==1||r.owner!==owner||r.mint!==WBTC.mint||r.programId!==WBTC.program||r.uiTokenAmount?.decimals!==8||!/^(0|[1-9][0-9]{0,19})$/.test(r.uiTokenAmount.amount))throw Error('rewards_balance_invalid');return BigInt(r.uiTokenAmount.amount);
 };
 if(balance(result.meta.preTokenBalances,canonical.source,expected.owner)-balance(result.meta.postTokenBalances,canonical.source,expected.owner)!==BigInt(expected.amount)||balance(result.meta.postTokenBalances,canonical.destination,expected.recipient)-balance(result.meta.preTokenBalances,canonical.destination,expected.recipient,true)!==BigInt(expected.amount))throw Error('rewards_delta_mismatch');
 return {state:'finalized',slot:result.slot};
}

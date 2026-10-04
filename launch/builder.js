import { createRequire } from 'node:module';
// The SDK's ESM dependency path fails on Node 22.16 (Anchor BN export).
// Use its published CommonJS entry; no dependency source modifications.
const { PUMP_SDK, PUMP_PROGRAM_ID, PUMP_FEE_PROGRAM_ID, feeSharingConfigPda } = createRequire(import.meta.url)('@pump-fun/pump-sdk');
import { PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } from '@solana/web3.js';

const WSOL = new PublicKey('So11111111111111111111111111111111111111112');
const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const PLACEHOLDER_BLOCKHASH = '11111111111111111111111111111111';
function text(value, label, max) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value) || Buffer.byteLength(value,'utf8') > max) throw Error(`Invalid ${label}; maximum ${max} UTF-8 bytes`);
  return value;
}
function address(value, label) {
  let key; try { key = new PublicKey(value); } catch { throw Error(`Invalid ${label}`); }
  if (key.equals(PublicKey.default)) throw Error(`Invalid ${label}`);
  return key;
}
function measure(instructions, payer) {
  const message = new TransactionMessage({payerKey:payer,recentBlockhash:PLACEHOLDER_BLOCKHASH,instructions}).compileToV0Message();
  // web3's serializer itself overflows on large messages. Measure the exact v0
  // wire layout first so maximum-length inputs produce a useful size rejection.
  const short = n => { let bytes=1; while(n>=128){n=Math.floor(n/128);bytes++;}return bytes; };
  const signatures=message.header.numRequiredSignatures;
  const bytes=short(signatures)+64*signatures+1+3+short(message.staticAccountKeys.length)+32*message.staticAccountKeys.length+32+
    short(message.compiledInstructions.length)+message.compiledInstructions.reduce((sum,ix)=>sum+1+short(ix.accountKeyIndexes.length)+ix.accountKeyIndexes.length+short(ix.data.length)+ix.data.length,0)+1;
  if(message.addressTableLookups.length!==0)throw Error('Size measurement only supports no-lookup previews');
  if(bytes<=1232 && new VersionedTransaction(message).serialize().length!==bytes)throw Error('Serialized length mismatch');
  return { bytes, limitBytes:1232, fits:bytes<=1232, signerCount:message.header.numRequiredSignatures,
    signers:message.staticAccountKeys.slice(0,message.header.numRequiredSignatures).map(k=>k.toBase58()) };
}
export async function buildPreview(input) {
  if (input?.mode !== 'unsigned-preview') throw Error('Only unsigned-preview mode is implemented');
  const allowed=new Set(['mode','routingMode','name','symbol','uri','payer','mint','treasury','computeShareBps','holderReward','cashback','mayhemMode','initialBuyLamports']);
  if(Object.keys(input).some(k=>!allowed.has(k)))throw Error('Unsupported preview option');
  const name=text(input.name,'name',32),symbol=text(input.symbol,'symbol',13),uri=text(input.uri,'metadata URI',200);
  let parsed;try{parsed=new URL(uri);}catch{throw Error('Metadata URI must use HTTPS or IPFS');}
  if (!['https:','ipfs:'].includes(parsed.protocol) || parsed.username || parsed.password) throw Error('Metadata URI must use HTTPS or IPFS without credentials');
  const payer=address(input.payer,'payer'),mint=address(input.mint,'mint'),treasury=address(input.treasury,'treasury');
  if (!PublicKey.isOnCurve(payer.toBytes()) || !PublicKey.isOnCurve(mint.toBytes())) throw Error('Payer and mint must be signer public keys');
  if (new Set([payer,mint,treasury].map(k=>k.toBase58())).size!==3) throw Error('Payer, mint and treasury must be distinct for this preview');
  const bps=input.computeShareBps;
  if (!Number.isSafeInteger(bps) || bps<1 || bps>10000) throw Error('Explicit compute share must be 1–10000 basis points');
  const routingMode=input.routingMode??'fee-sharing';
  if(!['fee-sharing','direct-creator'].includes(routingMode))throw Error('Unknown routing mode');
  if(routingMode==='direct-creator' && bps!==10000)throw Error('Direct creator route requires all creator fees to treasury');
  if (['holderReward','cashback','mayhemMode'].some(k=>input[k]!==undefined && input[k]!==false) || input.initialBuyLamports!==undefined && input.initialBuyLamports!=='0') throw Error('Preview supports regular SOL-paired creation without an initial buy');
  const shares=[{address:treasury,shareBps:bps}];
  if(bps<10000) shares.push({address:payer,shareBps:10000-bps});
  const create=await PUMP_SDK.createV2Instruction({mint,name,symbol,uri,creator:routingMode==='direct-creator'?treasury:payer,user:payer,mayhemMode:false,cashback:false,holderReward:false});
  const instructions=[create];
  if(routingMode==='fee-sharing'){
    instructions.push(await PUMP_SDK.createFeeSharingConfig({creator:payer,mint,pool:null}));
    instructions.push(await PUMP_SDK.updateFeeSharesV2({authority:payer,mint,currentShareholders:[payer],newShareholders:shares,quoteMint:WSOL,quoteTokenProgram:TOKEN}));
  }
  const expected=[PUMP_PROGRAM_ID,PUMP_FEE_PROGRAM_ID,PUMP_FEE_PROGRAM_ID];
  instructions.forEach((ix,i)=>{if(!ix.programId.equals(expected[i]))throw Error('Unexpected SDK program');});
  const budget=ComputeBudgetProgram.setComputeUnitLimit({units:1400000});
  const combined=measure([budget,...instructions],payer);
  const separate={create:measure([budget,create],payer),configure:routingMode==='fee-sharing'?measure([budget,...instructions.slice(1)],payer):null};
  return {summary:{mode:'UNSIGNED OFFLINE PREVIEW',sdkVersion:'2.0.0',submitted:false,simulated:false,
    name,symbol,metadataURI:uri,metadataVerified:false,payer:payer.toBase58(),mint:mint.toBase58(),treasury:treasury.toBase58(),
    routingMode,quote:'SOL',holderReward:false,cashback:false,mayhemMode:false,initialBuyLamports:'0',
    shareBasis:'Share of creator fees, not trading volume or all trading fees',
    shares:shares.map(s=>({address:s.address.toBase58(),shareBps:s.shareBps})),
    sharingConfig:routingMode==='fee-sharing'?feeSharingConfigPda(mint).toBase58():null,
    routingCaveat:routingMode==='direct-creator'?'Creator set directly to treasury; no per-mint sharing lock. Shared creator vault aggregates fees across coins. Onchain execution and admin controls need verification.':'Per-mint sharing setup requests final shares; final onchain state and admin scope still need verification.',
    combined,separate,atomicExecutionVerified:false,
    nextGate:combined.fits?'Read-only simulation with real chain state and a valid blockhash is required':'Combined v0 packet exceeds limit. Inspect an existing lookup table or design explicit resumable setup; do not silently launch unconfigured.',
    costs:'Not quoted: fetch current rent, network/priority fees and live program state. Fee split and destination are preview inputs, not approved project policy.',
    instructions:instructions.map((ix,i)=>({name:['create_v2','create_fee_sharing_config','update_fee_shares_v2'][i],program:ix.programId.toBase58(),accounts:ix.keys.length,dataBytes:ix.data.length,dataBase64:ix.data.toString('base64')}))},instructions};
}

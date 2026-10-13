import {createPublicKey} from 'node:crypto';
const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function decode58(s,size){if(typeof s!=='string'||s.length>90||!s.length)throw Error('invalid_base58');let n=0n;for(const c of s){const i=alphabet.indexOf(c);if(i<0)throw Error('invalid_base58');n=n*58n+BigInt(i)}let hex=n.toString(16);if(hex.length%2)hex='0'+hex;const bytes=Buffer.concat([Buffer.alloc(s.match(/^1*/)[0].length),n===0n?Buffer.alloc(0):Buffer.from(hex,'hex')]);if(bytes.length!==size)throw Error('invalid_length');return bytes}
export function ownerPem(address){return createPublicKey({key:{kty:'OKP',crv:'Ed25519',x:decode58(address,32).toString('base64url')},format:'jwk'}).export({format:'pem',type:'spki'}).toString()}
// Strictly observes top-level native SOL transfers; no inferred fee revenue or provider credit.
export async function verifySolTransfer({signature,source,destination,lamports},{fetchImpl=fetch}={}){
 decode58(signature,64);decode58(source,32);decode58(destination,32);
 if(source===destination||!/^\d{1,16}$/.test(lamports)||BigInt(lamports)<=0n||BigInt(lamports)>BigInt(Number.MAX_SAFE_INTEGER))throw Error('invalid_transfer');
 const response=await fetchImpl('https://api.mainnet-beta.solana.com',{method:'POST',headers:{'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(10000),body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getTransaction',params:[signature,{encoding:'jsonParsed',commitment:'finalized',maxSupportedTransactionVersion:0}]})});
 if(!response.ok)throw Error('rpc_unavailable');const data=await response.json(),tx=data.result;
 if(data.error||!tx||!tx.meta||tx.meta.err!==null||tx.transaction?.signatures?.[0]!==signature||!Number.isSafeInteger(tx.slot))throw Error('transaction_not_verified');
 const matches=(tx.transaction.message?.instructions??[]).filter(i=>i.programId==='11111111111111111111111111111111'&&i.parsed?.type==='transfer'&&i.parsed.info?.source===source&&i.parsed.info?.destination===destination&&Number.isSafeInteger(i.parsed.info?.lamports)&&String(i.parsed.info.lamports)===lamports);
 if(matches.length!==1)throw Error('transfer_not_uniquely_matched');
 return {kind:'native-sol-transfer',verification:'finalized-rpc-observation',network:'mainnet-beta',signature,source,destination,lamports,slot:tx.slot,observedAt:new Date().toISOString(),url:'https://solscan.io/tx/'+signature,limitations:'Confirms one native SOL transfer. Does not establish creator-fee origin, Runpod credit or GPU work.'};
}

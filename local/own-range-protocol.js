import {createHash,createPublicKey,publicEncrypt,privateDecrypt,constants,sign,verify} from 'node:crypto';
import {addressFor,integer} from './solver.js';
export const RANGE_DOMAIN='bithash.own-range-receipt.v1\n';
export const LOWER=1n<<70n,UPPER=1n<<71n,MAX_CHUNK=1n<<32n,PROBE_KEY=LOWER+(1n<<20n)+7n;
export const RANGE_TARGETS=Object.freeze({
 'puzzle-71':Object.freeze({id:'puzzle-71',start:String(LOWER),end:String(UPPER),address:'1PWo3JeB9jrGwfHDNpdGK54CRas7fsVzXU'}),
 'range-probe-71':Object.freeze({id:'range-probe-71',start:String(LOWER),end:String(LOWER+MAX_CHUNK),address:'1ASZWacT6EhP8oNjG4iWjWFyKMRexVtNXr'})});
export const digest=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
export const rangeFail=code=>Object.assign(Error(code),{code});
export function shape(v,fields){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join()!==fields.split(',').sort().join())throw rangeFail('invalid_schema');}
export function stamp(n){if(!Number.isSafeInteger(n)||n<0)throw rangeFail('invalid_clock');return n;}
export function target(id){if(!Object.hasOwn(RANGE_TARGETS,id))throw rangeFail('invalid_target');return RANGE_TARGETS[id];}
export function bounds(id,start,end){const t=target(id);start=integer(start);end=integer(end);
 if(start<BigInt(t.start)||end>BigInt(t.end)||end<=start||end-start>MAX_CHUNK)throw rangeFail('invalid_range');return {start:String(start),end:String(end)};}
export function rangeRequest(r){
 shape(r,'schema,jobId,epoch,targetId,start,end,solverSha256,providerPodId,expiresAt,recoveryKeyId');
 if(r.schema!=='bithash.own-range-request.v1'||!/^range-[a-f0-9]{24}$/.test(r.jobId)||!Number.isSafeInteger(r.epoch)||r.epoch<1||
  !/^[a-f0-9]{64}$/.test(r.solverSha256)||!/^[-a-zA-Z0-9]{1,64}$/.test(r.providerPodId)||typeof r.start!=='string'||typeof r.end!=='string')throw rangeFail('invalid_request');
 bounds(r.targetId,r.start,r.end);stamp(r.expiresAt);
 if(r.targetId==='puzzle-71'?!/^[a-f0-9]{64}$/.test(r.recoveryKeyId):r.recoveryKeyId!==null)throw rangeFail('invalid_recovery_key');
 return {schema:r.schema,jobId:r.jobId,epoch:r.epoch,targetId:r.targetId,start:r.start,end:r.end,solverSha256:r.solverSha256,
  providerPodId:r.providerPodId,expiresAt:r.expiresAt,recoveryKeyId:r.recoveryKeyId};
}
export function nativeResult(request,r){
 request=rangeRequest(request);shape(r,'schema,targetId,start,end,attempted,status,matched,elapsedNanoseconds');
 if(r.schema!=='bithash.native-range.v1'||r.targetId!==request.targetId||r.start!==request.start||r.end!==request.end||
  !['completed','candidate'].includes(r.status)||typeof r.matched!=='boolean'||typeof r.elapsedNanoseconds!=='string'||! /^[1-9][0-9]{0,14}$/.test(r.elapsedNanoseconds))throw rangeFail('invalid_result');
 const count=BigInt(request.end)-BigInt(request.start),attempted=integer(r.attempted);
 if(r.status==='completed'?(attempted!==count):(request.targetId!=='puzzle-71'||!r.matched||attempted<1n||attempted>count))throw rangeFail('incomplete_range');
 if(request.targetId==='puzzle-71'&&r.status==='completed'&&r.matched)throw rangeFail('unsealed_candidate');
 if(request.targetId==='range-probe-71'&&(r.status!=='completed'||r.matched!==(BigInt(request.start)<=PROBE_KEY&&PROBE_KEY<BigInt(request.end))))throw rangeFail('probe_mismatch');
 return {...r};
}
export function recoveryPublic(pem){const key=createPublicKey(pem);if(key.asymmetricKeyType!=='rsa'||key.asymmetricKeyDetails.modulusLength!==3072)throw rangeFail('invalid_recovery_key');
 const normalized=key.export({type:'spki',format:'pem'}).toString();return {keyId:digest(normalized),publicKey:normalized};}
export function sealCandidate(raw,request,publicKey){
 request=rangeRequest(request);const recipient=recoveryPublic(publicKey);
 if(request.targetId!=='puzzle-71'||recipient.keyId!==request.recoveryKeyId||typeof raw!=='string'||!/^([a-f0-9]{64})\r?\n?$/i.test(raw))throw rangeFail('invalid_candidate');
 const scalar=BigInt('0x'+raw.trim());if(scalar<BigInt(request.start)||scalar>=BigInt(request.end)||addressFor(scalar)!==target(request.targetId).address)throw rangeFail('invalid_candidate');
 const plaintext=Buffer.from(raw.trim().toLowerCase(),'hex');
 try {return {algorithm:'rsa-oaep-sha256',keyId:recipient.keyId,ciphertext:publicEncrypt({key:recipient.publicKey,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},plaintext).toString('base64')};}
 finally{plaintext.fill(0);}
}
export function openCandidate(sealed,request,privateKey){
 const bytes=privateDecrypt({key:privateKey,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},Buffer.from(sealed.ciphertext,'base64'));
 try{const scalar=BigInt('0x'+bytes.toString('hex'));if(bytes.length!==32||scalar<BigInt(request.start)||scalar>=BigInt(request.end)||addressFor(scalar)!==target(request.targetId).address)throw rangeFail('invalid_candidate');return Buffer.from(bytes);}
 finally{bytes.fill(0);}
}
export function receiptPayload(p){
 shape(p,'schema,request,backend,result,sealedCandidate');const request=rangeRequest(p.request),result=nativeResult(request,p.result);
 if(p.schema!=='bithash.own-range-receipt.v1'||!['bitcrack-cuda-exact-range','node-openssl-range-probe'].includes(p.backend)||
  (request.targetId==='puzzle-71'&&p.backend!=='bitcrack-cuda-exact-range'))throw rangeFail('invalid_backend');
 if(result.status==='candidate'){
  shape(p.sealedCandidate,'algorithm,keyId,ciphertext');
  if(p.sealedCandidate.algorithm!=='rsa-oaep-sha256'||p.sealedCandidate.keyId!==request.recoveryKeyId||
   typeof p.sealedCandidate.ciphertext!=='string'||!/^[A-Za-z0-9+/]{512}$/.test(p.sealedCandidate.ciphertext))throw rangeFail('invalid_candidate');
 }else if(p.sealedCandidate!==null)throw rangeFail('unexpected_secret');
 return {schema:p.schema,request,backend:p.backend,result,sealedCandidate:p.sealedCandidate};
}
export function signRangeReceipt(value,key){const payload=receiptPayload(value);return {payload,signature:sign(null,Buffer.from(RANGE_DOMAIN+JSON.stringify(payload)),key).toString('base64')};}
export function verifyRangeReceipt(envelope,key){shape(envelope,'payload,signature');const payload=receiptPayload(envelope.payload);
 if(typeof envelope.signature!=='string'||!/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature)||
  !verify(null,Buffer.from(RANGE_DOMAIN+JSON.stringify(payload)),key,Buffer.from(envelope.signature,'base64')))throw rangeFail('signature_rejected');return payload;}

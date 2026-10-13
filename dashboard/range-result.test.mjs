import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyRangeArchive, resultView } from './public/range-result.mjs';
const p={schema:'bithash.range-result.v1',job:'a'.repeat(24),epoch:1,fixture:'puzzle-3',start:'4',end:'6',
 result:{backend:'node-openssl-cpu-fixture',attempted:'2',matched:false,elapsedNanoseconds:'100'},
 evidence:'local-known-answer-validation',hardwareVerified:false,coverageVerified:false};
function envelope(value=p){const payload=JSON.stringify(value),digest=createHash('sha256').update(payload).digest('hex');
 return {schema:'bithash.range-proof.v1',payload,digest,hardwareVerified:false,coverageVerified:false};}
test('result viewer independently verifies archive bytes and presents exact fixture metadata',async()=>{
 const proof=envelope();assert.deepEqual(await verifyRangeArchive(proof,proof.digest),p);
 const html=resultView(p,proof.digest,proof.payload);assert.ok(html.includes('[4, 6)'));assert.ok(html.includes('CPU / OpenSSL'));
 assert.ok(!html.includes('GPU verified'));
 await assert.rejects(verifyRangeArchive({...proof,payload:proof.payload+' '},proof.digest));
});
test('result viewer rejects changed schema, unknown targets, overruns, extra candidate fields and verified flags',async()=>{
 for(const patch of [{fixture:'puzzle-71'},{end:'9'},{hardwareVerified:true},{candidate:'secret'},
  {result:{...p.result,attempted:'3'}},{result:{...p.result,privateKey:'secret'}}]){
  const proof=envelope({...p,...patch});await assert.rejects(verifyRangeArchive(proof,proof.digest));
 }
});

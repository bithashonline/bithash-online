import {readFileSync} from 'node:fs';
import {createHash,verify} from 'node:crypto';
import assert from 'node:assert/strict';
const root=new URL('./artifacts/hosted-gpu-acceptance/',import.meta.url);
const read=name=>JSON.parse(readFileSync(new URL(name,root),'utf8').replace(/^\uFEFF/,''));
const records=read('proofs.json').proofs,build='sha256:17e6a74ec89099ef934493871b380ae52fac22a67611b667849f132ab8b4021b';
assert.equal(records.length,13);const sequences=new Map();
for(const p of records){
 assert.equal(p.domain,'bithash.gpu-telemetry.v1\n');
 const bytes=Buffer.from(p.domain+JSON.stringify(p.envelope.payload));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),p.digest);
 assert(verify(null,bytes,p.enrollment.publicKey,Buffer.from(p.envelope.signature,'base64')));
 assert.equal(p.enrollment.build,build);assert.equal(p.enrollment.providerPodId,'17jsao96984h9q');
 assert.equal(p.enrollment.id,p.envelope.payload.lease);assert.equal(p.enrollment.kind,'gpu');
 assert(Date.parse(p.receivedAt)<p.enrollment.expiresAt);
 assert.equal(p.envelope.payload.sequence,(sequences.get(p.enrollment.id)||0)+1);sequences.set(p.enrollment.id,p.envelope.payload.sequence);
}
const full=read('result.json'),interrupted=read('interruption-result.json');
assert.equal(full.status,'passed');assert.equal(full.completedCases,2);assert.equal(full.candidatesChecked,'34361835520');
assert.equal(interrupted.status,'failed');assert.equal(interrupted.completedCases,1);assert.equal(interrupted.candidatesChecked,'2097152');
for(const r of [full,interrupted]){assert.equal(r.puzzle71Candidates,'0');assert.equal(r.build,build);assert.equal(r.deliveryFailed,false);}
const audit=read('shutdown.json');assert.equal(audit.lease.phase,'absence_observed');
assert(audit.events.find(x=>x.kind==='provider_404_observed').at<audit.lease.deadline);
console.log('Verified 13 archived worker claims, case outcomes and controller deadline evidence; no exhaustive search or physical attestation implied.');

const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const decimal=v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(v);
const shape=(p,keys)=>p&&typeof p==='object'&&!Array.isArray(p)&&Object.keys(p).sort().join()===keys.sort().join();
export async function verifyRangeArchive(proof,digest){
 if(!/^[a-f0-9]{64}$/.test(digest)||proof?.schema!=='bithash.range-proof.v1'||proof.digest!==digest||
    proof.hardwareVerified!==false||proof.coverageVerified!==false||typeof proof.payload!=='string'||proof.payload.length>8192)throw Error('Invalid archive');
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(proof.payload));
 const actual=Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');
 if(actual!==digest)throw Error('Archive checksum mismatch');
 const p=JSON.parse(proof.payload),bounds={'puzzle-1':['1','2'],'puzzle-2':['2','4'],'puzzle-3':['4','8']};
 if(!shape(p,['schema','job','epoch','fixture','start','end','result','evidence','hardwareVerified','coverageVerified'])||
    p.schema!=='bithash.range-result.v1'||!/^[a-f0-9]{24}$/.test(p.job)||!Number.isSafeInteger(p.epoch)||p.epoch<1||
    !Object.hasOwn(bounds,p.fixture)||!decimal(p.start)||!decimal(p.end)||BigInt(p.start)>=BigInt(p.end)||
    BigInt(p.start)<BigInt(bounds[p.fixture][0])||BigInt(p.end)>BigInt(bounds[p.fixture][1])||
    p.evidence!=='local-known-answer-validation'||p.hardwareVerified!==false||p.coverageVerified!==false||
    !shape(p.result,['backend','attempted','matched','elapsedNanoseconds'])||
    !['node-openssl-cpu-fixture','bitcrack-cuda-bounded-fixture'].includes(p.result.backend)||
    !decimal(p.result.attempted)||BigInt(p.result.attempted)!==BigInt(p.end)-BigInt(p.start)||
    typeof p.result.matched!=='boolean'||!decimal(p.result.elapsedNanoseconds)||BigInt(p.result.elapsedNanoseconds)<1n)throw Error('Invalid result');
 return p;
}
export function resultView(p,digest,payload){
 const fields=[['Public fixture',p.fixture],['Range · end excluded',`[${p.start}, ${p.end})`],['Candidates checked',p.result.attempted],
  ['Known solution within range',p.result.matched?'Yes':'No'],['Backend',p.result.backend==='node-openssl-cpu-fixture'?'CPU / OpenSSL':'CUDA fixture adapter'],
  ['Recorded duration',`${p.result.elapsedNanoseconds} nanoseconds`]];
 return `<div class="result-grid">${fields.map(([label,value])=>`<div><span>${esc(label)}</span><b>${esc(value)}</b></div>`).join('')}</div><p><span class="micro-label">ARCHIVE SHA-256</span><br><code style="overflow-wrap:anywhere">${esc(digest)}</code></p><details><summary>Inspect normalized archive</summary><pre>${esc(payload)}</pre></details>`;
}
if(typeof document!=='undefined'){
 const status=document.getElementById('archive-status'),root=document.getElementById('range-result');
 (async()=>{
  try{
   const digest=location.hash.slice(1);if(!/^[a-f0-9]{64}$/.test(digest))throw Error();
   const response=await fetch('/api/range-proof/'+digest,{cache:'no-store',signal:AbortSignal.timeout(5000)});
   if(!response.ok)throw Error();const proof=await response.json(),p=await verifyRangeArchive(proof,digest);
   status.textContent='Archive checksum verified · Local known-answer result';
   root.innerHTML=resultView(p,digest,proof.payload);
  }catch{status.textContent='Result unavailable or archive check failed. No verified result can be shown.';root.replaceChildren();}
 })();
}

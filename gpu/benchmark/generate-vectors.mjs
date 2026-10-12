import {createECDH,createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const hash=(n,b)=>createHash(n).update(b).digest();
function address(n){
  const ec=createECDH('secp256k1');ec.setPrivateKey(Buffer.from(n.toString(16).padStart(64,'0'),'hex'));
  const payload=Buffer.concat([Buffer.from([0]),hash('ripemd160',hash('sha256',ec.getPublicKey(null,'compressed')))]);
  const bytes=Buffer.concat([payload,hash('sha256',hash('sha256',payload)).subarray(0,4)]);
  let v=BigInt('0x'+bytes.toString('hex')),s='';const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  while(v){s=alphabet[Number(v%58n)]+s;v/=58n;}for(const b of bytes){if(b)break;s='1'+s;}return s;
}
const start=1n<<40n, cases=[];
const profiles=[{id:'small',blocks:64,threads:256,points:64},{id:'medium',blocks:128,threads:256,points:128},{id:'large',blocks:128,threads:256,points:256}];
for(const p of profiles)for(const mode of ['validate','benchmark']){
  const batch=BigInt(p.blocks*p.threads*p.points),count=mode==='validate'?2n*batch:1n<<35n;
  const offsets=mode==='validate'?[0n,batch-1n,batch,count-1n,-1n,count]:[count-1n,count];
  cases.push({...p,mode,start:start.toString(),end:(start+count).toString(),count:count.toString(),
    targets:offsets.map(o=>({offset:o.toString(),address:address(start+o),expectedMatch:o>=0n&&o<count}))});
}
const root=fileURLToPath(new URL('.',import.meta.url));
writeFileSync(root+'vectors.json',JSON.stringify({schema:'bithash.synthetic-benchmark-v1',description:'Public deterministic test vectors; no funded target or user-supplied address',profiles:cases},null,2)+'\n');
let header='#pragma once\n#include <vector>\n#include <string>\nstruct VectorTarget {std::string address; long long offset; bool expected;};\nstruct VectorCase {std::string id,mode; int blocks,threads,points; unsigned long long start,count; std::vector<VectorTarget> targets;};\nconst std::vector<VectorCase> vectors = {\n';
for(const c of cases)header+=`{"${c.id}","${c.mode}",${c.blocks},${c.threads},${c.points},${c.start}ULL,${c.count}ULL,{${c.targets.map(t=>`{"${t.address}",${t.offset}LL,${t.expectedMatch}}`).join(',')}}},\n`;
writeFileSync(root+'vectors.h',header+'};\n');
console.log(`Generated ${cases.length} fixed cases with independent Node/OpenSSL references`);

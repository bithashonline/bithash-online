import {readFileSync,writeFileSync,copyFileSync,mkdirSync,lstatSync,chmodSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';
const here=dirname(fileURLToPath(import.meta.url)),repo=resolve(here,'../..');
const [archiveArg,outArg]=process.argv.slice(2);
if(!archiveArg||!outArg||process.argv.length!==4)throw Error('usage: node package.mjs ORIGINAL_COMPARISON_ARCHIVE NEW_OUTPUT_DIRECTORY');
const archive=resolve(archiveArg),out=resolve(outArg),sha=b=>createHash('sha256').update(b).digest('hex');
// This exact historical archive was used for the three-GPU comparison.
if(sha(readFileSync(archive))!=='dfe1255f3809c20bac939b91656f45d719bde0d982a7ef6cb7ffbbd071c96e17')throw Error('historical_archive_mismatch');
mkdirSync(out);mkdirSync(join(out,'lib'));
const runtime=['bithash-benchmark','vectors.json','lib/libcudart.so.12','BITCRACK-LICENSE.MIT','CUDA-LICENSE'];
execFileSync('tar',['-xzf',archive,'-C',out,...runtime],{stdio:'pipe'});
const old=JSON.parse(readFileSync(join(repo,'experiments/artifacts/bithash-comparison-package-manifest.json')));
for(const name of runtime){if(!lstatSync(join(out,name)).isFile()||sha(readFileSync(join(out,name)))!==old.files[name])throw Error('runtime_mismatch');}
for(const name of ['worker.mjs','core.mjs','runtime.mjs','README.md'])copyFileSync(join(here,name),join(out,name));
for(const name of ['gpu-telemetry.js','collector-client.js'])copyFileSync(join(repo,'local',name),join(out,name));
writeFileSync(join(out,'package.json'),JSON.stringify({private:true,type:'module',engines:{node:'>=22.16.0'}})+'\n');
const names=[...runtime,'worker.mjs','core.mjs','runtime.mjs','README.md','gpu-telemetry.js','collector-client.js','package.json'].sort();
const files=Object.fromEntries(names.map(name=>[name,sha(readFileSync(join(out,name)))]));
const manifest={schema:'bithash.supervised-worker-package.v1',workload:'fixed-synthetic-known-answer',files,
  originalArchiveSha256:sha(readFileSync(archive)),upstreamCommit:'6bf8059ef075eb1622298395866b0bd02375e1d9',
  cudaTargets:['sm_86','sm_89','compute_89 PTX'],puzzle71Enabled:false};
const bytes=JSON.stringify(manifest,null,2)+'\n';writeFileSync(join(out,'manifest.json'),bytes);
chmodSync(join(out,'bithash-benchmark'),0o755);
// Write deterministic POSIX tar metadata even when packaging on Windows, whose
// native tar would otherwise discard the Linux executable bit.
const chunks=[];
for(const name of [...names,'manifest.json']){
 const data=readFileSync(join(out,name)),header=Buffer.alloc(512);
 header.write(name,0,100,'utf8');
 const octal=(value,offset,size)=>header.write(value.toString(8).padStart(size-1,'0')+'\0',offset,size,'ascii');
 octal(name==='bithash-benchmark'?0o755:0o644,100,8);octal(0,108,8);octal(0,116,8);
 octal(data.length,124,12);octal(0,136,12);header.fill(32,148,156);
 header.write('0',156);header.write('ustar\0',257,6);header.write('00',263,2);
 const checksum=header.reduce((sum,b)=>sum+b,0);header.write(checksum.toString(8).padStart(6,'0')+'\0 ',148,8,'ascii');
 chunks.push(header,data,Buffer.alloc((512-data.length%512)%512));
}
chunks.push(Buffer.alloc(1024));writeFileSync(out+'.tar.gz',gzipSync(Buffer.concat(chunks),{level:9}));
console.log(JSON.stringify({build:'sha256:'+sha(bytes),archiveSha256:sha(readFileSync(out+'.tar.gz')),files:names.length},null,2));

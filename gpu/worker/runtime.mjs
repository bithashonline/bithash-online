import {readFileSync,lstatSync,mkdirSync,openSync,closeSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {models} from './core.mjs';
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const bundleFiles=['bithash-benchmark','vectors.json','lib/libcudart.so.12','BITCRACK-LICENSE.MIT','CUDA-LICENSE',
  'worker.mjs','core.mjs','runtime.mjs','README.md','gpu-telemetry.js','collector-client.js','package.json'].sort();
export function validateConfig(c,now=Date.now()){
 const fields=['origin','caFile','keyFile','lease','expiresAt','build','gpu','durationSeconds','stateDir'];
 if(c && Object.hasOwn(c,'sustainSeconds')) {
  fields.push('sustainSeconds');
  if(c.sustainSeconds!==300 || c.durationSeconds<390)throw Error('invalid_sustained_runtime');
 }
 if(!c||Object.keys(c).sort().join()!==fields.sort().join()||typeof c.lease!=='string'||!/^[a-f0-9]{32}$/.test(c.lease)||
   !Object.hasOwn(models,c.gpu)||!Number.isInteger(c.durationSeconds)||c.durationSeconds<1||c.durationSeconds>900||
   !Number.isSafeInteger(c.expiresAt)||c.expiresAt<=now||c.expiresAt-now>86400000||
   typeof c.build!=='string'||!/^sha256:[a-f0-9]{64}$/.test(c.build))throw Error('invalid_config');
 const origin=new URL(c.origin);
 if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw Error('invalid_origin');
 for(const name of ['caFile','keyFile','stateDir'])if(typeof c[name]!=='string'||resolve(c[name])!==c[name])throw Error('absolute_paths_required');
 return c;
}
export function verifyBundle(root,build){
 const bytes=readFileSync(join(root,'manifest.json'));
 if(build!=='sha256:'+sha(bytes))throw Error('build_mismatch');
 const m=JSON.parse(bytes);
 if(m.schema!=='bithash.supervised-worker-package.v1'||!m.files||Object.keys(m.files).sort().join()!==bundleFiles.join())throw Error('manifest_schema');
 for(const name of bundleFiles)if(!lstatSync(join(root,name)).isFile()||sha(readFileSync(join(root,name)))!==m.files[name])throw Error('package_mismatch');
 return m;
}
export function claimLease(stateDir,lease){
 if(!/^[a-f0-9]{32}$/.test(lease))throw Error('invalid_lease');
 mkdirSync(stateDir,{recursive:true,mode:0o700});
 if(!lstatSync(stateDir).isDirectory()||(process.platform!=='win32'&&(lstatSync(stateDir).mode&0o077)))throw Error('private_state_required');
 closeSync(openSync(join(stateDir,lease+'.started'),'wx',0o600));
 const state=join(stateDir,lease);mkdirSync(state,{mode:0o700});return state;
}

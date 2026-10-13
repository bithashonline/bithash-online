import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {controllerCredential} from './credential.mjs';

test('service credential is private file input; ambiguous/missing input fails without exposing content',()=>{
 const dir=mkdtempSync(join(tmpdir(),'bithash-cred-'));
 try{
  writeFileSync(join(dir,'runpod-key'),'fixture-secret\n');
  assert.equal(controllerCredential({CREDENTIALS_DIRECTORY:dir}),'fixture-secret');
  assert.throws(()=>controllerCredential({CREDENTIALS_DIRECTORY:dir,BITHASH_RUNPOD_CONTROLLER_KEY:'other'}),/ambiguous/);
  writeFileSync(join(dir,'runpod-key'),'sensitive invalid value');
  assert.throws(()=>controllerCredential({CREDENTIALS_DIRECTORY:dir}),/^Error: controller_credential_file_unavailable$/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('serve remains alive across empty-ledger polls and restart retains the database',{timeout:15000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'bithash-service-'));
 const env={...process.env,BITHASH_RUNPOD_CONTROLLER_KEY:'fixture-never-sent'};
 delete env.CREDENTIALS_DIRECTORY;delete env.RUNPOD_POD_ID;
 const args=['--experimental-sqlite',fileURLToPath(new URL('./cli.mjs',import.meta.url)),'serve',join(dir,'state.sqlite')];
 async function observe(polls){
  const child=spawn(process.execPath,args,{env,stdio:['ignore','pipe','pipe']});
  let output='',errors='';child.stderr.on('data',c=>errors+=c);
  try{await new Promise((resolve,reject)=>{
   child.once('error',reject);child.once('exit',()=>reject(Error('unexpected_exit')));
   child.stdout.on('data',c=>{output+=c;if(output.trim().split('\n').length>=polls)resolve();});
  });assert.equal(output.includes('fixture-never-sent'),false);assert.equal(errors.includes('fixture-never-sent'),false);
  const rows=output.trim().split('\n').map(JSON.parse);assert(rows.every(r=>r.permitsNewRental===false&&r.pods.length===0&&r.observedAt));
  }finally{child.kill('SIGKILL');await new Promise(r=>child.once('close',r));}
 }
 try{await observe(2);await observe(1);}finally{rmSync(dir,{recursive:true,force:true});}
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {GoogleOwner} from './google-owner.js';
import {loadGoogleOwnerConfig} from './google-owner-config.js';
const clientId='test.apps.googleusercontent.com';
const payload={sub:'123',aud:clientId,iss:'https://accounts.google.com',email_verified:true,email:'owner@gmail.com',exp:9999999999};
test('enrollment rejects wrong email, signature failure and bad claims without persistence',async()=>{
 for(const change of [{email:'other@gmail.com'},{email_verified:false},{aud:'wrong'},{sub:'invalid'},{iss:'wrong'},{exp:1}]){
  let writes=0;const a=new GoogleOwner({clientId,enrollmentEmail:'owner@gmail.com',persistOwner:()=>writes++,verifyToken:async()=>({...payload,...change})});
  await assert.rejects(a.login('test'));assert.equal(writes,0);assert.equal(a.sessions.size,0);
 }
 const a=new GoogleOwner({clientId,enrollmentEmail:'owner@gmail.com',persistOwner:()=>{throw Error('must not write')},verifyToken:async()=>{throw Error('invalid signature')}});await assert.rejects(a.login('test'));assert.equal(a.sessions.size,0);
});
test('persisted identity survives restart and cannot be rebound by same email',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bithash-owner-'));const file=path.join(dir,'setup.json');
 try{
 fs.writeFileSync(file,JSON.stringify({googleClientId:clientId,intendedOwnerEmail:'owner@gmail.com'}));
 const config=loadGoogleOwnerConfig(file);const a=new GoogleOwner({...config,verifyToken:async()=>payload});
 assert.equal(a.enrollmentReady,true);await a.login('test');assert.equal(a.configured,true);assert.equal(a.enrollmentReady,false);
 const restored=loadGoogleOwnerConfig(file);assert.equal(restored.ownerSub,'123');assert.equal(restored.enrollmentEmail,undefined);
 assert.throws(()=>config.persistOwner({clientId,sub:'456'}));
 const b=new GoogleOwner({...restored,verifyToken:async()=>({...payload,sub:'456'})});await assert.rejects(b.login('test'));
 fs.writeFileSync(file+'.identity.json','broken');assert.throws(()=>loadGoogleOwnerConfig(file));
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('storage failure creates no session or in-memory owner',async()=>{
 const a=new GoogleOwner({clientId,enrollmentEmail:'owner@gmail.com',persistOwner:()=>{throw Error('disk failure')},verifyToken:async()=>payload});
 await assert.rejects(a.login('test'));assert.equal(a.ownerSub,undefined);assert.equal(a.sessions.size,0);
});

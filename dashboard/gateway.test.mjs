import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pbkdf2Sync,randomBytes} from 'node:crypto';
import worker from './dist/server/index.js';
const password='fixture-access-only',salt=randomBytes(16).toString('hex');
const env={BITHASH_PASSWORD_VERIFIER:JSON.stringify({salt,iterations:100000,hash:pbkdf2Sync(password,Buffer.from(salt,'hex'),100000,32,'sha256').toString('hex')}),BITHASH_SESSION_SECRET:randomBytes(32).toString('hex')};
const origin='https://bithash.online';let address=0;
const req=(path='/',options={})=>new Request(origin+path,options);
function login(value=password,patch={}){return worker.fetch(req('/_gate/login',{method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded','cf-connecting-ip':'fixture-'+(++address),...patch},body:new URLSearchParams({password:value})}),env);}
test('anonymous root shows themed gate and protected assets/API reject direct access',async()=>{
 const page=await worker.fetch(req(),env),html=await page.text();assert.equal(page.status,200);assert(html.includes('Enter the dashboard'));assert(!html.includes('You set the limits.'));assert(!html.includes(password));
 for(const path of ['/index.html','/app.mjs','/controls.css','/rig.png','/api/approvals','/api/gpu-progress']){
  const r=await worker.fetch(req(path),env);assert.equal(r.status,401);assert(!String(await r.text()).includes('You set the limits.'));
 }
});
test('valid password yields secure signed cookie; dashboard unlocks without owner privileges',async()=>{
 const r=await login();assert.equal(r.status,303);const cookie=r.headers.get('set-cookie');
 for(const flag of ['Secure','HttpOnly','SameSite=Strict','Path=/'])assert(cookie.includes(flag));
 const headers={cookie:cookie.split(';')[0]};
 const page=await worker.fetch(req('/',{headers}),env);assert.equal(page.status,200);const html=await page.text();assert(html.includes('You set the limits.'));assert(html.includes('SHARED PREVIEW'));
 const asset=await worker.fetch(req('/controls.css',{headers}),env);assert.equal(asset.status,200);assert(asset.headers.get('cache-control').includes('no-store'));
 const owner=await worker.fetch(req('/api/approvals/approve',{method:'POST',headers}),env);assert.equal(owner.status,503);
 const status=await worker.fetch(req('/api/auth/status',{headers}),env);assert.equal((await status.json()).authenticated,false);
});
test('bad password, cross-site login, oversize body and forged cookies fail closed',async()=>{
 assert.equal((await login('wrong')).status,401);assert.equal((await login(password,{origin:'https://evil.invalid'})).status,403);
 const big=await login('x'.repeat(3000));assert.equal(big.status,413);
 const good=await login(),cookie=good.headers.get('set-cookie').split(';')[0];
 const changed=cookie.slice(0,-1)+(cookie.endsWith('a')?'b':'a');assert.equal((await worker.fetch(req('/index.html',{headers:{cookie:changed}}),env)).status,401);
 const other=new Request('https://other.invalid/index.html',{headers:{cookie}});assert.equal((await worker.fetch(other,env)).status,401);
});
test('cookie expiration and secret rotation invalidate the session',async()=>{
 const good=await login(),cookie=good.headers.get('set-cookie').split(';')[0];
 assert.equal((await worker.fetch(req('/index.html',{headers:{cookie}}),{...env,BITHASH_SESSION_SECRET:'c'.repeat(64)})).status,401);
 const expiry=cookie.replace(/=\d{10}\./,'=1000000000.');assert.equal((await worker.fetch(req('/index.html',{headers:{cookie:expiry}}),env)).status,401);
});
test('attempt throttling, missing secrets and logout remain restrictive',async()=>{
 for(let i=0;i<8;i++)assert.equal((await login('wrong',{'cf-connecting-ip':'rate-test'})).status,401);
 assert.equal((await login(password,{'cf-connecting-ip':'rate-test'})).status,429);
 assert.equal((await worker.fetch(req(),{})).status,503);
 assert.equal((await worker.fetch(req('/_gate/logout',{method:'POST',headers:{origin:'https://evil.invalid'}}),env)).status,403);
 const logout=await worker.fetch(req('/_gate/logout',{method:'POST',headers:{origin}}),env);assert.equal(logout.status,303);assert(logout.headers.get('set-cookie').includes('Max-Age=0'));
});

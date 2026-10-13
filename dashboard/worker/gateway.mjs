const ASSETS = /*ASSETS*/ {};
/*TELEMETRY*/
const GATE = /*GATE*/ '';
const encoder=new TextEncoder(), attempts=new Map();
const COOKIE='__Host-bithash_access', LIFE=12*60*60;
const hex=a=>Array.from(new Uint8Array(a),b=>b.toString(16).padStart(2,'0')).join('');
const unhex=s=>Uint8Array.from(s.match(/../g)??[],b=>parseInt(b,16));
const equal=(a,b)=>{if(a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0;};
const security={'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'same-origin','X-Robots-Tag':'noindex, nofollow','Content-Security-Policy':"default-src 'self'; script-src 'self' https://accounts.google.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-src https://accounts.google.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};
function response(body,status=200,headers={}){return new Response(body,{status,headers:{...security,...headers}});}
function gate(error='',status=200){return response(GATE.replace('{{ERROR}}',error),status,{'Content-Type':'text/html; charset=utf-8'});}
function config(env){
 try{const v=JSON.parse(env.BITHASH_PASSWORD_VERIFIER);
  if(v.iterations!==100000||! /^[a-f0-9]{32}$/.test(v.salt)||! /^[a-f0-9]{64}$/.test(v.hash)||typeof env.BITHASH_SESSION_SECRET!=='string'||env.BITHASH_SESSION_SECRET.length<64) return null;
  return v;
 }catch{return null;}
}
async function hmac(env,text){const k=await crypto.subtle.importKey('raw',encoder.encode(env.BITHASH_SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);return hex(await crypto.subtle.sign('HMAC',k,encoder.encode(text)));}
async function passwordOK(password,v){const k=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:unhex(v.salt),iterations:v.iterations,hash:'SHA-256'},k,256);return equal(hex(bits),v.hash);}
async function authorized(request,env,v){
 const token=(request.headers.get('cookie')??'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1)??'';
 if(!/^\d{10}\.[a-f0-9]{32}\.[a-f0-9]{64}$/.test(token))return false;
 const [expiry,nonce,signature]=token.split('.'),now=Math.floor(Date.now()/1000);
 if(Number(expiry)<=now||Number(expiry)>now+LIFE)return false;
 const expected=await hmac(env,`${new URL(request.url).host}.${expiry}.${nonce}.${v.hash}`);return equal(signature,expected);
}
async function readBody(request){
 if(Number(request.headers.get('content-length')??0)>2048)throw Error('too_large');
 const reader=request.body?.getReader();if(!reader)return '';
 let result='',bytes=0;const decoder=new TextDecoder();
 for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>2048){await reader.cancel();throw Error('too_large');}result+=decoder.decode(value,{stream:true});}
 return result+decoder.decode();
}
function rateLimited(ip){
 const now=Date.now();for(const [key,value]of attempts)if(now-value.start>=900000)attempts.delete(key);
 if(!attempts.has(ip)){if(attempts.size>=10000)return true;attempts.set(ip,{start:now,count:0});}
 const entry=attempts.get(ip);entry.count++;return entry.count>8;
}
export default {async fetch(request,env){
 try{
  const url=new URL(request.url),v=config(env);
  if(!v)return gate('Preview access is temporarily unavailable.',503);
  if(url.pathname==='/robots.txt')return response('User-agent: *\nDisallow: /\n',200,{'Content-Type':'text/plain'});
  if(url.pathname==='/_gate/login'){
   if(request.method!=='POST')return response('Method not allowed',405,{'Allow':'POST'});
   if(request.headers.get('origin')!==url.origin)return gate('Please submit from this website.',403);
   if(!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))return gate('Invalid submission.',415);
   const ip=request.headers.get('cf-connecting-ip')??'unidentified';
   if(rateLimited(ip))return gate('Too many attempts. Please try again in 15 minutes.',429);
   let form;try{form=new URLSearchParams(await readBody(request));}catch{return gate('Invalid submission.',413);}
   const password=form.get('password');if(!password||password.length>128||form.getAll('password').length!==1||!await passwordOK(password,v))return gate('That password didn’t match. Try again.',401);
   attempts.delete(ip);
   const expiry=Math.floor(Date.now()/1000)+LIFE,nonce=hex(crypto.getRandomValues(new Uint8Array(16)));
   const signature=await hmac(env,`${url.host}.${expiry}.${nonce}.${v.hash}`);
   return response(null,303,{'Location':'/','Set-Cookie':`${COOKIE}=${expiry}.${nonce}.${signature}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${LIFE}`});
  }
  if(url.pathname==='/_gate/logout'){
   if(request.method!=='POST'||request.headers.get('origin')!==url.origin)return response('Forbidden',403);
   return response(null,303,{'Location':'/','Set-Cookie':`${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`});
  }
  if(!await authorized(request,env,v))return request.method==='GET'&&url.pathname==='/'?gate():response('{"error":"preview_password_required"}',401,{'Content-Type':'application/json'});
  // Shared preview access never grants owner authorization. No private local
  // database, session, provider credential or admin API is deployed here.
  if(url.pathname.startsWith('/api/')){
   const progress=await telemetry(request,env);if(progress)return progress;
   if(url.pathname==='/api/auth/status'&&request.method==='GET')return response('{"configured":false,"authenticated":false,"hostedPreview":true}',200,{'Content-Type':'application/json'});
   return response('{"error":"local_backend_not_connected","liveExecutionEnabled":false}',503,{'Content-Type':'application/json'});
  }
  if(!['GET','HEAD'].includes(request.method))return response('Method not allowed',405);
  const path=url.pathname==='/'?'/index.html':url.pathname,a=Object.hasOwn(ASSETS,path)?ASSETS[path]:null;
  if(!a)return response('Not found',404);
  const bytes=Uint8Array.from(atob(a.data),c=>c.charCodeAt(0));
  return response(request.method==='HEAD'?null:bytes,200,{'Content-Type':a.type});
 }catch{return response('Preview temporarily unavailable',503);}
}};


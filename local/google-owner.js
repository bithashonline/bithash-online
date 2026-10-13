import {OAuth2Client} from 'google-auth-library';
import {randomBytes} from 'node:crypto';
export class GoogleOwner {
 constructor({clientId,ownerSub,enrollmentEmail,persistOwner,verifyToken,now=()=>Date.now()}={}){this.clientId=clientId;this.ownerSub=ownerSub;this.enrollmentEmail=enrollmentEmail;this.persistOwner=persistOwner;this.now=now;this.sessions=new Map();this.client=new OAuth2Client();this.verifyToken=verifyToken??(async token=>(await this.client.verifyIdToken({idToken:token,audience:clientId})).getPayload());}
 get configured(){return Boolean(this.clientId&&/^\d{1,255}$/.test(this.ownerSub??''))}
 get enrollmentReady(){return Boolean(this.clientId&&!this.ownerSub&&/^[^@\s]+@gmail\.com$/.test(this.enrollmentEmail??'')&&typeof this.persistOwner==='function')}
 prune(){for(const [id,s] of this.sessions)if(s.expires<=this.now())this.sessions.delete(id)}
 async login(token){
  if((!this.configured&&!this.enrollmentReady)||typeof token!=='string'||token.length>12000)throw Error('login_rejected');
  const p=await this.verifyToken(token);
  if(!p||!/^\d{1,255}$/.test(p.sub??'')||p.aud!==this.clientId||!['accounts.google.com','https://accounts.google.com'].includes(p.iss)||p.email_verified!==true||!Number.isFinite(p.exp)||p.exp*1000<=this.now())throw Error('login_rejected');
  if(!this.ownerSub){
   if(!this.enrollmentReady||p.email!==this.enrollmentEmail)throw Error('login_rejected');
   // Persist before granting any session; the callback must refuse overwrites.
   await this.persistOwner({sub:p.sub,clientId:this.clientId});
   this.ownerSub=p.sub;this.enrollmentEmail=null;
  }
  if(p.sub!==this.ownerSub)throw Error('login_rejected');
  this.prune();if(this.sessions.size>=20)this.sessions.delete(this.sessions.keys().next().value);const id=randomBytes(32).toString('hex'),session={csrf:randomBytes(32).toString('hex'),expires:Math.min(p.exp*1000,this.now()+30*60*1000),actor:'google-owner'};this.sessions.set(id,session);return {id,...session}
 }
 session(req){this.prune();const id=(req.headers.cookie??'').split(';').map(s=>s.trim()).find(s=>s.startsWith('bithash_owner='))?.slice(14);return {id,value:this.sessions.get(id)}}
 authorize(req){const {value}=this.session(req);if(!value||req.headers['x-csrf-token']!==value.csrf)throw Error('owner_required');return value}
}
export async function handleGoogleAuth(req,res,{auth,origin}){
 const route=new URL(req.url,origin).pathname;if(!route.startsWith('/api/auth/'))return false;
 const send=(code,data,cookie)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store',...(cookie?{'Set-Cookie':cookie}:{})});res.end(JSON.stringify(data));return true};
 const cookie=v=>`bithash_owner=${v}; HttpOnly; SameSite=Strict; Path=/; ${v?'Max-Age=1800':'Max-Age=0'}${origin.startsWith('https:')?'; Secure':''}`;
 if(req.method==='GET'&&route==='/api/auth/status'){const s=auth.session(req).value;return send(200,{configured:auth.configured||auth.enrollmentReady,enrollment:auth.enrollmentReady,clientId:auth.configured||auth.enrollmentReady?auth.clientId:null,authenticated:Boolean(s),csrf:s?.csrf??null})}
 if(req.method!=='POST'||req.headers.origin!==origin||!req.headers['content-type']?.startsWith('application/json'))return send(403,{error:'request_rejected'});
 try{
  if(route==='/api/auth/logout'){auth.authorize(req);auth.sessions.delete(auth.session(req).id);return send(200,{signedOut:true},cookie(''))}
  if(route!=='/api/auth/login')return send(404,{error:'not_found'});
  let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>14000)return send(413,{error:'too_large'})}
  const v=JSON.parse(body);if(Object.keys(v).join()!=='credential')throw Error();const s=await auth.login(v.credential);const old=auth.session(req).id;if(old)auth.sessions.delete(old);return send(200,{authenticated:true,csrf:s.csrf},cookie(s.id));
 }catch{return send(401,{error:'owner_login_rejected'})}
}

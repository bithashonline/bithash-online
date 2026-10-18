import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,chmod,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRemoteJWKSet,jwtVerify} from 'jose';

export const ISSUER='https://auth.openai.com';
export const RESOURCE='https://api.openai.com/v1';
export const SCOPES='openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const jwks=createRemoteJWKSet(new URL(ISSUER+'/.well-known/jwks.json'),{timeoutDuration:10000});
const random=()=>randomBytes(32).toString('base64url');
export function authorization(hostId,redirectUri,account=null,now=Date.now()){
 const callback=new URL(redirectUri);
 if(callback.protocol!=='http:'||callback.hostname!=='127.0.0.1'||callback.pathname!=='/auth/callback'||callback.search||callback.hash)throw Error('invalid_callback');
 const pending={state:random(),nonce:random(),verifier:random(),redirectUri,expiresAt:now+600000,account};
 const params={client_id:account?.client_id??'dynamic_agent_client',ext_agent_host_id:hostId,response_type:'code',redirect_uri:redirectUri,scope:SCOPES,resource:RESOURCE,state:pending.state,nonce:pending.nonce,code_challenge_method:'S256',code_challenge:createHash('sha256').update(pending.verifier).digest('base64url')};
 if(!account)params.agent_name_hint='BitHash Operator';
 // Login hints are deliberately omitted, so no ID token enters a browser URL.
 return {pending,url:ISSUER+'/api/accounts/authorize?'+new URLSearchParams(params)};
}
export function validateCallback(url,pending,now=Date.now()){
 if(!pending||pending.expiresAt<=now||url.searchParams.getAll('state').length!==1||url.searchParams.get('state')!==pending.state)throw Error('invalid_signin_state');
 if(url.searchParams.has('error'))throw Error('signin_declined');
 if(url.searchParams.getAll('code').length!==1||!url.searchParams.get('code'))throw Error('invalid_callback');
 const client=url.searchParams.get('client_id')??pending.account?.client_id;
 if(!client||client==='dynamic_agent_client'||!/^oaiapp_[A-Za-z0-9_-]+$/.test(client)||url.searchParams.getAll('client_id').length>1||(pending.account&&client!==pending.account.client_id))throw Error('client_mismatch');
 return {client,code:url.searchParams.get('code')};
}
export async function verifyIdentity(token,client,nonce,subject,keys=jwks){
 const {payload}=await jwtVerify(token,keys,{issuer:ISSUER,audience:client,requiredClaims:['sub','exp','iat'],clockTolerance:5,algorithms:['RS256','ES256']});
 if(typeof payload.sub!=='string'||!payload.sub||(nonce!==undefined&&payload.nonce!==nonce)||(subject&&payload.sub!==subject))throw Error('identity_mismatch');
 return {subject:payload.sub,email:typeof payload.email==='string'?payload.email:null};
}
export async function tokenRequest(params,fetchImpl=fetch){
 const r=await fetchImpl(ISSUER+'/api/accounts/oauth/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...params,resource:RESOURCE})});
 if(!r.ok)throw Error('signin_required');
 const t=await r.json();
 if(typeof t.access_token!=='string'||!t.access_token||t.token_type?.toLowerCase()!=='bearer'||!Number.isFinite(t.expires_in)||t.expires_in<=0)throw Error('invalid_token_response');
 return t;
}
export function tokenRecord(t,previous={}){
 const scopes=typeof t.scope==='string'?t.scope.split(/\s+/):previous.scopes??[];
 return {...previous,access_token:t.access_token,refresh_token:t.refresh_token??previous.refresh_token,id_token:t.id_token??previous.id_token,scopes,expiresAt:Date.now()+t.expires_in*1000};
}
export function hasPlan(account){return !!account?.access_token&&account.scopes?.includes('chatgpt.tokens.use.direct')&&account.scopes.includes('resource.invoke');}

// This store belongs to one local process. No credentials enter a web response.
export async function openStore(directory){
 const dir=resolve(directory);await mkdir(dir,{recursive:true,mode:0o700});
 if(process.platform==='win32'){
  const sid=execFileSync(process.env.BITHASH_POWERSHELL_PATH??'pwsh.exe',['-NoProfile','-NonInteractive','-Command','[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value'],{encoding:'utf8',windowsHide:true,timeout:30000}).trim();
  if(!/^S-1-[0-9-]+$/.test(sid))throw Error('storage_permissions_failed');
  execFileSync('icacls.exe',[dir,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`],{stdio:'pipe',windowsHide:true});
 }else await chmod(dir,0o700);
 const lock=join(dir,'runtime.lock');
 try{await writeFile(lock,String(process.pid),{flag:'wx',mode:0o600});}
 catch(e){
  if(e.code!=='EEXIST')throw e;
  const pid=Number(await readFile(lock,'utf8'));if(!Number.isSafeInteger(pid)||pid<1)throw Error('storage_locked');
  try{process.kill(pid,0);throw Error('storage_locked');}catch(err){if(err.code!=='ESRCH')throw err;}
  await unlink(lock);await writeFile(lock,String(process.pid),{flag:'wx',mode:0o600});
 }
 const file=join(dir,'chatgpt.json');let state;
 try{state=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;state={hostId:'urn:uuid:'+randomUUID(),accounts:[],active:null};}
 if(!/^urn:uuid:[a-f0-9-]{36}$/.test(state.hostId)||!Array.isArray(state.accounts))throw Error('invalid_local_state');
 const save=async()=>{const temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(state),{mode:0o600,flag:'wx'});await rename(temp,file);};
 await save();let refreshing=null;
 return {state,save,close:()=>unlink(lock),async access(){
  const a=state.accounts.find(a=>a.client_id===state.active);if(!hasPlan(a))throw Error('chatgpt_plan_not_connected');
  if(a.expiresAt>Date.now()+60000)return a.access_token;
  if(!refreshing)refreshing=(async()=>{
   if(!a.refresh_token)throw Error('signin_required');
   const t=await tokenRequest({grant_type:'refresh_token',client_id:a.client_id,refresh_token:a.refresh_token});
   if(t.id_token)await verifyIdentity(t.id_token,a.client_id,undefined,a.subject);
   Object.assign(a,tokenRecord(t,a));await save();if(!hasPlan(a))throw Error('plan_permission_missing');return a.access_token;
  })().finally(()=>{refreshing=null;});
  return refreshing;
 }};
}

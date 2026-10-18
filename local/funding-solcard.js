import {randomBytes,timingSafeEqual} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {auth} from '@modelcontextprotocol/sdk/client/auth.js';

export const SOLCARD_SCOPES='cards:read activity:read invoices:read perma:read';
const ENDPOINT='https://app.solcard.cc/mcp',CALLBACK='http://127.0.0.1:4185/funding/solcard/callback';
const READ_TOOLS=new Set(['get_card','get_card_activity','list_deposits','get_perma_addresses','get_invoice']);
const scopesOK=s=>typeof s==='string'&&s.split(/\s+/).length===4&&SOLCARD_SCOPES.split(' ').every(x=>s.split(/\s+/).includes(x));
export function validateSolcardAuthorization(url){const u=new URL(url);if(u.origin!=='https://api.solcard.cc'||u.pathname!=='/oauth/authorize'||u.username||u.password||u.searchParams.get('redirect_uri')!==CALLBACK||!scopesOK(u.searchParams.get('scope'))||u.searchParams.get('code_challenge_method')!=='S256'||!u.searchParams.get('state'))throw Error('solcard_authorization_rejected');return u.toString();}
export function validateSolcardCallback(url,pending,now){
 const u=new URL(url),actual=u.searchParams.get('state')??'';
 if(!pending||now-pending.at>600000||now<pending.at||u.origin!=='http://127.0.0.1:4185'||u.pathname!=='/funding/solcard/callback'||u.searchParams.getAll('state').length!==1||Buffer.byteLength(actual)!==Buffer.byteLength(pending.state)||!timingSafeEqual(Buffer.from(actual),Buffer.from(pending.state)))throw Error('invalid_solcard_callback');
 if(u.searchParams.has('error'))throw Error('solcard_consent_declined');
 if(u.searchParams.getAll('code').length!==1||!u.searchParams.get('code')||u.searchParams.get('code').length>4096)throw Error('invalid_solcard_callback');return u.searchParams.get('code');
}
export async function solcardFetch(input,init={}){
 const u=new URL(typeof input==='string'||input instanceof URL?input:input.url),method=init.method??'GET';
 const discovery=u.origin==='https://app.solcard.cc'&&u.pathname.startsWith('/.well-known/oauth-')&&method==='GET';
 const oauth=u.origin==='https://api.solcard.cc'&&['/v1/oauth/token','/v1/oauth/register'].includes(u.pathname)&&method==='POST';
 const mcp=u.href===ENDPOINT&&['POST','GET'].includes(method);
 if(u.username||u.password||(!discovery&&!oauth&&!mcp))throw Error('solcard_endpoint_rejected');
 if(mcp&&method==='POST'){
  const b=JSON.parse(init.body);if(b.method==='tools/call'&&!READ_TOOLS.has(b.params?.name))throw Error('solcard_write_forbidden');
  if(!['initialize','notifications/initialized','tools/call','ping'].includes(b.method))throw Error('solcard_method_forbidden');
 }
 const signal=init.signal?AbortSignal.any([init.signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000);
 return fetch(input,{...init,signal,redirect:'error'});
}
function unwrap(result){if(result.isError)throw Error('solcard_read_failed');if(result.structuredContent)return result.structuredContent;const text=result.content?.find(x=>x.type==='text')?.text;if(!text||text.length>2097152)throw Error('solcard_invalid_response');return JSON.parse(text);}

export class SolcardFundingConnection{
 #store;#data;#clock;#authorize;#pending=null;#pendingCredentials=null;#url=null;#busy=false;#provider;
 constructor(store,{clock=Date.now,authorize=auth}={}){this.#store=store;this.#clock=clock;this.#authorize=authorize;
  this.#provider={redirectUrl:CALLBACK,clientMetadata:{client_name:'BitHash Operator funding records (read only)',application_type:'native',redirect_uris:[CALLBACK],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none',scope:SOLCARD_SCOPES},
   state:()=>{if(!this.#pending)throw Error('solcard_authorization_required');return this.#pending.state;},
   clientInformation:()=>this.#data.client,
   saveClientInformation:async client=>{if(client.scope&&!scopesOK(client.scope))throw Error('solcard_scope_rejected');this.#data.client=client;await this.#save();},
   tokens:()=>this.#data.tokens,
   saveTokens:async tokens=>{if(tokens.scope&&!scopesOK(tokens.scope))throw Error('solcard_scope_rejected');this.#pendingCredentials={data:{...this.#data,tokens,expiresAt:this.#clock()+Math.max(0,Number(tokens.expires_in??300))*1000},at:this.#clock()};await this.retryCredentialSave();},
   redirectToAuthorization:url=>{if(!this.#pending)throw Error('solcard_authorization_required');this.#url=validateSolcardAuthorization(url);},
   saveCodeVerifier:verifier=>{if(!this.#pending)throw Error('solcard_authorization_required');this.#pending.verifier=verifier;},
   codeVerifier:()=>{if(!this.#pending?.verifier)throw Error('invalid_solcard_callback');return this.#pending.verifier;},
   invalidateCredentials:async scope=>{if(scope==='all'||scope==='client')delete this.#data.client;if(scope==='all'||scope==='tokens'){delete this.#data.tokens;delete this.#data.expiresAt;}await this.#save();}
  };
 }
 async initialize(){this.#data=await this.#store.load();return this;}
 async #save(){await this.#store.save(this.#data);}
 status(){return {authorized:!!this.#data?.tokens&&!this.#pendingCredentials,credentialSavePending:!!this.#pendingCredentials,consentPending:!!this.#pending,scopes:SOLCARD_SCOPES,readOnly:true};}
 async retryCredentialSave(){
  const pending=this.#pendingCredentials;if(!pending)return;
  if(this.#clock()-pending.at>900000||this.#clock()<pending.at){this.#pendingCredentials=null;throw Error('solcard_credential_save_expired');}
  // Retry only local encrypted persistence of this process's normal OAuth response.
  // Never repeat the authorization-code exchange or use tokens before this succeeds.
  await this.#store.save(pending.data);this.#data=pending.data;this.#pendingCredentials=null;
 }
 async begin(){if(this.#busy)throw Error('solcard_read_busy');this.#busy=true;
  try{if(this.#pendingCredentials)throw Error('solcard_credential_save_pending');this.#pending={state:randomBytes(32).toString('hex'),at:this.#clock()};this.#url=null;
   // Re-consent must not silently refresh the previous grant instead.
   delete this.#data.tokens;delete this.#data.expiresAt;await this.#save();
   await this.#authorize(this.#provider,{serverUrl:ENDPOINT,scope:SOLCARD_SCOPES,fetchFn:solcardFetch});if(!this.#url)throw Error('solcard_authorization_unavailable');return this.#url;
  }finally{this.#busy=false;}
 }
 async finish(url){if(this.#busy)throw Error('solcard_read_busy');const code=validateSolcardCallback(url,this.#pending,this.#clock());this.#busy=true;
  try{const result=await this.#authorize(this.#provider,{serverUrl:ENDPOINT,authorizationCode:code,scope:SOLCARD_SCOPES,fetchFn:solcardFetch});if(result!=='AUTHORIZED')throw Error('solcard_authorization_required');}
  finally{this.#pending=null;this.#url=null;this.#busy=false;}
 }
 async read(){if(this.#busy)throw Error('solcard_read_busy');this.#busy=true;
  let client;
  try{
   await this.retryCredentialSave();if(!this.#data?.tokens)throw Error('solcard_authorization_required');
   if(this.#clock()>=this.#data.expiresAt-30000){const result=await this.#authorize(this.#provider,{serverUrl:ENDPOINT,scope:SOLCARD_SCOPES,fetchFn:solcardFetch});if(result!=='AUTHORIZED')throw Error('solcard_authorization_required');}
   client=new Client({name:'bithash-funding-records',version:'1.0.0'},{capabilities:{}});
   const transport=new StreamableHTTPClientTransport(new URL(ENDPOINT),{requestInit:{headers:{Authorization:'Bearer '+this.#data.tokens.access_token}},fetch:solcardFetch,reconnectionOptions:{maxRetries:0,initialReconnectionDelay:1000,maxReconnectionDelay:1000,reconnectionDelayGrowFactor:1}});
   await client.connect(transport);
   const call=async(name,args)=>unwrap(await client.callTool({name,arguments:args},undefined,{timeout:12000}));
   const card=await call('get_card',{slotNumber:1}),addresses=await call('get_perma_addresses',{slotNumber:1});
   const activity=await call('get_card_activity',{slotNumber:1,limit:100});
   const deposits=await call('list_deposits',{limit:100,page:1});
   return {observedAt:new Date(this.#clock()).toISOString(),card,addresses,activity,deposits};
  }catch(e){if(e?.code===401)this.#data.expiresAt=0;throw Error(/^[a-z_]{1,80}$/.test(e.message)?e.message:'solcard_read_failed');}
  finally{await client?.close().catch(()=>{});this.#busy=false;}
 }
}

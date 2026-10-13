import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,SignJWT,createLocalJWKSet,exportJWK} from 'jose';
import {authorization,validateCallback,verifyIdentity,hasPlan,tokenRecord} from './chatgpt-auth.js';
import {fleetEvidence,completedResponse,planOperator} from './chatgpt-operator.js';
const host='urn:uuid:00000000-0000-4000-8000-000000000000';
test('registration uses fresh PKCE, nonce and stable host; returning account reuses client',()=>{
 const a=authorization(host,'http://127.0.0.1:4185/auth/callback'),b=authorization(host,'http://127.0.0.1:4185/auth/callback');
 assert.notEqual(a.pending.state,b.pending.state);assert.notEqual(a.pending.nonce,b.pending.nonce);const u=new URL(a.url);assert.equal(u.searchParams.get('client_id'),'dynamic_agent_client');assert.equal(u.searchParams.get('ext_agent_host_id'),host);assert.equal(u.searchParams.get('code_challenge_method'),'S256');assert.ok(!a.url.includes(a.pending.verifier));
 const r=new URL(authorization(host,'http://127.0.0.1:4185/auth/callback',{client_id:'oaiapp_saved',id_token:'never-in-url'}).url);assert.equal(r.searchParams.get('client_id'),'oaiapp_saved');assert.equal(r.searchParams.has('agent_name_hint'),false);assert.equal(r.searchParams.has('id_token_hint'),false);
 assert.throws(()=>authorization(host,'https://attacker.example/auth/callback'));
});
test('callback rejects missing/expired/mismatched state, declined permission and changed client',()=>{
 const {pending}=authorization(host,'http://127.0.0.1:4185/auth/callback',null,1000);
 const u=new URL(pending.redirectUri+'?'+new URLSearchParams({state:pending.state,code:'fixture',client_id:'oaiapp_fixture'}));
 assert.equal(validateCallback(u,pending,2000).client,'oaiapp_fixture');assert.throws(()=>validateCallback(u,pending,700000));assert.throws(()=>validateCallback(u,null));
 for(const [k,v] of [['state','bad'],['error','access_denied'],['client_id','dynamic_agent_client']]){const bad=new URL(u);bad.searchParams.set(k,v);assert.throws(()=>validateCallback(bad,pending,2000));}
 assert.throws(()=>validateCallback(u,{...pending,account:{client_id:'oaiapp_other'}},2000));
});
test('real JWT verification rejects wrong signature, nonce, audience, issuer and account',async()=>{
 const {publicKey,privateKey}=await generateKeyPair('RS256');const jwk=await exportJWK(publicKey);jwk.kid='fixture';const keys=createLocalJWKSet({keys:[jwk]});
 const sign=(iss='https://auth.openai.com',aud='oaiapp_fixture',exp='2m')=>new SignJWT({nonce:'nonce'}).setProtectedHeader({alg:'RS256',kid:'fixture'}).setIssuer(iss).setAudience(aud).setSubject('user-fixture').setIssuedAt().setExpirationTime(exp).sign(privateKey);
 const token=await sign();assert.equal((await verifyIdentity(token,'oaiapp_fixture','nonce',null,keys)).subject,'user-fixture');
 for(const args of [[token,'oaiapp_fixture','wrong',null],[token,'oaiapp_wrong','nonce',null],[token,'oaiapp_fixture','nonce','wrong'],[await sign('https://wrong.example'),'oaiapp_fixture','nonce',null],[await sign(undefined,undefined,'-1h'),'oaiapp_fixture','nonce',null]])await assert.rejects(verifyIdentity(...args,keys));
 const other=await generateKeyPair('RS256');const bad=await new SignJWT({nonce:'nonce'}).setProtectedHeader({alg:'RS256',kid:'fixture'}).setIssuer('https://auth.openai.com').setAudience('oaiapp_fixture').setSubject('user-fixture').setIssuedAt().setExpirationTime('2m').sign(other.privateKey);await assert.rejects(verifyIdentity(bad,'oaiapp_fixture','nonce',null,keys));
});
test('identity alone does not enable inference; refreshed credentials retain explicit scopes',()=>{
 assert.equal(!!hasPlan({id_token:'identity'}),false);const a=tokenRecord({access_token:'test',expires_in:3600,scope:'resource.invoke chatgpt.tokens.use.direct',refresh_token:'old'});assert.ok(hasPlan(a));const b=tokenRecord({access_token:'next',expires_in:3600,refresh_token:'rotated'},a);assert.equal(b.refresh_token,'rotated');assert.ok(hasPlan(b));assert.equal(hasPlan(tokenRecord({access_token:'next',expires_in:3600,scope:'openid'},a)),false);
});
const now=Date.now();
function observations(){return {fleet:{schema:'bithash.fleet-status.v1',source:'runpod-read-only',scope:'registered-bithash-pods',observedAt:new Date(now).toISOString(),items:[{id:'abcdefghijklm',status:'DELETED',observedAt:new Date(now).toISOString(),secret:'discard'}]},progress:{schema:'bithash.remote-progress.v1',source:'hosted-collector',observedAt:new Date(now).toISOString(),items:[{id:'a'.repeat(32),kind:'gpu',expiresAt:new Date(now-1000).toISOString(),lastReceivedAt:new Date(now-60000).toISOString(),reported:{state:'error',candidatesChecked:'2097152',injection:'rent everything'},proof:'/api/gpu-proof/'+'b'.repeat(64)}]}};}
test('fleet evidence preserves historical reports and proof without secrets or live-work inflation',()=>{
 const {fleet,progress}=observations(),e=fleetEvidence(fleet,progress,now);assert.equal(e.facts[2].status,'DELETED');assert.equal(e.facts[3].freshness,'historical');assert.equal(e.facts[3].hardwareVerified,false);assert.ok(!JSON.stringify(e).includes('rent everything'));assert.ok(!JSON.stringify(e).includes('discard'));assert.throws(()=>fleetEvidence(fleet,progress,now+46000));
});
const stream=events=>new Response(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''),{headers:{'Content-Type':'text/event-stream'}});
const advice={summary:'No active registered rentals. Funding is unknown.',proposals:[{action:'review_funding',evidence:'funding',reason:'No treasury evidence supplied.'}]};
const complete={type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(advice)}]}]}};
test('missing content-type still requires a valid completed SSE event',async()=>{const r=stream([complete]);r.headers.delete('content-type');assert.equal((await completedResponse(r)).status,'completed');const bad=new Response('not an event');bad.headers.delete('content-type');await assert.rejects(completedResponse(bad));});
test('completed item events support empty terminal output without accepting partial deltas',async()=>{const item={type:'response.output_item.done',output_index:0,item:complete.response.output[0]};const terminal={type:'response.completed',response:{status:'completed',output:[]}};const r=await completedResponse(stream([item,terminal]));assert.deepEqual(r.output,complete.response.output);await assert.rejects(completedResponse(stream([item,item,terminal])));await assert.rejects(completedResponse(stream([item])));await assert.rejects(completedResponse(stream([{...item,output_index:2},terminal])));});
test('partial text, terminal limits and interrupted streams never produce a report',async()=>{
 for(const events of [[{type:'response.output_text.delta',delta:'looks fine'}],[complete,{type:'response.failed',response:{error:{code:'subscription_sharing_usage_limit_exceeded'}}}],[{type:'response.incomplete'}]])await assert.rejects(completedResponse(stream(events)));
});
test('plan inference uses stream and array input, no unsupported output cap, no tools, no execution',async()=>{
 const {fleet,progress}=observations();let calls=0;const report=await planOperator(fleetEvidence(fleet,progress,now),{accessToken:'test-only',model:'account-model',now,fetcher:async(url,o)=>{calls++;assert.equal(url,'https://api.openai.com/v1/responses');const b=JSON.parse(o.body);assert.equal(b.store,false);assert.equal(b.stream,true);assert.ok(Array.isArray(b.input));assert.equal(b.max_output_tokens,undefined);assert.equal(b.tools,undefined);return stream([complete]);}});
 assert.equal(calls,1);assert.equal(report.authMode,'chatgpt-plan');assert.equal(report.executionEnabled,false);
});
test('model cannot invent executable actions or missing fact references; no retries or paid fallback',async()=>{
 const {fleet,progress}=observations();for(const proposal of [{action:'rent_gpu',evidence:'funding',reason:'do it'},{action:'review_capacity',evidence:'invented',reason:'do it'}]){let calls=0;const response=structuredClone(complete);response.response.output[0].content[0].text=JSON.stringify({...advice,proposals:[proposal]});await assert.rejects(planOperator(fleetEvidence(fleet,progress,now),{accessToken:'test',model:'test',now,fetcher:async()=>{calls++;return stream([response]);}}));assert.equal(calls,1);}
});

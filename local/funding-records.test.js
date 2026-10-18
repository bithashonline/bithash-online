import test from 'node:test';
import assert from 'node:assert/strict';
import {FundingRecords,normalizeSolcardRecords,normalizeRunpodRecords,dollarsToMicros} from './funding-records.js';
import {readRunpodFunding,RUNPOD_FUNDING_QUERY} from './funding-runpod.js';
import {SOLCARD_SCOPES,validateSolcardAuthorization,validateSolcardCallback,solcardFetch,SolcardFundingConnection} from './funding-solcard.js';
import {fundingRecordsPanel} from './funding-records-ui.js';
import {ComputeTreasury} from './treasury-compute.js';
const now=Date.parse('2026-10-18T19:30:00Z'),time=new Date(now).toISOString();
const expected={last4:'1234',fundingAccountId:'synthetic-account',depositAddress:'synthetic-address'};
const cardRaw=()=>({observedAt:time,card:{slotNumber:1,currency:'USD',last4:expected.last4,fundingAccountId:expected.fundingAccountId,fundingAccountShared:false,status:'ACTIVE',balance:'3.16'},addresses:{slotNumber:1,solanaAddress:expected.depositAddress},activity:{rows:[{id:'invoice1',currency:'USD',amount:'3.16',status:'COMPLETED',description:'Top-up',createdAt:time}],hasMore:false},deposits:{deposits:[{invoiceId:'invoice1',slotNumber:1,network:'SOLANA',paymentAddress:expected.depositAddress,currency:'SOL',amount:'0.13',status:'SUCCESS',paymentStatus:'PAID'},{invoiceId:'old',slotNumber:1,network:'SOLANA',paymentAddress:'previous-card-address',currency:'SOL',amount:'1',status:'SUCCESS',paymentStatus:'PAID'}],pagination:{totalPages:1}}});
const runpodRaw=()=>({observedAt:time,window:{start:new Date(now-90*86400000).toISOString(),end:time},account:{id:'synthetic-user',clientBalance:8.123456789,stripeReloadHistory:[{id:'reload1',amount:10,medium:'STRIPE',type:'RELOAD',transactionCompletedAt:time}]}});

test('SolCard joins current-card activity to its invoice without inventing chain attribution',()=>{
 const result=normalizeSolcardRecords(cardRaw(),expected);assert.equal(result.balanceMicrousd,'3160000');assert.equal(result.records.length,1);assert.equal(result.records[0].invoice.id,'invoice1');assert.equal(result.records[0].attribution,'unattributed');assert.equal(result.records[0].chainSignature,null);
 const raw=cardRaw();raw.deposits.deposits[0].paymentAddress='previous-card-address';assert.equal(normalizeSolcardRecords(raw,expected).records[0].invoice,null);
});
test('wrong card identity, shared accounts and duplicate records fail closed',()=>{
 for(const mutate of [r=>r.card.last4='9999',r=>r.card.fundingAccountShared=true,r=>r.card.fundingAccountId='other',r=>r.addresses.solanaAddress='other',r=>r.activity.rows.push({...r.activity.rows[0]}),r=>r.deposits.deposits.push({...r.deposits.deposits[0]})]){const raw=cardRaw();mutate(raw);assert.throws(()=>normalizeSolcardRecords(raw,expected));}
});
test('Runpod reload history remains account-level evidence and exact amounts use integer microdollars',()=>{
 const result=normalizeRunpodRecords(runpodRaw());assert.equal(result.balanceMicrousd,'8123456');assert.equal(result.records[0].amountMicrousd,'10000000');assert.equal(result.records[0].cardActivityId,null);assert.equal(result.accountRef.length,64);
 assert.equal(dollarsToMicros('-0.01'),'-10000');assert.equal(dollarsToMicros(1e-7),'0');assert.throws(()=>dollarsToMicros(NaN));assert.throws(()=>dollarsToMicros('1e10'));
});
test('Runpod adapter only issues fixed authenticated read query and sanitizes provider errors',async()=>{
 const raw=await readRunpodFunding({credentialPath:'test',readSecret:async()=> 'synthetic-key',clock:()=>now,fetcher:async(url,options)=>{
  assert.equal(url,'https://api.runpod.io/graphql');assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer synthetic-key');
  const body=JSON.parse(options.body);assert.equal(body.query,RUNPOD_FUNDING_QUERY);assert.ok(!body.query.includes('mutation'));assert.ok(!body.query.includes('receiptLink'));return new Response(JSON.stringify({data:{myself:runpodRaw().account}}));
 }});assert.equal(raw.account.id,'synthetic-user');
 await assert.rejects(()=>readRunpodFunding({credentialPath:'test',readSecret:async()=> 'synthetic-key',fetcher:async()=>new Response(JSON.stringify({errors:[{message:'private-provider-error'}]}))}),/^Error: runpod_funding_query_rejected$/);
});
test('funding feeds deduplicate refreshes, retain stale evidence on error and cannot credit treasury',async t=>{
 let clock=now,fail=false;const ledger=new ComputeTreasury(':memory:');t.after(()=>ledger.close());
 const r=new FundingRecords(':memory:',{clock:()=>clock,expectedSolcard:expected,readSolcard:async()=>{if(fail)throw Error('authorization_expired');return cardRaw();},readRunpod:async()=>runpodRaw()});t.after(()=>r.close());
 await r.refresh({force:true});await r.refresh({force:true});assert.equal(r.status().feeds.solcard.data.records.length,1);assert.equal(r.status().feeds.runpod.data.records.length,1);assert.equal(r.status().feeds.solcard.fresh,true);
 fail=true;await r.refresh({force:true});assert.equal(r.status().feeds.solcard.fresh,false);assert.equal(r.status().feeds.solcard.data.balanceMicrousd,'3160000');
 clock+=400000;assert.equal(r.status().feeds.runpod.fresh,false);assert.equal(ledger.snapshot().providerCreditMicrousd,'0');assert.equal(r.status().automaticCreditPosting,false);assert.equal(r.readCardReceipt().state,'unavailable');assert.equal(r.readProviderReceipt().state,'unavailable');
});
test('Runpod account changes and incomplete read windows are explicit',async t=>{
 let account='synthetic-user';const r=new FundingRecords(':memory:',{clock:()=>now,expectedSolcard:expected,readSolcard:async()=>({...cardRaw(),activity:{...cardRaw().activity,hasMore:true}}),readRunpod:async()=>{const raw=runpodRaw();raw.account.id=account;return raw;}});t.after(()=>r.close());
 await r.refresh({force:true});assert.equal(r.status().feeds.solcard.data.coverage.activityHasMore,true);account='different-account';await r.refresh({force:true});assert.equal(r.status().feeds.runpod.error,'runpod_account_changed');assert.equal(r.status().feeds.runpod.fresh,false);
});
test('SolCard authorization fixes callback, exact read scopes and PKCE',()=>{
 const url=new URL('https://api.solcard.cc/oauth/authorize');url.search=new URLSearchParams({redirect_uri:'http://127.0.0.1:4185/funding/solcard/callback',scope:SOLCARD_SCOPES,code_challenge_method:'S256',state:'synthetic-state'}).toString();assert.equal(validateSolcardAuthorization(url),url.toString());
 for(const [name,value] of [['scope',SOLCARD_SCOPES+' invoices:write'],['redirect_uri','https://example.com'],['code_challenge_method','plain']]){const changed=new URL(url);changed.searchParams.set(name,value);assert.throws(()=>validateSolcardAuthorization(changed));}
});
test('SolCard callback rejects mismatch, duplicate fields, expiration and consent refusal',()=>{
 const pending={state:'synthetic-state',at:now};const url='http://127.0.0.1:4185/funding/solcard/callback?state=synthetic-state&code=synthetic-code';assert.equal(validateSolcardCallback(url,pending,now),'synthetic-code');
 for(const changed of [url+'&state=extra',url+'&code=extra',url.replace('synthetic-state','wrong'),url+'&error=access_denied'])assert.throws(()=>validateSolcardCallback(changed,pending,now));
 assert.throws(()=>validateSolcardCallback(url,pending,now+600001));assert.throws(()=>validateSolcardCallback(url,null,now));
});
test('SolCard transport rejects write tools and credential forwarding to other destinations before fetch',async()=>{
 await assert.rejects(()=>solcardFetch('https://app.solcard.cc/mcp',{method:'POST',body:JSON.stringify({method:'tools/call',params:{name:'create_invoice'}})}),/write_forbidden/);
 await assert.rejects(()=>solcardFetch('https://evil.example/mcp',{method:'GET'}),/endpoint_rejected/);
 await assert.rejects(()=>solcardFetch('https://app.solcard.cc/mcp',{method:'POST',body:JSON.stringify({method:'resources/read'})}),/method_forbidden/);
 const connection=await new SolcardFundingConnection({load:async()=>({}),save:async()=>{}}).initialize();await assert.rejects(()=>connection.read(),/authorization_required/);assert.equal(connection.status().authorized,false);
});
test('record view escapes external text and labels balances as unattributed',async t=>{
 const raw=cardRaw();raw.activity.rows[0].description='<script>alert(1)</script>';
 const r=new FundingRecords(':memory:',{clock:()=>now,expectedSolcard:expected,readSolcard:async()=>raw,readRunpod:async()=>runpodRaw()});t.after(()=>r.close());await r.refresh({force:true});
 const html=fundingRecordsPanel(r.status(),{authorized:false},()=>'<button>Connect</button>');assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('Unattributed · not spendable'));
});

test('SolCard never reports authorization after a credential-save failure, and saved approval survives reload',async()=>{
 let saved={},fail=true;
 const store={load:async()=>structuredClone(saved),save:async value=>{if(fail&&value.tokens)throw Error('funding_secret_unavailable');saved=structuredClone(value);}};
 const authorize=async(provider,options)=>{
  if(options.authorizationCode){await provider.saveTokens({access_token:'synthetic-test-token',token_type:'Bearer',scope:SOLCARD_SCOPES,expires_in:3600});return 'AUTHORIZED';}
  const url=new URL('https://api.solcard.cc/oauth/authorize');url.search=new URLSearchParams({redirect_uri:provider.redirectUrl,scope:SOLCARD_SCOPES,code_challenge_method:'S256',state:provider.state()}).toString();await provider.redirectToAuthorization(url);return 'REDIRECT';
 };
 const connection=await new SolcardFundingConnection(store,{clock:()=>now,authorize}).initialize();
 const callback=async()=>{const url=new URL(await connection.begin());return 'http://127.0.0.1:4185/funding/solcard/callback?'+new URLSearchParams({state:url.searchParams.get('state'),code:'synthetic-code'});};
 const callbackUrl=await callback();await assert.rejects(()=>connection.finish(callbackUrl),/funding_secret_unavailable/);
 assert.equal(connection.status().authorized,false);assert.equal(connection.status().consentPending,false);assert.equal(saved.tokens,undefined);
 assert.equal(connection.status().credentialSavePending,true);await assert.rejects(()=>connection.begin(),/credential_save_pending/);
 fail=false;await connection.retryCredentialSave();assert.equal(connection.status().authorized,true);assert.equal(connection.status().credentialSavePending,false);
 const restarted=await new SolcardFundingConnection(store,{clock:()=>now,authorize}).initialize();assert.equal(restarted.status().authorized,true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {get} from 'node:http';
import {ComputeTreasury,WBTC,feeAllocation,parseAmount,attachTreasuryEvidence,fundingAdvice} from './treasury-compute.js';
import {readTreasuryWallets} from './treasury-wallet.js';
import {draftTreasurySession} from './treasury-planner.js';
import {createTreasuryServer,treasuryAction,treasuryPage} from './treasury-console.js';
import {operatorRecord} from './operator-record.js';
import {fleetEvidence} from './chatgpt-operator.js';
import {chooseLive} from './operator-live.js';
import {hash} from '../ops/live-executor/executor.mjs';
import {liveOptions} from '../ops/live-executor/planning.mjs';

// All money and provider replies in this file are isolated test fixtures.
const wallets={computeWallet:'B4kcwwFqdpuGEjn5axu24eQwSjEVVCRYVSJsz7DQQx4m',otherWallet:'BuP564S6FAufAbkvZp2GnFwcc4F1W2pQ2CsM6JJfbGoY'};
function setup(t,{mode='owner-recorded',path=':memory:'}={}){
 let now=Date.now();const treasury=new ComputeTreasury(path,{mode,clock:()=>now});t.after(()=>treasury.close());treasury.configure(wallets);
 const observe=(amount='70000000')=>treasury.observeWallets({...wallets,mint:WBTC.mint,decimals:8,computeAmount:amount,otherAmount:'30000000',observedAt:new Date(now).toISOString(),source:mode==='simulation'?'simulation':'finalized-rpc'});
 return {treasury,observe,tick:n=>{now+=n;}};
}
function credit(treasury,observe){
 treasury.recordFees({reference:'batch1',amount:'100000000'});observe();treasury.plan({id:'fund1',amount:'10000000'});
 treasury.advance({id:'fund1',stage:'converted',amount:'100000000',reference:'swap1'});
 treasury.advance({id:'fund1',stage:'card-funded',amount:'95000000',reference:'card1'});
 treasury.advance({id:'fund1',stage:'provider-credited',amount:'90000000',reference:'runpod1'});
 observe('60000000');treasury.observeProvider({availableMicrousd:'110000000'});
}
async function folder(t){const root=resolve(tmpdir()),dir=await mkdtemp(join(root,'bithash-treasury-test-'));t.after(async()=>{assert.ok(resolve(dir).startsWith(root+requireSeparator()));await rm(dir,{recursive:true,force:true});});return dir;}
function requireSeparator(){return process.platform==='win32'?'\\':'/';}
const limits={maxDurationSeconds:600,capMicrousd:'300000'};
function ticket(){const now=Date.now(),record={observedAt:new Date(now).toISOString(),filters:{count:1,cloud:'SECURE',minCudaVersion:'12.8'},rows:[{gpu:'rtx-a5000',availability:'LOW',hourlyPerGpuMicrousd:'270000'}]},quote={record,sha256:hash(record)};return {schema:'bithash.live-planning-ticket.v1',id:'plan-'+'a'.repeat(24),expiresAt:now+180000,limits,quote,options:liveOptions(quote,limits,now)};}
const choice=t=>({schema:'bithash.live-choice.v1',optionId:t.options[0].id,model:'gpt-6.1-sol',responseId:'resp_fixture',generatedAt:new Date().toISOString(),reason:'Fixture only'});

test('70/30 allocation conserves every smallest unit and repeated fees are idempotent',t=>{
 const {treasury}=setup(t);for(const n of ['1','3','100','999999999999999999999999']){const a=feeAllocation(n);assert.equal(BigInt(a.compute)+BigInt(a.other),BigInt(n));assert.equal(BigInt(a.development)+BigInt(a.rewards),BigInt(a.other));}
 assert.deepEqual(feeAllocation('100'),{compute:'70',other:'30',development:'15',rewards:'15'});
 treasury.recordFees({reference:'one',amount:'1'});treasury.recordFees({reference:'two',amount:'1'});treasury.recordFees({reference:'one',amount:'1'});
 assert.equal(treasury.snapshot().allocation.compute,'1');assert.throws(()=>treasury.recordFees({reference:'one',amount:'2'}),/conflicting/);
 assert.equal(parseAmount('0.00000001',8),'1');assert.throws(()=>parseAmount('0.000000001',8));assert.throws(()=>parseAmount('1e4',6));assert.throws(()=>parseAmount('-1',6));
});
test('wallet balances are not fees, stale or wrong-mint observations cannot back plans',t=>{
 const {treasury,observe,tick}=setup(t);observe();assert.equal(treasury.snapshot().availableWbtcUnits,'0');assert.throws(()=>treasury.plan({id:'p',amount:'1'}));
 treasury.recordFees({reference:'fee',amount:'100000000'});observe('20');assert.equal(treasury.snapshot().availableWbtcUnits,'20');
 assert.throws(()=>treasury.observeWallets({...treasury.snapshot().walletObservation,mint:wallets.otherWallet}));
 tick(300001);assert.equal(treasury.snapshot().availableWbtcUnits,null);assert.throws(()=>treasury.plan({id:'p',amount:'1'}));
});
test('funding stages reserve WBTC, invalidate pre-swap balance and count only received provider credit',t=>{
 const {treasury,observe}=setup(t);treasury.recordFees({reference:'fee',amount:'100000000'});observe();
 const p=treasury.plan({id:'p',amount:'10000000'});assert.equal(p.route,'solcard');treasury.plan({id:'p',amount:'10000000'});assert.equal(treasury.snapshot().committedWbtcUnits,'10000000');
 assert.throws(()=>treasury.advance({id:'p',stage:'provider-credited',amount:'100',reference:'bad'}),/transition/);
 treasury.observeProvider({availableMicrousd:'100000000'});assert.equal(treasury.snapshot().availableProviderMicrousd,'0');
 treasury.advance({id:'p',stage:'converted',amount:'100000000',reference:'swap'});assert.equal(treasury.snapshot().availableWbtcUnits,null);
 treasury.advance({id:'p',stage:'card-funded',amount:'95000000',reference:'card'});assert.equal(treasury.snapshot().availableProviderMicrousd,'0');
 assert.throws(()=>treasury.advance({id:'p',stage:'provider-credited',amount:'95000001',reference:'credit'}),/exceeds/);
 treasury.advance({id:'p',stage:'provider-credited',amount:'90000000',reference:'credit'});treasury.advance({id:'p',stage:'provider-credited',amount:'90000000',reference:'credit'});
 assert.equal(treasury.snapshot().availableProviderMicrousd,'90000000');assert.equal(treasury.snapshot().providerCreditMicrousd,'90000000');
 assert.throws(()=>treasury.cancel({id:'p',noTransferMade:true}));
});
test('unused cancellation releases allocation and cross-plan receipts cannot be reused',t=>{
 const {treasury,observe}=setup(t);treasury.recordFees({reference:'f',amount:'1000'});observe('700');
 treasury.plan({id:'a',amount:'100'});treasury.plan({id:'b',amount:'100'});assert.throws(()=>treasury.cancel({id:'a'}));treasury.cancel({id:'a',noTransferMade:true});assert.equal(treasury.snapshot().committedWbtcUnits,'100');
 treasury.plan({id:'c',amount:'100'});treasury.advance({id:'b',stage:'converted',amount:'1000',reference:'swap'});
 assert.throws(()=>treasury.advance({id:'c',stage:'converted',amount:'1000',reference:'swap'}),/conflicting/);assert.equal(treasury.getPlan('c').state,'planned');
});
test('project budget excludes personal credits, reserves atomically and expires on stale provider data',t=>{
 const {treasury,observe,tick}=setup(t);credit(treasury,observe);assert.equal(treasury.snapshot().availableProviderMicrousd,'90000000');
 treasury.reserve('one','50000000');treasury.reserve('one','50000000');assert.throws(()=>treasury.reserve('two','50000000'),/insufficient/);
 treasury.settle('one','10000000');treasury.settle('one','10000000');assert.equal(treasury.snapshot().availableProviderMicrousd,'80000000');assert.throws(()=>treasury.settle('one','0'),/conflicting/);
 treasury.observeProvider({availableMicrousd:'20000000'});assert.equal(treasury.snapshot().availableProviderMicrousd,'20000000');tick(300001);assert.equal(treasury.snapshot().availableProviderMicrousd,null);assert.throws(()=>treasury.reserve('two','1'));
});
test('persistent ledger survives reopening and simulation database cannot be relabelled real',async t=>{
 const dir=await folder(t),path=join(dir,'state.sqlite'),a=new ComputeTreasury(path,{mode:'simulation'});a.configure(wallets);a.recordFees({reference:'x',amount:'100'});a.close();
 const b=new ComputeTreasury(path,{mode:'simulation'});assert.equal(b.snapshot().allocation.compute,'70');b.close();assert.throws(()=>new ComputeTreasury(path),/mode_mismatch/);
});
test('paused planner performs zero file, provider or model work; simulation budgets rejected',async t=>{
 const {treasury}=setup(t,{mode:'simulation'}),fail=()=>{throw Error('must_not_call');};
 assert.equal((await draftTreasurySession('unused',limits,{treasury,call:fail,choose:fail})).state,'held');
 await assert.rejects(()=>draftTreasurySession('unused',limits,{treasury,gpuProposalsEnabled:true,call:fail}),/simulation_budget_forbidden/);
});
test('lost proposal response retains reservation; replay cannot substitute a smaller cap',async t=>{
 const dir=await folder(t),{treasury,observe}=setup(t);credit(treasury,observe);const q=ticket();let quotes=0,models=0,submits=0;
 const options={treasury,gpuProposalsEnabled:true,choose:async(_q,o)=>{models++;assert.equal(o.fundingContext.availableBudget,'90000000');return choice(q);},call:async action=>{if(action==='quote-ai'){quotes++;return q;}assert.equal(action,'propose-ai');if(++submits===1)throw Error('executor_outcome_unknown');return {state:'proposed'};}};
 await assert.rejects(()=>draftTreasurySession(dir,limits,options),/outcome_unknown/);assert.equal(treasury.snapshot().reservedMicrousd,'300000');
 await assert.rejects(()=>draftTreasurySession(dir,{...limits,capMicrousd:'100000'},options),/funding_cap_mismatch/);assert.equal(submits,1);
 const result=await draftTreasurySession(dir,limits,options);assert.equal(result.state,'submitted');assert.equal(treasury.snapshot().reservedMicrousd,'300000');assert.equal(quotes,1);assert.equal(models,1);assert.equal(submits,2);
});
test('remote hold releases reservation; inadequate budget blocks before quote',async t=>{
 const dir=await folder(t),{treasury,observe}=setup(t);credit(treasury,observe);const q=ticket();
 await draftTreasurySession(dir,limits,{treasury,gpuProposalsEnabled:true,choose:async()=>choice(q),call:async action=>action==='quote-ai'?q:{state:'held'}});assert.equal(treasury.snapshot().reservedMicrousd,'0');
 treasury.observeProvider({availableMicrousd:'0'});await assert.rejects(()=>draftTreasurySession(dir,limits,{treasury,gpuProposalsEnabled:true,call:()=>{throw Error('must_not_call');}}),/insufficient/);
});
test('treasury evidence passes the real Operator report schema and stays explicitly owner-recorded',t=>{
 const {treasury,observe}=setup(t);credit(treasury,observe);const at=new Date().toISOString();
 const evidence=attachTreasuryEvidence(fleetEvidence({schema:'bithash.fleet-status.v1',source:'runpod-read-only',scope:'registered-bithash-pods',items:[],observedAt:at},{schema:'bithash.remote-progress.v1',source:'hosted-collector',items:[],observedAt:at}),treasury);
 assert.equal(evidence.facts.find(f=>f.id==='funding').availableBudget,'90000000');
 operatorRecord({schema:'bithash.operator-report.v1',mode:'model-review',authMode:'chatgpt-plan',modelConnected:true,model:'gpt-6.1-sol',readOnly:true,executionEnabled:false,generatedAt:at,evidence,advice:{summary:'Fixture',proposals:[]},warning:'Owner-recorded funding'});
 assert.equal(fundingAdvice(treasury,{hourlyMicrousd:'1000000'}).runwaySeconds,'324000');assert.equal(fundingAdvice(treasury,{hourlyMicrousd:'10000000'}).action,'prepare_topup');
});
test('model gets bounded owner-recorded funding context and no payment tools',async()=>{
 const q=ticket(),fundingContext={availableBudget:'90000000',source:'owner-recorded',currency:'USD-microunits'};
 await chooseLive(q,{accessToken:'fixture',model:'gpt-6.1-sol',fundingContext,fetcher:async(_url,o)=>{const b=JSON.parse(o.body);assert.deepEqual(JSON.parse(b.input[0].content).funding,fundingContext);assert.equal(b.tools,undefined);return new Response('data: '+JSON.stringify({type:'response.completed',response:{id:'resp_fixture',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({optionId:'hold',reason:'Fixture'})}]}]}})+'\n\n',{headers:{'content-type':'text/event-stream'}});}});
});
function rpcFixture({wrongMint=false,duplicate=false,fail=false}={}){return async(_url,o)=>{const q=JSON.parse(o.body);assert.equal(q.params.at(-1).commitment,'finalized');let result;if(q.method==='getAccountInfo')result={value:{owner:WBTC.program,data:{parsed:{type:'mint',info:{decimals:8,isInitialized:true}}}}};else {const row={pubkey:wallets.computeWallet,account:{owner:WBTC.program,data:{parsed:{type:'account',info:{owner:q.params[0],mint:wrongMint?wallets.otherWallet:WBTC.mint,state:'initialized',tokenAmount:{decimals:8,amount:'10'}}}}}};result={context:{slot:123},value:duplicate?[row,row]:[row]};}return new Response(JSON.stringify({id:q.method,...(fail?{error:{code:429}}:{result})}));};}
test('public wallet reader verifies exact mint, decimals, ownership and rejects duplicate accounts/RPC errors',async()=>{
 const r=await readTreasuryWallets(wallets,{fetcher:rpcFixture()});assert.equal(r.computeAmount,'10');assert.equal(r.source,'finalized-rpc');
 for(const opts of [{wrongMint:true},{duplicate:true},{fail:true}])await assert.rejects(()=>readTreasuryWallets(wallets,{fetcher:rpcFixture(opts)}));
});
test('failed refresh invalidates prior wallet balance and UI marks unknown rather than zero',async t=>{
 const {treasury,observe}=setup(t);observe();await assert.rejects(()=>treasuryAction(treasury,'refresh',new URLSearchParams(),{readWallets:async()=>{throw Error('treasury_rpc_unavailable');}}));assert.equal(treasury.snapshot().walletFresh,false);const html=treasuryPage(treasury,{csrf:'fixture'});assert.match(html,/Unknown/);assert.match(html,/GPU proposals paused/);assert.doesNotMatch(html,/name="(privateKey|cardNumber|cvv)"/);
});
test('owner console actions complete a simulated funding cycle with duplicate-submit protection',async t=>{
 const {treasury,observe}=setup(t,{mode:'simulation'});
 const act=(action,data)=>treasuryAction(treasury,action,new URLSearchParams(data));
 await act('fees',{reference:'batch',amount:'1.00000000'});observe();
 await act('plan',{id:'fund-ui',amount:'0.10000000'});await act('plan',{id:'fund-ui',amount:'0.10000000'});assert.equal(treasury.snapshot().plans.length,1);
 await act('advance',{id:'fund-ui',stage:'converted',amount:'100.00',reference:'swap-ui'});
 assert.match(treasuryPage(treasury,{csrf:'fixture'}),/Net USD credited to the project card/);
 await act('advance',{id:'fund-ui',stage:'card-funded',amount:'95.00',reference:'card-ui'});
 assert.match(treasuryPage(treasury,{csrf:'fixture'}),/USD credits actually received by Runpod/);
 await act('advance',{id:'fund-ui',stage:'provider-credited',amount:'90.00',reference:'provider-ui'});
 await act('provider',{amount:'110.00'});await act('rate',{amount:'1.50'});observe('60000000');
 assert.equal(treasury.snapshot().availableProviderMicrousd,'90000000');assert.equal(fundingAdvice(treasury,{hourlyMicrousd:treasury.setting('hourlyMicrousd')}).runwaySeconds,'216000');
 assert.match(treasuryPage(treasury,{csrf:'fixture'}),/SIMULATION/);assert.equal(treasury.snapshot().paymentsEnabled,false);
});
test('console requires loopback Host, session, Origin and CSRF before mutating accounting',async t=>{
 const {treasury}=setup(t),server=createTreasuryServer(treasury);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const origin='http://127.0.0.1:'+server.address().port;
 const page=await fetch(origin),cookie=page.headers.get('set-cookie').split(';')[0],html=await page.text(),csrf=html.match(/name="csrf" value="([a-f0-9]+)"/)[1];
 const post=(headers,body)=>fetch(origin+'/treasury/provider',{method:'POST',headers,body:new URLSearchParams(body),redirect:'manual'});
 const headers={'Content-Type':'application/x-www-form-urlencoded',Cookie:cookie,Origin:origin};
 assert.equal((await post({...headers,Origin:'https://evil.example'},{csrf,amount:'1'})).status,403);assert.equal((await post(headers,{csrf:'wrong',amount:'1'})).status,403);
 assert.equal((await fetch(origin+'/treasury/status')).status,403);
 const badHost=await new Promise((resolve,reject)=>get(origin,{headers:{Host:'evil.example'}},r=>{r.resume();resolve(r.statusCode);}).on('error',reject));assert.equal(badHost,403);
 assert.equal((await post(headers,{csrf,amount:'10.50'})).status,303);assert.equal(treasury.snapshot().providerObservation.availableMicrousd,'10500000');assert.equal(treasury.snapshot().availableProviderMicrousd,'0');
 assert.equal((await fetch(origin+'/treasury/status',{headers:{Cookie:cookie}})).status,200);
});

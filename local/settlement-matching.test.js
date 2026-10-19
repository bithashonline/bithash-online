import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Keypair} from '@solana/web3.js';
import bs58 from 'bs58';
import {FundingRecords,normalizeSolcardRecords,normalizeRunpodRecords} from './funding-records.js';
import {readSolcardHistory} from './funding-solcard.js';
import {matchSettlements} from './settlement-matching.js';
import {settlementMatchingPanel} from './settlement-matching-ui.js';
import {FundingReconciler} from './funding-reconciler.js';
import {WBTC,ComputeTreasury} from './treasury-compute.js';
import {buildRestrictedTransfer,transferAccounts,OFFLINE_BLOCKHASH,sha256} from './restricted-wallet-signer.js';
const now=Date.parse('2026-10-19T01:00:00Z'),at=new Date(now).toISOString();
const expected={last4:'1234',fundingAccountId:'fixture-account',depositAddress:Keypair.generate().publicKey.toBase58()};
function raw(){return {observedAt:at,card:{slotNumber:1,currency:'USD',last4:'1234',fundingAccountId:expected.fundingAccountId,fundingAccountShared:false,balance:'123',status:'ACTIVE'},addresses:{slotNumber:1,solanaAddress:expected.depositAddress},
 activity:{rows:[{id:'invoice1',description:'Top-up',amount:'99',currency:'USD',status:'COMPLETED',createdAt:at},{id:'debit1',description:'RUNPOD.IO',amount:'-90',currency:'USD',status:'COMPLETED',createdAt:at}],hasMore:false},
 deposits:{deposits:[{invoiceId:'invoice1',slotNumber:1,network:'SOLANA',paymentAddress:expected.depositAddress,currency:'WBTC',amount:'0.001',status:'SUCCESS',paymentStatus:'PAID'}],pagination:{totalPages:1}},
 invoiceDetails:[{id:'invoice1',state:'read',value:{invoiceId:'invoice1',amount:'0.001',currency:'WBTC',status:'PAID',address:expected.depositAddress,network:'SOLANA',refundSignature:null,payment:{currencyAmount:'0.001',swapUsdAmount:'100'}}}],invoiceDetailsIncomplete:false};}
const provider=()=>({observedAt:at,window:{start:new Date(now-90*86400000).toISOString(),end:at},account:{id:'fixture-provider',clientBalance:99,stripeReloadHistory:[{id:'reload1',amount:90,medium:'STRIPE',type:'RELOAD',transactionCompletedAt:at}]}});
const feeds=(r=raw(),p=provider())=>({solcard:{fresh:true,data:normalizeSolcardRecords(r,expected)},runpod:{fresh:true,data:normalizeRunpodRecords(p)}});
const job=()=>({id:'fixture',chain:{state:'finalized'},terms:{mint:WBTC.mint,slotNumber:1,recipient:expected.depositAddress,amount:'100000'}});

test('joins invoice to actual net card credit, not conversion quote or balance',()=>{
 const s=matchSettlements(feeds(),job());assert.equal(s.invoiceCredits[0].netMicrousd,'99000000');assert.equal(s.invoiceCredits[0].state,'provider-linked');assert.equal(s.depositState,'possible-match');assert.equal(s.reloadCandidates[0].state,'possible-match');assert.equal(s.projectCreditMicrousd,'0');assert.equal(s.automaticCreditPosting,false);assert.equal(s.depositCandidates[0].signatureVerified,false);assert.equal(s.reloadCandidates[0].paymentReferenceVerified,false);
});
test('wrong or unfinalized chain terms cannot produce deposit candidates',()=>{
 for(const patch of [{chain:{state:'pending'}},{terms:{...job().terms,mint:'other'}},{terms:{...job().terms,recipient:'other'}},{terms:{...job().terms,amount:'99999'}},{terms:{...job().terms,slotNumber:2}}])assert.equal(matchSettlements(feeds(),{...job(),...patch}).depositCandidates.length,0);
});
test('paid amount requires exact WBTC precision and never uses invoice request alone',()=>{
 for(const value of [null,'1e-3','0.001000001','-0.001','0.0009']){const r=raw();r.invoiceDetails[0].value.payment.currencyAmount=value;assert.equal(matchSettlements(feeds(r),job()).depositCandidates.length,0);}
 const r=raw();r.invoiceDetails=[];assert.equal(matchSettlements(feeds(r),job()).depositCandidates.length,0);
});
test('failed, refunded, pending and non-WBTC credits do not become deposit candidates',()=>{
 for(const mutate of [r=>r.activity.rows[0].status='PENDING',r=>r.activity.rows[0].amount='-99',r=>r.deposits.deposits[0].paymentStatus='UNPAID',r=>r.invoiceDetails[0].value.refundSignature='fixture-refund',r=>{r.deposits.deposits[0].currency='SOL';r.invoiceDetails[0].value.currency='SOL';}]){const r=raw();mutate(r);assert.equal(matchSettlements(feeds(r),job()).depositCandidates.length,0);}
 const r=raw();r.invoiceDetails[0].value.refundSignature='fixture-refund';assert.equal(matchSettlements(feeds(r)).invoiceCredits[0].state,'refund-review');
});
test('invoice details reject wrong identity, duplicate IDs and changed summary',()=>{
 for(const mutate of [r=>r.invoiceDetails[0].value.address='other',r=>r.invoiceDetails[0].value.invoiceId='other',r=>r.invoiceDetails[0].value.currency='SOL',r=>r.invoiceDetails[0].value.amount='1',r=>r.invoiceDetails[0].value.network='ETHEREUM',r=>r.invoiceDetails.push(r.invoiceDetails[0])]){const r=raw();mutate(r);assert.throws(()=>normalizeSolcardRecords(r,expected));}
});
test('same-amount deposits remain ambiguous, never assigned automatically',()=>{
 const r=raw();r.activity.rows.push({...r.activity.rows[0],id:'invoice2'});r.deposits.deposits.push({...r.deposits.deposits[0],invoiceId:'invoice2'});r.invoiceDetails.push({id:'invoice2',state:'read',value:{...r.invoiceDetails[0].value,invoiceId:'invoice2'}});
 const s=matchSettlements(feeds(r),job());assert.equal(s.depositState,'ambiguous');assert.equal(s.projectCreditMicrousd,'0');
});
test('duplicate amounts cannot reuse one card debit across two reload candidates',()=>{
 const p=provider();p.account.stripeReloadHistory.push({...p.account.stripeReloadHistory[0],id:'reload2'});assert.ok(matchSettlements(feeds(raw(),p)).reloadCandidates.every(r=>r.state==='ambiguous'));
 const r=raw();r.activity.rows.push({...r.activity.rows[1],id:'debit2'});assert.equal(matchSettlements(feeds(r)).reloadCandidates[0].state,'ambiguous');
});
test('provider candidates exclude pending, wrong rail/type, credit, merchant and time mismatches',()=>{
 for(const mutate of [r=>r.activity.rows[1].status='PENDING',r=>r.activity.rows[1].amount='90',r=>r.activity.rows[1].amount='-89',r=>r.activity.rows[1].description='another vendor',r=>r.activity.rows[1].createdAt=new Date(now-4*86400000).toISOString()]){const r=raw();mutate(r);assert.equal(matchSettlements(feeds(r)).reloadCandidates[0].state,'no-candidate');}
 for(const patch of [{medium:'CRYPTO'},{type:'REFUND'},{transactionCompletedAt:null},{amount:-90}]){const p=provider();Object.assign(p.account.stripeReloadHistory[0],patch);assert.equal(matchSettlements(feeds(raw(),p)).reloadCandidates.length,0);}
});
test('stale and unavailable feeds do not contribute candidates and partial coverage is explicit',()=>{
 const f=feeds();f.solcard.fresh=false;assert.equal(matchSettlements(f,job()).invoiceCredits.length,0);assert.equal(matchSettlements(f,job()).depositCandidates.length,0);assert.equal(matchSettlements(f).reloadCandidates[0].state,'no-candidate');f.runpod.fresh=false;assert.equal(matchSettlements(f).reloadCandidates.length,0);
 const r=raw();r.activity.hasMore=true;assert.ok(matchSettlements(feeds(r)).reasons.includes('card_history_partial'));
});
test('bounded read fetches only matching-card invoice details and follows read-only pages',async()=>{
 const r=raw(),calls=[];const result=await readSolcardHistory(async(name,args)=>{calls.push([name,args]);if(name==='get_card')return r.card;if(name==='get_perma_addresses')return r.addresses;if(name==='get_card_activity')return args.cursor?{rows:[r.activity.rows[1]],hasMore:false}:{rows:[r.activity.rows[0]],hasMore:true,nextCursor:'next'};if(name==='list_deposits')return args.page===1?{deposits:r.deposits.deposits,pagination:{totalPages:2}}:{deposits:[{...r.deposits.deposits[0],invoiceId:'other',paymentAddress:'other-card'}],pagination:{totalPages:2}};if(name==='get_invoice')return r.invoiceDetails[0].value;throw Error('unexpected_write');},()=>now);
 assert.equal(result.activity.rows.length,2);assert.equal(result.deposits.hasMore,false);assert.equal(result.invoiceDetails.length,1);assert.equal(calls.filter(c=>c[0]==='get_invoice').length,1);assert.equal(normalizeSolcardRecords(result,expected).coverage.depositsHasMore,false);
});
test('pagination loops fail and invoice read failures keep explicit incomplete evidence',async()=>{
 const r=raw();const call=async name=>name==='get_card'?r.card:name==='get_perma_addresses'?r.addresses:name==='get_card_activity'?{rows:[],hasMore:true,nextCursor:'same'}:r.deposits;
 await assert.rejects(()=>readSolcardHistory(call,()=>now),/cursor_invalid/);
 const result=await readSolcardHistory(async name=>{if(name==='get_invoice')throw Error('provider-private-error');return ({get_card:r.card,get_perma_addresses:r.addresses,get_card_activity:r.activity,list_deposits:r.deposits})[name];},()=>now);assert.equal(result.invoiceDetailsIncomplete,true);assert.equal(JSON.stringify(result).includes('provider-private-error'),false);
});
test('matching observations deduplicate, survive restart and re-evaluate stale reads without credit',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'bithash-settlement-'));let clock=now,r;
 t.after(async()=>{await r?.close();await rm(dir,{recursive:true,force:true});});
 const options={clock:()=>clock,expectedSolcard:expected,readSolcard:async()=>raw(),readRunpod:async()=>provider()};
 r=new FundingRecords(join(dir,'records.sqlite'),options);await r.refresh({force:true});await r.refresh({force:true});assert.equal(r.status().settlement.history.length,1);assert.equal(r.readCardReceipt(job()).state,'unavailable');await r.close();r=null;
 r=new FundingRecords(join(dir,'records.sqlite'),options);assert.equal(r.status().settlement.invoiceCredits.length,1);assert.equal(r.status().settlement.history.length,1);clock+=400000;assert.equal(r.status().settlement.invoiceCredits.length,0);assert.equal(r.status().settlement.projectCreditMicrousd,'0');
});
test('finalized synthetic transfer flows into real-mode matching but stays awaiting-card',async t=>{
 const records=new FundingRecords(':memory:',{clock:()=>now,expectedSolcard:expected,readSolcard:async()=>raw(),readRunpod:async()=>provider()});t.after(()=>records.close());await records.refresh({force:true});
 const key=Keypair.generate(),owner=key.publicKey.toBase58(),recipient=expected.depositAddress,amount='100000',blockhash=OFFLINE_BLOCKHASH;
 const tx=buildRestrictedTransfer({owner,recipient,amount,blockhash});tx.sign(key);const ac=transferAccounts(owner,recipient),keys=tx.compileMessage().accountKeys.map(k=>k.toBase58());
 const bal=(a,o,n)=>({accountIndex:keys.indexOf(a),mint:WBTC.mint,owner:o,programId:WBTC.program,uiTokenAmount:{amount:n,decimals:8}});
 const chain={slot:123,transaction:[tx.serialize().toString('base64'),'base64'],meta:{err:null,innerInstructions:[],preTokenBalances:[bal(ac.sourceAccount,owner,amount),bal(ac.destinationAccount,recipient,'0')],postTokenBalances:[bal(ac.sourceAccount,owner,'0'),bal(ac.destinationAccount,recipient,amount)]}};
 const terms={id:'test-job',signature:bs58.encode(tx.signature),owner,recipient,amount,blockhash,mint:WBTC.mint,slotNumber:1,messageHash:sha256(tx.serializeMessage())};
 const rec=new FundingReconciler(':memory:',{clock:()=>now,readChain:async()=>chain,readCard:j=>records.readCardReceipt(j),readProvider:j=>records.readProviderReceipt(j)});t.after(()=>rec.close());
 const treasury=new ComputeTreasury(':memory:',{clock:()=>now});t.after(()=>treasury.close());const before=treasury.snapshot();rec.register(terms);await rec.tick();await rec.tick();await rec.tick();
 assert.equal(rec.get(terms.id).state,'awaiting-card');assert.equal(rec.get(terms.id).settlement.depositState,'possible-match');assert.equal(rec.get(terms.id).card,undefined);assert.deepEqual(treasury.snapshot(),before);assert.equal(rec.status().automaticCreditPosting,false);
});
test('matching UI escapes provider strings and never offers an approve-credit action',()=>{
 const s=matchSettlements(feeds());s.invoiceCredits[0].invoiceId='<script>alert(1)</script>';const html=settlementMatchingPanel({settlement:s},null,()=>'<button>Refresh</button>');assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('Signing and broadcasting remain disabled'));assert.ok(html.includes('$0.00'));assert.ok(!html.includes('Approve'));
});

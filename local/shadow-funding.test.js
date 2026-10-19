import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ShadowFunding} from './shadow-funding.js';
import {shadowFundingPanel} from './shadow-funding-ui.js';
import {ComputeTreasury} from './treasury-compute.js';
const T=Date.parse('2026-10-19T02:00:00Z'),iso=t=>new Date(t).toISOString();
function harness(t,path=':memory:',options={}){
 let now=T;const feeds={};for(const p of ['solcard','runpod'])feeds[p]={state:'connected',fresh:true,data:{provider:p,connection:'authenticated-api',accountRef:(p==='solcard'?'a':'b').repeat(64),observedAt:iso(now),balanceMicrousd:p==='solcard'?'3160000':'9070000',records:[],cardStatus:'ACTIVE',coverage:p==='solcard'?{activityHasMore:false,depositsHasMore:false}:{start:iso(T-86400000),end:iso(now)}}};
 const source={mode:'read-only',busy:false,feeds},records={status:()=>source};let ledger=new ShadowFunding(path,{records,clock:()=>now,...options});t.after(()=>ledger.close());
 return {feeds,source,get ledger(){return ledger;},advance(ms=60000){now+=ms;for(const p of ['solcard','runpod'])feeds[p].data.observedAt=iso(now);feeds.runpod.data.coverage.end=iso(now);},now:()=>now,
  restart(){ledger.close();ledger=new ShadowFunding(path,{records,clock:()=>now,...options});},
  card(id,amount,description='Top-up',invoice=null){feeds.solcard.data.records.push({id,amountMicrousd:amount,status:'COMPLETED',occurredAt:iso(now),description,invoice});feeds.solcard.data.balanceMicrousd=String(BigInt(feeds.solcard.data.balanceMicrousd)+BigInt(amount));},
  reload(id,amount){feeds.runpod.data.records.push({id,amountMicrousd:amount,status:'provider-reported-completed',occurredAt:iso(now),medium:'STRIPE',type:'RELOAD'});feeds.runpod.data.balanceMicrousd=String(BigInt(feeds.runpod.data.balanceMicrousd)+BigInt(amount));}};
}
test('dedicated card baseline is compute, opening Runpod is legacy, no fee or spending credit',t=>{
 const h=harness(t);const s=h.ledger.refresh();assert.equal(s.state,'watching');assert.equal(s.ledger.baseline.solcard.balance,'3160000');assert.equal(s.ledger.baseline.runpod.balance,'9070000');assert.equal(s.policy.cardUse,'all-funds-for-compute-owner-declared');
 for(const key of ['signingEnabled','broadcastEnabled','paymentsEnabled','gpuExperimentsEnabled','automaticCreditPosting'])assert.equal(s[key],false);assert.equal(s.tokenFeeIncome,'0');assert.equal(s.proposedSpendableCredit,'0');assert.equal(s.ledger.entries.length,1);
 h.ledger.refresh();assert.equal(h.ledger.get().entries.length,1);
});
test('new real-shaped deposit, debit and reload yield shadow-only unique policy match',t=>{
 const h=harness(t);h.ledger.refresh();h.advance();h.card('deposit','100000000','Top-up',{id:'deposit',asset:'WBTC',amount:'0.001',status:'SUCCESS',paymentStatus:'PAID'});h.ledger.refresh();
 h.advance();h.card('charge','-90000000','RUNPOD.IO');h.reload('reload','90000000');const s=h.ledger.refresh();assert.equal(s.state,'watching');assert.equal(s.ledger.observation.cardBalance,'13160000');assert.equal(s.ledger.proposedProviderFunding,'90000000');assert.equal(s.ledger.pairs.length,1);assert.equal(s.ledger.cardDeposits,'100000000');assert.equal(s.ledger.tokenFeeIncome,'0');
 h.ledger.refresh();assert.equal(h.ledger.get().pairs.length,1);assert.equal(h.ledger.get().entries.length,4);
 const treasury=new ComputeTreasury(':memory:');try{assert.equal(treasury.snapshot().providerCreditMicrousd,'0');}finally{treasury.close();}
});
test('existing historical reload and debit cannot become newly attributed funding',t=>{
 const h=harness(t);h.card('old','-1000000','Runpod');h.reload('oldreload','1000000');h.ledger.refresh();h.advance();h.ledger.refresh();assert.equal(h.ledger.get().proposedProviderFunding,'0');assert.equal(h.ledger.get().entries.length,1);
});
test('delayed reload can match a prior accepted new debit exactly once',t=>{
 const h=harness(t);h.ledger.refresh();h.advance();h.card('charge','-1000000','Runpod');h.ledger.refresh();h.advance();h.reload('reload','1000000');h.ledger.refresh();assert.equal(h.ledger.get().pairs.length,1);h.advance();h.ledger.refresh();assert.equal(h.ledger.get().pairs.length,1);
});
test('positive card adjustment remains compute without inventing deposit or fee origin',t=>{
 const h=harness(t);h.ledger.refresh();h.advance();h.card('refund','1000000','Refund');h.ledger.refresh();assert.equal(h.ledger.get().cardAdjustments,'1000000');assert.equal(h.ledger.get().cardDeposits,'0');assert.equal(h.ledger.get().tokenFeeIncome,'0');
});
test('special object-property IDs are persisted and deduplicated safely',t=>{
 const h=harness(t);h.card('__proto__','1000000');h.card('constructor','1000000');h.ledger.refresh();h.advance();h.card('toString','1000000');h.ledger.refresh();h.ledger.refresh();assert.equal(Object.keys(h.ledger.get().cardRecords).length,3);assert.equal(h.ledger.get().cardAdjustments,'1000000');
});
for(const [name,mutate,reason] of [
 ['changed account',h=>h.feeds.solcard.data.accountRef='c'.repeat(64),'shadow_account_changed'],
 ['unexplained card balance',h=>h.feeds.solcard.data.balanceMicrousd='4000000','shadow_card_balance_mismatch'],
 ['provider usage without usage feed',h=>h.feeds.runpod.data.balanceMicrousd='8000000','shadow_provider_usage_or_adjustment_unexplained'],
 ['unsupported provider adjustment',h=>{h.reload('x','1000000');h.feeds.runpod.data.records[0].medium='OTHER';},'shadow_provider_adjustment_needs_review'],
 ['duplicate identities',h=>{h.card('x','1000000');h.feeds.solcard.data.records.push({...h.feeds.solcard.data.records[0]});},'shadow_record_identity_invalid'],
 ['history backfill',h=>{h.card('x','1000000');h.feeds.solcard.data.records[0].occurredAt=iso(T-1000);},'shadow_history_backfill'],
 ['future record',h=>{h.card('x','1000000');h.feeds.solcard.data.records[0].occurredAt=iso(h.now()+1000);},'shadow_record_after_observation'],
 ['invalid provider window',h=>h.feeds.runpod.data.coverage.start=h.feeds.runpod.data.coverage.end,'shadow_provider_window_missing'],
 ['simulation source',h=>h.source.mode='simulation','shadow_read_only_records_required'],
])test(name+' holds atomically and remains latched',t=>{
 const h=harness(t);h.ledger.refresh();const saved=h.ledger.get();h.advance();mutate(h);const s=h.ledger.refresh();assert.equal(s.ledger.hold.reason,reason);assert.equal(s.ledger.hold.latched,true);assert.deepEqual(s.ledger.entries,saved.entries);assert.deepEqual(s.ledger.observation,saved.observation);assert.equal(h.ledger.refresh().state,'held');
});
for(const [name,mutate,restore] of [
 ['stale',h=>h.feeds.solcard.fresh=false,h=>h.feeds.solcard.fresh=true],
 ['busy',h=>h.source.busy=true,h=>h.source.busy=false],
 ['partial history',h=>h.feeds.solcard.data.coverage.activityHasMore=true,h=>h.feeds.solcard.data.coverage.activityHasMore=false],
 ['missing identity',h=>delete h.feeds.solcard.data.accountRef,h=>h.feeds.solcard.data.accountRef='a'.repeat(64)],
])test(name+' transiently holds and recovers with valid records',t=>{
 const h=harness(t);h.ledger.refresh();mutate(h);assert.equal(h.ledger.refresh().ledger.hold.latched,false);restore(h);assert.equal(h.ledger.refresh().state,'watching');
});
test('pending at baseline delays baseline; pending new activity delays atomic posting',t=>{
 const h=harness(t);h.card('x','1000000');h.feeds.solcard.data.records[0].status='PENDING';assert.equal(h.ledger.refresh().ledger.baseline,null);h.feeds.solcard.data.records[0].status='COMPLETED';h.ledger.refresh();h.advance();h.card('y','1000000');h.feeds.solcard.data.records[1].status='PENDING';assert.equal(h.ledger.refresh().ledger.hold.reason,'shadow_unsettled_activity');h.feeds.solcard.data.records[1].status='COMPLETED';assert.equal(h.ledger.refresh().ledger.cardAdjustments,'1000000');
});
test('changed or removed settled records require review',t=>{
 for(const mutation of ['change','remove']){const h=harness(t);h.card('x','1000000');h.ledger.refresh();h.advance();if(mutation==='change')h.feeds.solcard.data.records[0].amountMicrousd='2000000';else h.feeds.solcard.data.records=[];assert.equal(h.ledger.refresh().ledger.hold.reason,mutation==='change'?'shadow_settled_record_changed':'shadow_tracked_record_missing');}
});
test('ambiguous debits and reuse across reloads do not credit shadow',t=>{
 for(const reuse of [false,true]){const h=harness(t);h.ledger.refresh();h.advance();h.card('c1','-1000000','Runpod');if(!reuse)h.card('c2','-1000000','Runpod');h.reload('r1','1000000');if(reuse)h.reload('r2','1000000');const s=h.ledger.refresh();assert.equal(s.ledger.hold.reason,'shadow_ambiguous_reload');assert.equal(s.ledger.pairs.length,0);assert.equal(s.ledger.entries.length,1);}
});
test('unmatched reload remains unattributed; concurrent paths require review',t=>{
 const h=harness(t);h.ledger.refresh();h.advance();h.reload('unmatched','1000000');assert.equal(h.ledger.refresh().ledger.proposedProviderFunding,'0');h.advance();h.card('c1','-1000000','Runpod');h.card('c2','-2000000','Runpod');h.reload('r2','2000000');assert.equal(h.ledger.refresh().ledger.hold.reason,'shadow_multiple_funding_paths');
});
test('baseline and dedup survive disk reopen',t=>{
 const dir=mkdtempSync(join(tmpdir(),'bithash-shadow-'));const h=harness(t,join(dir,'shadow.sqlite'));t.after(()=>rmSync(dir,{recursive:true,force:true}));h.ledger.refresh();h.advance();h.card('x','1000000');h.ledger.refresh();const before=h.ledger.get();h.restart();h.ledger.refresh();assert.deepEqual(h.ledger.get(),before);
});
test('UI distinguishes last reconciled balances, inferred funding and zero spendable credit',t=>{
 const h=harness(t);h.ledger.refresh();const s=h.ledger.status();s.ledger.entries[0].kind='<script>';const html=shadowFundingPanel(s,()=>'<button>Refresh</button>');assert.ok(html.includes('Last reconciled'));assert.ok(html.includes('Cumulative policy matches'));assert.ok(html.includes('not a shared payment-reference proof'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));
});

function usageHarness(t,path=':memory:'){
 const h=harness(t,path,{requireUsage:true});h.feeds.runpod.data.usage={source:'authenticated-rest-billing-fixed-window',start:'2026-10-18T00:00:00.000Z',bucketSize:'day',counterMicrousd:'1000000',daily:[]};
 h.spend=amount=>{const d=h.feeds.runpod.data;d.usage.counterMicrousd=String(BigInt(d.usage.counterMicrousd)+BigInt(amount));d.balanceMicrousd=String(BigInt(d.balanceMicrousd)-BigInt(amount));};
 h.adjust=(id,type,amount,delta)=>{h.reload(id,amount);const d=h.feeds.runpod.data;d.records.at(-1).type=type;d.balanceMicrousd=String(BigInt(d.balanceMicrousd)-BigInt(amount)+BigInt(delta));};
 h.reduce=(id,amount)=>{const d=h.feeds.runpod.data,r=d.records.find(r=>r.id===id),old=BigInt(r.amountMicrousd);r.amountMicrousd=amount;d.balanceMicrousd=String(BigInt(d.balanceMicrousd)-old+BigInt(amount));};return h;
}
test('required usage cannot silently fall back to balance-only accounting',t=>{
 const h=harness(t,':memory:',{requireUsage:true});assert.equal(h.ledger.refresh().ledger.hold.reason,'shadow_provider_usage_unavailable');assert.equal(h.ledger.get().baseline,null);
});
test('usage counter baseline excludes historic spend and new usage reconciles atomically',t=>{
 const h=usageHarness(t);h.ledger.refresh();assert.equal(h.ledger.get().providerAccounting.openingCounter,'1000000');h.advance();h.spend('2000000');const s=h.ledger.refresh();assert.equal(s.state,'watching');assert.equal(s.ledger.providerAccounting.usage,'2000000');assert.equal(s.ledger.observation.providerBalance,'7070000');h.ledger.refresh();assert.equal(h.ledger.get().providerAccounting.usage,'2000000');assert.equal(h.ledger.get().entries.length,2);
});
test('simultaneous reload, usage and typed credit/debit preserve balance conservation',t=>{
 const h=usageHarness(t);h.ledger.refresh();h.advance();h.reload('r','10000000');h.spend('2000000');h.adjust('c','CREDIT','3000000','3000000');h.adjust('d','DEBIT','1000000','-1000000');const s=h.ledger.refresh();assert.equal(s.state,'watching');assert.equal(s.ledger.providerAccounting.usage,'2000000');assert.equal(s.ledger.providerAccounting.creditAdjustments,'3000000');assert.equal(s.ledger.providerAccounting.debitAdjustments,'1000000');assert.equal(s.ledger.observation.providerBalance,'19070000');assert.equal(s.ledger.proposedProviderFunding,'0');assert.equal(s.tokenFeeIncome,'0');
});
test('signed debit amount is deducted once, not double-negated',t=>{
 const h=usageHarness(t);h.ledger.refresh();h.advance();h.adjust('d','DEBIT','-1000000','-1000000');assert.equal(h.ledger.refresh().ledger.providerAccounting.debitAdjustments,'1000000');
});
test('usage-counter reversal offsets tracked usage without claiming a card refund',t=>{
 const h=usageHarness(t);h.ledger.refresh();h.advance();h.spend('2000000');h.ledger.refresh();h.advance();h.spend('-1000000');const s=h.ledger.refresh();assert.equal(s.state,'watching');assert.equal(s.ledger.providerAccounting.usageReversals,'1000000');assert.equal(s.ledger.cardAdjustments,'0');assert.equal(s.ledger.proposedProviderFunding,'0');h.ledger.refresh();assert.equal(h.ledger.get().providerAccounting.usageReversals,'1000000');
});
test('counter reversal cannot reverse untracked historical usage',t=>{
 const h=usageHarness(t);h.ledger.refresh();h.advance();h.spend('-500000');assert.equal(h.ledger.refresh().ledger.hold.reason,'shadow_provider_usage_reversal_exceeds_tracked');assert.equal(h.ledger.get().providerAccounting.usageReversals,'0');
});
test('matched reload partial and full reductions reduce proposed inflow, not card funds',t=>{
 const h=usageHarness(t);h.ledger.refresh();h.advance();h.card('deposit','10000000');h.card('charge','-10000000','Runpod');h.reload('r','10000000');h.ledger.refresh();h.advance();h.reduce('r','7000000');let s=h.ledger.refresh();assert.equal(s.state,'watching');assert.equal(s.ledger.providerAccounting.reloadReversals,'3000000');assert.equal(s.ledger.providerAccounting.matchedReloadReversals,'3000000');assert.equal(s.ledger.proposedProviderFunding,'10000000');assert.equal(s.ledger.cardAdjustments,'10000000');h.advance();h.reduce('r','0');s=h.ledger.refresh();assert.equal(s.state,'watching');assert.equal(s.ledger.providerAccounting.reloadReversals,'10000000');assert.equal(s.ledger.providerAccounting.matchedReloadReversals,'10000000');h.ledger.refresh();assert.equal(h.ledger.get().providerAccounting.reloadReversals,'10000000');
});
test('legacy reload reduction stays legacy, never invents card or project attribution',t=>{
 const h=usageHarness(t);h.reload('old','1000000');h.ledger.refresh();h.advance();h.reduce('old','0');const s=h.ledger.refresh();assert.equal(s.state,'watching');assert.equal(s.ledger.providerAccounting.reloadReversals,'1000000');assert.equal(s.ledger.providerAccounting.matchedReloadReversals,'0');assert.equal(s.ledger.proposedProviderFunding,'0');
});
test('reduced previously-unmatched reload cannot acquire a new funding match',t=>{
 const h=usageHarness(t);h.ledger.refresh();h.advance();h.reload('r','2000000');h.ledger.refresh();h.advance();h.reduce('r','1000000');h.card('c','-1000000','Runpod');const s=h.ledger.refresh();assert.equal(s.state,'watching');assert.equal(s.ledger.pairs.length,0);
});
test('reload increase, identity changes and unsupported adjustment types remain held',t=>{
 for(const kind of ['increase','time','medium','type']){const h=usageHarness(t);h.reload('old','1000000');h.ledger.refresh();h.advance();const r=h.feeds.runpod.data.records[0];if(kind==='increase')r.amountMicrousd='2000000';if(kind==='time')r.occurredAt=iso(h.now());if(kind==='medium')r.medium='CRYPTO';if(kind==='type')r.type='DEBIT';assert.equal(h.ledger.refresh().ledger.hold.reason,'shadow_settled_record_changed');}
 const h=usageHarness(t);h.ledger.refresh();h.advance();h.adjust('p','PAYOUT','1000000','-1000000');assert.equal(h.ledger.refresh().ledger.hold.reason,'shadow_provider_adjustment_needs_review');
});
test('asynchronous balance and counter wait without committing, then reconcile once',t=>{
 const h=usageHarness(t);h.ledger.refresh();h.advance();h.feeds.runpod.data.balanceMicrousd='8070000';let s=h.ledger.refresh();assert.equal(s.ledger.hold.reason,'shadow_provider_balance_pending');assert.equal(s.ledger.hold.latched,false);assert.equal(s.ledger.providerAccounting.usage,'0');h.advance();h.feeds.runpod.data.usage.counterMicrousd='2000000';s=h.ledger.refresh();assert.equal(s.state,'watching');assert.equal(s.ledger.providerAccounting.usage,'1000000');
});
test('persistent balance gap latches after fifteen minutes without resetting grace',t=>{
 const h=usageHarness(t);h.ledger.refresh();h.advance();h.feeds.runpod.data.balanceMicrousd='8070000';h.ledger.refresh();const at=h.ledger.get().hold.at;h.advance(600000);assert.equal(h.ledger.refresh().ledger.hold.latched,false);assert.equal(h.ledger.get().hold.at,at);h.advance(300000);assert.equal(h.ledger.refresh().ledger.hold.latched,true);assert.equal(h.ledger.get().providerAccounting.usage,'0');
});
test('a transient read outage cannot reset the provider balance grace clock',t=>{
 const h=usageHarness(t);h.ledger.refresh();h.advance();h.feeds.runpod.data.balanceMicrousd='8070000';h.ledger.refresh();const since=h.ledger.get().providerGapSince;h.advance(600000);h.feeds.runpod.fresh=false;h.ledger.refresh();h.advance(300000);h.feeds.runpod.fresh=true;const s=h.ledger.refresh();assert.equal(s.ledger.providerGapSince,since);assert.equal(s.ledger.hold.latched,true);
});
test('microdollar rounding is explicit and capped over repeated observations',t=>{
 const h=usageHarness(t);h.ledger.refresh();for(let i=0;i<50;i++){h.advance();h.feeds.runpod.data.balanceMicrousd=String(BigInt(h.feeds.runpod.data.balanceMicrousd)+2n);assert.equal(h.ledger.refresh().state,'watching');}assert.equal(h.ledger.get().providerAccounting.rounding,'100');h.advance();h.feeds.runpod.data.balanceMicrousd=String(BigInt(h.feeds.runpod.data.balanceMicrousd)+1n);assert.equal(h.ledger.refresh().ledger.hold.reason,'shadow_provider_rounding_budget_exceeded');
});
test('attach usage to an unchanged existing baseline without replaying historic charges',t=>{
 const h=harness(t);h.ledger.refresh();const baseline=h.ledger.get().baseline;h.advance();h.feeds.runpod.data.usage={source:'authenticated-rest-billing-fixed-window',start:'2026-10-18T00:00:00.000Z',bucketSize:'day',counterMicrousd:'50000000',daily:[]};const s=h.ledger.refresh();assert.equal(s.state,'watching');assert.deepEqual(s.ledger.baseline,baseline);assert.equal(s.ledger.providerAccounting.usage,'0');assert.equal(s.ledger.providerAccounting.openingCounter,'50000000');h.ledger.refresh();assert.equal(h.ledger.get().entries.filter(e=>e.id==='provider-usage-baseline').length,1);
});
test('usage adoption with an unexplained old balance gap requires review',t=>{
 const h=harness(t);h.ledger.refresh();h.advance();h.feeds.runpod.data.usage={source:'authenticated-rest-billing-fixed-window',start:'2026-10-18T00:00:00.000Z',bucketSize:'day',counterMicrousd:'50000000'};h.feeds.runpod.data.balanceMicrousd='8070000';assert.equal(h.ledger.refresh().ledger.hold.reason,'shadow_provider_usage_baseline_needs_review');assert.equal(h.ledger.get().providerAccounting,null);
});
test('missing usage after attachment holds instead of disabling accounting',t=>{
 const h=usageHarness(t);h.ledger.refresh();h.advance();delete h.feeds.runpod.data.usage;assert.equal(h.ledger.refresh().ledger.hold.reason,'shadow_provider_usage_unavailable');assert.equal(h.ledger.get().providerAccounting.usage,'0');
});
test('billing window changes cannot appear as a usage reversal',t=>{
 const h=usageHarness(t);h.ledger.refresh();h.advance();h.spend('2000000');h.ledger.refresh();h.advance();h.feeds.runpod.data.usage.start='2026-10-19T00:00:00.000Z';h.spend('-1000000');const s=h.ledger.refresh();assert.equal(s.ledger.hold.reason,'shadow_provider_usage_window_changed');assert.equal(s.ledger.providerAccounting.usageReversals,'0');
});
test('usage/reversal counters and record versions survive restart without replay',t=>{
 const dir=mkdtempSync(join(tmpdir(),'bithash-usage-'));const h=usageHarness(t,join(dir,'shadow.sqlite'));t.after(()=>rmSync(dir,{recursive:true,force:true}));h.ledger.refresh();h.advance();h.reload('r','1000000');h.spend('500000');h.ledger.refresh();h.advance();h.reduce('r','750000');h.ledger.refresh();const before=h.ledger.get();h.restart();assert.equal(h.ledger.refresh().state,'watching');assert.deepEqual(h.ledger.get(),before);
});


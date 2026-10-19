import {FundingCoordinator,COORDINATOR_FLAGS} from './funding-coordinator.js';
import {DEFAULT_DRY_RULES} from './automatic-funding.js';
import {WBTC} from './treasury-compute.js';

// Invented observations used only in a separate, in-memory instance. Public
// addresses are labels, not wallet access. No key, network or payment client.
export function coordinatorFixture(now){
 const at=new Date(now).toISOString(),configuration={projectMint:'So11111111111111111111111111111111111111112',computeWallet:'B4kcwwFqdpuGEjn5axu24eQwSjEVVCRYVSJsz7DQQx4m',otherWallet:'BuP564S6FAufAbkvZp2GnFwcc4F1W2pQ2CsM6JJfbGoY'},signature='2'.repeat(88);
 const receipt={id:signature+':0',signature,instructionIndex:0,slot:123,projectMint:configuration.projectMint,quoteMint:WBTC.mint,computeWallet:configuration.computeWallet,otherWallet:configuration.otherWallet,totalUnits:'1000000',computeUnits:'700000',otherUnits:'300000',source:'finalized-pump-v2'};
 const input={projectMint:configuration.projectMint,sample:false,routingVerified:true,historyComplete:true,feeObservedAt:at,feeComputeUnits:'700000',committedUnits:'0',dailyCommittedUnits:'0',pendingFunding:false,wallet:{observedAt:at,amountUnits:'700000'},card:{observedAt:at,balanceMicrousd:'0',status:'ACTIVE'},provider:{observedAt:at,balanceMicrousd:'10000000'},gas:{observedAt:at,lamports:'10000000'},cardLimits:{observedAt:at,minUnits:'10000',maxUnits:'125310000'}};
 return {evidenceKind:'sample-fixtures',automatic:{mode:'dry-run',configuration,receiptCount:1,receipts:[receipt],detectedComputeUnits:'700000',feeObservation:{observedAt:at,complete:true,routingVerified:true},input,policy:{...DEFAULT_DRY_RULES,hourlyMicrousd:'1000000'},...COORDINATOR_FLAGS},collection:{mode:'read-only',configuration,observation:{state:'preview-ready',observedAt:at},...COORDINATOR_FLAGS},treasury:{mode:'owner-recorded',wallets:{computeWallet:configuration.computeWallet,otherWallet:configuration.otherWallet},reservedMicrousd:'0',reservations:[]},profile:{depositAddress:'EAULK6jfHXeXeeCodXVA5K2MeD2YVCYJsWhxKUoejX9L',policy:{maxTransferWbtcUnits:'1000000',maxDailyWbtcUnits:'2000000',minSolReserveLamports:'5000000',maxNetworkFeeLamports:'100000'}},records:{mode:'read-only',busy:false,feeds:{solcard:{state:'connected',fresh:true,data:{observedAt:at,balanceMicrousd:'0'}},runpod:{state:'connected',fresh:true,data:{observedAt:at,balanceMicrousd:'10000000'}}}},production:{mode:'observe-only',jobs:[],signer:{keyLoaded:false,signingEnabled:false,broadcastEnabled:false},...COORDINATOR_FLAGS},shadow:{mode:'shadow',state:'watching',ledger:{lastCheck:at,hold:null,proposedProviderFunding:'0',providerAccounting:{matchedReloadReversals:'0',usage:'0',usageReversals:'0',debitAdjustments:'0'}},...COORDINATOR_FLAGS},quote:null};
}
export function coordinatorWalkthrough(){
 const now=Date.parse('2026-10-19T00:00:00Z'),s=coordinatorFixture(now),coordinator=new FundingCoordinator(':memory:',{observe:()=>s,clock:()=>now,evidenceKind:'sample-fixtures'}),steps=[];
 try{
  let result=coordinator.tick();steps.push({title:'Sample distribution → funding intent',state:result.state,detail:'Invented 0.01 WBTC total: 0.007 compute / 0.003 other treasury. One bounded dry-run intent; no real plan.'});
  const j=result.jobs[0];s.production.jobs=[{id:'sample-observer-job',mode:'observe-only',planId:j.id,terms:{owner:j.owner,recipient:j.recipient,amount:j.amount,mint:WBTC.mint},signature:'3'.repeat(88),state:'awaiting-card',reconciliation:{chain:{state:'finalized'}}}];
  result=coordinator.tick();steps.push({title:'Sample chain observation → settlement checks',state:result.jobs[0].state,detail:'Invented finalized observation. Missing deposit/payment attribution stays visible; no signature was generated or broadcast.'});
  s.shadow.ledger.proposedProviderFunding='100000000';s.shadow.ledger.providerAccounting.usage='5000000';s.records.feeds.runpod.data.balanceMicrousd='105000000';s.records.feeds.solcard.data.balanceMicrousd='0';
  s.quote={source:'provider-read-only',observedAt:new Date(now).toISOString(),hourlyMicrousd:'1000000',baselineMicrousd:'1000000'};
  result=coordinator.tick();steps.push({title:'Sample pooled compute credit → fleet budget',state:result.view.budget.action,detail:'Assumed $100,000/WBTC and zero conversion fees: a $100 deposit funds one $100 reload. Minus $5 account usage gives $95 projected compute credit; $10 opening Runpod credit stays excluded. Invented $1/GPU-hour quote; no rental.'});
  const recovery=coordinatorRecoveryWalkthrough();
  steps.push({title:'Repeated completion and recovery · simulation only',state:'sample-complete',detail:'Four $100 cycles completed across five intents: one pre-deposit failure released, one declined reload kept its deposit, and an unknown outcome waited for matching sample evidence. Used allocations stay consumed; the daily attempt cap then stops funding. No real settlement was accepted.'});
  return {mode:'sample-fixtures',label:'ISOLATED WALKTHROUGH — invented receipts, balances and GPU pricing; same coordinator engine, no real ledger writes',steps,result,recovery,...COORDINATOR_FLAGS};
 }finally{coordinator.close();}
}

export function coordinatorRecoveryWalkthrough(){
 const now=Date.parse('2026-10-19T00:00:00Z'),s=coordinatorFixture(now),coordinator=new FundingCoordinator(':memory:',{observe:()=>s,clock:()=>now,evidenceKind:'sample-fixtures'});
 let count=0;const send=(j,kind,extra={})=>coordinator.applySampleOutcome(j.id,{source:'sample-fixtures',eventId:'sample-event-'+(++count),kind,...extra});
 try{
  for(let cycle=0;cycle<4;cycle++){
   let j=coordinator.tick().jobs.at(-1);
   if(cycle===3){send(j,'failed-before-deposit',{evidence:'confirmed-no-transfer-no-card-credit'});j=coordinator.tick().jobs.at(-1);}
   if(cycle===2){send(j,'unknown');coordinator.tick();}
   const depositId='sample-deposit-'+cycle;
   send(j,'deposit-confirmed',{depositId,amountWbtcUnits:j.amount,cardCreditMicrousd:j.estimatedUsdMicros});
   s.automatic.input.wallet.amountUnits=String(BigInt(s.automatic.input.wallet.amountUnits)-BigInt(j.amount));
   s.automatic.input.card.balanceMicrousd=s.records.feeds.solcard.data.balanceMicrousd='100000000';
   if(cycle===1){send(j,'reload-declined');coordinator.tick();}
   send(j,'complete',{depositId,reloadId:'sample-reload-'+cycle,cardDebitMicrousd:'100000000',providerCreditMicrousd:'100000000'});
   // Invented usage consumes each new reload before the next funding cycle.
   s.automatic.input.card.balanceMicrousd=s.records.feeds.solcard.data.balanceMicrousd='0';
   s.shadow.ledger.proposedProviderFunding=String(BigInt(cycle+1)*100000000n);
   s.shadow.ledger.providerAccounting.usage=s.shadow.ledger.proposedProviderFunding;
  }
  const result=coordinator.tick();
  return {mode:'sample-fixtures',result,remainingComputeWbtcUnits:s.automatic.input.wallet.amountUnits,otherTreasuryWbtcUnits:'300000',simulatedUsageMicrousd:s.shadow.ledger.providerAccounting.usage,...COORDINATOR_FLAGS};
 }finally{coordinator.close();}
}

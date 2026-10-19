import {createHash} from 'node:crypto';
import {ComputeTreasury,WBTC} from './treasury-compute.js';
import {decode58} from './solana-evidence.js';

export const SOLCARD_SUPPORT=Object.freeze({network:'solana-mainnet',mint:WBTC.mint,decimals:8,
 source:'https://www.solcard.cc/blog/wbtc-weth-crypto-card',checkedOn:'2026-10-18',
 route:'solcard-wbtc',conversion:'SolCard credits USD after confirmation; no external swap'});
const number=v=>{if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,23})$/.test(v))throw Error('invalid_funding_units');return BigInt(v);};
const positive=v=>{const n=number(v);if(!n)throw Error('invalid_funding_units');return n;};
const fresh=(at,now,age)=>{const delta=now-Date.parse(at);return Number.isFinite(delta)&&delta>=0&&delta<=age;};
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const pending=p=>p.route==='solcard-wbtc'&&!['cancelled','provider-credited'].includes(p.state);
const id=v=>{if(typeof v!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(v))throw Error('invalid_funding_id');return v;};

// This profile contains observations, not credentials or permission to spend.
export function validateFundingProfile(p){
 if(p?.schema!=='bithash.solcard-profile.v1'||p.network!=='solana-mainnet'||p.mint!==WBTC.mint||p.decimals!==8||p.slotNumber!==1)throw Error('funding_profile_mismatch');
 decode58(p.depositAddress,32);
 if(p.confirmedDepositAddress!==p.depositAddress)throw Error('deposit_address_mismatch');
 if(!Number.isFinite(Date.parse(p.observedAt)))throw Error('invalid_card_observation');
 if(p.cardStatus!=='ACTIVE')throw Error('card_not_active');
 if(p.cardLimits){const lo=positive(p.cardLimits.minWbtcUnits),hi=positive(p.cardLimits.maxWbtcUnits);if(lo>hi)throw Error('invalid_card_limits');}
 if(p.policy){positive(p.policy.maxTransferWbtcUnits);positive(p.policy.maxDailyWbtcUnits);positive(p.policy.minSolReserveLamports);positive(p.policy.maxNetworkFeeLamports);
  if(p.policy.minRetainedWbtcUnits!==undefined)number(p.policy.minRetainedWbtcUnits);
  if(number(p.policy.maxTransferWbtcUnits)>number(p.policy.maxDailyWbtcUnits))throw Error('invalid_funding_policy');}
 return p;
}

// Read-only decision: never reserves real funds, builds a transaction or invokes a signer.
export function previewFunding(treasury,profile,{amount,now=treasury.clock()}={}){
 const s=treasury.snapshot(),reasons=[];
 const result={schema:'bithash.funding-preview.v1',mode:'dry-run',observedAt:new Date(now).toISOString(),
  state:'held',amount:amount??null,route:SOLCARD_SUPPORT,feeSource:s.mode,
  availableWbtcUnits:s.availableWbtcUnits,reasons,paymentsEnabled:false,gpuExperimentsEnabled:false,
  nextSteps:['WBTC transfer to the fixed project SolCard address','Finalized chain confirmation',
   'Match the deposit to net USD credited by SolCard','Confirm the project-funded Runpod credit'],
  warning:'Planning only. No signer, payment, card billing or GPU action is connected.'};
 let n;
 try{n=positive(amount);}catch{reasons.push('enter_wbtc_amount');}
 if(!profile){reasons.push('solcard_profile_missing');return result;}
 if(treasury.setting('solcardBackendError'))reasons.push('solcard_backend_unavailable');
 try{validateFundingProfile(profile);}catch(e){reasons.push(e.message);return result;}
 result.card={slotNumber:profile.slotNumber,status:profile.cardStatus,balanceMicrousd:profile.cardBalanceMicrousd??null,
  depositAddress:profile.depositAddress,observationFresh:fresh(profile.observedAt,now,300000)};
 if(!result.card.observationFresh)reasons.push('refresh_solcard_observation');
 if(!s.walletFresh)reasons.push('refresh_wallet_observation');
 if(n!==undefined&&s.availableWbtcUnits!==null&&n>number(s.availableWbtcUnits))reasons.push('insufficient_fee_allocated_wbtc');
 if(pendingPlans(s).length)reasons.push('reconcile_existing_funding');
 if(!profile.cardLimits)reasons.push('card_limits_missing');
 else {
  if(!fresh(profile.cardLimits.observedAt,now,86400000))reasons.push('refresh_card_limits');
  if(n!==undefined&&(n<number(profile.cardLimits.minWbtcUnits)||n>number(profile.cardLimits.maxWbtcUnits)))reasons.push('outside_card_limits');
 }
 if(!profile.policy)reasons.push('owner_funding_limits_not_set');
 else {
  const spent=s.plans.filter(p=>p.route==='solcard-wbtc'&&p.state!=='cancelled'&&
   Number.isFinite(Date.parse(p.createdAt))&&Date.parse(p.createdAt)>=now-86400000)
   .reduce((sum,p)=>sum+number(p.amount),0n);
  result.rolling24hCommittedWbtcUnits=spent.toString();
  if(n!==undefined&&n>number(profile.policy.maxTransferWbtcUnits))reasons.push('per_transfer_cap_exceeded');
  if(n!==undefined&&spent+n>number(profile.policy.maxDailyWbtcUnits))reasons.push('daily_cap_exceeded');
  const gas=profile.gasObservation;
  if(!gas||gas.wallet!==s.wallets?.computeWallet||!fresh(gas.observedAt,now,300000))reasons.push('refresh_sol_balance');
  else {try{if(number(gas.lamports)<number(profile.policy.minSolReserveLamports)+number(profile.policy.maxNetworkFeeLamports))reasons.push('insufficient_sol_reserve');}catch{reasons.push('invalid_sol_balance');}}
 }
 if(!s.wallets)reasons.push('treasury_wallets_missing');
 if(profile.depositAddress===s.wallets?.computeWallet||profile.depositAddress===s.wallets?.otherWallet)reasons.push('invalid_deposit_destination');
 if(!reasons.length)result.state='review-ready';
 result.digest=digest({...result,digest:undefined});return result;
}
const pendingPlans=s=>s.plans.filter(pending);

function onlySimulation(t){if(t.mode!=='simulation')throw Error('real_funding_execution_disabled');}

// Durable offline state machine. No network client or signer is accepted, even as an argument.
// The only executable route in this release uses a simulation-mode ledger.
export function prepareSimulatedFunding(treasury,profile,{id:planId,amount}){
 onlySimulation(treasury);id(planId);validateFundingProfile(profile);positive(amount);
 const terms={amount,slotNumber:profile.slotNumber,depositAddress:profile.depositAddress,mint:profile.mint,
  network:profile.network,policy:profile.policy,cardLimits:profile.cardLimits};
 const termsDigest=digest(terms);
 return treasury.transaction(()=>{
  const old=treasury.getPlan(planId);
  if(old){if(old.funding?.termsDigest!==termsDigest)throw Error('funding_terms_changed');return old;}
  const decision=previewFunding(treasury,profile,{amount});
  if(decision.state!=='review-ready')throw Error('funding_held_'+decision.reasons[0]);
  const p={id:planId,amount,route:'solcard-wbtc',state:'planned',createdAt:new Date(treasury.clock()).toISOString(),source:'simulation',
   funding:{terms,termsDigest,phase:'prepared',submitAttempts:0}};
  treasury.savePlan(p);return p;
 });
}

export function stepSimulatedFunding(treasury,planId,action,{amount}={}){
 onlySimulation(treasury);id(planId);
 return treasury.transaction(()=>{
  const p=treasury.getPlan(planId);if(!p?.funding||p.source!=='simulation')throw Error('unknown_simulation');
  const f=p.funding,at=new Date(treasury.clock()).toISOString();
  if(action==='submit'){
   if(f.phase!=='prepared')return p; // Lost response or restart never makes a second send.
   if(p.state!=='planned')throw Error('invalid_simulation_transition');
   f.submitAttempts=1;f.phase='awaiting-chain';
   p['deposit-submitted']={amount:p.amount,reference:'simulation-chain-'+planId,at};p.state='deposit-submitted';
   treasury.walletUnavailable();
  } else if(action==='confirm-chain'){
   if(['chain-confirmed','card-credited','complete'].includes(f.phase))return p;
   if(f.phase!=='awaiting-chain')throw Error('invalid_simulation_transition');
   f.phase='chain-confirmed';f.chain={status:'finalized',reference:p['deposit-submitted'].reference,source:'simulation',at};
  } else if(action==='fail-chain'){
   if(f.phase==='failed-final')return p;
   if(f.phase!=='awaiting-chain')throw Error('invalid_simulation_transition');
   f.phase='failed-final';f.chain={status:'failed',source:'simulation',at}; // Held for reconciliation, no auto-release.
  } else if(action==='credit-card'||action==='credit-provider'){
   positive(amount);
   const stage=action==='credit-card'?'card-funded':'provider-credited',required=action==='credit-card'?'chain-confirmed':'card-credited';
   if(p[stage]){if(p[stage].amount!==amount)throw Error('conflicting_replay');return p;}
   if(f.phase!==required)throw Error('invalid_simulation_transition');
   if(stage==='provider-credited'&&number(amount)>number(p['card-funded'].amount))throw Error('credit_exceeds_card_funds');
   p[stage]={amount,reference:'simulation-'+stage+'-'+planId,at};p.state=stage;f.phase=action==='credit-card'?'card-credited':'complete';
  } else throw Error('unknown_simulation_action');
  treasury.event('simulation-'+action+'-'+planId,'simulation-funding',{planId,action,amount:amount??null});
  treasury.savePlan(p);return p;
 });
}

// Reusable demo fixture; deliberately uses different wallet/card addresses and a separate DB.
export function rehearsalFixture(now=Date.now()){
 const at=new Date(now).toISOString();
 return {wallets:{computeWallet:'11111111111111111111111111111111',otherWallet:'So11111111111111111111111111111111111111112'},
  profile:{schema:'bithash.solcard-profile.v1',network:'solana-mainnet',mint:WBTC.mint,decimals:8,slotNumber:1,
   depositAddress:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',confirmedDepositAddress:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',cardStatus:'ACTIVE',cardBalanceMicrousd:'0',observedAt:at,
   cardLimits:{minWbtcUnits:'10000',maxWbtcUnits:'125310000',observedAt:at,source:'simulation'},
   policy:{maxTransferWbtcUnits:'1000000',maxDailyWbtcUnits:'2000000',minSolReserveLamports:'10000000',maxNetworkFeeLamports:'1000000'},
   gasObservation:{wallet:'11111111111111111111111111111111',lamports:'20000000',observedAt:at,source:'simulation'}}};
}
export function runFundingRehearsal(){
 const t=new ComputeTreasury(':memory:',{mode:'simulation'}),{wallets,profile}=rehearsalFixture(t.clock());
 try{
  t.configure(wallets);t.recordFees({reference:'simulation-fee-batch',amount:'10000000'});
  t.observeWallets({...wallets,mint:WBTC.mint,decimals:8,computeAmount:'7000000',otherAmount:'3000000',observedAt:new Date(t.clock()).toISOString(),source:'simulation'});
  const steps=[],planId='rehearsal';
  steps.push(prepareSimulatedFunding(t,profile,{id:planId,amount:'1000000'}).funding.phase);
  steps.push(stepSimulatedFunding(t,planId,'submit').funding.phase);
  stepSimulatedFunding(t,planId,'submit'); // Response-loss replay is a no-op.
  steps.push(stepSimulatedFunding(t,planId,'confirm-chain').funding.phase);
  steps.push(stepSimulatedFunding(t,planId,'credit-card',{amount:'600000000'}).funding.phase);
  steps.push(stepSimulatedFunding(t,planId,'credit-provider',{amount:'500000000'}).funding.phase);
  t.observeProvider({availableMicrousd:'900000000'}); // Extra personal credit cannot inflate project budget.
  return {schema:'bithash.funding-rehearsal.v1',mode:'simulation',completedAt:new Date(t.clock()).toISOString(),steps,
   submitAttempts:t.getPlan(planId).funding.submitAttempts,availableProjectCreditMicrousd:t.snapshot().availableProviderMicrousd,
   fixtureWbtcUnits:'1000000',fixtureCardCreditMicrousd:'600000000',fixtureProviderCreditMicrousd:'500000000',
   paymentsSent:0,gpuActions:0,warning:'Offline invented amounts; no exchange-rate quote or actual payment. Separate in-memory ledger.'};
 }finally{t.close();}
}

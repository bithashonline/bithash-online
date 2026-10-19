import {fundingReadiness,validateDryRules} from './automatic-funding.js';
import {AUTOPAY_POLICY,planAutoPay,AUTOPAY_FLAGS} from './runpod-autopay-simulation.js';
const n=v=>{if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,23})$/.test(v))throw Error('coordinator_invalid_amount');return BigInt(v);};
const min=(...v)=>v.reduce((a,b)=>a<b?a:b),max=(a,b)=>a>b?a:b;

// Same native-reload policy as the simulation, with the real coordinator's
// provenance, freshness, SOL, WBTC reserve and owner-configured limits retained.
// Values remain dry-run assumptions; this is not a conversion or spending quote.
export function decideCoordinatorFunding(input,policy,now,{dailyDepositMicrousd='0'}={}){
 const p=validateDryRules(policy),reasons=fundingReadiness(input,p,now);
 const result={mode:'dry-run',action:'hold',reasons,amountWbtcUnits:'0',estimatedUsdMicros:'0',reloadMicrousd:AUTOPAY_POLICY.reloadMicrousd,priceBasis:'Simulation price assumption; not an executable SolCard quote',...AUTOPAY_FLAGS};
 if(reasons.length)return result;
 const card=n(input.card.balanceMicrousd),provider=n(input.provider.balanceMicrousd),price=n(p.assumedWbtcPriceMicrousd);
 const reserve=max(n(p.walletReserveUnits),n(AUTOPAY_POLICY.retainedWbtcUnits));
 const available=min(max(n(input.feeComputeUnits)-n(input.committedUnits),0n),max(n(input.wallet.amountUnits)-reserve,0n));
 result.availableFeeWbtcUnits=String(available);
 const plan=planAutoPay({cardMicrousd:String(card),providerMicrousd:String(provider),hourlyMicrousd:p.hourlyMicrousd,fresh:true,dailyDepositMicrousd});
 result.reloadPolicy=plan;reasons.push(plan.reason);
 if(plan.action!=='would-fund-card'){
  if(['ready','would-observe-reload'].includes(plan.action))result.action='would_review_provider_reload';
  return result;
 }
 const amount=(n(plan.cardFundingMicrousd)*100000000n+price-1n)/price,estimated=amount*price/100000000n;
 const cardMin=n(input.cardLimits.minUnits),cardMax=n(input.cardLimits.maxUnits);
 if(!cardMin||cardMin>cardMax)throw Error('invalid_card_limits');
 const cap=min(available,n(p.maxTransferUnits),max(n(p.maxDailyUnits)-n(input.dailyCommittedUnits),0n),cardMax);
 if(amount<cardMin||amount>cap){reasons.push('full_reload_batch_not_available_within_limits');return result;}
 if(card+estimated>n(p.maxCardFloatMicrousd)||card+provider+estimated>n(AUTOPAY_POLICY.maxFloatMicrousd)||n(dailyDepositMicrousd)+estimated>n(AUTOPAY_POLICY.dailyDepositMicrousd)){
  reasons.push('rounded_batch_exceeds_float_or_daily_limit');return result;
 }
 result.action='would_top_up_solcard';result.amountWbtcUnits=String(amount);result.estimatedUsdMicros=String(estimated);return result;
}

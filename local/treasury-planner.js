import {draftLive} from './operator-live.js';

// This gate is local to the Operator. It does not grant owner approval or change
// the remote executor's deadlines. Disable by default while GPU experiments pause.
export async function draftTreasurySession(directory,limits,{treasury,gpuProposalsEnabled=false,call,...options}={}){
 if(!treasury)throw Error('treasury_not_connected');
 if(!gpuProposalsEnabled)return {state:'held',reason:'GPU proposals paused. Treasury tracking remains active.'};
 const s=treasury.snapshot();
 if(s.mode!=='owner-recorded'&&options.simulation!==true)throw Error('simulation_budget_forbidden');
 let heldId=null;
 const fundedCall=async(action,input)=>{
  if(['quote-ai','quote-range-ai','quote-fleet-ai'].includes(action)){
   const current=treasury.snapshot(),cap=BigInt(limits.capMicrousd);
   if(current.availableProviderMicrousd===null||cap>BigInt(current.availableProviderMicrousd))throw Error('insufficient_provider_budget');
   const ticket=await call(action,input);
   // Server must retain the exact requested ceiling.
   if(ticket.limits.capMicrousd!==limits.capMicrousd)throw Error('funding_cap_mismatch');
   return ticket;
  }
  if(action!=='propose-ai')throw Error('treasury_action_forbidden');
  if(input.choice.optionId==='hold')return call(action,input);
  // Saved pending submissions reuse this id. An unknown remote result keeps the
  // reservation; no automatic release/retry with a new budget or plan id.
  const result=await call(action,input);if(result.state==='held')treasury.settle(heldId,'0');return result;
 };
 const beforeSubmit=async(ticket,choice)=>{
  if(choice.optionId==='hold')return;
  // A pending draft may have older limits. Never reserve the new form's smaller
  // cap against a saved proposal with a larger ceiling.
  if(ticket.limits.capMicrousd!==limits.capMicrousd)throw Error('funding_cap_mismatch');
  heldId=ticket.id;treasury.reserve(heldId,ticket.limits.capMicrousd);
 };
 const result=await draftLive(directory,limits,{...options,call:fundedCall,beforeSubmit,fundingContext:{availableBudget:s.availableProviderMicrousd,source:s.mode,currency:'USD-microunits'}});
 return {...result,treasuryReservationId:heldId};
}

import {readFundingSecret} from './funding-secrets.js';
// Reload history and balance use GraphQL; account usage uses REST v2 billing.
export const RUNPOD_FUNDING_QUERY=`query BitHashFundingRecords($start: DateTime!, $end: DateTime!) {
 myself { id clientBalance
 stripeReloadHistory(startDate: $start, endDate: $end) {
  id transactionCompletedAt amount medium type
 } }
}`;
export async function readRunpodFunding({credentialPath,usageStartTime,readSecret=readFundingSecret,fetcher=fetch,clock=Date.now}){
 if(!credentialPath)throw Error('runpod_funding_not_connected');
 const now=clock(),start=new Date(now-90*86400000).toISOString(),end=new Date(now).toISOString(),anchor=Date.parse(usageStartTime);
 // Persist this anchor: never silently roll a spend counter forward.
 if(!Number.isFinite(anchor)||anchor%86400000!==0||anchor>now||now-anchor>365*86400000)throw Error('runpod_usage_anchor_invalid_or_expired');
 let key;try{key=await readSecret(credentialPath);}catch{throw Error('runpod_funding_credential_unavailable');}
 if(!key||key.length>8192)throw Error('runpod_funding_credential_unavailable');
 async function read(url,options){
  let response;try{response=await fetcher(url,{...options,redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'}});}catch{throw Error('runpod_funding_unreachable');}
  if(!response.ok)throw Error(response.status===401||response.status===403?'runpod_funding_authorization_required':'runpod_funding_unavailable');
  const text=await response.text();if(text.length>2097152)throw Error('runpod_funding_response_too_large');
  try{return JSON.parse(text);}catch{throw Error('runpod_funding_invalid_response');}
 }
 try{
  const body=await read('https://api.runpod.io/graphql',{method:'POST',body:JSON.stringify({query:RUNPOD_FUNDING_QUERY,variables:{start,end}})});
  if(body.errors?.length||!body.data?.myself)throw Error('runpod_funding_query_rejected');
  const billingWindow={start:new Date(anchor).toISOString(),end:new Date(Math.ceil(now/86400000)*86400000).toISOString(),bucketSize:'day'};
  const url=new URL('https://api.runpod.io/v2/billing');url.search=new URLSearchParams({startTime:billingWindow.start,endTime:end,bucketSize:'day'}).toString();
  const billing=await read(url.toString(),{method:'GET'});
  return {observedAt:end,window:{start,end},account:body.data.myself,billing,billingWindow};
 }finally{key=null;}
}


import {readFundingSecret} from './funding-secrets.js';
// Official GraphQL schema exposes reload history; REST v2 billing is usage only.
export const RUNPOD_FUNDING_QUERY=`query BitHashFundingRecords($start: DateTime!, $end: DateTime!) {
 myself { id clientBalance stripeReloadHistory(startDate: $start, endDate: $end) {
  id transactionCompletedAt amount medium type
 } }
}`;
export async function readRunpodFunding({credentialPath,readSecret=readFundingSecret,fetcher=fetch,clock=Date.now}){
 if(!credentialPath)throw Error('runpod_funding_not_connected');
 const now=clock(),start=new Date(now-90*86400000).toISOString(),end=new Date(now).toISOString();
 let key;try{key=await readSecret(credentialPath);}catch{throw Error('runpod_funding_credential_unavailable');}
 if(!key||key.length>8192)throw Error('runpod_funding_credential_unavailable');
 let response;
 try{response=await fetcher('https://api.runpod.io/graphql',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({query:RUNPOD_FUNDING_QUERY,variables:{start,end}})});}catch{throw Error('runpod_funding_unreachable');}finally{key=null;}
 if(!response.ok)throw Error(response.status===401||response.status===403?'runpod_funding_authorization_required':'runpod_funding_unavailable');
 const text=await response.text();if(text.length>2097152)throw Error('runpod_funding_response_too_large');
 let body;try{body=JSON.parse(text);}catch{throw Error('runpod_funding_invalid_response');}
 if(body.errors?.length||!body.data?.myself)throw Error('runpod_funding_query_rejected');
 return {observedAt:end,window:{start,end},account:body.data.myself};
}

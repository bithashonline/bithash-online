import {WalletExecution} from './wallet-execution.js';
import {feeAddresses} from './fee-detection.js';
import {sha256} from './restricted-wallet-signer.js';
const hash=v=>sha256(JSON.stringify(v));

function collectionIntent(collection){
 const s=collection.status(),o=s.observation,c=s.configuration;
 if(s.busy||!c||!o?.fresh||o.state!=='unsigned-preview'||o.reasons.length)return null;
 const observation={routing:{addresses:feeAddresses(c),recipients:o.recipients},amounts:o.amounts,steps:o.steps,initializeRecipientAtas:o.initializeRecipientAtas};
 if(!Number.isSafeInteger(s.receipts?.count)||s.receipts.count<0)throw Error('wallet_collection_receipt_epoch_invalid');
 const terms={kind:'collection',owner:c.computeWallet,configuration:c,observation,receiptEpoch:s.receipts.count};
 // Amount changes invalidate the pending draft; a blockhash refresh alone does not.
 return {id:'collection-'+hash(terms).slice(0,24),...terms};
}

// Production factory deliberately ignores activation fields in external config.
// No custody loader or broadcaster is supplied. These gates require a separately
// reviewed deployment change; a browser/config toggle cannot enable this service.
export function connectDisabledWalletExecution(path,{funding,collection,rewards,clock=Date.now}={}){
 return new WalletExecution(path,{
  signingEnabled:false,broadcastEnabled:false,clock,
  source:()=>{const c=collectionIntent(collection);return [...funding.executionIntents(),...rewards.executionIntents(),...(c?[c]:[])];},
  prepare:async i=>{
   if(i.kind==='funding')return funding.executionPreflight(i.id);
   if(i.kind==='reward')return rewards.preflightPayout(i.roundId,i.payoutId);
   await collection.refresh();const current=collectionIntent(collection),o=collection.status().observation;
   if(!current||hash(current)!==hash(i))throw Error('wallet_collection_draft_changed');
   return {...o,state:o.state==='unsigned-preview'?'checks-passed':'held'};
  },
  onSignature:(i,signature)=>{
   if(i.kind==='funding')funding.attachSignature(i.id,signature);
   else if(i.kind==='reward')rewards.attachExistingSignature(i.roundId,i.payoutId,signature);
   // Collection distributions are already discovered by the finalized fee observer.
  }
 });
}

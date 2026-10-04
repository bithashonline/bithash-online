import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeReceipt, fetchReceipt, ReceiptStore, sample } from './receipts.js';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/archived-fee-receipt.json',import.meta.url),'utf8'));
const copy = () => structuredClone(fixture);
const provenance = {mode:'archived-rpc-unrefreshed',source:'saved public RPC fixture',observedAt:'2026-10-02'};
test('saved real native fee transfer reconciles exactly without mint inference',()=>{
  const rows=decodeReceipt(copy()); assert.equal(rows.length,1);
  assert.equal(rows[0].amountLamports,'3056738'); assert.equal(rows[0].mint,null);
  assert.equal(rows[0].outerIndex,2); assert.equal(rows[0].innerIndex,0);
});
test('missing, failed and wrong-signature receipts fail closed',()=>{
  assert.throws(()=>decodeReceipt(null));
  let t=copy();t.meta.err={InstructionError:[2,'failure']};assert.throws(()=>decodeReceipt(t));
  t=copy();delete t.meta.err;assert.throws(()=>decodeReceipt(t));
  t=copy();t.transaction.signatures[0]='wrong';assert.throws(()=>decodeReceipt(t));
});
test('ordinary deposits and wrong program, route or instruction cannot count as fees',()=>{
  for(const mutate of [
    t=>t.transaction.message.instructions[2].programId='11111111111111111111111111111111',
    t=>t.transaction.message.instructions[2].data='11111111',
    t=>t.transaction.message.instructions[2].accounts[1]=sample.recipient,
    t=>t.meta.innerInstructions[0].instructions[0].parsed.info.source=sample.recipient,
    t=>t.meta.innerInstructions[0].instructions[0].stackHeight=3,
  ]){const t=copy();mutate(t);assert.throws(()=>decodeReceipt(t));}
});
test('imprecise amounts, missing evidence, duplicate instruction groups and balance mismatch reject',()=>{
  for(const mutate of [
    t=>t.meta.innerInstructions[0].instructions[0].parsed.info.lamports=9007199254740992,
    t=>t.meta.innerInstructions[0].instructions[0].parsed.info.lamports=-1,
    t=>t.meta.innerInstructions=[],
    t=>t.meta.innerInstructions.push(t.meta.innerInstructions[0]),
    t=>t.meta.postBalances[t.transaction.message.accountKeys.findIndex(k=>k.pubkey===sample.recipient)]++,
  ]){const t=copy();mutate(t);assert.throws(()=>decodeReceipt(t));}
});
test('durable import is idempotent after reopen; conflicts leave balance unchanged',t=>{
  const dir=mkdtempSync(join(tmpdir(),'fee-observer-')),path=join(dir,'test.sqlite');
  let store=new ReceiptStore(path);t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
  assert.equal(store.import(copy(),provenance).inserted,1);
  store.close();store=new ReceiptStore(path);
  assert.equal(store.import(copy(),provenance).inserted,0);
  const changed=copy();changed.meta.innerInstructions[0].instructions[0].parsed.info.lamports++;
  const keys=changed.transaction.message.accountKeys.map(k=>k.pubkey);
  changed.meta.postBalances[keys.indexOf(sample.recipient)]++;
  changed.meta.postBalances[keys.indexOf(sample.source)]--;
  assert.throws(()=>store.import(changed,provenance),/Conflicting/);
  assert.equal(store.report().observedLamports,'3056738');
  assert.equal(store.report().platformAvailableLamports,'0');
  assert.equal(store.report().evidence.length,1);
});
function rpcMock(results,calls=[]){return async (url,options)=>{
  calls.push(JSON.parse(options.body));return {ok:true,json:async()=>({result:results.shift()})};
};}
test('live reader requests finalized commitment and independently checks signature status',async()=>{
  const calls=[];
  const result=await fetchReceipt('https://rpc.example',sample.signature,rpcMock([copy(),{value:[{slot:fixture.slot,err:null,confirmationStatus:'finalized'}]}],calls));
  assert.equal(result.provenance.mode,'live-finalized-rpc');
  assert.deepEqual(calls.map(c=>c.method),['getTransaction','getSignatureStatuses']);
  assert.equal(calls[0].params[1].commitment,'finalized');
  assert.equal(calls[1].params[1].searchTransactionHistory,true);
});
test('null RPC result, pending/failed status, wrong slot, errors and timeout fail closed',async()=>{
  await assert.rejects(()=>fetchReceipt('https://rpc.example',sample.signature,rpcMock([null])),/unavailable/);
  for(const status of [null,{slot:fixture.slot,err:null,confirmationStatus:'confirmed'},
    {slot:fixture.slot,err:{failed:true},confirmationStatus:'finalized'},
    {slot:fixture.slot+1,err:null,confirmationStatus:'finalized'}]) {
    await assert.rejects(()=>fetchReceipt('https://rpc.example',sample.signature,rpcMock([copy(),{value:[status]}])));
  }
  await assert.rejects(()=>fetchReceipt('http://rpc.example',sample.signature,rpcMock([])),/HTTPS/);
  await assert.rejects(()=>fetchReceipt('https://rpc.example',sample.signature,async()=>({ok:false})),/HTTP/);
  await assert.rejects(()=>fetchReceipt('https://rpc.example',sample.signature,async()=>({ok:true,json:async()=>({error:{code:-1}})})),/error/);
  await assert.rejects(()=>fetchReceipt('https://rpc.example',sample.signature,async()=>{throw Error('timeout');}),/timeout/);
});

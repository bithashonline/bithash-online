import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,PublicKey} from '@solana/web3.js';
import {buildPreview} from './builder.js';
const key=()=>Keypair.generate().publicKey.toBase58();
const input=()=>({mode:'unsigned-preview',name:'Puzzle Preview',symbol:'PZTEST',uri:'https://example.invalid/metadata.json',payer:key(),mint:key(),treasury:key(),computeShareBps:10000});
test('real SDK encodes correct recipients, split and regular coin flags',async()=>{
  const draft=input();draft.computeShareBps=8000;const {instructions,summary}=await buildPreview(draft);
  const lock=instructions[2].data;
  assert.equal(lock.readUInt32LE(8),2);
  assert.equal(new PublicKey(lock.subarray(12,44)).toBase58(),draft.treasury);
  assert.equal(lock.readUInt16LE(44),8000);
  assert.equal(new PublicKey(lock.subarray(46,78)).toBase58(),draft.payer);
  assert.equal(lock.readUInt16LE(78),2000);
  let offset=8;const create=instructions[0].data;
  for(const text of [draft.name,draft.symbol,draft.uri]) {const length=create.readUInt32LE(offset);offset+=4;assert.equal(create.subarray(offset,offset+length).toString(),text);offset+=length;}
  assert.equal(new PublicKey(create.subarray(offset,offset+32)).toBase58(),draft.payer);offset+=32;
  assert.ok(create.subarray(offset).every(byte=>byte===0),'mayhem/cashback/creator-fee override/holder reward all disabled');
  assert.equal(summary.submitted,false);assert.equal(summary.simulated,false);
});
test('sample combined packet is oversized while explicit separate packets fit',async()=>{
  const {summary}=await buildPreview(input());assert.equal(summary.combined.bytes,1304);
  assert.equal(summary.combined.fits,false);assert.equal(summary.separate.create.fits,true);assert.equal(summary.separate.configure.fits,true);
  assert.equal(summary.atomicExecutionVerified,false);assert.equal(summary.combined.signerCount,2);
});
test('maximum metadata byte sizes remain measurable and invalid byte lengths reject',async()=>{
  const draft=input();draft.name='N'.repeat(32);draft.symbol='S'.repeat(13);draft.uri='https://example.invalid/'+'x'.repeat(176);
  const {summary}=await buildPreview(draft);assert.ok(summary.combined.bytes>1304);
  draft.name='😀'.repeat(9);await assert.rejects(()=>buildPreview(draft),/UTF-8/);
});
test('unknown destinations, missing split, invalid integers and conflicting signer keys reject',async()=>{
  for(const changes of [{treasury:'bad'},{payer:PublicKey.default.toBase58()},{computeShareBps:undefined},{computeShareBps:0},{computeShareBps:10001},{computeShareBps:12.5},{computeShareBps:'8000'}])await assert.rejects(()=>buildPreview({...input(),...changes}));
  const draft=input();draft.mint=draft.payer;await assert.rejects(()=>buildPreview(draft),/distinct/);
});
test('unsupported financial/mode choices cannot silently become a different transaction',async()=>{
  for(const changes of [{mode:'live'},{holderReward:true},{holderReward:'false'},{cashback:true},{mayhemMode:true},{initialBuyLamports:'1'},{initialBuyLamports:0},{quoteMint:key()},{uri:'javascript:alert(1)'},{uri:'https://user:secret@example.invalid/m.json'}])await assert.rejects(()=>buildPreview({...input(),...changes}));
});
test('100 percent fee routing encodes exactly one shareholder',async()=>{
  const draft=input();const {instructions,summary}=await buildPreview(draft);
  assert.equal(instructions[2].data.readUInt32LE(8),1);assert.equal(instructions[2].data.readUInt16LE(44),10000);
  assert.equal(summary.shares.length,1);assert.deepEqual(summary.combined.signers,[draft.payer,draft.mint]);
});
test('direct creator route encodes treasury without fee config and fits sample packet',async()=>{
  const draft={...input(),routingMode:'direct-creator'};const {summary,instructions}=await buildPreview(draft);
  assert.equal(instructions.length,1);assert.equal(summary.sharingConfig,null);assert.equal(summary.combined.bytes,859);
  assert.equal(summary.combined.fits,true);assert.equal(summary.atomicExecutionVerified,false);
  let offset=8;for(let i=0;i<3;i++){offset+=4+instructions[0].data.readUInt32LE(offset);}
  assert.equal(new PublicKey(instructions[0].data.subarray(offset,offset+32)).toBase58(),draft.treasury);
  await assert.rejects(()=>buildPreview({...draft,computeShareBps:8000}),/all creator fees/);
  await assert.rejects(()=>buildPreview({...draft,routingMode:'other'}),/Unknown/);
});

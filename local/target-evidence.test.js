import test from 'node:test';
import assert from 'node:assert/strict';
import { assessTarget, observeTarget, explorers, puzzle71 } from './target-evidence.js';
const now=Date.parse('2026-10-07T23:05:00Z');
function rows() {
  return explorers.map(source=>({source,observedUtc:new Date(now).toISOString(),result:{address:puzzle71.address,
    chain_stats:{funded_txo_count:69,funded_txo_sum:710191680,spent_txo_count:0,spent_txo_sum:0,tx_count:69},
    mempool_stats:{funded_txo_count:0,funded_txo_sum:0,spent_txo_count:0,spent_txo_sum:0,tx_count:0}}}));
}
test('corroborated fixture evidence yields exact balance but never enables searching',()=>{
  const r=assessTarget(rows(),now);
  assert.equal(r.status,'FUNDED_NO_SPEND_OBSERVED');assert.equal(r.corroboratedBalanceSatoshis,'710191680');
  assert.equal(r.searchEnabled,false);assert.equal(r.publicKeyStatus,'NOT_VERIFIED');
  assert.equal(BigInt(puzzle71.endExclusive)-BigInt(puzzle71.start),2n**70n);
});
test('stale, future, duplicate, missing, disagreeing or wrong-address evidence pauses',()=>{
  assert.equal(assessTarget(rows(),now+600001).status,'PAUSED_EVIDENCE');
  assert.equal(assessTarget(rows(),now-1).status,'PAUSED_EVIDENCE');
  for(const change of [r=>r.pop(),r=>r.push(r[0]),r=>r[0].result.address='wrong',
    r=>r[0].result.chain_stats.funded_txo_sum++,r=>r[0].result.chain_stats.funded_txo_sum=Number.MAX_SAFE_INTEGER+1]) {
    const r=rows();change(r);assert.equal(assessTarget(r,now).status,'PAUSED_EVIDENCE');
  }
});
test('confirmed spend, pending spend, funding movement and empty balance pause',()=>{
  for(const change of [r=>{r.result.chain_stats.spent_txo_count=1;r.result.chain_stats.spent_txo_sum=1;},
    r=>{r.result.mempool_stats.spent_txo_count=1;r.result.mempool_stats.spent_txo_sum=710191680;},
    r=>{r.result.mempool_stats.funded_txo_count=1;r.result.mempool_stats.funded_txo_sum=1;},
    r=>r.result.chain_stats.funded_txo_sum=0]) {
    const r=rows();r.forEach(change);assert.equal(assessTarget(r,now).status,'PAUSED_EVIDENCE');
  }
});
test('read-only fetch uses fixed endpoints and treats HTTP/schema failures as unavailable',async()=>{
  const visited=[];
  const observations=await observeTarget(async url=>{visited.push(url);return {ok:false};});
  assert.deepEqual(visited,explorers.map(s=>`${s}/address/${puzzle71.address}`));
  assert.equal(assessTarget(observations).status,'PAUSED_EVIDENCE');
  assert.equal((await observeTarget(async()=>{throw Error('sensitive raw network error');}))[0].error,'Explorer unavailable or invalid');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { AllocationLedger, validatePolicy, splitAmount, budgetAccount } from './policies.js';
import { fixturePolicy, fixtureReceipt } from './allocation-fixtures.js';

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'allocation-test-')); const path = join(dir, 'state.sqlite');
  let c = new AllocationLedger(path);
  t.after(() => { c.close(); rmSync(dir, { recursive: true, force: true }); });
  return { get c() { return c; }, path, reopen() { c.close(); c = new AllocationLedger(path); return c; } };
}
test('strict versioned policies reject unset production terms and invalid categories', () => {
  const p = fixturePolicy(); assert.equal(validatePolicy(p).policyVersion, 1);
  for (const shares of [{compute: null, rewards: null, treasury: null}, {compute: 5000, rewards: 4000, treasury: 0},
    {compute: -1, rewards: 10001, treasury: 0}, {compute: 6000.5, rewards: 2000, treasury: 1999.5},
    {compute: 6000, rewards: 2000, creator: 2000}, {compute: 6000, rewards: 2000, burn: 2000}])
    assert.throws(() => validatePolicy({...p, mode: 'production', shares}));
  assert.throws(() => validatePolicy({...fixturePolicy('child','child'), shares: p.shares}));
  for (const patch of [{policyVersion: 0}, {mode:'live'}, {coin:'a:b'}, {asset:{id:'a',decimals:-1}},
    {target:{id:'x',version:0}}, {unexpected:true}]) assert.throws(() => validatePolicy({...p,...patch}));
});
test('1-unit, zero shares, deterministic tie and huge amounts conserve exactly', () => {
  const p = fixturePolicy(); assert.deepEqual(splitAmount('1',p), {compute:'1',rewards:'0',treasury:'0'});
  assert.deepEqual(splitAmount('1',fixturePolicy('m','main',{compute:5000,rewards:5000,treasury:0})),{compute:'1',rewards:'0',treasury:'0'});
  assert.deepEqual(splitAmount('7',fixturePolicy('m','main',{compute:0,rewards:10000,treasury:0})),{compute:'0',rewards:'7',treasury:'0'});
  for (let i=0; i<10001; i++) {
    const out = splitAmount(String(i),p);
    assert.equal(Object.values(out).reduce((n,v)=>n+BigInt(v),0n),BigInt(i));
  }
  const huge='999999999999999999999999999999999999';
  assert.equal(Object.values(splitAmount(huge,p)).reduce((n,v)=>n+BigInt(v),0n),BigInt(huge));
  assert.throws(()=>splitAmount(9007199254740992,p));
});
test('immutable identity, assets and policy versions survive restart', t => {
  const s=setup(t); const p=s.c.register(fixturePolicy());
  assert.throws(()=>s.c.register({...p, shares:{compute:10000,rewards:0,treasury:0}}));
  assert.throws(()=>s.c.register({...p,policyVersion:2,mint:'other'}));
  assert.throws(()=>s.c.register({...fixturePolicy('alias'),mint:p.mint}));
  assert.throws(()=>s.c.register({...fixturePolicy('c','child'),asset:{id:p.asset.id,decimals:6}}));
  const second={...p,policyVersion:2,shares:{compute:8000,rewards:1000,treasury:1000}};
  s.c.register(second); const c=s.reopen();
  assert.deepEqual(c.policy('main',1),p); assert.deepEqual(c.policy('main',2),second);
});
test('shared custody keeps two reward books isolated and compute sums without double counting', t => {
  const {c}=setup(t); const a=c.register(fixturePolicy('a','child')); const b=c.register(fixturePolicy('b','child'));
  c.allocate(fixtureReceipt(a,'a-fee','10000')); c.allocate(fixtureReceipt(b,'b-fee','20000'));
  assert.equal(c.balance(budgetAccount(a,'rewards')),2300n); assert.equal(c.balance(budgetAccount(b,'rewards')),4600n);
  assert.equal(c.balance(budgetAccount(a,'burn')),1600n);
  assert.equal(Object.values(c.reportAllocations().computePools)[0],'18300');
  assert.equal(c.reportAllocations().journalNet,'0');
  assert.equal(c.balance('available'),0n); // Cannot enter existing mock job funds implicitly.
});
test('different assets never combine in a compute pool or reward balance', t => {
  const {c}=setup(t); const p=c.register(fixturePolicy());
  const other=c.register({...p,policyVersion:2,asset:{id:'dummy-USDC',decimals:6}});
  c.allocate(fixtureReceipt(p,'sol','10000')); c.allocate(fixtureReceipt(other,'usd','20000'));
  const out=c.reportAllocations(); assert.equal(Object.keys(out.computePools).length,2);
  assert.deepEqual(out.journalNetByAsset,{'dummy-SOL':'0','dummy-USDC':'0'});
  assert.equal(c.balance(budgetAccount(p,'rewards')),2300n); assert.equal(c.balance(budgetAccount(other,'rewards')),4600n);
});
test('wrong coin/mint/asset/target, zero and live receipts create no funds', t => {
  const {c}=setup(t); const p=c.register(fixturePolicy()); const r=fixtureReceipt(p);
  for (const patch of [{coin:'unknown'}, {mint:'wrong'}, {asset:{id:'wrong',decimals:9}},
    {asset:{id:p.asset.id,decimals:6}}, {target:{id:p.target.id,version:2}}, {amount:'0'}, {mode:'production'}])
    assert.throws(()=>c.allocate({...r,...patch}));
  const prod=c.register({...fixturePolicy('production'),mode:'production'});
  assert.throws(()=>c.allocate({...fixtureReceipt(prod),mode:'fixture'}));
  assert.equal(c.reportAllocations().receipts,0); assert.equal(c.db.prepare('SELECT count(*) AS n FROM ledger').get().n,0);
});
test('replays deduplicate through restart and conflicting attribution is rejected', t => {
  const s=setup(t); const p=s.c.register(fixturePolicy()); const r=fixtureReceipt(p);
  const result=s.c.allocate(r); const c=s.reopen(); assert.deepEqual(c.allocate(r),result);
  for (const patch of [{amount:'10002'}, {custody:'different-wallet'}]) assert.throws(()=>c.allocate({...r,...patch}));
  const child=c.register(fixturePolicy('c','child'));
  assert.throws(()=>c.allocate(fixtureReceipt(child,r.event,r.amount)));
  assert.equal(c.reportAllocations().receipts,1);
  assert.equal(c.balance(budgetAccount(p,'compute')),6101n);
});
test('new policy and target do not recalculate past receipt or duplicate shared balances', t => {
  const {c}=setup(t); const p=c.register(fixturePolicy()); const r=fixtureReceipt(p);
  c.allocate(r);
  const next=c.register({...p,policyVersion:2,target:{...p.target,version:2},shares:{compute:8000,rewards:2000,treasury:0}});
  assert.throws(()=>c.allocate({...r,policyVersion:2,target:next.target}));
  c.allocate(fixtureReceipt(next,'next','10000'));
  const out=c.reportAllocations(); assert.equal(out.accounts.filter(r=>r.category==='rewards').length,1);
  assert.equal(c.balance(budgetAccount(p,'rewards')),4300n); assert.equal(Object.keys(out.computePools).length,2);
});
test('actual process exit between postings rolls back entire allocation then retry credits once', t => {
  const s=setup(t); const p=s.c.register(fixturePolicy()); const r=fixtureReceipt(p);
  const script=`import {AllocationLedger} from ${JSON.stringify(new URL('./policies.js',import.meta.url).href)};
    const c=new AllocationLedger(${JSON.stringify(s.path)}); const post=c.post.bind(c); let n=0;
    c.post=(...args)=>{post(...args);if(++n===2)process.exit(73);};
    c.allocate(${JSON.stringify(r)});`;
  const child=spawnSync(process.execPath,['--experimental-sqlite','--input-type=module','-e',script],{encoding:'utf8'});
  assert.equal(child.status,73,child.stderr); const c=s.reopen();
  assert.equal(c.reportAllocations().receipts,0); assert.equal(c.db.prepare('SELECT count(*) AS n FROM ledger').get().n,0);
  c.allocate(r); c.allocate(r); assert.equal(c.reportAllocations().receipts,1);
  assert.equal(c.balance(budgetAccount(p,'compute')),6101n);
  assert.equal(c.balance(`allocation:fixture:${p.asset.id}:receipt:${r.event}`),0n);
});

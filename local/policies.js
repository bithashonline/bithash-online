import { Controller } from './controller.js';
import { integer } from './solver.js';

function id(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw Error('Invalid identity');
  return value;
}
function shape(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw Error('Invalid schema fields');
}
function version(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw Error('Invalid version');
  return value;
}
export function validatePolicy(p) {
  shape(p, ['coin', 'mint', 'kind', 'asset', 'target', 'policyVersion', 'mode', 'shares']);
  if (!['main', 'child'].includes(p.kind) || !['fixture', 'production'].includes(p.mode)) throw Error('Invalid policy kind/mode');
  shape(p.asset, ['id', 'decimals']); shape(p.target, ['id', 'version']);
  if (!Number.isSafeInteger(p.asset.decimals) || p.asset.decimals < 0 || p.asset.decimals > 18) throw Error('Invalid decimals');
  const categories = ['compute', 'rewards', p.kind === 'main' ? 'treasury' : 'burn'];
  shape(p.shares, categories);
  for (const k of categories) if (!Number.isSafeInteger(p.shares[k]) || p.shares[k] < 0 || p.shares[k] > 10000) throw Error('Unset or invalid shares');
  if (categories.reduce((n, k) => n + p.shares[k], 0) !== 10000) throw Error('Shares must total 10000 bps');
  return { coin: id(p.coin), mint: id(p.mint), kind: p.kind,
    asset: { id: id(p.asset.id), decimals: p.asset.decimals },
    target: { id: id(p.target.id), version: version(p.target.version) },
    policyVersion: version(p.policyVersion), mode: p.mode,
    shares: Object.fromEntries(categories.map(k => [k, p.shares[k]])) };
}
export function splitAmount(amount, policy) {
  amount = integer(amount); const p = validatePolicy(policy);
  // Largest remainder; ties follow compute, rewards, then treasury/burn.
  const rows = Object.entries(p.shares).map(([category, bps], order) => ({ category, order,
    amount: amount * BigInt(bps) / 10000n, remainder: amount * BigInt(bps) % 10000n }));
  let dust = amount - rows.reduce((sum, r) => sum + r.amount, 0n);
  const ranked = [...rows].sort((a, b) => a.remainder === b.remainder ? a.order - b.order : a.remainder > b.remainder ? -1 : 1);
  for (const r of ranked) if (dust > 0n) { r.amount++; dust--; }
  return Object.fromEntries(rows.map(r => [r.category, r.amount.toString()]));
}
export function budgetAccount(p, category) {
  p = validatePolicy(p);
  if (!Object.hasOwn(p.shares, category)) throw Error('Invalid category');
  // Version-independent reward balances; compute remains target-version scoped.
  return ['allocation', p.mode, p.asset.id, p.coin, category,
    ...(category === 'compute' ? [p.target.id, p.target.version] : [])].join(':');
}
export class AllocationLedger extends Controller {
  constructor(path) {
    super(path);
    this.db.exec(`CREATE TABLE IF NOT EXISTS allocation_coins(coin TEXT PRIMARY KEY, identity TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS allocation_assets(asset TEXT PRIMARY KEY, decimals INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS allocation_mints(mint TEXT PRIMARY KEY, coin TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS allocation_policies(coin TEXT, version INTEGER, policy TEXT NOT NULL, PRIMARY KEY(coin,version));
      CREATE TABLE IF NOT EXISTS allocation_events(event TEXT PRIMARY KEY, receipt TEXT NOT NULL, allocations TEXT NOT NULL);`);
  }
  register(policy) {
    const p = validatePolicy(policy); const encoded = JSON.stringify(p);
    const identity = JSON.stringify({ mint: p.mint, kind: p.kind, mode: p.mode });
    return this.transaction(() => {
      const coin = this.db.prepare('SELECT identity FROM allocation_coins WHERE coin=?').get(p.coin);
      if (coin && coin.identity !== identity) throw Error('Conflicting coin identity');
      const mint = this.db.prepare('SELECT coin FROM allocation_mints WHERE mint=?').get(p.mint);
      if (mint && mint.coin !== p.coin) throw Error('Mint already registered to another coin');
      const asset = this.db.prepare('SELECT decimals FROM allocation_assets WHERE asset=?').get(p.asset.id);
      if (asset && asset.decimals !== p.asset.decimals) throw Error('Conflicting asset identity');
      const old = this.db.prepare('SELECT policy FROM allocation_policies WHERE coin=? AND version=?').get(p.coin, p.policyVersion);
      if (old && old.policy !== encoded) throw Error('Immutable policy conflict');
      this.db.prepare('INSERT OR IGNORE INTO allocation_coins VALUES (?,?)').run(p.coin, identity);
      this.db.prepare('INSERT OR IGNORE INTO allocation_assets VALUES (?,?)').run(p.asset.id, p.asset.decimals);
      this.db.prepare('INSERT OR IGNORE INTO allocation_mints VALUES (?,?)').run(p.mint, p.coin);
      this.db.prepare('INSERT OR IGNORE INTO allocation_policies VALUES (?,?,?)').run(p.coin, p.policyVersion, encoded);
      return p;
    });
  }
  policy(coin, policyVersion) {
    const row = this.db.prepare('SELECT policy FROM allocation_policies WHERE coin=? AND version=?').get(id(coin), version(policyVersion));
    if (!row) throw Error('Unknown policy');
    return JSON.parse(row.policy);
  }
  allocate(receipt) {
    shape(receipt, ['event', 'mode', 'coin', 'mint', 'asset', 'target', 'policyVersion', 'amount', 'custody']);
    const p = this.policy(receipt.coin, receipt.policyVersion);
    if (receipt.mode !== 'fixture' || p.mode !== 'fixture') throw Error('Fixture allocations only; live ingestion unavailable');
    shape(receipt.asset, ['id', 'decimals']); shape(receipt.target, ['id', 'version']);
    if (receipt.mint !== p.mint || receipt.asset.id !== p.asset.id || receipt.asset.decimals !== p.asset.decimals ||
      receipt.target.id !== p.target.id || receipt.target.version !== p.target.version) throw Error('Receipt attribution mismatch');
    const amount = integer(receipt.amount); if (!amount) throw Error('Empty fee receipt');
    const r = { event: id(receipt.event), mode: 'fixture', coin: p.coin, mint: p.mint, asset: p.asset,
      target: p.target, policyVersion: p.policyVersion, amount: amount.toString(), custody: id(receipt.custody) };
    const encoded = JSON.stringify(r); const allocations = splitAmount(amount, p);
    return this.transaction(() => {
      const old = this.db.prepare('SELECT * FROM allocation_events WHERE event=?').get(r.event);
      if (old) {
        if (old.receipt !== encoded) throw Error('Conflicting receipt replay');
        return JSON.parse(old.allocations);
      }
      const clearing = `allocation:fixture:${p.asset.id}:receipt:${r.event}`;
      this.post(`allocation:${r.event}:receipt`, clearing, `allocation:fixture:${p.asset.id}:source:${p.coin}`, amount);
      for (const [category, units] of Object.entries(allocations)) if (BigInt(units))
        this.post(`allocation:${r.event}:${category}`, budgetAccount(p, category), clearing, units);
      this.db.prepare('INSERT INTO allocation_events VALUES (?,?,?)').run(r.event, encoded, JSON.stringify(allocations));
      return allocations;
    });
  }
  reportAllocations() {
    const policies = this.db.prepare('SELECT policy FROM allocation_policies ORDER BY coin,version').all().map(r => JSON.parse(r.policy));
    const accounts = new Map();
    for (const p of policies) for (const category of Object.keys(p.shares)) {
      const account = budgetAccount(p, category);
      accounts.set(account, { coin: p.coin, category, asset: p.asset.id, mode: p.mode,
        target: category === 'compute' ? p.target : null, amount: this.balance(account).toString() });
    }
    const pools = new Map();
    for (const r of accounts.values()) if (r.category === 'compute') {
      const key = `${r.mode}:${r.asset}:${r.target.id}:${r.target.version}`;
      pools.set(key, (pools.get(key) ?? 0n) + BigInt(r.amount));
    }
    const sums = new Map();
    for (const row of this.db.prepare("SELECT * FROM ledger WHERE id LIKE 'allocation:%'").all()) {
      const asset = row.debit.split(':')[2];
      if (row.credit.split(':')[2] !== asset) throw Error('Cross-asset journal');
      // Independent debit/credit sum over every account, including sources and clearing.
      for (const [account, sign] of [[row.debit, 1n], [row.credit, -1n]])
        sums.set(account, (sums.get(account) ?? 0n) + sign * BigInt(row.amount));
    }
    const assetNets = new Map();
    for (const [account, balance] of sums) {
      const asset = account.split(':')[2];
      assetNets.set(asset, (assetNets.get(asset) ?? 0n) + balance);
    }
    const total = [...assetNets.values()].reduce((n, v) => n + v, 0n);
    return { mode: 'FIXTURE ONLY — no real fees, transfers, purchases or compute', spendingEnabled: false,
      accounts: [...accounts.values()], computePools: Object.fromEntries([...pools].map(([k,v]) => [k,v.toString()])),
      journalNet: total.toString(), journalNetByAsset: Object.fromEntries([...assetNets].map(([k,v])=>[k,v.toString()])),
      receipts: this.db.prepare('SELECT count(*) AS n FROM allocation_events').get().n };
  }
}

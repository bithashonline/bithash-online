import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const schema = JSON.parse(readFileSync(new URL('./fixtures/collect-creator-fee-schema.json', import.meta.url), 'utf8'));
export const sample = Object.freeze({
  signature: '5AJ8DdtNWzPNJXp5yTdCVUkQ4xVwN5VXt6CW1fHrr2JfrAbujTSwyEYjGnRyzJ7Weo78EELXGcKZfuGn5K5tzA3u',
  recipient: 'FdihHxkb717GKLtwTL2Kg5UW52WeepVeRCtjN2cWterV',
  source: 'DBcUX89eW1rgscAUSKKTB2xiG5xL6RwLKKnWbCviMsH9',
});
const SYSTEM = '11111111111111111111111111111111';
const EVENT = 'Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1';
const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const digest = data => createHash('sha256').update(data).digest('hex');
function exact(n) {
  if (typeof n === 'number' && Number.isSafeInteger(n) && n >= 0) return BigInt(n);
  if (typeof n === 'string' && /^(0|[1-9][0-9]*)$/.test(n)) return BigInt(n);
  throw Error('Missing, negative or imprecise integer');
}
function base58(s) {
  if (typeof s !== 'string' || s.length > 64 || !s.length) throw Error('Invalid instruction data');
  let n = 0n;
  for (const c of s) { const i = alphabet.indexOf(c); if (i < 0) throw Error('Invalid base58'); n = n * 58n + BigInt(i); }
  const hex = n.toString(16).padStart(Math.ceil(n.toString(16).length / 2) * 2, '0');
  return Buffer.concat([Buffer.alloc(s.match(/^1*/)[0].length), n ? Buffer.from(hex, 'hex') : Buffer.alloc(0)]);
}

// Narrow observer for a known native SOL legacy collect_creator_fee route.
// Does not authorize contributions, assert a mint, or support sharing-v2/AMM yet.
export function decodeReceipt(tx, expected = sample) {
  if (!tx?.meta || tx.meta.err !== null) throw Error('Missing or failed transaction');
  if (tx.transaction?.signatures?.[0] !== expected.signature) throw Error('Signature mismatch');
  const slot = exact(tx.slot).toString();
  const message = tx.transaction.message;
  if (!Array.isArray(message?.accountKeys) || !Array.isArray(message.instructions) || !Array.isArray(tx.meta.innerInstructions)) throw Error('Missing parsed instruction evidence');
  const keys = message.accountKeys.map(k => k.pubkey);
  if (keys.some(k => typeof k !== 'string') || new Set(keys).size !== keys.length) throw Error('Invalid account keys');
  const balances = [tx.meta.preBalances, tx.meta.postBalances];
  if (balances.some(b => !Array.isArray(b) || b.length !== keys.length)) throw Error('Missing balances');
  const groups = new Map();
  for (const group of tx.meta.innerInstructions) {
    if (!Number.isSafeInteger(group.index) || group.index < 0 || group.index >= message.instructions.length || groups.has(group.index) || !Array.isArray(group.instructions)) throw Error('Invalid inner instruction index');
    groups.set(group.index, group.instructions);
  }
  const records = [];
  for (const [outerIndex, ix] of message.instructions.entries()) {
    if (ix.programId !== schema.address || !ix.accounts?.includes(expected.recipient)) continue;
    const data = base58(ix.data);
    if (!data.equals(Buffer.from(schema.instruction.discriminator))) throw Error('Unsupported Pump instruction for watched recipient');
    if (ix.accounts.length !== 5 || ix.accounts[0] !== expected.recipient || ix.accounts[1] !== expected.source || ix.accounts[2] !== SYSTEM || ix.accounts[3] !== EVENT || ix.accounts[4] !== schema.address || ix.stackHeight !== 1) throw Error('Fee route mismatch');
    const inner = groups.get(outerIndex);
    if (!inner) throw Error('Missing transfer evidence');
    for (const [innerIndex, transfer] of inner.entries()) {
      if (transfer.programId === schema.address && transfer.stackHeight === 2) continue; // Anchor event CPI
      const info = transfer.parsed?.info;
      if (transfer.programId !== SYSTEM || transfer.stackHeight !== 2 || transfer.parsed?.type !== 'transfer' || info?.source !== expected.source || info?.destination !== expected.recipient) throw Error('Unexpected instruction inside fee claim');
      const amount = exact(info.lamports);
      if (!amount) throw Error('Zero transfer');
      records.push({ id: `${expected.signature}:${outerIndex}:${innerIndex}:SOL`, signature: expected.signature,
        slot, outerIndex, innerIndex, program: schema.address, instruction: schema.instruction.name,
        asset: 'SOL', amountLamports: amount.toString(), source: info.source, recipient: info.destination,
        mint: null, attribution: 'Creator wallet receipt only; coin attribution not established' });
    }
  }
  if (!records.length) throw Error('No supported creator-fee transfer');
  const total = records.reduce((s,r) => s + BigInt(r.amountLamports), 0n);
  // Fail closed when other activity prevents exact whole-transaction reconciliation.
  for (const [address, delta] of [[expected.recipient, total], [expected.source, -total]]) {
    const index = keys.indexOf(address);
    if (index < 0 || message.accountKeys[index].writable !== true) throw Error('Missing writable fee account');
    if (exact(balances[1][index]) - exact(balances[0][index]) !== delta) throw Error('Balance delta does not reconcile');
  }
  return records;
}

export async function fetchReceipt(endpoint, signature, fetcher = fetch) {
  if (new URL(endpoint).protocol !== 'https:') throw Error('HTTPS RPC required');
  async function rpc(method, params) {
    const response = await fetcher(endpoint, {method:'POST', headers:{'content-type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',id:method,method,params}), signal:AbortSignal.timeout(15000)});
    if (!response.ok) throw Error('RPC HTTP failure');
    const body = await response.json();
    if (body.error) throw Error('RPC returned an error');
    return body.result;
  }
  const tx = await rpc('getTransaction', [signature,{encoding:'jsonParsed',commitment:'finalized',maxSupportedTransactionVersion:0}]);
  if (!tx) throw Error('Receipt unavailable from RPC; no credit recorded');
  const statuses = await rpc('getSignatureStatuses', [[signature],{searchTransactionHistory:true}]);
  const status = statuses?.value?.[0];
  if (!status || status.err !== null || status.confirmationStatus !== 'finalized' || exact(status.slot) !== exact(tx.slot)) throw Error('Finality evidence missing or inconsistent');
  return {tx, provenance:{mode:'live-finalized-rpc',observedAt:new Date().toISOString(),source:new URL(endpoint).origin}};
}

export class ReceiptStore {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS fee_observations(id TEXT PRIMARY KEY, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS receipt_evidence(hash TEXT PRIMARY KEY, raw TEXT NOT NULL, provenance TEXT NOT NULL);`);
  }
  close() { this.db.close(); }
  import(tx, provenance, expected = sample) {
    if (!['archived-rpc-unrefreshed','live-finalized-rpc'].includes(provenance?.mode) || !provenance.source || !provenance.observedAt) throw Error('Evidence provenance required');
    const records = decodeReceipt(tx, expected);
    const raw = JSON.stringify(tx), hash = digest(raw);
    let inserted = 0;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const record of records) {
        const serialized = JSON.stringify(record);
        const prior = this.db.prepare('SELECT record FROM fee_observations WHERE id=?').get(record.id);
        if (prior && prior.record !== serialized) throw Error('Conflicting receipt replay');
        if (!prior) { this.db.prepare('INSERT INTO fee_observations VALUES (?,?)').run(record.id,serialized); inserted++; }
      }
      const evidenceKey = digest(hash + JSON.stringify(provenance));
      this.db.prepare('INSERT OR IGNORE INTO receipt_evidence VALUES (?,?,?)').run(evidenceKey,raw,JSON.stringify({...provenance,normalizedReceiptSha256:hash}));
      this.db.exec('COMMIT'); return {inserted, records};
    } catch (error) {this.db.exec('ROLLBACK'); throw error;}
  }
  report() {
    const records = this.db.prepare('SELECT record FROM fee_observations ORDER BY id').all().map(r=>JSON.parse(r.record));
    return {mode:'READ-ONLY FEE OBSERVER',spendingEnabled:false,platformAvailableLamports:'0',
      observedLamports:records.reduce((s,r)=>s+BigInt(r.amountLamports),0n).toString(), records,
      evidence:this.db.prepare('SELECT provenance FROM receipt_evidence').all().map(r=>JSON.parse(r.provenance)),
      limits:'Third-party receipts are observations, not our funds. No mint attribution, pooling, transfers or shared-fee-v2/AMM decoding.'};
  }
}

import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {Keypair,PublicKey,Transaction} from '@solana/web3.js';
import {createTransferCheckedInstruction,getAssociatedTokenAddressSync,TOKEN_PROGRAM_ID} from '@solana/spl-token';
import {WBTC} from './treasury-compute.js';

export const OFFLINE_BLOCKHASH='11111111111111111111111111111111';
export const sha256=b=>createHash('sha256').update(b).digest('hex');
export const fundingUnits=s=>{if(typeof s!=='string'||!/^(0|[1-9][0-9]{0,19})$/.test(s)||BigInt(s)>18446744073709551615n)throw Error('invalid_signer_amount');return BigInt(s);};
const positive=s=>{const n=fundingUnits(s);if(!n)throw Error('invalid_signer_amount');return n;};
const address=s=>new PublicKey(s);
const stable=o=>JSON.stringify(o);
const copy=o=>JSON.parse(stable(o));
const fresh=(at,now)=>{const age=now-Date.parse(at);if(!Number.isFinite(age)||age<0||age>60000)throw Error('stale_signer_evidence');};
export function transferAccounts(owner,recipient){return {
 sourceAccount:getAssociatedTokenAddressSync(address(WBTC.mint),address(owner)).toBase58(),
 destinationAccount:getAssociatedTokenAddressSync(address(WBTC.mint),address(recipient)).toBase58()};}

export function buildRestrictedTransfer({owner,recipient,amount,blockhash}){
 positive(amount);if(owner===recipient)throw Error('self_transfer_forbidden');
 address(blockhash);const a=transferAccounts(owner,recipient);
 const tx=new Transaction({feePayer:address(owner),recentBlockhash:blockhash});
 tx.add(createTransferCheckedInstruction(address(a.sourceAccount),address(WBTC.mint),address(a.destinationAccount),address(owner),BigInt(amount),8,[],TOKEN_PROGRAM_ID));
 return tx;
}

// Compare the compiled message, not a UI description of an instruction. This rejects
// extra instructions/accounts, authority changes, approvals, fees and nonce programs.
export function inspectRestrictedTransfer(wire,expected){
 if(!Buffer.isBuffer(wire)||wire.length>1232)throw Error('invalid_transaction_bytes');
 let tx;try{tx=Transaction.from(wire);}catch{throw Error('unsupported_transaction');}
 const canonical=buildRestrictedTransfer(expected).serializeMessage();
 if(!tx.serializeMessage().equals(canonical))throw Error('transaction_policy_mismatch');
 if(tx.signatures.length!==1||tx.signatures[0].publicKey.toBase58()!==expected.owner)throw Error('unexpected_signer');
 return {tx,messageHash:sha256(canonical),...transferAccounts(expected.owner,expected.recipient)};
}

// Production-facing inspection boundary. It owns no key and cannot sign or send.
// Uses an explicitly offline blockhash: this template is not a live preflight.
export class DisabledRestrictedFundingSigner {
 inspect({owner,recipient,amount,policy}){
  const expected={owner,recipient,amount,blockhash:OFFLINE_BLOCKHASH};
  const tx=buildRestrictedTransfer(expected);
  const wire=tx.serialize({requireAllSignatures:false,verifySignatures:false});
  const checked=inspectRestrictedTransfer(wire,expected),reasons=[];
  if(checked.tx.signatures.some(s=>s.signature!==null))throw Error('pre_signed_transaction_forbidden');
  if(!policy)reasons.push('owner_funding_limits_not_set');
  else {
   for(const k of ['maxTransferWbtcUnits','maxDailyWbtcUnits','minSolReserveLamports','maxNetworkFeeLamports'])positive(policy[k]);
   if(BigInt(policy.maxTransferWbtcUnits)>BigInt(policy.maxDailyWbtcUnits))throw Error('invalid_signer_policy');
   if(BigInt(amount)>BigInt(policy.maxTransferWbtcUnits))reasons.push('per_transfer_cap_exceeded');
  }
  return {mode:'inspect-only',structuralCheck:'passed',messageHash:checked.messageHash,
   sourceAccount:checked.sourceAccount,destinationAccount:checked.destinationAccount,
   reasons,signingEnabled:false,broadcastEnabled:false,
   livePreflightVerified:false,blockhashSource:'offline-placeholder',
   limitations:['live_token_account_checks_required','live_fee_and_sol_reserve_checks_required','independent_daily_spending_authority_required']};
 }
 sign(){throw Error('live_signing_disabled');}
 broadcast(){throw Error('broadcast_disabled');}
}

// Offline custody boundary: generates its own ephemeral key; no private-key import,
// production wallet, RPC client or broadcaster is accepted by this interface.
export class OfflineRestrictedWalletSigner {
 #key;#policy;#clock;#journal;
 constructor({recipient,maxTransferWbtcUnits,maxDailyWbtcUnits,minSolReserveLamports,maxNetworkFeeLamports,expiresAt},{clock=Date.now,journalPath=':memory:'}={}){
  address(recipient);for(const x of [maxTransferWbtcUnits,maxDailyWbtcUnits,minSolReserveLamports,maxNetworkFeeLamports])positive(x);
  if(BigInt(maxTransferWbtcUnits)>BigInt(maxDailyWbtcUnits)||!Number.isFinite(Date.parse(expiresAt)))throw Error('invalid_signer_policy');
  this.#key=Keypair.generate();this.#clock=clock;
  this.#policy=Object.freeze({owner:this.#key.publicKey.toBase58(),recipient,maxTransferWbtcUnits,maxDailyWbtcUnits,minSolReserveLamports,maxNetworkFeeLamports,expiresAt});
  // The calling treasury never owns the signer's reservations or replay records.
  // A file can retain audit records; restarting generates a NEW ephemeral wallet.
  this.#journal=new DatabaseSync(journalPath);
  this.#journal.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS restricted_offline_signatures(owner TEXT NOT NULL,id TEXT NOT NULL,message_hash TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(owner,id),UNIQUE(owner,message_hash));');
 }
 get publicKey(){return this.#policy.owner;}
 get policy(){return copy(this.#policy);}
 signLive(){throw Error('live_signing_disabled');}
 signOffline(treasury,{planId,wire,evidence}){
  if(!this.#key)throw Error('signer_destroyed');
  if(treasury.mode!=='simulation')throw Error('real_wallet_signing_disabled');
  const policy=this.#policy,now=this.#clock();
  if(!Number.isSafeInteger(now)||now<0)throw Error('invalid_signer_clock');
  if(typeof planId!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(planId))throw Error('invalid_signer_plan_id');
  if(now>=Date.parse(policy.expiresAt))throw Error('signer_policy_expired');
  if(treasury.setting('wallets')?.computeWallet!==policy.owner)throw Error('signer_wallet_mismatch');
  const p=treasury.getPlan(planId);
  if(!p?.funding||p.route!=='solcard-wbtc'||p.source!=='simulation'||p.state!=='planned'||p.funding.phase!=='prepared')throw Error('signer_plan_not_prepared');
  if(p.funding.terms.depositAddress!==policy.recipient||p.funding.terms.mint!==WBTC.mint||p.funding.terms.network!=='solana-mainnet'||p.amount!==p.funding.terms.amount)throw Error('signer_terms_mismatch');
  const checked=inspectRestrictedTransfer(wire,{owner:policy.owner,recipient:policy.recipient,amount:p.amount,blockhash:OFFLINE_BLOCKHASH});
  if(checked.tx.signatures.some(s=>s.signature!==null))throw Error('pre_signed_transaction_forbidden');
  this.#journal.exec('BEGIN IMMEDIATE');
  try{
   const old=this.#journal.prepare('SELECT body FROM restricted_offline_signatures WHERE owner=? AND id=?').get(policy.owner,planId);
   if(old){const saved=JSON.parse(old.body);if(saved.messageHash!==checked.messageHash)throw Error('signer_replay_conflict');this.#journal.exec('COMMIT');return saved;}
   if(this.#journal.prepare('SELECT id FROM restricted_offline_signatures WHERE owner=? AND message_hash=?').get(policy.owner,checked.messageHash))throw Error('signer_transaction_reused');
   fresh(evidence?.observedAt,now);if(evidence.source!=='offline-fixture'||evidence.blockhash!==OFFLINE_BLOCKHASH)throw Error('offline_evidence_required');
   const checkAccount=(a,key,owner)=>{
    if(a?.address!==key||a.owner!==owner||a.mint!==WBTC.mint||a.program!==WBTC.program||a.decimals!==8||a.frozen!==false||a.delegate!==null||a.closeAuthority!==null)throw Error('token_account_policy_mismatch');
    return fundingUnits(a.amount);
   };
   const sourceAmount=checkAccount(evidence.sourceAccount,checked.sourceAccount,policy.owner);
   checkAccount(evidence.destinationAccount,checked.destinationAccount,policy.recipient);
   const amount=positive(p.amount);if(amount>sourceAmount||amount>positive(policy.maxTransferWbtcUnits))throw Error('signer_transfer_cap');
   if(evidence.feePayer!==policy.owner||evidence.messageHash!==checked.messageHash)throw Error('fee_quote_mismatch');
   const fee=fundingUnits(evidence.networkFeeLamports),sol=fundingUnits(evidence.solLamports);
   if(fee>fundingUnits(policy.maxNetworkFeeLamports)||sol<fee+fundingUnits(policy.minSolReserveLamports))throw Error('signer_fee_reserve');
   const signed=this.#journal.prepare('SELECT body FROM restricted_offline_signatures WHERE owner=?').all(policy.owner).map(r=>JSON.parse(r.body));
   // Clock rollback cannot release a previous daily reservation.
   if(signed.some(s=>Date.parse(s.signedAt)>now))throw Error('signer_clock_rollback');
   const used=signed.filter(s=>Date.parse(s.signedAt)>=now-86400000).reduce((n,s)=>n+BigInt(s.amount),0n);
   if(used+amount>BigInt(policy.maxDailyWbtcUnits))throw Error('signer_daily_cap');
   checked.tx.sign(this.#key);if(!checked.tx.verifySignatures())throw Error('offline_signature_invalid');
   const signedWire=checked.tx.serialize();
   const result={schema:'bithash.offline-signature.v1',mode:'offline',planId,amount:p.amount,messageHash:checked.messageHash,
    signedAt:new Date(now).toISOString(),wireBase64:signedWire.toString('base64'),broadcastAllowed:false};
   this.#journal.prepare('INSERT INTO restricted_offline_signatures VALUES (?,?,?,?)').run(policy.owner,planId,checked.messageHash,stable(result));
   this.#journal.exec('COMMIT');
   return result;
  }catch(e){this.#journal.exec('ROLLBACK');throw e;}
 }
 destroy(){if(!this.#key)return;this.#key.secretKey.fill(0);this.#key=null;this.#journal.close();}
}

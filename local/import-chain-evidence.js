import {DatabaseSync} from 'node:sqlite';
import {decode58,verifySolTransfer} from './solana-evidence.js';
// Trusted local operator command. No wallet keys and no transaction broadcasting.
const [dbPath,signature,source,destination,lamports]=process.argv.slice(2);
const treasury=process.env.BITHASH_TREASURY_ADDRESS;
try{
 decode58(treasury,32);if(source!==treasury&&destination!==treasury)throw Error('treasury_mismatch');
 const record=await verifySolTransfer({signature,source,destination,lamports});
 const db=new DatabaseSync(dbPath,{open:true});
 try{if(!db.prepare("SELECT name FROM sqlite_master WHERE name='spending_meta'").get())throw Error('approval_database_required');db.exec('CREATE TABLE IF NOT EXISTS chain_evidence(signature TEXT PRIMARY KEY,record TEXT NOT NULL)');const existing=db.prepare('SELECT record FROM chain_evidence WHERE signature=?').get(signature);if(existing){const old=JSON.parse(existing.record);if(old.source!==source||old.destination!==destination||old.lamports!==lamports)throw Error('conflicting_evidence')}else db.prepare('INSERT INTO chain_evidence VALUES (?,?)').run(signature,JSON.stringify(record));console.log(JSON.stringify({stored:true,url:record.url,verification:record.verification,fundsCredited:false}));}finally{db.close()}
}catch{console.error('Evidence not imported: check configured treasury, exact transfer terms, database and RPC availability.');process.exitCode=1}

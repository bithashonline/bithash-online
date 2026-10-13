const fields=['id','provider','destination','gpu','count','durationSeconds','hourlyPerGpuMicrousd','overheadMicrousd','capMicrousd','expiresAt'];
const base64=bytes=>btoa(String.fromCharCode(...bytes));
export async function signRun(provider,snapshot,proposal){
 if(!provider?.isPhantom)throw Error('Phantom extension is required in this browser.');
 if(snapshot.liveExecutionEnabled!==false||snapshot.signingDomain!=='bithash.spending-approval.v1'||proposal.state!=='proposed'||Date.now()>=proposal.terms.expiresAt*1000)throw Error('Proposal is not available for signing.');
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(Object.fromEntries(fields.map(k=>[k,proposal.terms[k]]))))))).map(b=>b.toString(16).padStart(2,'0')).join('');
 if(digest!==proposal.digest)throw Error('Displayed terms do not match the approval digest.');
 const connected=await provider.connect();
 if(base64(connected.publicKey.toBytes())!==snapshot.ownerRawBase64)throw Error('Connected wallet is not the configured BitHash owner.');
 const message=new TextEncoder().encode(snapshot.signingDomain+'\n'+snapshot.ledgerId+'\n'+digest);
 const signed=await provider.signMessage(message,'utf8');
 if(base64(provider.publicKey.toBytes())!==snapshot.ownerRawBase64)throw Error('Wallet changed during approval.');
 const key=await crypto.subtle.importKey('raw',connected.publicKey.toBytes(),{name:'Ed25519'},false,['verify']);
 if(!await crypto.subtle.verify('Ed25519',key,signed.signature,message))throw Error('Wallet signature could not be verified.');
 return base64(signed.signature);
}
export function solscanLink(record){return record?.network==='mainnet-beta'&&record.verification==='finalized-rpc-observation'&&/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(record.signature)?'https://solscan.io/tx/'+record.signature:null}

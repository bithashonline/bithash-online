import {Keypair} from '@solana/web3.js';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {buildPreview} from './builder.js';
// Fixture public keys only. Generated secret keys are discarded, never stored or logged.
const fixture=()=>Keypair.generate().publicKey.toBase58();
const input=process.argv[2]?JSON.parse(readFileSync(process.argv[2],'utf8')):{mode:'unsigned-preview',name:'Puzzle Preview',symbol:'PZTEST',uri:'https://example.invalid/metadata.json',payer:fixture(),mint:fixture(),treasury:fixture(),computeShareBps:10000};
const {summary}=await buildPreview(input);
if(!process.argv[2]){
  const direct=await buildPreview({...input,routingMode:'direct-creator'});
  summary.directRouteComparison={routingMode:direct.summary.routingMode,combined:direct.summary.combined,routingCaveat:direct.summary.routingCaveat,simulated:false};
}
summary.inputOrigin=process.argv[2]?'User-supplied preview file':'Generated fixture addresses, nonexistent metadata URL, illustrative 100% allocation; no production settings selected';
mkdirSync('work',{recursive:true});writeFileSync('work/launch-preview.json',JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));

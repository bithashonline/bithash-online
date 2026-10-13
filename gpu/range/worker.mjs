import {readFile} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {runOwnRangeWorker} from '../../local/own-range-runtime.js';
import {rangeClient} from '../../local/own-range-client.js';
const [configFile]=process.argv.slice(2);
try{
 if(!configFile||!isAbsolute(configFile))throw Error();
 const c=JSON.parse(await readFile(configFile,'utf8'));
 if(Object.keys(c).sort().join()!==['schema','backend','origin','capability','caFile','stateDirectory','keyFile','jobId','epoch','providerPodId','expiresAt','chunkSize','solverSha256','binaryPath','recoveryPublicKey','validationOnly'].sort().join()||
  c.schema!=='bithash.own-range-worker-config.v1'||!isAbsolute(c.stateDirectory)||!isAbsolute(c.keyFile)||typeof c.validationOnly!=='boolean')throw Error();
 const client=rangeClient({origin:c.origin,capability:c.capability,ca:c.caFile?await readFile(c.caFile):undefined,validationOnly:c.validationOnly});
 const stop=new AbortController();process.once('SIGTERM',()=>stop.abort());process.once('SIGINT',()=>stop.abort());
 const result=await runOwnRangeWorker(c,{client,directory:c.stateDirectory,privateKey:await readFile(c.keyFile),signal:stop.signal});
 console.log(JSON.stringify(result));
}catch{process.stderr.write('Range worker stopped; unaccepted work was not checkpointed.\n');process.exitCode=1;}

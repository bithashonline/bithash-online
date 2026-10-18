import {validateFundingProfile} from './treasury-funding.js';
import {mkdir,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {ComputeTreasury} from './treasury-compute.js';
import {createTreasuryServer} from './treasury-console.js';
const [directory,configPath]=process.argv.slice(2);
if(!directory||!configPath)throw Error('Usage: node local/treasury-server.js PRIVATE_DIRECTORY PUBLIC_WALLET_CONFIG');
await mkdir(resolve(directory),{recursive:true});
const config=JSON.parse(await readFile(configPath,'utf8'));
const treasury=new ComputeTreasury(join(resolve(directory),'compute-treasury.sqlite'));
treasury.configure(config.computeTreasury??config);
if(config.fundingProfilePath){const profile=JSON.parse(await readFile(config.fundingProfilePath,'utf8'));validateFundingProfile(profile);treasury.set('fundingProfile',profile);}
const server=createTreasuryServer(treasury);
server.listen(4191,'127.0.0.1',()=>console.log('BitHash treasury: http://127.0.0.1:4191/treasury'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{treasury.close();process.exit();}));

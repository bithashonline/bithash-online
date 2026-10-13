import {SpendingApprovals} from './spending-approvals.js';
import {loadGoogleOwnerConfig} from './google-owner-config.js';
import {tickMockExecutor} from './mock-executor.js';

const config=loadGoogleOwnerConfig(process.env.BITHASH_GOOGLE_SETUP_FILE);
if(!config.ownerSub||!process.env.BITHASH_APPROVAL_DB)throw Error('verified_owner_and_database_required');
const store=new SpendingApprovals(process.env.BITHASH_APPROVAL_DB,'google:'+config.ownerSub);
let timer,closed=false;
function stop(){if(closed)return;closed=true;clearInterval(timer);store.close();}
function tick(){try{const changes=tickMockExecutor(store);for(const change of changes)console.log(JSON.stringify({at:new Date().toISOString(),...change,mode:'mock-only'}));}catch{console.error('Mock executor halted; inspect local ledger before restart.');stop();process.exitCode=1;}}
timer=setInterval(tick,1000);tick();
process.on('SIGINT',stop);process.on('SIGTERM',stop);
console.log('Mock executor active: local-simulation destinations only; no real GPU execution.');

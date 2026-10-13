import {Controller} from './controller.js';
import {WorkerReceipts} from './worker-receipts.js';
import {createWorkerServer} from './worker-api.js';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
// No funding/dispatch/model/provider credential: authenticated collection only.
const database=process.env.BITHASH_COLLECTOR_DB;
if(!database)throw Error('collector_database_required');
const controller=new Controller(database);
const secure=process.env.BITHASH_COLLECTOR_TLS==='1';
const credentials=process.env.CREDENTIALS_DIRECTORY;
if(secure&&!credentials)throw Error('tls_credentials_required');
const tls=secure?{key:readFileSync(join(credentials,'tls-key')),cert:readFileSync(join(credentials,'tls-cert'))}:undefined;
const server=createWorkerServer(new WorkerReceipts(controller),{databasePath:database,tls});
server.maxConnections=32;
server.listen(secure?8443:4180,secure?'0.0.0.0':'127.0.0.1',()=>console.log(secure?'collector_listening_tls':'collector_listening_loopback'));
let closing=false;
const quit=()=>{if(closing)return;closing=true;server.closeAllConnections();server.close(()=>controller.close());};
process.once('SIGTERM',quit);process.once('SIGINT',quit);

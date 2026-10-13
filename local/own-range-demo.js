import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {generateKeyPairSync,randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {Controller} from './controller.js';
import {OwnRangeLedger,ownRangeSummary} from './own-range-ledger.js';
import {createOwnRangeServer} from './own-range-server.js';
import {digest} from './own-range-protocol.js';
const directory=resolve(process.argv[2]??'work/own-range-demo');await mkdir(directory,{recursive:true});
const path=join(directory,'state.sqlite');let controller=new Controller(path);const ledger=new OwnRangeLedger(controller);
const id='range-'+randomBytes(12).toString('hex'),now=Date.now();
const solverSha256=digest(await readFile(new URL('own-range-backend.js',import.meta.url)));
ledger.reserve(id,'range-probe-71','9',solverSha256);
const key=generateKeyPairSync('ed25519',{privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
const row=ledger.row(id),approval={state:'local-validation',workload:'fixed-public-puzzle-range',jobId:id,targetId:row.target,start:row.start,end:row.end,
 solverSha256,providerPodId:'local-cpu-probe',expiresAt:now+120000,digest:digest('explicit local probe; not a paid approval'),validationOnly:true};
const lease=ledger.lease(id,{publicKey:key.publicKey,providerPodId:'local-cpu-probe',expiresAt:approval.expiresAt,approval},now);
const server=createOwnRangeServer(ledger);server.listen(0,'127.0.0.1');await once(server,'listening');
const config={schema:'bithash.own-range-worker-config.v1',backend:'node-openssl-range-probe',origin:'http://127.0.0.1:'+server.address().port,
 capability:lease.capability,caFile:null,stateDirectory:join(directory,'worker'),keyFile:join(directory,'worker-key.pem'),jobId:id,epoch:lease.epoch,
 providerPodId:'local-cpu-probe',expiresAt:lease.expiresAt,chunkSize:'3',solverSha256,binaryPath:null,recoveryPublicKey:null,validationOnly:true};
await writeFile(config.keyFile,key.privateKey,{mode:0o600});const configFile=join(directory,'worker-config.json');await writeFile(configFile,JSON.stringify(config),{mode:0o600});
try{
 const child=spawn(process.execPath,[fileURLToPath(new URL('../gpu/range/worker.mjs',import.meta.url)),configFile],{env:{},stdio:['ignore','pipe','pipe'],windowsHide:true});
 let output='';child.stdout.on('data',b=>output+=b.toString());child.stderr.resume();const [code]=await once(child,'close');if(code!==0)throw Error('Probe worker failed');
 const receipts=controller.db.prepare('SELECT digest,payload,signature FROM own_range_receipts WHERE job=? ORDER BY start').all(id);
 const completed={...ledger.row(id)};controller.close();controller=new Controller(path);
 const result={schema:'bithash.own-range-demo.v1',backend:'node-openssl-range-probe',workerPublicKey:key.publicKey,separateProcess:true,realLoopback:true,
  workerResult:JSON.parse(output),job:{id,targetId:completed.target,start:completed.start,end:completed.end,next:completed.next,state:completed.state},
  restartedSummary:ownRangeSummary(controller.db),receipts,puzzle71Candidates:'0',gpuValidated:false,paidRental:false};
 await writeFile(join(directory,'evidence.json'),JSON.stringify(result,null,2));process.stdout.write(JSON.stringify(result,null,2)+'\n');
}finally{server.close();controller.close();}

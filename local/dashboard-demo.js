import {generateKeyPairSync} from 'node:crypto';
import {mkdtempSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Controller,MockProvider} from './controller.js';
import {WorkerReceipts,signFixtureReceipt} from './worker-receipts.js';
import {WorkerActivity,signWorkerActivity} from './worker-activity.js';
import {executeFixture} from './worker-runner.js';

// Local CPU work and signed synthetic telemetry only. No provider client.
mkdirSync(resolve('work'),{recursive:true});
const dir=mkdtempSync(resolve('work/dashboard-demo-')),db=join(dir,'state.sqlite');
const c=new Controller(db),receipts=new WorkerReceipts(c),activity=new WorkerActivity(c);
const build='sha256:'+'a'.repeat(64),now=Math.floor(Date.now()/1000);
let fresh,sequence=1;
for(const [i,state] of ['fresh','stale','stopped'].entries()){
 const id=`fixture-${state}`,keys=generateKeyPairSync('ed25519');
 const start=String(2**i),end=String(2**(i+1)),fixture=`puzzle-${i+1}`;
 c.fund(`fund-${i}`,'bithash','100');c.plan(id,fixture,start,end,'50');
 c.dispatch(id,new MockProvider(c));const lease=c.lease(id,now-60,3600);
 receipts.enroll(id,lease.epoch,keys.publicKey.export({type:'spki',format:'pem'}),build);
 const request={protocol:1,job:id,epoch:lease.epoch,fixture,start,end:String(2**i+1)};
 const result=await executeFixture(request);
 receipts.accept(signFixtureReceipt({schema:'bithash.fixture-receipt.v1',provider:lease.provider,build,request,result},keys.privateKey),now);
 const payload={schema:'bithash.worker-activity.v1',job:id,epoch:lease.epoch,provider:lease.provider,build,sequence:1,state:'computing',device:'cpu-fixture',utilizationPercent:null,candidatesPerSecond:null};
 activity.accept(signWorkerActivity(payload,keys.privateKey),state==='stale'?now-45:now);
 if(state==='stopped')c.stop(id);
 if(state==='fresh')fresh={payload,key:keys.privateKey};
}
console.log(JSON.stringify({mode:'LOCAL CPU FIXTURES / SYNTHETIC HEARTBEATS',databasePath:db,spendUsd:0}));
const timer=setInterval(()=>{try{activity.accept(signWorkerActivity({...fresh.payload,sequence:++sequence},fresh.key));}catch{clearInterval(timer);c.close();}},5000);
function stop(){clearInterval(timer);c.close();process.exit(0)}
process.once('SIGINT',stop);process.once('SIGTERM',stop);

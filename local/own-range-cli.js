import {Controller} from './controller.js';
import {OwnRangeLedger,ownRangeSummary} from './own-range-ledger.js';
const [database,command,id,target,size,sha]=process.argv.slice(2);let c;
try{
 if(!database||!['plan','status'].includes(command))throw Error();c=new Controller(database);const ledger=new OwnRangeLedger(c);
 const result=command==='status'?ownRangeSummary(c.db):(()=>{const r=ledger.reserve(id,target,size,sha);return {jobId:r.id,targetId:r.target,start:r.start,end:r.end,next:r.next,state:r.state,dispatchEnabled:false};})();
 console.log(JSON.stringify(result,null,2));
}catch{process.stderr.write('Range planning failed; no GPU was dispatched.\n');process.exitCode=1;}
finally{c?.close();}

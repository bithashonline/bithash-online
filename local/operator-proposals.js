import {randomUUID} from 'node:crypto';
import {localOperator} from './operator.js';

// Fixed synthetic quote. No client-supplied prices, provider destinations or model commands.
export function proposeOperatorRun(store,input,snapshot,now=Date.now()) {
 if(!input||Object.keys(input).sort().join()!=='count,durationSeconds'||!Number.isInteger(input.count)||input.count<1||input.count>10||!Number.isInteger(input.durationSeconds)||input.durationSeconds<60||input.durationSeconds>3600)throw Error('invalid_run_request');
 const report=localOperator(snapshot,now);
 if(report.evidence.facts[0].freshness!=='fresh')throw Error('stale_evidence');
 const at=Math.floor(now/1000),rate=250000n;
 const cap=((rate*BigInt(input.count)*BigInt(input.durationSeconds)+3599n)/3600n).toString();
 const quote={schema:'bithash.synthetic-quote.v1',source:'built-in simulation fixture',observedAt:at,expiresAt:at+600,provider:'mock',gpu:'rtx-a5000',hourlyPerGpuMicrousd:rate.toString(),currency:'synthetic-USD-microcredits',liveCapacityVerified:false,limitations:'Invented test rate; not a Runpod quote or a claim of available GPUs.'};
 const terms={id:'operator-'+randomUUID(),provider:'mock',destination:'local-simulation',gpu:quote.gpu,...input,hourlyPerGpuMicrousd:quote.hourlyPerGpuMicrousd,overheadMicrousd:'0',capMicrousd:cap,expiresAt:quote.expiresAt};
 const context={schema:'bithash.operator-proposal.v1',mode:'rules-preview',modelConnected:false,quote,report,reason:'Owner-requested simulation with fixed A5000 test pricing. Actual funding and GPU availability remain unknown.',costCalculation:'ceil(hourly microcredits × GPU count × seconds / 3600)',approvalRequired:true,executionEnabled:false};
 const digest=store.propose(terms,at,context);
 return {id:terms.id,digest,mode:'local-simulation',modelConnected:false,approvalRequired:true};
}

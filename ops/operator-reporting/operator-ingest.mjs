import {mkdir,readFile,writeFile,rename,readdir} from 'node:fs/promises';
import {operatorRecord} from './operator-record.js';
const root='/var/lib/bithash-operator';
try{
 let body='';for await(const c of process.stdin){body+=c;if(Buffer.byteLength(body)>65536)throw Error();}
 const input=JSON.parse(body);if(Object.keys(input).sort().join()!=='digest,report,schema')throw Error();const record=operatorRecord(input.report);if(input.schema!==record.schema||input.digest!==record.digest)throw Error();
 await mkdir(root+'/reports',{recursive:true,mode:0o755});const file=root+'/reports/'+record.digest+'.json';
 try{const old=JSON.parse(await readFile(root+'/latest.json','utf8'));if(Date.parse(old.record.report.generatedAt)>Date.parse(record.report.generatedAt))throw Error('older_report');}catch(e){if(e.code!=='ENOENT')throw e;}
 try{await readFile(file);}catch(e){if(e.code!=='ENOENT')throw e;if((await readdir(root+'/reports')).length>=1000)throw Error('archive_full');await writeFile(file,JSON.stringify(record),{flag:'wx',mode:0o644});}
 const data={schema:'bithash.operator-snapshot.v1',heartbeatAt:new Date().toISOString(),...{record}};
 // Each upload is serialized by the laptop; atomic rename protects readers.
 const temp=root+'/latest.'+process.pid+'.tmp';await writeFile(temp,JSON.stringify(data),{flag:'wx',mode:0o644});await rename(temp,root+'/latest.json');console.log(record.digest);
}catch{console.error('operator_ingest_rejected');process.exitCode=1;}

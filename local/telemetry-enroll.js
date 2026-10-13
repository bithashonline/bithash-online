// Operator-only CLI. Enrollment accepts a public worker key, never a provider key.
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {GpuTelemetry} from './gpu-telemetry.js';
const [command,path,input]=process.argv.slice(2);
if(!['enroll','revoke'].includes(command)||!path||!input)throw Error('usage: enroll DB PUBLIC_ENROLLMENT.json | revoke DB LEASE_ID');
const db=new DatabaseSync(path);db.exec('PRAGMA busy_timeout=5000;');
try{const t=new GpuTelemetry(db);if(command==='enroll')t.enroll(JSON.parse(readFileSync(input,'utf8')));else t.revoke(input);console.log(JSON.stringify({ok:true,operation:command}));}finally{db.close();}

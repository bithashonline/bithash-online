import {spawn} from 'node:child_process';
import {operatorRecord} from './operator-record.js';
export function publishOperator(report,config){
 const record=operatorRecord(report);
 return new Promise((resolve,reject)=>{
  const child=spawn('ssh',['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=8','-o','UserKnownHostsFile='+config.knownHostsFile,'-i',config.keyFile,'root@YOUR_COLLECTOR_HOST','node /opt/bithash-operator/ingest.mjs'],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  const timer=setTimeout(()=>{child.kill();reject(Error('report_publish_timeout'));},15000);let output='';child.stdout.on('data',c=>{output+=c;if(output.length>2000)child.kill();});child.stderr.resume();child.on('error',()=>{clearTimeout(timer);reject(Error('report_publish_failed'));});child.stdin.on('error',()=>{});child.on('exit',code=>{clearTimeout(timer);if(code===0&&output.trim()===record.digest)resolve(record.digest);else reject(Error('report_publish_failed'));});child.stdin.end(JSON.stringify(record));
 });
}

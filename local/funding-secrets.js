import {spawn} from 'node:child_process';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('./funding-secret.ps1',import.meta.url));
// DPAPI stays bound to the signed-in Windows user. No secret appears in argv/logs.
export async function protectFundingSecret(action,value){
 if(process.platform!=='win32'||!['protect','unprotect'].includes(action)||typeof value!=='string'||value.length>131072)throw Error('funding_secret_unavailable');
 return new Promise((resolve,reject)=>{
  const p=spawn(process.env.BITHASH_POWERSHELL_PATH??'pwsh.exe',['-NoProfile','-NonInteractive','-File',script,'-Action',action],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  let output='',failure=null;const timer=setTimeout(()=>{failure='funding_secret_timeout';p.kill();},30000);
  p.stdout.on('data',b=>{output+=b;if(output.length>131072){failure='funding_secret_output_limit';p.kill();}});p.stderr.resume();
  p.on('error',()=>{clearTimeout(timer);reject(Error('funding_secret_spawn_failed'));});
  p.on('close',code=>{clearTimeout(timer);code===0&&!failure?resolve(output):reject(Error(failure??'funding_secret_process_failed'));});
  p.stdin.on('error',()=>{});p.stdin.end(value);
 });
}
export async function readFundingSecret(path){return protectFundingSecret('unprotect',(await readFile(path,'utf8')).trim());}
export class FundingSecretStore{
 constructor(path){this.path=path;}
 async load(){try{return JSON.parse(await readFundingSecret(this.path));}catch(e){if(e.code==='ENOENT')return {};throw Error('funding_secret_unavailable');}}
 async save(value){const encrypted=await protectFundingSecret('protect',JSON.stringify(value));await writeFile(this.path+'.tmp',encrypted,{mode:0o600});await rename(this.path+'.tmp',this.path);}
}

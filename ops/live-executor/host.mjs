import {spawn} from 'node:child_process';
export function command(file,args,input=''){
 return new Promise((resolve,reject)=>{const p=spawn(file,args,{stdio:['pipe','pipe','pipe'],windowsHide:true});let out='',size=0,done=false;const timer=setTimeout(()=>{p.kill('SIGKILL');finish(Error('host_command_timeout'));},12000);function finish(err){if(done)return;done=true;clearTimeout(timer);err?reject(err):resolve(out);}
 p.on('error',()=>finish(Error('host_command_failed')));p.stdout.on('data',x=>{size+=x.length;if(size>262144){p.kill();finish(Error('host_response_too_large'));}else out+=x;});p.stderr.resume();p.stdin.on('error',()=>{});p.on('close',code=>finish(code?Error('host_command_failed'):null));p.stdin.end(input);});
}
export function hostAdapters(){
 const control=async(op,value)=>{const args=['-u','bithash-shutdown','node','--experimental-sqlite','/opt/bithash-shutdown/cli.mjs',op,'/var/lib/bithash-shutdown/state.sqlite'];if(value)args.push(typeof value==='string'?value:'-');const raw=await command('sudo',args,typeof value==='object'?JSON.stringify(value):'');return JSON.parse(raw.trim().split('\n').at(-1));};
 return {guard:{ready:async()=>{await command('systemctl',['is-active','--quiet','bithash-shutdown','bithash-collector']);const s=await control('status');if(s.pods.some(p=>p.phase!=='absence_observed'))throw Error('shutdown_has_unresolved_pods');},register:p=>control('register',p),status:async()=>(await control('status')).pods,stop:id=>control('stop-pod',id)},
 telemetry:{enroll:e=>command('sudo',['-u','bithash-collector','node','--experimental-sqlite','/opt/bithash/local/telemetry-enroll.js','enroll','/var/lib/bithash-collector/state.sqlite','-'],JSON.stringify(e))}};
}

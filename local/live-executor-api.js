import {spawn} from 'node:child_process';
export function executorConnection({keyFile,knownHostsFile}){
 return async(action,input={})=>new Promise((resolve,reject)=>{
  const child=spawn('ssh',['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=8','-o','UserKnownHostsFile='+knownHostsFile,'-i',keyFile,'root@YOUR_COLLECTOR_HOST','node /opt/bithash-executor/ops/live-executor/control.mjs'],{windowsHide:true,stdio:['pipe','pipe','pipe']});let data='',finished=false;
  const finish=(err,value)=>{if(finished)return;finished=true;clearTimeout(timer);err?reject(err):resolve(value)};
  const timer=setTimeout(()=>{child.kill();finish(Error('executor_outcome_unknown'));},25000);
  child.on('error',()=>finish(Error('executor_unavailable')));child.stdout.on('data',x=>{data+=x;if(data.length>1000000){child.kill();finish(Error('response_too_large'));}});child.stderr.resume();child.stdin.on('error',()=>{});
  child.on('close',code=>{try{const v=JSON.parse(data);if(code)throw Error(/^[a-z_]{1,80}$/.test(v.error)?v.error:'executor_unavailable');finish(null,v);}catch(e){finish(e);}});child.stdin.end(JSON.stringify({action,input}));
 });
}
export async function handleLiveExecutor(req,res,{auth,call,origin='http://127.0.0.1:4173'}){
 const path=new URL(req.url,origin).pathname;if(!path.startsWith('/api/live-runs'))return false;
 const send=(status,v)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(v));return true;};
 try{
  if(req.method==='GET'&&path==='/api/live-runs')return send(200,await call('status'));
  if(req.method!=='POST'||!['/api/live-runs/propose','/api/live-runs/approve','/api/live-runs/cancel'].includes(path))return send(405,{error:'method_not_allowed'});
  if(req.headers.origin!==origin||req.headers['content-type']!=='application/json')return send(403,{error:'origin_rejected'});
  auth.authorize(req);let body='';for await(const x of req){body+=x;if(Buffer.byteLength(body)>4096)return send(413,{error:'body_too_large'});}
  return send(200,await call(path.split('/').at(-1),JSON.parse(body)));
 }catch(e){return send(400,{error:/^[a-z_]{1,80}$/.test(e.message)?e.message:'executor_request_rejected'});}
}

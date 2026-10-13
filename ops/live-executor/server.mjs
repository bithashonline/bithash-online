import http from 'node:http';
import {readFileSync,chmodSync,existsSync,unlinkSync} from 'node:fs';
import {Executor,hash} from './executor.mjs';
import {RunpodExecutorApi} from './provider.mjs';
import {hostAdapters} from './host.mjs';
import {controllerCredential} from '../runpod-shutdown/credential.mjs';
import {ownRangeHandler} from '../../local/own-range-server.js';
const dir='/var/lib/bithash-executor',socket='/run/bithash-executor/control.sock';
const config=JSON.parse(readFileSync('/etc/bithash-executor/config.json','utf8'));
config.bootstrap=readFileSync(new URL('bootstrap.py',import.meta.url),'utf8');
config.ca=readFileSync('/etc/bithash-collector/tls-cert','utf8');
const rangeArtifact=config.range?readFileSync('/opt/bithash-executor/range-worker.tar.gz'):null;
if(config.range){config.range.bootstrap=readFileSync(new URL('range-bootstrap.py',import.meta.url),'utf8');if(hash(rangeArtifact)!==config.range.archiveSha256)throw Error('invalid_range_artifact');}
const artifact=readFileSync('/opt/bithash-executor/worker.tar.gz');
if(hash(artifact)!==config.archiveSha256||!/^runpod\/base@sha256:[a-f0-9]{64}$/.test(config.image))throw Error('invalid_deployment_artifact');
const executor=new Executor(dir+'/state.sqlite',{provider:new RunpodExecutorApi({apiKey:controllerCredential()}),...hostAdapters(),config});
// This listener binds only loopback; nginx exposes these two paths only on its
// authenticated-worker HTTPS server. It does not trust a forwarded HTTP header.
const rangeHandler=executor.ranges?ownRangeHandler(executor.ranges.ledger,{secureTransport:true}):null;
const send=(res,code,body)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));};
async function body(req,limit=8192){let s='';for await(const x of req){s+=x;if(Buffer.byteLength(s)>limit)throw Error('body_too_large');}return JSON.parse(s);}
const publicServer=http.createServer(async(req,res)=>{try{
 if(rangeHandler&&['/worker/range/task','/worker/range/receipt'].includes(req.url))return await rangeHandler(req,res);
 if(rangeArtifact&&req.method==='GET'&&req.url==='/api/executor/artifact/'+config.range.archiveSha256){res.writeHead(200,{'Content-Type':'application/gzip','Content-Length':rangeArtifact.length,'Cache-Control':'public,max-age=31536000,immutable'});return res.end(rangeArtifact);}
 if(req.method==='GET'&&req.url==='/api/executor/status')return send(res,200,executor.snapshot());
 const proof=/^\/api\/executor\/proof\/([a-f0-9]{64})$/.exec(req.url??'');if(req.method==='GET'&&proof){const p=executor.proof(proof[1]);return send(res,p?200:404,p??{error:'not_found'});}
 const log=/^\/api\/executor\/log\/([a-f0-9]{64})$/.exec(req.url??'');if(req.method==='GET'&&log){const p=executor.archivedLog(log[1]);return send(res,p?200:404,p??{error:'not_found'});}
 if(req.method==='GET'&&req.url==='/api/executor/artifact/'+config.archiveSha256){res.writeHead(200,{'Content-Type':'application/gzip','Content-Length':artifact.length,'Cache-Control':'public,max-age=31536000,immutable'});return res.end(artifact);}
 if(req.method!=='POST'||!['/api/executor/enroll','/api/executor/complete','/api/executor/archive'].includes(req.url)||req.headers['content-type']!=='application/json')return send(res,404,{error:'not_found'});
 const token=(req.headers.authorization??'').replace(/^Bearer /,'');const v=await body(req,req.url.endsWith('/archive')?600000:8192);
 return send(res,200,req.url.endsWith('/enroll')?await executor.enroll(v,token):req.url.endsWith('/archive')?executor.archive(v,token):executor.complete(v,token));
 }catch{return send(res,503,{error:'worker_request_rejected'});}});
publicServer.requestTimeout=15000;publicServer.headersTimeout=10000;publicServer.listen(8793,'127.0.0.1');
// Owner commands are only reachable through a root-owned Unix socket, never nginx.
if(existsSync(socket))unlinkSync(socket);
const ownerServer=http.createServer(async(req,res)=>{try{
 if(req.method!=='POST'||req.url!=='/command')return send(res,404,{error:'not_found'});
 const v=await body(req);if(!v||Object.keys(v).sort().join()!=='action,input')throw Error();
 let result;
 if(v.action==='status')result=executor.snapshot();
 else if(v.action==='quote-ai')result=await executor.planningQuote(v.input);
 else if(v.action==='quote-range-ai')result=await executor.planningRangeQuote(v.input);
 else if(v.action==='propose-ai')result=await executor.proposeAi(v.input);
 else if(v.action==='propose')result=await executor.propose(v.input);
 else if(v.action==='propose-range')result=await executor.proposeRange(v.input);
 else if(['approve','cancel'].includes(v.action)&&v.input&&Object.keys(v.input).sort().join()==='digest,id')result=executor[v.action](v.input.id,v.input.digest);
 else throw Error();return send(res,200,result);
 }catch(e){return send(res,400,{error:/^[a-z_]{1,80}$/.test(e.message)?e.message:'command_rejected'});}});
ownerServer.listen(socket,()=>chmodSync(socket,0o600));
const tick=()=>executor.tick().catch(()=>console.error('executor_tick_failed'));
await tick();const timer=setInterval(tick,5000);
process.on('SIGTERM',()=>{clearInterval(timer);publicServer.close();ownerServer.close();setTimeout(()=>process.exit(0),12000).unref();});

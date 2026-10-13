import http from 'node:http';
import {pbkdf2Sync,randomBytes} from 'node:crypto';
import worker from '../dist/server/index.js';
// Local-only fixture password. Production secrets come exclusively from Sites.
const salt=randomBytes(16).toString('hex');
const env={BITHASH_PASSWORD_VERIFIER:JSON.stringify({salt,iterations:100000,hash:pbkdf2Sync('fixture-access-only',Buffer.from(salt,'hex'),100000,32,'sha256').toString('hex')}),BITHASH_SESSION_SECRET:randomBytes(32).toString('hex')};
http.createServer(async(req,res)=>{
 try{
  const request=new Request('http://127.0.0.1:4190'+req.url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:req,duplex:'half'}:{})});
  const reply=await worker.fetch(request,env);res.writeHead(reply.status,Object.fromEntries(reply.headers));res.end(Buffer.from(await reply.arrayBuffer()));
 }catch{res.writeHead(500).end();}
}).listen(4190,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:4190/'));

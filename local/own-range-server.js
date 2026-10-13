import {createServer} from 'node:http';
import {createServer as createTlsServer} from 'node:https';
import {ownRangeSummary} from './own-range-ledger.js';
import {shape} from './own-range-protocol.js';
export function ownRangeHandler(ledger,{secureTransport=false,clock=Date.now}={}){
 let window=0,count=0;
 const listener=async(req,res)=>{
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  const send=(code,v)=>{res.writeHead(code);res.end(JSON.stringify(v));};
  const second=Math.floor(Date.now()/1000);if(second!==window){window=second;count=0;}if(++count>50)return send(429,{error:'rate_limited'});
  if(req.method==='GET'&&req.url==='/api/own-ranges')return send(200,ownRangeSummary(ledger.controller.db));
  if(req.method!=='POST'||!['/worker/range/task','/worker/range/receipt'].includes(req.url))return send(404,{error:'not_found'});
  if(req.headers['content-type']!=='application/json'||req.headers['content-encoding'])return send(415,{error:'json_required'});
  const cap=(req.headers.authorization??'').replace(/^Bearer /,'');let body='';
  try{
   for await(const b of req){body+=b.toString();if(Buffer.byteLength(body)>8192)return send(413,{error:'body_too_large'});}
   const v=JSON.parse(body);shape(v,req.url.endsWith('/task')?'jobId,epoch,chunkSize':'jobId,epoch,envelope');
   const row=ledger.row(v.jobId);if(!secureTransport&&row.target!=='range-probe-71')return send(403,{error:'tls_required'});
   if(req.url.endsWith('/task')){
    const job=ledger.authenticate(v.jobId,v.epoch,cap,clock(),true);
    if(job.state==='completed')return send(200,{request:null,completed:true});
    return send(200,{request:ledger.next(v.jobId,v.epoch,cap,v.chunkSize,clock())});
   }
   return send(200,ledger.accept(v.jobId,v.epoch,cap,v.envelope,clock()));
  }catch(e){return send(409,{error:['lease_expired','lease_fenced','target_paused'].includes(e.code)?e.code:'range_request_rejected'});}
 };
 return listener;
}
export function createOwnRangeServer(ledger,{tls,clock=Date.now}={}){
 const listener=ownRangeHandler(ledger,{secureTransport:!!tls,clock});
 const server=tls?createTlsServer({...tls,minVersion:'TLSv1.2'},listener):createServer(listener);
 server.requestTimeout=10000;server.headersTimeout=10000;server.maxHeadersCount=32;return server;
}

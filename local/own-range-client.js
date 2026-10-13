import http from 'node:http';
import https from 'node:https';
import {rangeFail} from './own-range-protocol.js';
export function rangeClient({origin,capability,ca,validationOnly=false}){
 const url=new URL(origin);
 if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||! /^[a-f0-9]{64}$/.test(capability)||
  (url.protocol!=='https:'&&!(validationOnly&&url.protocol==='http:'&&url.hostname==='127.0.0.1')))throw rangeFail('invalid_transport');
 return (path,input)=>new Promise((resolve,reject)=>{
  if(!['/worker/range/task','/worker/range/receipt'].includes(path))return reject(rangeFail('invalid_transport'));
  const body=Buffer.from(JSON.stringify(input));const client=url.protocol==='https:'?https:http;
  const req=client.request(url.origin+path,{method:'POST',ca,rejectUnauthorized:true,timeout:10000,
   headers:{'Content-Type':'application/json','Content-Length':body.length,Authorization:'Bearer '+capability}},res=>{
   let text='';res.on('data',b=>{text+=b.toString();if(Buffer.byteLength(text)>16384){res.destroy();reject(rangeFail('response_too_large'));}});
   res.on('error',()=>reject(rangeFail('transport_failed')));res.on('end',()=>{try{const data=JSON.parse(text);if(res.statusCode!==200)throw rangeFail(['lease_expired','lease_fenced'].includes(data.error)?data.error:'transport_rejected');resolve(data);}catch(e){reject(rangeFail(e.code??'transport_rejected'));}});
  });req.on('timeout',()=>req.destroy());req.on('error',()=>reject(rangeFail('transport_failed')));req.end(body);
 });
}

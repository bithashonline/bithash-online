import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {operatorRecord} from './operator-record.js';
createServer(async(req,res)=>{
 res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');if(req.method!=='GET'){res.writeHead(405).end('{}');return;}
 const match=/^\/api\/operator-proof\/([a-f0-9]{64})$/.exec(req.url);if(req.url!=='/api/operator'&&!match){res.writeHead(404).end('{}');return;}
 try{let data=JSON.parse(await readFile(match?'/var/lib/bithash-operator/reports/'+match[1]+'.json':'/var/lib/bithash-operator/latest.json','utf8'));const rec=operatorRecord(match?data.report:data.record.report);if(rec.digest!==(match?match[1]:data.record.digest))throw Error();if(!match)data={...data,observedAt:new Date().toISOString()};res.end(JSON.stringify(data));}catch{res.writeHead(match?404:503).end('{"error":"operator_unavailable"}');}
}).listen(8791,'127.0.0.1');

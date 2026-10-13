import {test} from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {telemetry} from './worker/telemetry.mjs';import {approvalMarkup} from './public/approvals.mjs';
const env={BITHASH_TELEMETRY_READ_TOKEN:'a'.repeat(64)},req=(path,method='GET')=>new Request('https://bithash.online'+path,{method});
const feed={schema:'bithash.spending-approvals.v1',mode:'local-simulation',readOnly:true,liveExecutionEnabled:false,exportedAt:'2026-01-01T00:00:00Z',syncReceivedAt:'2026-01-01T00:00:00Z',events:[],proposals:[]};
const reply=data=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
test('public ledger keeps stale records available but exposes no mutations',async()=>{
 assert.equal((await telemetry(req('/api/approvals'),env,async()=>reply(feed))).status,200);
 for(const path of ['/api/approvals','/api/approval-evidence/1'])assert.equal((await telemetry(req(path,'POST'),env,()=>{throw Error('must not fetch');})).status,405);
 assert.equal((await telemetry(req('/api/approvals?token=x'),env)).status,400);
 assert.equal((await telemetry(req('/api/approvals'),env,async()=>reply({...feed,liveExecutionEnabled:true}))).status,503);
});
test('proof digest and event ID must match; altered proofs fail closed',async()=>{
 const proof={schema:'bithash.public-approval-proof.v1',seq:1,mode:'local-simulation'},digest=createHash('sha256').update(JSON.stringify(proof)).digest('hex');
 assert.equal((await telemetry(req('/api/approval-evidence/1'),env,async()=>reply({proof,digest}))).status,200);
 assert.equal((await telemetry(req('/api/approval-evidence/2'),env,async()=>reply({proof,digest}))).status,503);
 assert.equal((await telemetry(req('/api/approval-evidence/1'),env,async()=>reply({proof:{...proof,at:1},digest}))).status,503);
});
test('public proposed run has evidence but never an approve button',()=>{
 const html=approvalMarkup({...feed,proposals:[{id:'test',state:'proposed',terms:{count:5,gpu:'rtx-a5000',durationSeconds:60,capMicrousd:'20834',provider:'mock',expiresAt:4102444800},sourceEvidenceUrl:'/api/approval-evidence/1'}]});
 assert.doesNotMatch(html.cards,/<form|<button/);assert.match(html.cards,/approval-evidence\/1/);
});

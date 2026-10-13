import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {chooseMission,simulationOptions} from './operator-choice.js';
const limits={maxCount:5,maxDurationSeconds:600,maxCostMicrousd:'300000'};
function report(){const r=JSON.parse(readFileSync(new URL('../experiments/evidence/2026-10-12-chatgpt-operator-report.json',import.meta.url)));r.generatedAt=new Date().toISOString();r.evidence.observedAt=r.generatedAt;const {digest,...e}=r.evidence;r.evidence.digest=createHash('sha256').update(JSON.stringify(e)).digest('hex');return r;}
test('AI selects a bounded option; no executable parameters or wallet enters the request',async()=>{
 const r=report(),opts=simulationOptions(limits);assert.equal(opts.length,4);
 const out=await chooseMission(r,limits,{accessToken:'synthetic-test-token',model:'fixture-model',fetcher:async(url,o)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');const body=JSON.parse(o.body);assert.equal(body.tools,undefined);assert.equal(body.store,false);assert.equal(body.stream,true);
  const text=JSON.stringify({optionId:opts[2].id,reason:'Five workers exercise allocation in a short simulation.'});
  return new Response('data: '+JSON.stringify({type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}]}})+'\n\n',{headers:{'Content-Type':'text/event-stream'}});
 }});assert.equal(out.selected.input.count,5);assert.equal(out.selected.input.durationSeconds,60);assert.equal(out.executionEnabled,false);assert.equal(out.approvalRequired,true);
});
test('invented choices, extra commands, no funds and stale evidence cannot create a mission',async()=>{
 assert.equal(simulationOptions({...limits,maxCostMicrousd:'1'}).length,0);
 for(const choice of [{optionId:'rent-1000',reason:'bad'},{optionId:'hold',reason:'okay',command:'run'}])await assert.rejects(chooseMission(report(),limits,{accessToken:'fixture',model:'fixture',fetcher:async()=>new Response('data: '+JSON.stringify({type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(choice)}]}]}})+'\n\n',{headers:{'Content-Type':'text/event-stream'}})}),/invalid_mission_choice/);
 const r=report();await assert.rejects(chooseMission(r,limits,{accessToken:'fixture',model:'fixture',now:Date.now()+50000,fetcher:()=>{throw Error('must not call');}}),/fresh_ai/);
});

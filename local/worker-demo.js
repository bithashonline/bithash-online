import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Controller, MockProvider } from './controller.js';
import { runFixtureChunk } from './worker-runner.js';
const dir=mkdtempSync(join(tmpdir(),'bithash-demo-')),path=join(dir,'state.sqlite');
let c=new Controller(path);
try {
  c.fund('demo','bithash','100');c.plan('demo','puzzle-3','4','8','50');
  c.dispatch('demo',new MockProvider(c));c.lease('demo',0,30);
  const first=await runFixtureChunk(c,'demo',1,'2',()=>1);
  c.close();c=new Controller(path);
  const resumedAt=c.job('demo').next;
  const second=await runFixtureChunk(c,'demo',1,'2',()=>2);
  c.stop('demo');c.settle('demo','synthetic-invoice','0','0');
  console.log(JSON.stringify({mode:'LOCAL CPU SOLVED FIXTURE / MOCK PROVIDER',gpuUsed:false,
    realFundsSpent:'0',resumedAt,first,second,report:c.report()},null,2));
} finally {c.close();rmSync(dir,{recursive:true,force:true});}

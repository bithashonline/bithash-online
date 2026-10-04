import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Controller, MockProvider, charge } from './controller.js';
const dir=resolve(process.argv[2] ?? 'work/demo'); mkdirSync(dir,{recursive:true});
const c=new Controller(resolve(dir,'state.sqlite'));
try {
  c.fund('synthetic-r1','fixture-coin','1000');
  c.plan('fixture-job','puzzle-3','4','8','500');
  if(c.job('fixture-job').status==='planned') {
    try {c.dispatch('fixture-job',new MockProvider(c,{timeoutAfterCreate:true}));} catch(e) {
      if(c.job('fixture-job').status!=='unknown') throw e;
    }
  }
  if(c.job('fixture-job').status==='unknown') c.reconcile('fixture-job');
  if(['ready','running'].includes(c.job('fixture-job').status)) {
    const j=c.lease('fixture-job',c.job('fixture-job').expires,30);
    while(BigInt(c.job(j.id).next)<BigInt(j.end)) c.runChunk(j.id,j.epoch,'2',j.expires-1);
    c.stop(j.id);
  }
  c.settle('fixture-job','mock-invoice-1',charge('10','7').toString(),'10');
  const report=c.report(); writeFileSync(resolve(dir,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
} finally {c.close();}

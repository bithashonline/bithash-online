import { Controller, MockProvider } from './controller.js';
import { coverageSummary, previewCoverageRange } from './coverage.js';

const c = new Controller(':memory:');
try {
  c.fund('demo','demo','10');
  c.coverage.importSnapshot({schema:'bithash.external-coverage.v1',id:'synthetic-demo',
    targetId:'puzzle-3',targetVersion:1,sourceUrl:'https://example.org/synthetic-coverage',
    observedAt:100,expiresAt:1000,intervals:[{start:'4',end:'6'}]},100);
  const before = coverageSummary(c.db,'puzzle-3',100);
  const first = c.planNextFixture('unreported-first','puzzle-3','4','1',100);
  c.dispatch(first.job.id,new MockProvider(c)); const lease = c.lease(first.job.id,0);
  c.runChunk(first.job.id,lease.epoch,'4',1); c.stop(first.job.id); c.settle(first.job.id,'demo-invoice','1','1');
  const fallback = c.planNextFixture('reported-fallback','puzzle-3','4','1',100);
  console.log(JSON.stringify({mode:'SYNTHETIC CPU FIXTURE DEMO / NO LIVE POOL DATA OR GPU RENTAL',
    before,firstSelection:first.selection,fallbackSelection:fallback.selection,
    after:coverageSummary(c.db,'puzzle-3',100),
    puzzle71:coverageSummary(c.db,'puzzle-71',100),
    puzzle71Preview:previewCoverageRange(c.db,'puzzle-71','1000000',100)
  },null,2));
} finally { c.close(); }

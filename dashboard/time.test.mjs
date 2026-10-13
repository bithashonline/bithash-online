import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {localTime,localReportText} from './public/time.mjs';
test('local timestamps honor visitor zone, DST and previous calendar day',()=>{
 const instant='2026-10-13T02:26:14Z';
 assert.match(localTime(instant,{locale:'en-US',timeZone:'America/Toronto'}),/Oct 12, 2026, 10:26:14 PM EDT/);
 assert.match(localTime(instant,{locale:'en-US',timeZone:'Asia/Tokyo'}),/Oct 13, 2026, 11:26:14 AM GMT\+9/);
 assert.match(localTime('2026-12-13T02:26:14Z',{locale:'en-US',timeZone:'America/Toronto'}),/Dec 12, 2026, 9:26:14 PM EST/);
 assert.equal(localTime('bad'),'Not recorded');assert.equal(localTime(null),'Not recorded');
});
test('saved AI timestamps localize only when their UTC date is known; archives stay unchanged',()=>{
 const records=JSON.parse(readFileSync('fixtures/gpu-activity-records.json','utf8'));
 const before=JSON.stringify(records),options={locale:'en-US',timeZone:'America/Toronto'};
 for(const {report}of records){const map=new Map(report.evidence.sources.map(s=>[s.id,s]));
  for(const statement of [report.advice.summary,...report.advice.updates]){
   const view=localReportText(statement.text,statement.sourceIds.map(id=>map.get(id)),options);
   assert(!view.includes(' UTC'));assert(!view.includes('\u0000'));assert.match(view,/EDT/);
  }
 }
 assert.equal(JSON.stringify(records),before);
 assert.equal(localReportText('At 02:26 UTC, cause unknown.',[],options),'At 02:26 UTC, cause unknown.');
 const rendered=localReportText('2026-10-13 UTC: stop at 02:26:14.',[],options);
 assert.match(rendered,/Oct 12, 2026, 10:26:14 PM EDT/);
 const minute=localReportText('The 02:14 reports.',[{at:'2026-10-13T02:14:07Z'}],options);
 assert.match(minute,/10:14 PM EDT/);assert(!minute.includes('10:14:00'));
});

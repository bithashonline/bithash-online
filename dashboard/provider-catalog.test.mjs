import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogMarkup} from './public/provider-catalog.mjs';
test('saved prices cannot be mistaken for an executable all-in quote',()=>{
 const e={liveExecutionEnabled:false,stale:false,record:{schema:'bithash.runpod-catalog.v1',observedAt:'2026-10-12T22:30:00Z',filters:{count:1},rows:[{gpu:'<test>',hourlyPerGpuMicrousd:'890000',availability:'LOW'}]},blockers:[]};
 const html=catalogMarkup(e,Date.parse(e.record.observedAt)+61000);
 assert.match(html,/STALE OBSERVATION/);assert.match(html,/Storage and shutdown/);assert.match(html,/&lt;test&gt;/);assert.match(html,/does not poll Runpod/);
 assert.throws(()=>catalogMarkup({...e,liveExecutionEnabled:true}));
});

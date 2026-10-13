import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cases,checkResult} from '../gpu/validation.mjs';
import {search} from './solver.js';
import {readFileSync} from 'node:fs';

test('GPU validation corpus covers every subrange of all solved fixtures, including excluded solutions',()=>{
 const corpus=cases();assert.equal(corpus.length,14);
 for(const c of corpus){const expected=search(c.fixture,c.start,c.end);assert.equal(checkResult(c,JSON.stringify({backend:'bitcrack-cuda-bounded-fixture',attempted:expected.attempted,matched:expected.matched})).agreesWithCpu,true)}
 assert.equal(search('puzzle-3','4','7').matched,false);assert.equal(search('puzzle-3','7','8').matched,true);
 const vectors=JSON.parse(readFileSync(new URL('../gpu/reference-vectors.json',import.meta.url)));
 assert.deepEqual(vectors,corpus.map(c=>{const r=search(c.fixture,c.start,c.end);return {...c,attempted:r.attempted,matched:r.matched}}));
});
test('GPU validation rejects overshoot, false matches, CPU backend and candidate-bearing output',()=>{
 const c={fixture:'puzzle-3',start:'4',end:'7'};
 const valid={backend:'bitcrack-cuda-bounded-fixture',attempted:'3',matched:false};
 for(const change of [{attempted:'32'},{matched:true},{backend:'cpu'},{privateKey:'hidden'},{attempted:3}]) assert.throws(()=>checkResult(c,JSON.stringify({...valid,...change})));
 assert.throws(()=>checkResult({...c,fixture:'puzzle-71'},JSON.stringify(valid)));
});

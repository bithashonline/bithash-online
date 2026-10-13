import { fixtures, search } from '../local/solver.js';

export function cases() {
  return fixtures.flatMap(f=>{
    const result=[];
    for(let a=BigInt(f.start);a<BigInt(f.end);a++)
      for(let b=a+1n;b<=BigInt(f.end);b++) result.push({fixture:f.id,start:String(a),end:String(b)});
    return result;
  });
}
export function checkResult(test, raw) {
  const expected=search(test.fixture,test.start,test.end);
  const result=JSON.parse(raw);
  if(!result || Object.keys(result).sort().join(',')!=='attempted,backend,matched' ||
    result.backend!=='bitcrack-cuda-bounded-fixture' || result.attempted!==expected.attempted || result.matched!==expected.matched)
    throw Error('GPU fixture disagrees with CPU reference or output schema');
  return { ...test, attempted:result.attempted, matched:result.matched, agreesWithCpu:true };
}

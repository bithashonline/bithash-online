import {digest} from '../../local/own-range-protocol.js';
import {GPU_IDS} from './provider.mjs';import {liveOptions} from './planning.mjs';
export const FLEET_COUNT=2;
export const fleetClosed=state=>['completed','failed','cancelled','expired','rejected'].includes(state);
export function fleetInput(input){
 if(!input||Object.keys(input).sort().join()!=='capMicrousd,count,durationSeconds,gpu'||input.count!==FLEET_COUNT||!GPU_IDS[input.gpu]||!Number.isInteger(input.durationSeconds)||input.durationSeconds<300||input.durationSeconds>900||typeof input.capMicrousd!=='string'||!/^\d{1,7}$/.test(input.capMicrousd)||BigInt(input.capMicrousd)<20000n||BigInt(input.capMicrousd)>1000000n)throw Error('invalid_fleet_terms');
 return input;
}
export function fleetMissions(missions){
 if(!Array.isArray(missions)||missions.length!==FLEET_COUNT||new Set(missions.map(m=>m.jobId)).size!==FLEET_COUNT)throw Error('invalid_fleet_missions');
 const ordered=[...missions].sort((a,b)=>BigInt(a.start)<BigInt(b.start)?-1:1);
 if(BigInt(ordered[0].end)>BigInt(ordered[1].start))throw Error('overlapping_fleet_missions');return missions;
}
export function fleetOptions(quote,limits,now,missions){
 fleetMissions(missions);for(const m of missions)liveOptions(quote,limits,now,m);
 const checked=liveOptions(quote,limits,now,missions[0]);
 return checked.flatMap(o=>{
  const estimated=BigInt(o.estimatedMaximumMicrousd)*BigInt(FLEET_COUNT);if(estimated>BigInt(limits.capMicrousd))return [];
  const input={gpu:o.input.gpu,count:FLEET_COUNT,durationSeconds:o.input.durationSeconds,capMicrousd:limits.capMicrousd};
  return [{id:'option-'+digest({input,missions}).slice(0,16),input,estimatedMaximumMicrousd:String(estimated),workload:'fixed-public-puzzle-fleet',count:FLEET_COUNT,puzzle71Candidates:String(missions.reduce((n,m)=>n+BigInt(m.end)-BigInt(m.resumeFrom??m.start),0n))}];
 });
}

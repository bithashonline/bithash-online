import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {fleetView,validFleet} from './public/fleet.mjs';
const saved=JSON.parse(readFileSync(new URL('./fixtures/gpu-reports.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
const now=Date.parse('2026-10-13T02:30:00Z'),time=new Date(now).toISOString(),id='17jsao96984h9q';
const pod={id,status:'DELETED',observedAt:time,gpuModel:null,gpuCount:null,hourlyUsd:null,evidence:'provider-get-404'};
const snapshot=p=>({schema:'bithash.fleet-status.v1',scope:'registered-bithash-pods',source:'runpod-read-only',observedAt:time,items:[p]});
const running={...pod,status:'RUNNING',gpuModel:'NVIDIA GeForce RTX 4090',gpuCount:1,hourlyUsd:'0.89',evidence:'provider-get'};
test('saved real reports cannot revive a deleted rental; latest matching report is linked',()=>{
 const v=fleetView(snapshot(pod),saved.snapshot,now);assert.equal(v.count,'0');assert(v.html.includes('DELETED · SESSION RECORD'));assert(v.html.includes('2,097,152'));assert(v.html.includes('061439fb19d3dfdb0bc644ff30e89dbc3c43712a7f8fb0c7f63f2469b89d42fd'));assert(!v.html.includes('rig-active.png'));
});
test('provider running with historical worker reports is counted but never animated as computing',()=>{
 const v=fleetView(snapshot(running),saved.snapshot,now);assert.equal(v.count,'1');assert(!v.html.includes('rig-active.png'));assert(v.html.includes('historical / inactive'));
});
test('explicit replay of saved computing report animates only while both observations are fresh',()=>{
 const proof=saved.proofs.find(p=>p.envelope.payload.state==='computing'&&p.envelope.payload.utilizationPercent===97);
 const reports={items:[{id:proof.enrollment.id,kind:'gpu',providerPodId:id,freshness:'fresh',lastReceivedAt:time,expiresAt:new Date(now+60000).toISOString(),reported:proof.envelope.payload,proof:'/api/gpu-proof/'+proof.digest}]};
 assert(fleetView(snapshot(running),reports,now).html.includes('rig-active.png'));
 assert(!fleetView(snapshot(running),reports,now+31000).html.includes('rig-active.png'));
 assert.equal(fleetView(snapshot(running),reports,now+46000).count,'—');
 assert.equal(fleetView(snapshot(running),reports,now,false).count,'—');
});
test('unknown, stale, future, incomplete or duplicate provider records never produce false zero',()=>{
 assert.equal(fleetView(null,saved.snapshot,now).count,'—');
 assert.equal(fleetView(snapshot({...pod,status:'UNKNOWN',evidence:'provider-unavailable'}),saved.snapshot,now).count,'—');
 assert.equal(fleetView(snapshot(pod),saved.snapshot,now+46000).count,'—');
 assert.equal(fleetView(snapshot(pod),saved.snapshot,now-10000).count,'—');
 assert(!validFleet(snapshot({...running,gpuCount:null})));
 assert(!validFleet({...snapshot(pod),items:[pod,pod]}));
});
test('hostile provider labels are escaped and arbitrary report links cannot be rendered',()=>{
 const v=fleetView(snapshot({...running,gpuModel:'<script>bad</script>'}),{items:[{kind:'gpu',providerPodId:id,reported:{state:'<img>'},lastReceivedAt:time,proof:'https://evil.invalid'}]},now);
 assert(!v.html.includes('<script>'));assert(!v.html.includes('href="https://evil'));assert(v.html.includes('&lt;script&gt;'));
});

test('fresh deleted history is collapsed without hiding unknown rental states',()=>{const idle=fleetView(snapshot(pod),saved.snapshot,now);assert(idle.html.includes('<summary>Deleted rentals (1)'));assert(!idle.html.includes('rental-history\" open'));assert(idle.html.includes('No active rentals.'));const unknown=fleetView(snapshot({...pod,status:'UNKNOWN',evidence:'provider-unavailable'}),saved.snapshot,now);assert(!unknown.html.includes('rental-history'));assert(!unknown.html.includes('No active rentals.'));});

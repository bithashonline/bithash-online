import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ShutdownController } from './controller.mjs';
import { ProviderError } from './provider.mjs';
const lease=JSON.parse(readFileSync(new URL('./example-lease.json',import.meta.url),'utf8'));
lease.deleteDisposablePod=true;
let now=Date.parse(lease.startedAt),pod={id:lease.podId,name:lease.expectedName,desiredStatus:'RUNNING',hourlyMicrousd:lease.hourlyCeilingMicrousd,volumeInGb:0,networkVolumeId:null};
const provider={get:async()=>pod,stop:async()=>{throw new ProviderError('http_403',403);},delete:async()=>{pod=null;}};
const path=join(mkdtempSync(join(tmpdir(),'bithash-shutdown-demo-')),'state.sqlite');
let controller=new ShutdownController(path,provider,{clock:()=>now});
const snapshots=[];
try {
  const registered=controller.register(lease);await controller.tick();snapshots.push({stage:'identity_checked',pods:controller.status()});
  now=Date.parse(registered.triggerAt);await controller.tick();snapshots.push({stage:'stop_rejected_403',pods:controller.status()});
  controller.close();controller=new ShutdownController(path,provider,{clock:()=>now});
  await controller.tick();snapshots.push({stage:'restart_then_delete_requested',pods:controller.status()});
  await controller.tick();snapshots.push({stage:'provider_absence_observed',pods:controller.status()});
  console.log(JSON.stringify({schema:'bithash.shutdown-demo.v1',evidence:'simulated provider with real SQLite persistence; no Runpod request or rental',snapshots,events:controller.events()},null,2));
} finally {controller.close();}

import { readFileSync, writeFileSync } from 'node:fs';
import { ShutdownController } from '../controller.mjs';
const [path,remote,at]=process.argv.slice(2);
const provider={get:async()=>JSON.parse(readFileSync(remote,'utf8')),stop:async()=>{
  const pod=JSON.parse(readFileSync(remote,'utf8'));pod.desiredStatus='EXITED';writeFileSync(remote,JSON.stringify(pod));
  process.exit(73); // Simulate provider acceptance followed by controller process loss.
},delete:async()=>{throw Error('unexpected_delete');}};
const controller=new ShutdownController(path,provider,{clock:()=>Number(at)});
await controller.tick();process.exit(74);

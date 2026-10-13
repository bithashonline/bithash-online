import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ShutdownController } from './controller.mjs';
import { RunpodShutdownApi } from './provider.mjs';
import { controllerCredential } from './credential.mjs';

// No key arguments, custom hosts, create/resume commands or raw provider output.
const [command, dbArg, leaseArg, ...extra] = process.argv.slice(2);
let controller;
try {
  if (!['register','status','check','watch','serve','stop-all'].includes(command) || !dbArg || extra.length ||
      (command === 'register' ? !leaseArg : Boolean(leaseArg))) throw Error('usage: cli.mjs register DB LEASE.json | status/check/watch/serve/stop-all DB');
  const path = resolve(dbArg); mkdirSync(dirname(path),{recursive:true});
  if (['check','watch','serve','stop-all'].includes(command) && process.env.RUNPOD_POD_ID) throw Error('controller_must_run_outside_runpod_pod');
  const provider = ['check','watch','serve','stop-all'].includes(command)
    ? new RunpodShutdownApi({apiKey:controllerCredential()}) : null;
  controller = new ShutdownController(path,provider);
  if (command === 'register') controller.register(JSON.parse(readFileSync(leaseArg,'utf8').replace(/^\uFEFF/,'')));
  if (command === 'stop-all') controller.requestStopAll();
  if (['check','stop-all'].includes(command)) await controller.tick();
  if (command === 'watch' || command === 'serve') {
    let quitting = false;
    const quit = () => { quitting = true; controller.requestStopAll('controller_exit'); };
    process.once('SIGINT',quit); process.once('SIGTERM',quit);
    do {
      const state = await controller.tick();
      console.log(JSON.stringify({schema:'bithash.shutdown-status.v1',observedAt:new Date().toISOString(),permitsNewRental:false,pods:state}));
      if (command === 'watch' && (!state.length || state.every(p=>p.phase==='absence_observed'))) break;
      if (quitting) {
        // One final bounded pass; service restart/operator must reconcile any unknown outcome.
        await controller.tick(); break;
      }
      await delay(5000);
    } while (true);
    process.removeListener('SIGINT',quit); process.removeListener('SIGTERM',quit);
  }
  const pods = controller.status(); console.log(JSON.stringify({schema:'bithash.shutdown-status.v1',pods}));
  if (pods.some(p=>p.lastError || (p.reason && p.phase!=='absence_observed' && p.phase!=='provider_expected_stopped'))) process.exitCode=2;
} catch (error) {
  // Static errors only; never print input JSON, fetch bodies, credentials or stack traces.
  const safe = /^[a-z0-9_: .|/\[\]-]+$/i.test(error.message) && error.message.length < 160;
  console.error(JSON.stringify({error:safe ? error.message : 'shutdown_controller_failed'})); process.exitCode=1;
} finally { controller?.close(); }

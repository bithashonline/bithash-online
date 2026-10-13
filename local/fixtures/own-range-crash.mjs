import {readFile} from 'node:fs/promises';
import {rangeClient} from '../own-range-client.js';
import {runOwnRangeWorker} from '../own-range-runtime.js';
const c=JSON.parse(await readFile(process.argv[2],'utf8'));
await runOwnRangeWorker(c,{client:rangeClient(c),directory:c.stateDirectory,privateKey:await readFile(c.keyFile),afterScan:()=>process.exit(77)});

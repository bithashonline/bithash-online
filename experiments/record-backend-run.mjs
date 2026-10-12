import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const git = args => spawnSync('git', ['-c', `safe.directory=${root.replaceAll('\\','/')}`, ...args], {cwd:root, encoding:'utf8'});
const head = git(['rev-parse','HEAD']), status = git(['status','--porcelain']);
const sources = [];
for (const folder of ['local','local/fixtures','gpu']) {
  if (!existsSync(join(root,folder))) continue;
  for (const entry of readdirSync(join(root,folder),{withFileTypes:true})) {
    if (!entry.isFile() || !/\.(js|mjs|json|py|cpp|sh)$/.test(entry.name)) continue;
    const path = `${folder}/${entry.name}`;
    sources.push({path,sha256:createHash('sha256').update(readFileSync(join(root,path))).digest('hex')});
  }
}
sources.sort((a,b)=>a.path.localeCompare(b.path));
const startedAt = new Date().toISOString();
const run = spawnSync(process.execPath,['--experimental-sqlite','--test','--test-reporter=tap'],
  {cwd:join(root,'local'),encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});
const completedAt = new Date().toISOString();
const id = startedAt.replaceAll(':','-').replaceAll('.','-')+'-'+randomUUID().slice(0,8);
const output = join(root,'experiments','runs',id); mkdirSync(output,{recursive:true});
const transcript = ((run.stdout ?? '')+'\n'+(run.stderr ?? '')).replaceAll(root,'[project]');
writeFileSync(join(output,'test-output.txt'),transcript);
writeFileSync(join(output,'source-manifest.json'),JSON.stringify(sources,null,2)+'\n');
const counts = Object.fromEntries(['tests','pass','fail','skipped','cancelled'].map(key=>[
  key, transcript.match(new RegExp(`^# ${key} (\\d+)$`,'m'))?.[1] ?? null
]));
const result = {schema:'bithash.backend-experiment.v1',startedAt,completedAt,
  evidence:'local CPU fixtures and simulated control-plane tests; no GPU or provider rental',
  command:'node --experimental-sqlite --test --test-reporter=tap',nodeVersion:process.version,
  platform:process.platform,gitHead:head.status===0?head.stdout.trim():null,
  workingTreeWasDirty:status.status===0?Boolean(status.stdout.trim()):null,
  sourceIdentity:'source-manifest.json hashes working files; gitHead alone is not the tested source snapshot',
  exitCode:run.status,signal:run.signal,errorCode:run.error?.code ?? null,
  outcome:run.status===0?'passed':'failed',counts,
  transcriptSha256:createHash('sha256').update(transcript).digest('hex')};
writeFileSync(join(output,'result.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({directory:relative(root,output),...result},null,2));
process.exitCode=run.status===0?0:1;

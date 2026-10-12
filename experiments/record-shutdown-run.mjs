import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const sources=[];
function walk(folder){for(const entry of readdirSync(join(root,folder),{withFileTypes:true})){
  const path=`${folder}/${entry.name}`;
  if(entry.isDirectory())walk(path);
  else sources.push({path,sha256:createHash('sha256').update(readFileSync(join(root,path))).digest('hex')});
}}
walk('ops/runpod-shutdown');
const tests=['cli.test.mjs','controller.test.mjs','provider.test.mjs'].map(x=>'ops/runpod-shutdown/'+x);
const startedAt=new Date().toISOString();
const run=spawnSync(process.execPath,['--experimental-sqlite','--test',...tests],{cwd:root,encoding:'utf8',timeout:60000,maxBuffer:2e6});
const demo=spawnSync(process.execPath,['--experimental-sqlite','ops/runpod-shutdown/demo.mjs'],{cwd:root,encoding:'utf8',timeout:15000,maxBuffer:2e6});
const sanitize=text=>(text??'').replaceAll(root,'[project]').replaceAll(root.replaceAll('\\','/'),'[project]');
const transcript=sanitize(run.stdout)+'\n'+sanitize(run.stderr);
const counts=Object.fromEntries(['tests','pass','fail'].map(key=>[key,Number(transcript.match(new RegExp(`^# ${key} (\\d+)$`,'m'))?.[1]??NaN)]));
const result={schema:'bithash.shutdown-experiment.v1',startedAt,completedAt:new Date().toISOString(),
  evidence:'local state-machine, subprocess-crash and loopback HTTP tests; simulated provider demo; no Runpod access or spending',
  nodeVersion:process.version,platform:process.platform,tests:counts,testExitCode:run.status,demoExitCode:demo.status,
  outcome:run.status===0&&demo.status===0?'passed':'failed',
  testTranscriptSha256:createHash('sha256').update(transcript).digest('hex'),
  demoSha256:createHash('sha256').update(demo.stdout??'').digest('hex'),
  liveProviderValidated:false,controllerDeployed:false,spendUsd:0};
const output=join(root,'experiments/runs',startedAt.replaceAll(':','-').replaceAll('.','-')+'-shutdown');mkdirSync(output,{recursive:true});
writeFileSync(join(output,'test-output.txt'),transcript);
writeFileSync(join(output,'demo.json'),demo.stdout??'');
writeFileSync(join(output,'source-manifest.json'),JSON.stringify(sources.sort((a,b)=>a.path.localeCompare(b.path)),null,2)+'\n');
writeFileSync(join(output,'result.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({directory:relative(root,output),...result},null,2));
process.exitCode=result.outcome==='passed'?0:1;

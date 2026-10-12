import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const cli=fileURLToPath(new URL('./cli.mjs',import.meta.url));
test('CLI fails before network access without controller credential or inside a Pod',()=>{
  const dir=mkdtempSync(join(tmpdir(),'bithash-shutdown-cli-')),db=join(dir,'state.sqlite');
  try {
    const env={...process.env};delete env.BITHASH_RUNPOD_CONTROLLER_KEY;delete env.RUNPOD_POD_ID;
    const missing=spawnSync(process.execPath,['--experimental-sqlite',cli,'check',db],{env,encoding:'utf8'});
    assert.equal(missing.status,1);assert(missing.stderr.includes('controller_credential_missing'));
    env.RUNPOD_POD_ID='fixturepod001';env.BITHASH_RUNPOD_CONTROLLER_KEY='fixture';
    const inside=spawnSync(process.execPath,['--experimental-sqlite',cli,'watch',db],{env,encoding:'utf8'});
    assert.equal(inside.status,1);assert(inside.stderr.includes('controller_must_run_outside_runpod_pod'));
    const badFile=join(dir,'bad.json');writeFileSync(badFile,'{"confidential-field":"must-not-leak" invalid}');
    const malformed=spawnSync(process.execPath,['--experimental-sqlite',cli,'register',db,badFile],{env,encoding:'utf8'});
    assert.equal(malformed.status,1);assert(!malformed.stderr.includes('must-not-leak'));
  } finally {assert.equal(dirname(resolve(dir)),resolve(tmpdir()));rmSync(dir,{recursive:true,force:true});}
});

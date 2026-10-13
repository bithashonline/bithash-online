import { readFileSync, statSync } from 'node:fs';
import { Controller } from './controller.js';
import { coverageSummary, previewCoverageRange } from './coverage.js';

const [databasePath, command, argument, size] = process.argv.slice(2);
let c;
try {
  if (!databasePath || !['import','withdraw','summary','preview','audit'].includes(command) || !argument)
    throw Error('Usage: node --experimental-sqlite coverage-cli.js DATABASE import FILE | withdraw ID | summary TARGET | preview TARGET SIZE | audit TARGET');
  c = new Controller(databasePath);
  let result;
  if (command === 'import') {
    if (statSync(argument).size > 2_000_000) throw Error('Import exceeds 2 MB limit');
    result = c.coverage.importSnapshot(JSON.parse(readFileSync(argument,'utf8')));
  } else if (command === 'withdraw') { c.coverage.withdraw(argument); result = { withdrawn:true }; }
  else if (command === 'summary') result = coverageSummary(c.db,argument);
  else if (command === 'preview') result = previewCoverageRange(c.db,argument,size);
  else result = c.db.prepare('SELECT id,source,observed,expires,imported,digest,state,withdrawn,payload FROM coverage_imports WHERE target=? ORDER BY observed,id').all(argument);
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
} catch (error) { process.stderr.write(error.message+'\n'); process.exitCode=1; }
finally { c?.close(); }

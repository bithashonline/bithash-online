import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const reportBytes = read('experiments/results/2026-10-12-benchmark-report.json');
const report = JSON.parse(reportBytes);
const manifestBytes = read('experiments/artifacts/bithash-benchmark-package-manifest.json');
const manifest = JSON.parse(manifestBytes);
const vectorsBytes = read('gpu/benchmark/vectors.json');
const vectors = JSON.parse(vectorsBytes).profiles;
assert.equal(report.status, 'passed');
assert.equal(report.puzzle71Candidates, '0');
assert.equal(report.binarySha256, manifest.files['bithash-benchmark']);
assert.equal(report.packageManifestSha256, hash(manifestBytes));
assert.equal(report.vectorsSha256, hash(vectorsBytes));
assert.equal(report.hardware.model, 'NVIDIA GeForce RTX 4090');
assert.equal(report.cases.length, 6);
const seen = new Set();
for (const entry of report.cases) {
  const id = `${entry.mode}/${entry.profile}`;
  assert(!seen.has(id)); seen.add(id);
  const vector = vectors.find(v => v.id === entry.profile && v.mode === entry.mode);
  assert(vector); assert.equal(entry.status, 'passed');
  const result = entry.result;
  assert.equal(result.profile, entry.profile); assert.equal(result.mode, entry.mode);
  for (const field of ['start', 'end']) assert.equal(result[field], vector[field]);
  assert.equal(result.attempted, vector.count);
  assert.equal(BigInt(result.end) - BigInt(result.start), BigInt(result.attempted));
  assert.equal(result.matches, vector.targets.filter(t => t.expectedMatch).length);
  assert.equal(result.expectedMatches, result.matches); assert.equal(result.correct, true);
  for (const field of ['initializationSeconds', 'scanSeconds', 'candidatesPerSecond']) {
    assert(Number.isFinite(result[field]) && result[field] > 0);
  }
  const calculated = Number(result.attempted) / result.scanSeconds;
  assert(Math.abs(calculated - result.candidatesPerSecond) / calculated < 1e-6);
}
assert(report.telemetrySamples.length > 0);
for (const sample of report.telemetrySamples) {
  for (const key of ['gpuUtilizationPercent','temperatureC','powerW','smClockMHz','memoryMiB']) assert(Number.isFinite(sample[key]));
}
const profiles = report.cases.filter(c => c.mode === 'benchmark').map(c => ({
  profile: c.profile,
  billionCandidatesPerSecond: c.result.candidatesPerSecond / 1e9,
  initializationSeconds: c.result.initializationSeconds,
  scanSeconds: c.result.scanSeconds,
  estimatedUsdPerBillionDuringScanning: 0.894 / 3600 * 1e9 / c.result.candidatesPerSecond
}));
console.log(JSON.stringify({
  status: 'passed', reportSha256: hash(reportBytes), verifiedCases: seen.size,
  telemetrySamples: report.telemetrySamples.length, profiles,
  limitations: 'Checks report consistency and published identities; does not independently attest remote execution or every candidate. Cost projection excludes startup, idle time and transfer overhead.'
}, null, 2));

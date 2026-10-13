import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { workRequest, requestDigest, workResult } from './worker-protocol.js';
import { search } from './solver.js';
import { executeFixture } from './worker-runner.js';
import { checkResult } from '../gpu/validation.mjs';

// Historical 14-case GPU correctness binary, not the overlapping benchmark binary.
export const CUDA_FIXTURE_SHA256 = '4148dce03b6a5a0f7e688b77dc9b00f77190bb2902c1c37b7cb19835368febe6';
export const RANGE_BACKENDS = Object.freeze(['node-openssl-cpu-fixture', 'bitcrack-cuda-bounded-fixture']);
export const rangeError = code => Object.assign(Error(code), { code });

export function validateRangeResult(request, result, backend) {
  request = workRequest(request);
  if (!RANGE_BACKENDS.includes(backend) || result?.backend !== backend) throw rangeError('invalid_result');
  // Both backends use the same exact receipt schema. The CPU reference separately
  // checks the known-answer match, including subranges that exclude the solution.
  try {
    workResult(request, { ...result, backend: 'node-openssl-cpu-fixture' });
    if (search(request.fixture, request.start, request.end).matched !== result.matched) throw Error();
  } catch { throw rangeError('invalid_result'); }
  return { protocol: 1, requestDigest: result.requestDigest, backend, attempted: result.attempted,
    matched: result.matched, elapsedNanoseconds: result.elapsedNanoseconds };
}

export function normalizeCudaResult(request, raw, elapsedNanoseconds) {
  request = workRequest(request);
  try {
    const checked = checkResult({ fixture: request.fixture, start: request.start, end: request.end }, raw);
    return validateRangeResult(request, { protocol: 1, requestDigest: requestDigest(request),
      backend: 'bitcrack-cuda-bounded-fixture', attempted: checked.attempted, matched: checked.matched,
      elapsedNanoseconds: elapsedNanoseconds.toString() }, 'bitcrack-cuda-bounded-fixture');
  } catch { throw rangeError('invalid_result'); }
}

export function executeCudaFixture(request, { binaryPath, signal } = {}) {
  request = workRequest(request);
  if (signal?.aborted) return Promise.reject(rangeError('interrupted'));
  // No configurable executable hash, shell command or inherited auth environment.
  if (process.platform !== 'linux' || typeof binaryPath !== 'string' || !isAbsolute(binaryPath))
    return Promise.reject(rangeError('cuda_unavailable'));
  try {
    if (createHash('sha256').update(readFileSync(binaryPath)).digest('hex') !== CUDA_FIXTURE_SHA256) throw Error();
  } catch { return Promise.reject(rangeError('binary_pin_rejected')); }
  return new Promise((resolve, reject) => {
    const began = process.hrtime.bigint();
    const child = spawn(binaryPath, [request.fixture, request.start, request.end],
      { shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: {}, windowsHide: true });
    let output = '', bytes = 0, code = null;
    const fail = reason => { code ??= reason; child.kill(); };
    const abort = () => fail('interrupted');
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => fail('worker_timeout'), 5000);
    child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > 4096) fail('invalid_result'); else output += chunk.toString(); });
    child.stderr.on('data', () => fail('worker_failed'));
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    child.on('error', () => { cleanup(); reject(rangeError('worker_failed')); });
    child.on('close', status => {
      cleanup();
      if (code || status !== 0) return reject(rangeError(code ?? 'worker_failed'));
      try { resolve(normalizeCudaResult(request, output, process.hrtime.bigint() - began)); }
      catch { reject(rangeError('invalid_result')); }
    });
  });
}

export function executeRange(request, { backend, binaryPath, signal }) {
  if (backend === 'node-openssl-cpu-fixture') return executeFixture(request, { signal });
  if (backend === 'bitcrack-cuda-bounded-fixture') return executeCudaFixture(request, { binaryPath, signal });
  throw rangeError('unsupported_backend');
}

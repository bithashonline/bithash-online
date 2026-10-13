import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { integer } from './solver.js';
import { workRequest, workResult } from './worker-protocol.js';

export function executeFixture(request, { signal } = {}) {
  request = workRequest(request);
  if (signal?.aborted) return Promise.reject(Error('Fixture worker interrupted'));
  return new Promise((resolve, reject) => {
    // Fixed local executable/module; no shell, provider, DB or inherited credentials.
    const env = process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR } : {};
    const child = spawn(process.execPath, [fileURLToPath(new URL('./fixture-worker.js', import.meta.url))],
      { stdio: ['pipe','pipe','pipe'], windowsHide: true, env });
    let output = '', outputBytes = 0, failed = false;
    const fail = () => { failed = true; child.kill(); };
    signal?.addEventListener('abort', fail, { once: true });
    const timer = setTimeout(fail, 5000);
    child.stdout.on('data', data => { outputBytes += data.length; if (outputBytes > 4096) fail(); else output += data.toString(); });
    child.stderr.on('data', fail); // Discard raw stderr, never leak worker secrets.
    child.stdin.on('error', fail);
    child.on('error', () => { clearTimeout(timer); signal?.removeEventListener('abort', fail); reject(Error('Fixture worker could not start')); });
    child.on('close', code => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', fail);
      if (failed || code !== 0) { reject(Error('Fixture worker failed; checkpoint unchanged')); return; }
      try { resolve(workResult(request, JSON.parse(output))); }
      catch { reject(Error('Invalid fixture worker output; checkpoint unchanged')); }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

export async function runFixtureChunk(controller, jobId, epoch, size, clock = () => Math.floor(Date.now()/1000)) {
  const job = controller.job(jobId), now = clock(); size = integer(size);
  if (!Number.isSafeInteger(now) || now < 0 || !size || job.status !== 'running' || job.epoch !== epoch || now >= job.expires)
    throw Error('Invalid or stale worker lease');
  const end = BigInt(job.next) + size < BigInt(job.end) ? BigInt(job.next) + size : BigInt(job.end);
  const request = workRequest({ protocol: 1, job: job.id, epoch, fixture: job.fixture, start: job.next, end: end.toString() });
  const result = await executeFixture(request);
  // The controller fences lease/expiry again when committing. A racing chunk cannot advance twice.
  if (controller.job(jobId).next !== request.start) throw Error('Checkpoint changed while worker ran');
  controller.checkpoint(jobId, epoch, request.end, clock());
  return result;
}

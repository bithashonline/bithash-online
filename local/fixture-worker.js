import { workRequest, requestDigest } from './worker-protocol.js';
import { search } from './solver.js';
try {
  let data = '';
  for await (const chunk of process.stdin) {
    data += chunk; if (data.length > 4096) throw Error('Input too large');
  }
  const request = workRequest(JSON.parse(data));
  const result = search(request.fixture, request.start, request.end);
  console.log(JSON.stringify({ protocol: 1, requestDigest: requestDigest(request), backend: 'node-openssl-cpu-fixture', ...result }));
} catch {
  // Never echo untrusted input or candidate material into logs.
  process.stderr.write('Fixture worker rejected input\n'); process.exitCode = 1;
}

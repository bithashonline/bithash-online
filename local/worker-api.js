import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { GpuTelemetry } from './gpu-telemetry.js';
import { handleDashboardApi } from './dashboard-api.js';
import { WorkerActivity } from './worker-activity.js';

// Remote TLS mode exposes telemetry only; fixture/approval APIs stay local.
export function createWorkerServer(receipts, { databasePath, clock = () => Math.floor(Date.now()/1000), tls } = {}) {
  const activity = new WorkerActivity(receipts.controller);
  const telemetry = new GpuTelemetry(receipts.controller.db);
  let window=0,requests=0;
  const listener=async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const reply = (code, data) => { res.writeHead(code); res.end(JSON.stringify(data)); };
    const second=Math.floor(Date.now()/1000);if(second!==window){window=second;requests=0;}
    if(++requests>50)return reply(429,{error:'rate_limited'});
    if(req.url==='/api/gpu-progress'||req.url?.startsWith('/api/gpu-proof/')){
      if(req.method!=='GET')return reply(405,{error:'method_not_allowed'});
      try{const data=req.url==='/api/gpu-progress'?telemetry.snapshot(clock()*1000):telemetry.proof(req.url.slice('/api/gpu-proof/'.length));return reply(data?200:404,data??{error:'not_found'});}catch{return reply(503,{error:'collector_unavailable'});}
    }
    const isActivity = req.url === '/api/worker/activity';
    const isGpu=req.url==='/api/worker/gpu-progress';
    if(tls&&!isGpu)return reply(404,{error:'not_found'});
    if (req.url !== '/api/worker/receipts' && !isActivity && !isGpu) {
      if ((req.url?.startsWith('/api/status')||req.url?.startsWith('/api/operator')) && handleDashboardApi(req, res, { databasePath })) return;
      return reply(404, { error: 'not_found' });
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return reply(405, { error: 'method_not_allowed' }); }
    if (req.headers['content-type'] !== 'application/json') return reply(415, { error: 'json_required' });
    if (req.headers['content-encoding']) return reply(415, { error: 'encoding_unsupported' });
    let bytes = 0; const chunks = [];
    try {
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 8192) { reply(413, { error: 'receipt_too_large' }); return; }
        chunks.push(chunk);
      }
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const accepted = isGpu?telemetry.accept(value,clock()*1000):(isActivity ? activity : receipts).accept(value, clock());
      reply(200, { ...accepted, evidence: isActivity ? 'authenticated-worker-claim' : 'authenticated-cpu-fixture-report', gpuVerified: false });
    } catch {
      // Never echo supplied bodies, keys, signatures, SQL errors or local paths.
      if (!res.headersSent) reply(400, { error: isActivity ? 'activity_rejected' : 'receipt_rejected' });
    }
  };
  const server=tls?createHttpsServer({...tls,minVersion:'TLSv1.2'},listener):createServer(listener);
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.maxHeadersCount = 32;
  return server;
}

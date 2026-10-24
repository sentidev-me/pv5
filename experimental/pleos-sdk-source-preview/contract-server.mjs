// Isolated protocol-test harness only. Not used by the root v0.5 web app.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkflow, WorkflowError } from '../../workflow.mjs';
import { createCommunication } from '../../communication.mjs';
import { createPleosBridge } from './pleos-bridge.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
const json = (response, status, body) => { response.writeHead(status, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body)); };

async function readBody(request, limit = 16_384) {
  if (!(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new WorkflowError(415, 'JSON_REQUIRED', 'Content-Type: application/json이 필요합니다.');
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > limit) throw new WorkflowError(413, 'BODY_TOO_LARGE', '요청 본문이 너무 큽니다.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw new WorkflowError(400, 'INVALID_JSON', '올바른 JSON 본문이 필요합니다.'); }
}

export function createServer({ dataDir = process.env.MOBFLOW_DATA_DIR || resolve(ROOT, 'data'), publicDir = resolve(ROOT, 'test-assets'), clock, pleosEnabled = process.env.MOBFLOW_PLEOS_EMULATOR === '1' } = {}) {
  const workflow = createWorkflow({ dataDir });
  const communication = createCommunication({ dataDir, ...(clock ? { clock } : {}) });
  const pleos = createPleosBridge({ dataDir, workflow, enabled: pleosEnabled, ...(clock ? { clock } : {}) });
  const staticRoot = resolve(publicDir);
  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    try {
      const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
      const path = url.pathname;
      if (path.startsWith('/api/') && request.method === 'POST') {
        const origin = request.headers.origin;
        if (origin && origin !== `http://${request.headers.host}` && origin !== `https://${request.headers.host}`) throw new WorkflowError(403, 'ORIGIN_REJECTED', '다른 출처의 변경 요청은 허용하지 않습니다.');
      }
      if (path.startsWith('/api/pleos/')) {
        const remote = request.socket.remoteAddress;
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote) || !/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(request.headers.host || '')) throw new WorkflowError(403, 'LOCAL_BRIDGE_ONLY', '로컬 에뮬레이터 브리지만 허용합니다.');
        if (path === '/api/pleos/state' && request.method === 'GET') return json(response, 200, pleos.getState());
        if (path === '/api/pleos/jobs' && request.method === 'POST') { const result = pleos.enqueue(await readBody(request)); return json(response, result.replayed ? 200 : 201, result); }
        if (path === '/api/pleos/claim' && request.method === 'POST') return json(response, 200, pleos.claim(await readBody(request)));
        const sdkAction = path.match(/^\/api\/pleos\/jobs\/([A-Za-z0-9-]+)\/(events|cancel)$/);
        if (sdkAction && request.method === 'POST') return json(response, 200, sdkAction[2] === 'events' ? pleos.report(sdkAction[1], await readBody(request)) : pleos.cancel(sdkAction[1]));
      }
      if (path === '/api/health' && request.method === 'GET') return json(response, 200, { ok: true, mode: 'demo', vehicleConnected: false });
      if (path === '/api/state' && request.method === 'GET') return json(response, 200, workflow.getState());
      if (path === '/api/communication' && request.method === 'GET') return json(response, 200, communication.getState());
      if (path === '/api/communication/configurations' && request.method === 'POST') {
        const result = communication.saveConfiguration(await readBody(request));
        return json(response, result.replayed || result.duplicate ? 200 : 201, result);
      }
      if (path === '/api/communication/runs' && request.method === 'POST') {
        const result = communication.createRun(await readBody(request));
        return json(response, result.replayed || result.duplicate ? 200 : 201, result);
      }
      const communicationAction = path.match(/^\/api\/communication\/runs\/([A-Za-z0-9-]+)\/(depart|advance|complete|stop|stale)$/);
      if (communicationAction && request.method === 'POST') return json(response, 200, communication.transition(communicationAction[1], communicationAction[2], await readBody(request)));
      const customerLink = path.match(/^\/api\/customer-links\/([A-Za-z0-9_-]+)$/);
      if (customerLink && request.method === 'GET') {
        if (url.searchParams.getAll('customerId').length !== 1 || [...url.searchParams.keys()].some((key) => key !== 'customerId')) throw new WorkflowError(404, 'CUSTOMER_LINK_NOT_FOUND', '고객 안내 링크를 확인할 수 없습니다.');
        return json(response, 200, communication.getCustomerLink(customerLink[1], url.searchParams.get('customerId')));
      }
      if (path === '/api/templates/pickup-change' && request.method === 'POST') return json(response, 200, workflow.saveTemplate(await readBody(request, 65_536)));
      if (path === '/api/instances' && request.method === 'POST') {
        const result = workflow.activateInstance(await readBody(request));
        return json(response, result.replayed ? 200 : 201, result);
      }
      if (path === '/api/requests' && request.method === 'POST') {
        const result = workflow.createRequest(await readBody(request));
        return json(response, result.duplicate || result.replayed ? 200 : 201, result);
      }
      const action = path.match(/^\/api\/requests\/([A-Za-z0-9-]+)\/(approve|reject|dispatch|acknowledge)$/);
      if (action && request.method === 'POST') {
        const body = await readBody(request);
        if (pleos.isBusy() && ['dispatch', 'acknowledge', 'reject'].includes(action[2])) throw new WorkflowError(409, 'SDK_JOB_ACTIVE', 'SDK 검증 작업을 먼저 확인해주세요. 모의 전송과 SDK 전송은 동시에 처리하지 않습니다.');
        return json(response, 200, workflow.transition(action[1], action[2], body));
      }
      if (path.startsWith('/api/')) throw new WorkflowError(404, 'NOT_FOUND', 'API를 찾을 수 없습니다.');
      if (!['GET', 'HEAD'].includes(request.method)) throw new WorkflowError(405, 'METHOD_NOT_ALLOWED', '지원하지 않는 HTTP 메서드입니다.');
      let decoded;
      try { decoded = decodeURIComponent(path); } catch { throw new WorkflowError(400, 'INVALID_PATH', '잘못된 경로입니다.'); }
      const target = resolve(staticRoot, '.' + (decoded === '/' ? '/index.html' : decoded));
      if (!target.startsWith(staticRoot + sep)) throw new WorkflowError(403, 'FORBIDDEN', '접근할 수 없습니다.');
      const info = await stat(target).catch(() => null);
      if (!info?.isFile()) throw new WorkflowError(404, 'NOT_FOUND', '파일을 찾을 수 없습니다.');
      response.writeHead(200, { 'Content-Type': TYPES[extname(target)] || 'application/octet-stream', 'Content-Length': info.size, 'Cache-Control': 'no-cache' });
      response.end(request.method === 'HEAD' ? undefined : await readFile(target));
    } catch (error) {
      if (response.headersSent) { response.destroy(); return; }
      const known = error instanceof WorkflowError;
      if (!known) console.error(error);
      json(response, known ? error.status : 500, { error: { code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : '처리 중 오류가 발생했습니다. 저장 상태를 확인한 후 다시 시도해주세요.', ...(known && error.details ? { details: error.details } : {}) } });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.workflow = workflow;
  server.communication = communication;
  server.pleos = pleos;
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 3000);
  const server = createServer();
  server.listen(port, host, () => console.log(`MOBFLOW experimental protocol harness running at http://${host}:${server.address().port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}

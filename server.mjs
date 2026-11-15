import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkflow, WorkflowError } from './workflow.mjs';
import { createCommunication } from './communication.mjs';
import { createPlatform } from './platform.mjs';
import { createFleet } from './fleet.mjs';
import { createUnified } from './unified.mjs';
import { createNativeVehicle } from './native-vehicle.mjs';

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

export function createServer({ dataDir = process.env.MOBFLOW_DATA_DIR || resolve(ROOT, 'data'), publicDir = resolve(ROOT, 'public'), clock, nativeEmulator = process.env.PLEOSFLOWS_NATIVE_EMULATOR === '1' } = {}) {
  const workflow = createWorkflow({ dataDir });
  const communication = createCommunication({ dataDir, ...(clock ? { clock } : {}) });
  const platform = createPlatform({ dataDir, ...(clock ? { clock } : {}) });
  const fleet = createFleet({ dataDir, ...(clock ? { clock } : {}) });
  const unified = createUnified({ dataDir, fleet, ...(clock ? { clock } : {}) });
  const nativeVehicle = createNativeVehicle({ unified, ...(clock ? { clock } : {}) });
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
      if (path.startsWith('/api/native/')) {
        if (!nativeEmulator) throw new WorkflowError(404, 'NATIVE_DISABLED', '네이티브 에뮬레이터 경로가 꺼져 있습니다.');
        const local = ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(request.socket.remoteAddress);
        const localHost = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(request.headers.host || '');
        if (!local || !localHost) throw new WorkflowError(403, 'LOCAL_EMULATOR_ONLY', 'loopback 에뮬레이터 연결만 허용합니다.');
        if (path === '/api/native/assignment' && request.method === 'GET') {
          if ([...url.searchParams.keys()].some(k=>!['vehicleId','runId'].includes(k)) || ['vehicleId','runId'].some(k=>url.searchParams.getAll(k).length>1)) throw new WorkflowError(422,'INVALID_INPUT','배정 조회 조건이 올바르지 않습니다.');
          return json(response,200,nativeVehicle.assignment({vehicleId:url.searchParams.get('vehicleId')||'vehicle-101',runId:url.searchParams.get('runId')||undefined}));
        }
        if (path === '/api/native/studio-link' && request.method === 'GET') {
          const linked=unified.getState().runs.find(r=>r.studioOrigin?.platformRunId===url.searchParams.get('platformRunId'));
          return json(response,200,linked?nativeVehicle.assignment({vehicleId:linked.vehicleId,runId:linked.id}):{assignment:null});
        }
        if (request.method === 'POST') {
          const body=await readBody(request);
          if(path === '/api/native/studio-dispatch') {
            if(!body||Object.keys(body).some(k=>!['platformRunId','expectedVersion'].includes(k)))throw new WorkflowError(422,'INVALID_INPUT','Studio 실행 ID와 검토 버전만 허용합니다.');
            const source=platform.getState().runs.find(r=>r.id===body.platformRunId);
            if(!source)throw new WorkflowError(404,'RUN_NOT_FOUND','Studio 실행을 찾을 수 없습니다.');
            if(source.version!==body.expectedVersion)throw new WorkflowError(409,'STALE_VERSION','검토한 실행 버전이 다릅니다.');
            if(source.status!=='completed'||!source.reviewedMessage)throw new WorkflowError(409,'APPROVAL_REQUIRED','Studio에서 문안을 승인하고 로컬 실행을 완료하세요.');
            const all=unified.getState().runs;
            const existing=all.find(r=>r.studioOrigin?.platformRunId===source.id);
            if(existing)return json(response,200,nativeVehicle.assignment({vehicleId:existing.vehicleId,runId:existing.id}));
            if(all.some(r=>r.vehicleId==='vehicle-101'&&!r.expired&&!r.revoked&&!['completed','revoked'].includes(r.state)))throw new WorkflowError(409,'VEHICLE_BUSY','차량 앱에서 기존 업무를 완료한 뒤 새 업무를 배정하세요.');
            const key='studio-'+source.id;
            const {workflow}=unified.save({name:(source.snapshot.definition.trigger.connector==='calendar'?'Calendar':'Messenger')+' → Agent 승인 → PLEOS 업무',template:'delivery',vehicleId:'vehicle-101',thresholdMinutes:3,fields:[],notifications:{departure:false,approaching:false,completion:false},idempotencyKey:key+'-workflow'});
            const origin={platformRunId:source.id,platformVersion:source.version,connector:source.snapshot.definition.trigger.connector,reviewedMessage:source.reviewedMessage,externalInput:'simulated',agent:'deterministic-mock',externalMessages:false};
            const {run:linked}=unified.dispatch({workflowId:workflow.id,idempotencyKey:key+'-dispatch'},origin);
            return json(response,200,nativeVehicle.assignment({vehicleId:linked.vehicleId,runId:linked.id}));
          }
          if(path === '/api/native/fixture') return json(response,200,nativeVehicle.fixture(body));
          if(path === '/api/native/state') return json(response,200,nativeVehicle.observe(body));
          const nativeCommand=path.match(/^\/api\/native\/runs\/([A-Za-z0-9-]+)\/commands$/);
          if(nativeCommand) return json(response,200,nativeVehicle.command(nativeCommand[1],body));
        }
        throw new WorkflowError(404,'NOT_FOUND','차량 앱 API를 찾을 수 없습니다.');
      }
      if (path === '/api/health' && request.method === 'GET') return json(response, 200, { ok: true, mode: 'demo', vehicleConnected: false });
      if (path === '/api/unified' && request.method === 'GET') return json(response, 200, unified.getState());
      const unifiedCustomer = path.match(/^\/api\/unified\/customer\/([A-Za-z0-9_-]+)$/);
      if (unifiedCustomer && request.method === 'GET') {
        if(url.searchParams.getAll('customerId').length!==1 || [...url.searchParams.keys()].some(k=>k!=='customerId')) throw new WorkflowError(404,'CUSTOMER_LINK_NOT_FOUND','고객 안내 링크를 확인할 수 없습니다.');
        return json(response,200,unified.customer(unifiedCustomer[1],url.searchParams.get('customerId')));
      }
      if(path.startsWith('/api/unified/') && request.method === 'POST') {
        const body=await readBody(request,32768);
        if(path==='/api/unified/workflows')return json(response,200,unified.save(body));
        if(path==='/api/unified/dispatch')return json(response,200,unified.dispatch(body));
        const m=path.match(/^\/api\/unified\/runs\/([A-Za-z0-9-]+)\/(accept|complete|revoke|retry|events)$/);
        if(m)return json(response,200,m[2]==='events'?unified.event(m[1],body):unified.manual(m[1],m[2],body));
      }
      if (path === '/api/fleet' && request.method === 'GET') return json(response, 200, fleet.getState(url.searchParams.get('actorId')));
      if (path.startsWith('/api/fleet/') && request.method === 'POST') {
        const body = await readBody(request, 32_768);
        const operation = { '/api/fleet/inspect':'inspect', '/api/fleet/policy':'changePolicy', '/api/fleet/vehicles':'register', '/api/fleet/configure':'configure', '/api/fleet/bindings':'bind', '/api/fleet/runs':'run' }[path];
        if (operation) return json(response, 200, fleet[operation](body));
        const match = path.match(/^\/api\/fleet\/runs\/([A-Za-z0-9-]+)\/(approve|revoke|execute|retry)$/);
        if (match) return json(response, 200, fleet.transition(match[1], match[2], body));
      }
      if (path === '/api/platform' && request.method === 'GET') return json(response, 200, platform.getState());
      if (path.startsWith('/api/platform/') && request.method === 'POST') {
        const body = await readBody(request, 32_768);
        const operation = { '/api/platform/validate':'validate', '/api/platform/propose':'propose', '/api/platform/drafts':'save', '/api/platform/activate':'activate', '/api/platform/runs':'run' }[path];
        if (operation) return json(response, 200, platform[operation](body));
        const match = path.match(/^\/api\/platform\/runs\/([A-Za-z0-9-]+)\/(approve|reject|retry)$/);
        if (match) return json(response, 200, platform.transition(match[1], match[2], body));
      }
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
      const communicationAction = path.match(/^\/api\/communication\/runs\/([A-Za-z0-9-]+)\/(depart|advance|complete|stop|stale|vehicle-motion|vehicle-ux|vehicle-depart|vehicle-approach|vehicle-arrive|vehicle-complete)$/);
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
      if (action && request.method === 'POST') return json(response, 200, workflow.transition(action[1], action[2], await readBody(request)));
      if (path.startsWith('/api/')) throw new WorkflowError(404, 'NOT_FOUND', 'API를 찾을 수 없습니다.');
      if (!['GET', 'HEAD'].includes(request.method)) throw new WorkflowError(405, 'METHOD_NOT_ALLOWED', '지원하지 않는 HTTP 메서드입니다.');
      let decoded;
      try { decoded = decodeURIComponent(path); } catch { throw new WorkflowError(400, 'INVALID_PATH', '잘못된 경로입니다.'); }
      const entry = decoded === '/' ? ((await stat(resolve(staticRoot,'unified.html')).catch(()=>null)) ? '/unified.html' : '/index.html') : decoded;
      const target = resolve(staticRoot, '.' + entry);
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
  server.nativeVehicle = nativeVehicle;
  server.unified = unified;
  server.workflow = workflow;
  server.communication = communication;
  server.platform = platform;
  server.fleet = fleet;
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 3000);
  if(process.env.PLEOSFLOWS_NATIVE_EMULATOR==='1'&&!['127.0.0.1','::1','localhost'].includes(host)) throw new Error('Native emulator mode requires a loopback HOST; public exposure is not supported.');
  const server = createServer();
  server.listen(port, host, () => console.log(`PleosFlows demo running at http://${host}:${server.address().port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}

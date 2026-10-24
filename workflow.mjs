import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, openSync, fsyncSync, closeSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { simulateDispatch, MAX_WAYPOINTS } from './pleos-adapter.mjs';
import { defaultTemplates, applyTemplateEdit, validateInstanceConfig, deriveRunTrace, TemplateError } from './templates.mjs';
import { normalizeDemoInbound, buildMockNotificationPayload, DemoConnectorError, DEMO_CONNECTORS } from './connectors.mjs';

export const DEMO_CHILD = Object.freeze({ id: 'demo-child-1', name: '김하늘 (가상)', school: '새봄학교 (가상)', guardian: '김보호 (가상)' });
export const DESTINATIONS = Object.freeze(['새봄학교 정문', '한빛도서관', '푸른공원']);
export const SAMPLE_MESSAGE = '오늘 하늘이 픽업을 한빛도서관으로 변경해주세요. 16:30에 도착할게요.';
const clone = (value) => structuredClone(value);
const now = () => new Date().toISOString();
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export class WorkflowError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message); this.status = status; this.code = code; this.details = details;
  }
}

/** Conservative, deterministic demonstration parser; not an LLM or Korean NLU service. */
export function parseDemoMessage(message) {
  const destinations = DESTINATIONS.filter((destination) => new RegExp(`(?<![가-힣A-Za-z0-9])${destination}(?=$|[\\s.,!?]|(?:으로|로|에서|에|을|를)(?:[\\s.,!?]|$))`).test(message));
  const times = [...message.matchAll(/(?<!\d)(\d{1,2}):(\d{2})(?!\d)/g)];
  const uniqueTimes = [...new Set(times.map((m) => `${m[1].padStart(2, '0')}:${m[2]}`))];
  const validTime = uniqueTimes.length === 1 && Number(uniqueTimes[0].slice(0, 2)) < 24 && Number(uniqueTimes[0].slice(3)) < 60;
  const uncertainties = [];
  if (destinations.length !== 1) uncertainties.push(destinations.length ? '목적지가 여러 개입니다. 한 곳만 지정해주세요.' : '등록된 픽업 장소를 확인할 수 없습니다.');
  if (!validTime) uncertainties.push('시간을 하나의 유효한 HH:MM 형식으로 지정해주세요.');
  if (/(?:오전|오후)\s*\d|\d{1,2}\s*시|\d{1,2}:\d{2}:|\d{1,2}:\d{2}\s*[-~–]/.test(message)) uncertainties.push('추가 시간 표현이나 시간 범위는 처리하지 않습니다. HH:MM 시간 하나만 적어주세요.');
  if (/(아마|쯤|정도|또는|혹은|아니면|가능할까|가능하면|미정|나중에|변경하지|취소|아닌|말고|대신|근처|옆|맞은편|부근|인근)/.test(message)) uncertainties.push('조건·선택·부정 표현이 있어 운영자 확인이 필요합니다.');
  if (!/픽업/.test(message) || !/(변경|바꿔|바꾸)/.test(message)) uncertainties.push('이 규칙 기반 데모는 픽업과 변경·바꿔·바꾸 표현이 모두 있는 명시적인 변경 요청만 처리합니다.');
  if (/(안\s*바꿔|안\s*바꾸|바꾸지|바꿔야\s*하지|변경\s*안|변경할\s*필요\s*없|필요\s*없어|필요\s*없)/.test(message)) uncertainties.push('픽업 변경을 부정하는 표현이 있어 자동 승인할 수 없습니다.');
  if (/내일|모레|다음\s*(주|달)|\d{1,2}\s*월|\d{1,2}\s*일/.test(message)) uncertainties.push('이 데모는 오늘의 픽업 변경만 처리합니다.');
  return {
    destination: destinations.length === 1 ? destinations[0] : null,
    time: validTime ? uniqueTimes[0] : null,
    date: 'today',
    parser: 'deterministic-demo',
    confidence: uncertainties.length ? 'needs-review' : 'demo-exact-match',
    uncertainties,
    summary: uncertainties.length ? '자동 확정 불가 · 명확한 새 요청이 필요합니다.' : `오늘 ${uniqueTimes[0]} · ${destinations[0]} 픽업 변경`,
  };
}

function initialState() {
  return {
    schemaVersion: 2,
    templates: defaultTemplates(),
    instances: [],
    requests: [],
    notifications: [],
    idempotency: {},
    route: {
      id: 'demo-route-1', name: '새봄 하교 노선 (가상)', version: 1, status: 'scheduled',
      vehicle: 'DEMO SHUTTLE', activeRequestId: null,
      stops: [
        { id: 'stop-child-1', label: '새봄학교 정문', destination: '새봄학교 정문', time: '16:00', type: 'pickup', childId: DEMO_CHILD.id },
        { id: 'stop-checkpoint', label: '가상 안전 확인 지점', time: '16:40', type: 'checkpoint' },
        { id: 'stop-end', label: '데모 차고지', time: '17:00', type: 'finish' },
      ],
      pendingItinerary: null,
      adapter: { mode: 'simulation', maxWaypoints: MAX_WAYPOINTS, lastDispatch: null },
      boardingStatus: 'not_confirmed', handoverStatus: 'not_confirmed',
    },
  };
}

function policyChecks(childId, interpretation, config = { allowedDestinations: DESTINATIONS, windowStart: '15:00', windowEnd: '16:30' }) {
  const minutes = interpretation.time ? Number(interpretation.time.slice(0, 2)) * 60 + Number(interpretation.time.slice(3)) : NaN;
  return [
    { label: '가상 아동 확인', passed: childId === DEMO_CHILD.id, detail: '등록된 데모 아동 demo-child-1만 처리합니다. 실제 보호자 인증은 구현되지 않았습니다.' },
    { label: '허용 픽업 장소', passed: DESTINATIONS.includes(interpretation.destination) && config.allowedDestinations.includes(interpretation.destination), detail: `활성화한 규칙의 허용 목록: ${config.allowedDestinations.join(', ')}` },
    { label: '운행 시간 범위', passed: Number.isFinite(minutes) && minutes >= 15 * 60 && minutes <= 16 * 60 + 30 && interpretation.time >= config.windowStart && interpretation.time <= config.windowEnd, detail: `활성화한 픽업 시간은 ${config.windowStart}–${config.windowEnd}입니다. 안전 기준 15:00–16:30을 넘길 수 없습니다.` },
    { label: '모호성 없음', passed: interpretation.uncertainties.length === 0, detail: interpretation.uncertainties.join(' ') || '등록 목적지 1개와 명확한 HH:MM 시간 1개를 확인했습니다.' },
    { label: '운영자 승인 필요', passed: true, detail: '요청 접수만으로 차량에 전송하거나 경로를 변경하지 않습니다.' },
  ];
}

export function createWorkflow({ dataDir = process.env.MOBFLOW_DATA_DIR || './data' } = {}) {
  const directory = resolve(dataDir);
  mkdirSync(directory, { recursive: true });
  const filename = join(directory, 'store.json');
  let state;
  if (existsSync(filename)) {
    try { state = JSON.parse(readFileSync(filename, 'utf8')); }
    catch { throw new Error(`저장소를 읽을 수 없습니다. 원본을 보존하고 복구해주세요: ${filename}`); }
    if (![1, 2].includes(state.schemaVersion) || !Array.isArray(state.requests) || !Array.isArray(state.notifications) || !state.route || !state.idempotency) throw new Error('Unsupported or invalid store schema; existing data was not overwritten.');
    if (state.schemaVersion === 1) { state.schemaVersion = 2; state.templates = defaultTemplates(); state.instances = []; persist(state); }
    if (!Array.isArray(state.templates) || !Array.isArray(state.instances)) throw new Error('Invalid template/instance store schema; existing data was not overwritten.');
  } else {
    state = initialState();
    persist(state);
  }

  function persist(next) {
    const temporary = `${filename}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
    const file = openSync(temporary, 'r');
    try { fsyncSync(file); } finally { closeSync(file); }
    renameSync(temporary, filename);
    const folder = openSync(directory, 'r');
    try { fsyncSync(folder); } finally { closeSync(folder); }
  }

  function transact(mutator) {
    const next = clone(state);
    const result = mutator(next);
    persist(next);
    state = next;
    return clone(result);
  }

  function translateTemplateError(callback) {
    try { return callback(); } catch (error) { if (error instanceof TemplateError) throw new WorkflowError(error.status, error.code, error.message); throw error; }
  }

  function event(request, type, detail) {
    request.events.push({ id: randomUUID(), type, at: now(), version: request.version, actor: 'demo-operator', detail });
    request.trace = deriveRunTrace(request);
  }

  function notify(next, request, type, title, body) {
    const payloadPreview = buildMockNotificationPayload({ connector: request.templateSnapshot?.nodes.find((node) => node.id === 'notify')?.connector || request.source?.connector || 'demo-web', requestId: request.id, status: type, version: request.version, title, body, connectionLabel: request.configSnapshot?.connectionLabel });
    next.notifications.unshift({ payloadPreview, id: randomUUID(), requestId: request.id, type, title, body, createdAt: now(), channel: 'in-app-demo', deliveryStatus: 'simulated', recipient: DEMO_CHILD.guardian });
  }

  function validateKey(key) {
    if (key !== undefined && (typeof key !== 'string' || !/^[A-Za-z0-9:_-]{1,120}$/.test(key))) throw new WorkflowError(400, 'INVALID_IDEMPOTENCY_KEY', 'idempotencyKey는 영문·숫자·콜론·밑줄·하이픈 1–120자여야 합니다.');
  }

  function withIdempotency(next, key, scope, payload, action) {
    validateKey(key);
    const fingerprint = hash({ scope, payload });
    if (key && Object.hasOwn(next.idempotency, key)) {
      const saved = next.idempotency[key];
      if (saved.fingerprint !== fingerprint) throw new WorkflowError(409, 'IDEMPOTENCY_CONFLICT', '같은 재시도 키를 다른 요청에 사용할 수 없습니다.');
      return { ...saved.result, replayed: true };
    }
    const result = action();
    if (key) Object.defineProperty(next.idempotency, key, { value: { fingerprint, result: clone(result) }, enumerable: true, configurable: true, writable: true });
    return result;
  }

  return {
    filename,
    getState() {
      return clone({ templates: state.templates, instances: state.instances, requests: state.requests.map((request) => ({ ...request, trace: deriveRunTrace(request) })), notifications: state.notifications, route: state.route, child: DEMO_CHILD, destinations: DESTINATIONS, sampleMessage: SAMPLE_MESSAGE, connectors: DEMO_CONNECTORS, mode: 'demo', limitations: ['모든 인물과 장소는 가상 예시입니다.', '결정 규칙 기반 파서이며 실제 LLM이 아닙니다.', 'Pleos SDK·차량·문자 발송 서비스와 연결되지 않았습니다.', '문 열림 신호로 탑승·인계를 판단하지 않습니다.', '로컬 데모이며 실제 인증·권한·다중 서버 동기화가 없습니다.'] });
    },
    saveTemplate(input) {
      return transact((next) => {
        const index = next.templates.findIndex((template) => template.id === 'pickup-change');
        const template = translateTemplateError(() => applyTemplateEdit(next.templates[index], input));
        next.templates[index] = template;
        return { template };
      });
    },
    activateInstance(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new WorkflowError(400, 'INVALID_BODY', '활성화 설정 JSON 객체가 필요합니다.');
      const { idempotencyKey, ...payload } = input;
      return transact((next) => withIdempotency(next, idempotencyKey, 'activate-instance', payload, () => {
        const template = next.templates.find((entry) => entry.id === input.templateId);
        const config = translateTemplateError(() => validateInstanceConfig(input, template, DEMO_CONNECTORS));
        const instance = { id: randomUUID(), name: config.name, templateId: template.id, templateVersion: template.version, templateSnapshot: clone(template), config, sourceConnector: config.sourceConnector, active: true, status: 'active', createdAt: now(), mode: 'mock' };
        next.instances.unshift(instance);
        return { instance, replayed: false };
      }));
    },
    createRequest(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new WorkflowError(400, 'INVALID_BODY', 'JSON 객체가 필요합니다.');
      if (Object.keys(input).some((key) => !['message', 'childId', 'idempotencyKey', 'sourceConnector', 'externalMessageId', 'instanceId'].includes(key))) throw new WorkflowError(400, 'LIVE_CONNECTOR_INPUT_REJECTED', '허용된 로컬 데모 필드만 입력해주세요. 실제 계정·토큰·웹훅·수신자 정보는 받지 않습니다.');
      const { childId = DEMO_CHILD.id, idempotencyKey, externalMessageId = null, instanceId } = input;
      if (typeof input.message !== 'string' || !input.message.trim() || input.message.length > 2000) throw new WorkflowError(400, 'INVALID_MESSAGE', '요청 메시지는 1–2000자로 입력해주세요.');
      if (childId !== DEMO_CHILD.id) throw new WorkflowError(400, 'UNKNOWN_CHILD', '등록된 가상 아동만 요청할 수 있습니다.');
      if (typeof instanceId !== 'string' || !instanceId) throw new WorkflowError(400, 'INSTANCE_REQUIRED', '카탈로그에서 워크플로를 설정·활성화한 뒤 실행해주세요.');
      const instance = state.instances.find((entry) => entry.id === instanceId);
      if (!instance?.active) throw new WorkflowError(422, 'INSTANCE_INACTIVE', '활성화된 워크플로를 선택해주세요.');
      const sourceConnector = input.sourceConnector ?? instance.config.sourceConnector;
      if (sourceConnector !== instance.config.sourceConnector) throw new WorkflowError(400, 'CONNECTOR_MISMATCH', '활성화한 워크플로의 연결과 입력 출처가 다릅니다.');
      let inbound;
      try { inbound = normalizeDemoInbound({ connector: sourceConnector, message: input.message, externalMessageId }); }
      catch (error) { if (error instanceof DemoConnectorError) throw new WorkflowError(400, error.code, error.message); throw error; }
      const { message, source } = inbound;
      source.connectionLabel = instance.config.connectionLabel;
      return transact((next) => withIdempotency(next, idempotencyKey, 'create', { message, childId, source, instanceId }, () => {
        const interpretation = parseDemoMessage(message);
        const duplicate = next.requests.find((r) => r.childId === childId && r.instanceId === instanceId && ['pending', 'approved', 'dispatched'].includes(r.status) && (r.message === message || (interpretation.confidence === 'demo-exact-match' && r.interpretation.confidence === 'demo-exact-match' && r.interpretation.destination === interpretation.destination && r.interpretation.time === interpretation.time)));
        if (duplicate) return { request: duplicate, duplicate: true, replayed: false };
        const request = { id: randomUUID(), instanceId, templateId: instance.templateId, templateVersion: instance.templateVersion, templateSnapshot: clone(instance.templateSnapshot), configSnapshot: clone(instance.config), message, childId, source, status: 'pending', version: 1, createdAt: now(), updatedAt: now(), interpretation, policyChecks: policyChecks(childId, interpretation, instance.config), events: [], routeVersion: next.route.version };
        const currentStop = next.route.stops.find((stop) => stop.childId === childId);
        request.routeImpact = {
          label: '데모 노선 변경 미리보기', mode: 'demo-static', measured: false,
          previous: { destination: currentStop.label, time: currentStop.time },
          proposed: { destination: interpretation.destination, time: interpretation.time },
          totalStops: next.route.stops.length, retainedStops: next.route.stops.length - 1,
          maxNavigationWaypoints: MAX_WAYPOINTS,
          distanceEstimate: null, travelTimeEstimate: null,
          summary: '아동 픽업 지점 1곳만 변경하며 나머지 지점은 유지합니다. 거리·소요 시간은 측정하거나 추정하지 않습니다.',
        };
        event(request, 'created', '요청 접수 · 데모 파싱과 정책 검사를 완료했습니다.');
        next.requests.unshift(request);
        notify(next, request, 'pending', '픽업 변경 요청 접수', '운영자 승인을 기다리고 있습니다. 아직 경로는 변경되지 않았습니다.');
        return { request, duplicate: false, replayed: false };
      }));
    },
    transition(id, action, input = {}) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new WorkflowError(400, 'INVALID_BODY', 'JSON 객체가 필요합니다.');
      const { expectedVersion, idempotencyKey, reason, outcome } = input;
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new WorkflowError(400, 'EXPECTED_VERSION_REQUIRED', '현재 요청의 expectedVersion이 필요합니다.');
      if (reason !== undefined && (typeof reason !== 'string' || reason.length > 1000)) throw new WorkflowError(400, 'INVALID_REASON', '사유는 1000자 이하의 문자열이어야 합니다.');
      return transact((next) => withIdempotency(next, idempotencyKey, `${id}:${action}`, { expectedVersion, reason, outcome }, () => {
        const request = next.requests.find((entry) => entry.id === id);
        if (!request) throw new WorkflowError(404, 'REQUEST_NOT_FOUND', '요청을 찾을 수 없습니다.');
        if (request.version !== expectedVersion) throw new WorkflowError(409, 'STALE_VERSION', '요청이 이미 변경되었습니다. 최신 상태를 확인해주세요.', { currentVersion: request.version, request });
        const permitted = { approve: ['pending'], reject: ['pending', 'approved'], dispatch: ['approved'], acknowledge: ['dispatched'] };
        if (!permitted[action]) throw new WorkflowError(404, 'UNKNOWN_ACTION', '지원하지 않는 작업입니다.');
        if (!permitted[action].includes(request.status)) throw new WorkflowError(409, 'INVALID_TRANSITION', `현재 ${request.status} 상태에서는 ${action} 작업을 할 수 없습니다.`);
        if (action === 'approve' || action === 'dispatch') {
          if (request.policyChecks.some((check) => !check.passed)) throw new WorkflowError(422, 'POLICY_BLOCKED', '정책 검사를 통과하지 못했습니다. 명확한 새 요청을 제출해주세요.', { policyChecks: request.policyChecks });
          if (request.routeVersion !== next.route.version) throw new WorkflowError(409, 'STALE_ROUTE', '다른 요청으로 노선이 변경되었습니다. 최신 노선을 확인하고 새 요청을 제출해주세요.');
        }
        if (action === 'reject' && !reason?.trim()) throw new WorkflowError(400, 'REASON_REQUIRED', '거절 사유를 입력해주세요.');
        if (action === 'acknowledge' && !['executed', 'failed'].includes(outcome)) throw new WorkflowError(400, 'OUTCOME_REQUIRED', '실행 결과 outcome은 executed 또는 failed여야 합니다.');
        if (action === 'acknowledge' && outcome === 'failed' && !reason?.trim()) throw new WorkflowError(400, 'REASON_REQUIRED', '실행 실패 사유를 입력해주세요.');
        if (action === 'dispatch' && next.route.activeRequestId) throw new WorkflowError(409, 'ROUTE_BUSY', '다른 요청의 실행 결과 확인이 먼저 필요합니다.');
        request.version += 1;
        request.updatedAt = now();
        if (action === 'approve') {
          request.status = 'approved';
          request.approvedAt = now();
          event(request, 'approved', reason?.trim() || '운영자가 해석과 정책 검사를 확인하고 승인했습니다.');
          notify(next, request, 'approved', '픽업 변경 승인', `${request.interpretation.destination} · ${request.interpretation.time}. 차량 전송 전입니다.`);
        } else if (action === 'reject') {
          request.status = 'rejected'; request.reason = reason.trim();
          event(request, 'rejected', request.reason);
          notify(next, request, 'rejected', '픽업 변경 요청 거절', request.reason);
        } else if (action === 'dispatch') {
          const itinerary = clone(next.route.stops).map((stop) => stop.childId === request.childId ? { ...stop, label: request.interpretation.destination, destination: request.interpretation.destination, time: request.interpretation.time } : stop);
          const receipt = simulateDispatch({ requestId: request.id, itinerary });
          request.status = 'dispatched'; request.dispatch = receipt; request.dispatchedAt = now();
          next.route.activeRequestId = request.id; next.route.pendingItinerary = itinerary; next.route.status = 'awaiting_execution'; next.route.adapter.lastDispatch = receipt;
          event(request, 'dispatched', `시뮬레이터에 ${receipt.waypoints.length}개 경유지를 전송했습니다. 전체 ${itinerary.length}개 지점은 서버에 보관합니다. 실행은 미확인입니다.`);
          notify(next, request, 'dispatched', '데모 전송 접수', '실제 차량 연결이 아닌 시뮬레이션입니다. 실행 결과 확인을 기다립니다.');
        } else {
          if (next.route.activeRequestId !== request.id || !next.route.pendingItinerary) throw new WorkflowError(409, 'DISPATCH_MISMATCH', '현재 전송 건과 일치하지 않습니다.');
          request.status = outcome; request.execution = { outcome, at: now(), source: 'explicit-demo-acknowledgement', reason: reason?.trim() || null, vehicleVerified: false, boardingConfirmed: false, handoverConfirmed: false };
          if (outcome === 'executed') {
            next.route.stops = next.route.pendingItinerary; next.route.version += 1; next.route.status = 'simulated_execution_confirmed';
          } else { next.route.status = 'execution_failed'; request.reason = reason.trim(); }
          next.route.pendingItinerary = null; next.route.activeRequestId = null;
          event(request, outcome, outcome === 'executed' ? '운영자가 데모 경로 실행 결과를 명시적으로 확인했습니다. 아동 탑승·인계는 확인되지 않았습니다.' : `데모 실행 실패: ${reason.trim()}`);
          notify(next, request, outcome, outcome === 'executed' ? '데모 경로 실행 확인' : '데모 경로 실행 실패', outcome === 'executed' ? '시뮬레이션 경로 실행 결과만 확인했습니다. 아동 탑승·보호자 인계 확인과는 별개입니다.' : reason.trim());
        }
        return { request, replayed: false, route: next.route };
      }));
    },
  };
}

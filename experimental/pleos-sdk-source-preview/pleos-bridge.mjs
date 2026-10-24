import { randomUUID } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { WorkflowError } from '../../workflow.mjs';

const TERMINAL = new Set(['readback-matched', 'failed', 'uncertain', 'cancelled', 'expired']);
const TYPES = new Set(['sdk-requested', 'route-started', 'routing-completed', 'destination', 'waypoints', 'location', 'error', 'uncertain']);
const MAX_AGE = 120_000;
const clone = value => structuredClone(value);
const fail = (status, code, message) => { throw new WorkflowError(status, code, message); };
const samePoint = (a, b) => a && b && Math.abs(a.latitude - b.latitude) < 0.00001 && Math.abs(a.longitude - b.longitude) < 0.00001;

// Public-landmark test coordinates, not the real location of any fictional school or child.
export const FIXTURE_POINTS = Object.freeze({
  '새봄학교 정문': { latitude: 37.5665, longitude: 126.9780, poiName: 'MOBFLOW TEST A', poiId: '', poiSubId: '', address: '' },
  '한빛도서관': { latitude: 37.5700, longitude: 126.9820, poiName: 'MOBFLOW TEST B', poiId: '', poiSubId: '', address: '' },
  '푸른공원': { latitude: 37.5730, longitude: 126.9760, poiName: 'MOBFLOW TEST C', poiId: '', poiSubId: '', address: '' },
  checkpoint: { latitude: 37.5720, longitude: 126.9800, poiName: 'MOBFLOW TEST CHECKPOINT', poiId: '', poiSubId: '', address: '' },
  destination: { latitude: 37.5750, longitude: 126.9820, poiName: 'MOBFLOW TEST END', poiId: '', poiSubId: '', address: '' },
});
export function validateRoute(route) {
  if (!route || !Array.isArray(route.waypoints) || route.waypoints.length > 2) fail(400, 'WAYPOINT_LIMIT', '경유지는 최대 2개입니다. 자동 잘라내기는 허용하지 않습니다.');
  for (const point of [route.destination, ...route.waypoints]) {
    if (!point || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude) || Math.abs(point.latitude) > 90 || Math.abs(point.longitude) > 180) fail(400, 'INVALID_COORDINATES', '위도와 경도를 확인해주세요.');
  }
  return route;
}
function object(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !allowed.includes(k))) fail(400, 'INVALID_BRIDGE_INPUT', '허용된 브리지 JSON 필드만 사용해주세요.');
}
function point(input) {
  object(input, ['latitude', 'longitude']);
  validateRoute({ destination: input, waypoints: [] });
  return clone(input);
}
export function createPleosBridge({ dataDir, workflow, enabled = false, clock = () => Date.now() }) {
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, 'pleos-jobs.json');
  let state = { schemaVersion: 1, jobs: [] };
  if (existsSync(file)) {
    state = JSON.parse(readFileSync(file, 'utf8'));
    if (state.schemaVersion !== 1 || !Array.isArray(state.jobs) || state.jobs.some(j => !j.id || !Number.isFinite(j.expiresAt) || !Array.isArray(j.events))) throw new Error('Invalid Pleos bridge store; refused to overwrite.');
    // A route call may have reached NaviService before the process stopped. Never redispatch it.
    for (const job of state.jobs) if (['claimed', 'request-sent', 'searching', 'awaiting-readback'].includes(job.status)) {
      job.status = 'uncertain'; job.message = '서버 재시작: 이전 호출 결과를 확인할 수 없어 재전송하지 않습니다.';
    }
    persist(state);
  }
  function persist(next) {
    const temp = `${file}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify(next, null, 2), { mode: 0o600 });
    const fd = openSync(temp, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temp, file);
    const dir = openSync(dataDir, 'r'); try { fsyncSync(dir); } finally { closeSync(dir); }
  }
  function update(fn) { const next = clone(state); const result = fn(next); persist(next); state = next; return clone(result); }
  function requireEnabled() { if (!enabled) fail(409, 'BRIDGE_DISABLED', 'Pleos 브리지는 기본 꺼짐입니다. 로컬 에뮬레이터 검증 모드에서만 켜주세요.'); }
  function sweep() {
    if (!state.jobs.some(j => !TERMINAL.has(j.status) && clock() >= j.expiresAt)) return;
    update(next => { for (const j of next.jobs) if (!TERMINAL.has(j.status) && clock() >= j.expiresAt) {
      j.status = j.status === 'queued' ? 'expired' : 'uncertain'; j.message = '제한 시간 초과. 자동 재전송 또는 경로 확정 없음.';
    } });
  }
  function find(next, id) { const job = next.jobs.find(j => j.id === id); if (!job) fail(404, 'JOB_NOT_FOUND', 'SDK 작업을 찾을 수 없습니다.'); return job; }
  function approval(id, version) {
    const s = workflow.getState(); const request = s.requests.find(r => r.id === id);
    if (!request || request.status !== 'approved') fail(409, 'APPROVAL_REQUIRED', '운영자 승인 상태의 픽업 요청만 SDK 검증 대상으로 보낼 수 있습니다.');
    if (request.version !== version || request.routeVersion !== s.route.version) fail(409, 'STALE_APPROVAL', '승인 또는 노선 버전이 변경되었습니다.');
    if (request.policyChecks.some(check => !check.passed) || s.route.activeRequestId) fail(409, 'ROUTE_BUSY_OR_BLOCKED', '정책 또는 기존 전송 상태를 확인해주세요.');
    if (s.route.stops.length !== 3) fail(422, 'UNSUPPORTED_ITINERARY', '이 테스트 어댑터는 고정 3지점만 지원합니다. 지점을 조용히 생략하지 않습니다.');
    return request;
  }
  function publicJob(job) { return clone({ ...job, attemptId: undefined }); }
  return {
    getState() { sweep(); return { enabled, mode: 'pleos-emulator-development', sdk: 'NaviHelper 3.0.5', runtimeVerified: false, vehicleVerified: false, jobs: state.jobs.map(publicJob), warning: 'SDK 연결/실행은 아래 이벤트로 확인해야 합니다. 운영 노선·탑승·인계 상태는 변경하지 않습니다.' }; },
    isBusy() { sweep(); return state.jobs.some(j => !TERMINAL.has(j.status)); },
    enqueue(input) {
      requireEnabled(); sweep(); object(input, ['requestId', 'expectedVersion', 'idempotencyKey']);
      if (!Number.isSafeInteger(input.expectedVersion) || typeof input.idempotencyKey !== 'string' || !/^[A-Za-z0-9:_-]{1,120}$/.test(input.idempotencyKey)) fail(400, 'VERSION_AND_KEY_REQUIRED', 'expectedVersion과 idempotencyKey가 필요합니다.');
      const existing = state.jobs.find(j => j.idempotencyKey === input.idempotencyKey);
      if (existing) {
        if (existing.requestId !== input.requestId || existing.requestVersion !== input.expectedVersion) fail(409, 'IDEMPOTENCY_CONFLICT', '재시도 키를 다른 요청에 사용할 수 없습니다.');
        return { job: publicJob(existing), replayed: true };
      }
      if (this.isBusy()) fail(409, 'BRIDGE_BUSY', '한 번에 SDK 작업 하나만 처리합니다.');
      // Never issue the same approval twice, even after an uncertain result.
      if (state.jobs.some(j => j.requestId === input.requestId)) fail(409, 'ALREADY_SUBMITTED', '이미 SDK로 보낸 승인입니다. 불확실한 결과를 자동 재시도하지 않습니다.');
      const request = approval(input.requestId, input.expectedVersion);
      const pickup = FIXTURE_POINTS[request.interpretation.destination];
      if (!pickup) fail(422, 'FIXTURE_NOT_FOUND', '허용된 가상 목적지에 대한 테스트 좌표가 없습니다.');
      const route = validateRoute({ destination: clone(FIXTURE_POINTS.destination), waypoints: [clone(pickup), clone(FIXTURE_POINTS.checkpoint)] });
      return update(next => {
        const job = { id: randomUUID(), requestId: request.id, requestVersion: request.version, idempotencyKey: input.idempotencyKey, status: 'queued', createdAt: clock(), expiresAt: clock() + MAX_AGE, route, mode: 'emulator-only', coordinateSource: 'synthetic-public-landmark-fixture-not-child-location', events: [], lastSequence: 0, readback: {}, routingCompleted: false, vehicleVerified: false, boardingConfirmed: false, handoverConfirmed: false, routeApplied: false, causalityVerified: false };
        next.jobs.unshift(job); return { job: publicJob(job), replayed: false };
      });
    },
    claim(input) {
      requireEnabled(); sweep(); object(input, ['clientId', 'runtime']);
      if (input.clientId !== 'mobflow-pleos-emulator' || input.runtime !== 'android-emulator') fail(400, 'EMULATOR_ONLY', '지정된 로컬 에뮬레이터 브리지만 사용합니다.');
      const queued = state.jobs.find(j => j.status === 'queued');
      if (!queued) return { job: null };
      approval(queued.requestId, queued.requestVersion);
      return update(next => { const job = find(next, queued.id); job.status = 'claimed'; job.attemptId = randomUUID(); job.claimedAt = clock(); return { job }; });
    },
    report(id, input) {
      requireEnabled(); sweep(); object(input, ['attemptId', 'sequence', 'type', 'payload']);
      if (!Number.isSafeInteger(input.sequence) || input.sequence < 1 || !TYPES.has(input.type)) fail(400, 'INVALID_EVENT', '올바른 SDK 이벤트가 필요합니다.');
      return update(next => {
        const j = find(next, id);
        if (!j.attemptId || j.attemptId !== input.attemptId) fail(409, 'ATTEMPT_MISMATCH', 'SDK 호출 회차가 일치하지 않습니다.');
        const duplicate = j.events.find(e => e.sequence === input.sequence);
        if (duplicate) {
          if (duplicate.type !== input.type || JSON.stringify(duplicate.payload) !== JSON.stringify(input.payload)) fail(409, 'EVENT_CONFLICT', '같은 이벤트 번호의 내용이 다릅니다.');
          return { job: publicJob(j), replayed: true };
        }
        if (TERMINAL.has(j.status)) return { job: publicJob(j), replayed: false, eventIgnored: true, terminal: true };
        if (input.sequence !== j.lastSequence + 1) fail(409, 'EVENT_GAP', 'SDK 이벤트 순서가 맞지 않습니다.');
        const payload = input.payload;
        if (['destination', 'location'].includes(input.type)) point(payload);
        else if (input.type === 'waypoints') {
          if (!Array.isArray(payload) || payload.length > 2) fail(400, 'INVALID_WAYPOINTS', '경유지 읽기 결과를 확인해주세요.');
          payload.forEach(point);
        } else if (['error', 'uncertain'].includes(input.type)) {
          object(payload, ['code']); if (typeof payload.code !== 'string' || payload.code.length > 120) fail(400, 'INVALID_ERROR', '오류 코드만 받습니다. 개인정보는 보내지 마세요.');
        } else object(payload, []);
        if (input.type !== 'sdk-requested' && j.status === 'claimed' && input.type !== 'uncertain' && input.type !== 'error') fail(409, 'REQUEST_NOT_SENT', 'SDK 요청 이벤트가 먼저 필요합니다.');
        if (input.type === 'sdk-requested' && j.status !== 'claimed') fail(409, 'DUPLICATE_SDK_CALL', 'SDK 호출은 작업당 한 번만 허용됩니다.');
        j.events.push({ sequence: input.sequence, type: input.type, payload: clone(payload), observedAt: clock(), source: 'android-bridge-report-not-attestation' });
        j.lastSequence = input.sequence;
        if (input.type === 'sdk-requested') j.status = 'request-sent';
        if (input.type === 'route-started') j.status = 'searching';
        if (input.type === 'routing-completed') { j.status = 'awaiting-readback'; j.routingCompleted = true; j.readback = {}; }
        if (input.type === 'destination' && j.routingCompleted) j.readback.destination = point(payload);
        if (input.type === 'waypoints' && j.routingCompleted) j.readback.waypoints = clone(payload);
        if (input.type === 'location') j.emulatorLocation = { ...payload, observedAt: clock(), source: 'emulated-not-real-gps' };
        if (input.type === 'error') { j.status = 'failed'; j.message = payload.code; }
        if (input.type === 'uncertain') { j.status = 'uncertain'; j.message = payload.code; }
        if (j.routingCompleted && !TERMINAL.has(j.status) && samePoint(j.route.destination, j.readback.destination) && j.readback.waypoints?.length === j.route.waypoints.length && j.route.waypoints.every((w, i) => samePoint(w, j.readback.waypoints[i]))) {
          j.status = 'readback-matched'; j.message = '에뮬레이터 내비의 목적지·경유지 읽기 결과 일치. SDK 전역 콜백이므로 이 요청의 인과관계·실차 반영·탑승·인계 증명은 아닙니다.';
        }
        return { job: publicJob(j), replayed: false };
      });
    },
    cancel(id) {
      sweep(); return update(next => { const j = find(next, id); if (j.status !== 'queued') fail(409, 'CANCEL_UNSAFE', 'SDK 전달 후에는 원격 취소했다고 표시하지 않습니다. 에뮬레이터 내비에서 직접 확인해주세요.'); j.status = 'cancelled'; return { job: publicJob(j) }; });
    },
  };
}

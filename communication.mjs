import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, openSync, fsyncSync, closeSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { WorkflowError } from './workflow.mjs';

const clone = (value) => structuredClone(value);
const freeze = (value) => { Object.values(value).forEach((entry) => { if (entry && typeof entry === 'object') freeze(entry); }); return Object.freeze(value); };
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const hash = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const STAGES = ['departure', 'approaching', 'arrival', 'completion'];
const TERMINAL = ['completed', 'stopped', 'expired'];
export const LOCATION_FRESHNESS_MS = 120_000;

export const COMMUNICATION_PRESETS = freeze([
  { id: 'school', label: '학원·학교', operatorLabel: '새봄학원 차량 (가상)', customer: { id: 'demo-parent-1', name: '김보호 학부모 (가상)', role: '학부모' }, destination: { label: '가상 하차 지점 A' } },
  { id: 'instructor', label: '방문 강사', operatorLabel: '이강사 (가상)', customer: { id: 'demo-lesson-customer-1', name: '박고객 수강생 (가상)', role: '수강생' }, destination: { label: '가상 수업 장소 B' } },
  { id: 'delivery', label: '배송 기사', operatorLabel: '최기사 (가상)', customer: { id: 'demo-delivery-customer-1', name: '정고객 수령인 (가상)', role: '수령 고객' }, destination: { label: '가상 배송 지점 C' } },
]);

export const COMMUNICATION_TEMPLATE = freeze({
  id: 'customer-communication', version: 1, title: '이동·도착 고객 안내', available: true,
  description: '관리자가 공급한 고정 템플릿에서 사업자가 고객 안내 연결과 위치 공유 범위를 설정합니다.',
  author: 'PleosFlows 관리자', mode: 'simulation', executor: 'fixed-customer-communication-v1', editable: false,
  nodes: [
    { id: 'configure', label: '사업자 설정', kind: 'configuration' },
    { id: 'depart', label: '출발', kind: 'explicit-simulation-action' },
    { id: 'approaching', label: '도착 임박', kind: 'explicit-simulation-action' },
    { id: 'arrival', label: '도착', kind: 'explicit-simulation-action' },
    { id: 'complete', label: '업무 완료·공유 종료', kind: 'explicit-simulation-action' },
  ],
  capabilities: {
    roles: ['school', 'instructor', 'delivery'],
    connector: { id: 'kakaotalk-demo', label: '카카오톡 알림 모의 연결', mode: 'simulation', networkEnabled: false, acceptsCredentials: false },
    notifications: STAGES,
    sharing: { configurable: true, starts: ['departure', 'approaching'], fields: ['position', 'remainingDistanceMeters', 'etaMinutes'], ttlMinutes: { minimum: 5, maximum: 60 }, stopOn: ['completed', 'stopped', 'expired'], freshnessSeconds: LOCATION_FRESHNESS_MS / 1000 },
    recipients: 'fixed-fictional-presets-only', coordinates: 'fictional-grid-only', arbitraryGraphs: false,
  },
  defaults: { kakaoEnabled: false, sharingEnabled: false, sharingStart: 'departure', showPosition: true, showDistance: true, showEta: true, notifications: { departure: true, approaching: true, arrival: true, completion: true }, ttlMinutes: 15 },
});

// These are illustrative local-grid fixtures, not geographic coordinates or routing estimates.
const FIXTURES = freeze({
  departed: { position: { x: 12, y: 18, label: '가상 출발 지점', coordinateSystem: 'fictional-grid' }, remainingDistanceMeters: 2400, etaMinutes: 8 },
  approaching: { position: { x: 71, y: 66, label: '가상 도착 임박 지점', coordinateSystem: 'fictional-grid' }, remainingDistanceMeters: 450, etaMinutes: 2 },
  arrived: { position: { x: 84, y: 78, label: '가상 목적지', coordinateSystem: 'fictional-grid' }, remainingDistanceMeters: 0, etaMinutes: 0 },
});
const TITLES = { departure: '출발 안내', approaching: '도착 임박 안내', arrival: '도착 안내', completion: '업무 완료 안내' };
const BODIES = { departure: '가상 출발 단계를 실행했습니다.', approaching: '가상 도착 임박 단계를 실행했습니다.', arrival: '가상 도착 단계를 실행했습니다. 실제 도착·탑승·인계 확인은 아닙니다.', completion: '가상 업무가 완료되어 위치 공유를 종료했습니다. 실제 서비스 완료·탑승·인계 확인은 아닙니다.' };
const fail = (status, code, message) => { throw new WorkflowError(status, code, message); };

function objectInput(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'INVALID_BODY', 'JSON 객체가 필요합니다.');
  if (Object.keys(input).some((key) => !allowed.includes(key))) fail(400, 'UNSUPPORTED_COMMUNICATION_FIELD', '고정 데모 설정만 허용합니다. 실제 수신자·주소·좌표·계정·인증 정보는 받지 않습니다.');
}
function booleanField(input, key, fallback) {
  if (input[key] === undefined) return fallback;
  if (typeof input[key] !== 'boolean') fail(400, 'INVALID_CONFIGURATION', `${key}는 참 또는 거짓이어야 합니다.`);
  return input[key];
}
function validateConfiguration(input) {
  objectInput(input, ['templateVersion', 'role', 'name', 'kakaoEnabled', 'sharingEnabled', 'sharingStart', 'showPosition', 'showDistance', 'showEta', 'notifications', 'ttlMinutes', 'idempotencyKey']);
  if (input.templateVersion !== COMMUNICATION_TEMPLATE.version) fail(409, 'STALE_TEMPLATE', '현재 관리자 템플릿 버전을 확인해주세요.');
  const preset = COMMUNICATION_PRESETS.find((entry) => entry.id === input.role);
  if (!preset) fail(400, 'INVALID_ROLE', '학원·학교, 방문 강사, 배송 기사 프리셋만 선택할 수 있습니다.');
  const defaults = COMMUNICATION_TEMPLATE.defaults;
  const name = input.name === undefined ? `${preset.label} 고객 안내 (가상)` : input.name;
  if (typeof name !== 'string' || !name.trim() || name.length > 80) fail(400, 'INVALID_CONFIGURATION_NAME', '설정 이름은 1–80자로 입력해주세요.');
  const sharingStart = input.sharingStart === undefined ? defaults.sharingStart : input.sharingStart;
  if (!['departure', 'approaching'].includes(sharingStart)) fail(400, 'INVALID_SHARING_START', '위치 공유는 출발 또는 도착 임박 단계에서 시작할 수 있습니다.');
  const ttlMinutes = input.ttlMinutes === undefined ? defaults.ttlMinutes : input.ttlMinutes;
  if (!Number.isInteger(ttlMinutes) || ttlMinutes < 5 || ttlMinutes > 60) fail(400, 'INVALID_TTL', '공유 링크 유효 시간은 실행 생성 후 5–60분입니다.');
  const notificationInput = input.notifications === undefined ? {} : input.notifications;
  objectInput(notificationInput, STAGES);
  return { name: name.trim(), role: preset.id, kakaoEnabled: booleanField(input, 'kakaoEnabled', false), sharingEnabled: booleanField(input, 'sharingEnabled', false), sharingStart,
    showPosition: booleanField(input, 'showPosition', true), showDistance: booleanField(input, 'showDistance', true), showEta: booleanField(input, 'showEta', true),
    notifications: Object.fromEntries(STAGES.map((stage) => [stage, booleanField(notificationInput, stage, defaults.notifications[stage])])), ttlMinutes };
}

export function createCommunication({ dataDir = process.env.MOBFLOW_DATA_DIR || './data', clock = () => Date.now() } = {}) {
  const directory = resolve(dataDir);
  mkdirSync(directory, { recursive: true });
  const filename = join(directory, 'communication.json');
  const time = () => { const value = Number(clock()); if (!Number.isFinite(value)) throw new Error('Invalid communication clock'); return value; };
  const timestamp = (at) => new Date(at).toISOString();
  let state;
  if (existsSync(filename)) {
    try { state = JSON.parse(readFileSync(filename, 'utf8')); }
    catch { throw new Error(`Customer communication storage is unreadable; original preserved: ${filename}`); }
    if (state.schemaVersion !== 1 || !Array.isArray(state.configurations) || !Array.isArray(state.runs) || !state.idempotency || typeof state.idempotency !== 'object' || Array.isArray(state.idempotency)
      || state.configurations.some((entry) => !entry?.id || entry.version !== 1 || entry.templateVersion !== 1 || !COMMUNICATION_PRESETS.some((preset) => preset.id === entry.role))
      || state.runs.some((entry) => !entry?.id || !Number.isInteger(entry.version) || entry.version < 1 || !['ready', 'departed', 'approaching', 'arrived', ...TERMINAL].includes(entry.status) || !entry.configSnapshot || !entry.customer || !entry.link?.token || !Array.isArray(entry.events) || !Array.isArray(entry.notifications) || !Number.isFinite(Date.parse(entry.expiresAt)))) {
      throw new Error('Unsupported or invalid communication store schema; existing data was not overwritten.');
    }
  } else {
    state = { schemaVersion: 1, configurations: [], runs: [], idempotency: {} };
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
  function effectiveStatus(run, at) {
    if (TERMINAL.includes(run.status)) return run.status;
    return at >= Date.parse(run.expiresAt) ? 'expired' : run.status;
  }
  function sharingView(run, at) {
    const status = effectiveStatus(run, at);
    if (TERMINAL.includes(status)) return { status, enabled: false, expiresAt: run.expiresAt };
    if (!run.configSnapshot.sharingEnabled) return { status: 'disabled', enabled: false, expiresAt: run.expiresAt };
    if (status === 'ready' || (status === 'departed' && run.configSnapshot.sharingStart === 'approaching')) return { status: 'waiting', enabled: false, expiresAt: run.expiresAt };
    if (run.locationStale || !run.updatedAt || at - Date.parse(run.updatedAt) >= LOCATION_FRESHNESS_MS) return { status: 'stale', enabled: false, expiresAt: run.expiresAt };
    return { status: 'active', enabled: true, expiresAt: run.expiresAt };
  }
  function locationView(run, at) {
    if (sharingView(run, at).status !== 'active') return {};
    const fixture = FIXTURES[run.status];
    if (!fixture) return {};
    return { ...(run.configSnapshot.showPosition ? { position: clone(fixture.position) } : {}), ...(run.configSnapshot.showDistance ? { remainingDistanceMeters: fixture.remainingDistanceMeters } : {}), ...(run.configSnapshot.showEta ? { etaMinutes: fixture.etaMinutes } : {}) };
  }
  function notificationView(run, at, customer = false) {
    const active = sharingView(run, at).status === 'active';
    return run.notifications.map((entry) => {
      const { link, ...safe } = clone(entry);
      // An old notification cannot re-expose a link after its sharing window closes.
      if (active && link && !customer) safe.link = link;
      return safe;
    });
  }
  function runView(run, at) {
    return { ...clone(run), status: effectiveStatus(run, at), sharing: sharingView(run, at), notifications: notificationView(run, at), ...locationView(run, at) };
  }
  function withIdempotency(next, key, scope, payload, action, at) {
    if (key !== undefined && (typeof key !== 'string' || !/^[A-Za-z0-9:_-]{1,120}$/.test(key))) fail(400, 'INVALID_IDEMPOTENCY_KEY', '재시도 키는 영문·숫자·콜론·밑줄·하이픈 1–120자로 입력해주세요.');
    const fingerprint = hash({ scope, payload });
    if (key && Object.hasOwn(next.idempotency, key)) {
      const saved = next.idempotency[key];
      if (saved.fingerprint !== fingerprint) fail(409, 'IDEMPOTENCY_CONFLICT', '같은 재시도 키를 다른 요청에 사용할 수 없습니다.');
      const result = saved.kind === 'run' ? { run: runView(next.runs.find((run) => run.id === saved.id), at) } : { configuration: clone(next.configurations.find((config) => config.id === saved.id)) };
      return { ...result, replayed: true, duplicate: false };
    }
    const result = action();
    if (key) Object.defineProperty(next.idempotency, key, { value: { fingerprint, kind: result.run ? 'run' : 'configuration', id: (result.run || result.configuration).id }, enumerable: true, configurable: true, writable: true });
    return { ...result, replayed: false, duplicate: Boolean(result.duplicate) };
  }
  function event(run, type, at) { run.events.push({ id: randomUUID(), type, at: timestamp(at), version: run.version, actor: 'demo-operator', simulation: true }); }
  function notify(run, stage, at) {
    if (!run.configSnapshot.kakaoEnabled || !run.configSnapshot.notifications[stage] || run.notifications.some((entry) => entry.stage === stage)) return;
    run.notifications.push({ id: randomUUID(), runId: run.id, customerId: run.customer.id, recipient: run.customer.name, stage, type: stage, title: TITLES[stage], body: `${run.operatorLabel}: ${BODIES[stage]}`, channel: 'kakaotalk-demo', deliveryStatus: 'simulated', networkEnabled: false, createdAt: timestamp(at), ...(sharingView(run, at).status === 'active' ? { link: clone(run.link) } : {}) });
  }

  return {
    filename,
    getState() {
      const at = time();
      return clone({ template: COMMUNICATION_TEMPLATE, presets: COMMUNICATION_PRESETS, configurations: state.configurations, runs: state.runs.map((run) => runView(run, at)), notifications: state.runs.flatMap((run) => notificationView(run, at)), mode: 'simulation', limitations: ['고정된 두 번째 실행 템플릿이며 임의 워크플로 엔진이 아닙니다.', '가상 수신자와 가상 로컬 좌표만 사용합니다. 거리·시간은 고정 예시입니다.', '실제 카카오톡·GPS·지도·차량·외부 API 연결이나 메시지 발송이 없습니다.', '실제 로그인·사업자 권한 분리가 없는 로컬 데모입니다. 공개 배포하지 마세요.', '실제 도착·탑승·인계·서비스 완료를 증명하지 않습니다.'], serverTime: timestamp(at) });
    },
    saveConfiguration(input) {
      const config = validateConfiguration(input);
      const at = time();
      return transact((next) => withIdempotency(next, input.idempotencyKey, 'communication-configuration', config, () => {
        const fingerprint = hash(config);
        const existing = next.configurations.find((entry) => entry.fingerprint === fingerprint);
        if (existing) return { configuration: existing, duplicate: true };
        const configuration = { id: randomUUID(), version: 1, templateId: COMMUNICATION_TEMPLATE.id, templateVersion: COMMUNICATION_TEMPLATE.version, templateSnapshot: clone(COMMUNICATION_TEMPLATE), ...config, createdAt: timestamp(at), fingerprint, mode: 'simulation' };
        next.configurations.unshift(configuration);
        return { configuration };
      }, at));
    },
    createRun(input) {
      objectInput(input, ['configurationId', 'configurationVersion', 'idempotencyKey']);
      if (typeof input.configurationId !== 'string') fail(400, 'CONFIGURATION_REQUIRED', '저장한 사업자 설정을 먼저 선택해주세요.');
      if (!Number.isInteger(input.configurationVersion)) fail(400, 'CONFIGURATION_VERSION_REQUIRED', '설정 버전을 포함해주세요.');
      const at = time();
      return transact((next) => withIdempotency(next, input.idempotencyKey, 'communication-run', { configurationId: input.configurationId, configurationVersion: input.configurationVersion }, () => {
        const config = next.configurations.find((entry) => entry.id === input.configurationId);
        if (!config) fail(404, 'CONFIGURATION_NOT_FOUND', '저장한 사업자 설정을 찾을 수 없습니다.');
        if (config.version !== input.configurationVersion) fail(409, 'STALE_CONFIGURATION', '현재 사업자 설정 버전을 확인해주세요.');
        const existing = next.runs.find((run) => run.configurationId === config.id && !TERMINAL.includes(effectiveStatus(run, at)));
        if (existing) return { run: runView(existing, at), duplicate: true };
        const preset = COMMUNICATION_PRESETS.find((entry) => entry.id === config.role);
        const token = randomBytes(32).toString('base64url');
        const run = { id: randomUUID(), version: 1, status: 'ready', configurationId: config.id, configurationVersion: config.version, templateId: config.templateId, templateVersion: config.templateVersion, templateSnapshot: clone(config.templateSnapshot), configSnapshot: clone(config), customer: clone(preset.customer), operatorLabel: preset.operatorLabel, destination: clone(preset.destination), mode: 'simulation', createdAt: timestamp(at), expiresAt: timestamp(at + config.ttlMinutes * 60_000), updatedAt: null, locationStale: false, link: { token, customerId: preset.customer.id, url: `/customer.html?token=${encodeURIComponent(token)}&customerId=${encodeURIComponent(preset.customer.id)}` }, notifications: [], events: [] };
        event(run, 'created', at);
        next.runs.unshift(run);
        return { run: runView(run, at) };
      }, at));
    },
    transition(id, action, input) {
      const vehicleAction = action.startsWith('vehicle-');
      objectInput(input, ['expectedVersion', 'idempotencyKey', ...(action === 'vehicle-motion' ? ['motion'] : []), ...(action === 'vehicle-ux' ? ['restriction'] : []), ...(action === 'vehicle-complete' ? ['completionConfirmed'] : [])]);
      if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) fail(400, 'EXPECTED_VERSION_REQUIRED', '현재 실행 버전을 포함해주세요.');
      if (!['depart', 'advance', 'complete', 'stop', 'stale', 'vehicle-motion', 'vehicle-ux', 'vehicle-depart', 'vehicle-approach', 'vehicle-arrive', 'vehicle-complete'].includes(action)) fail(400, 'INVALID_ACTION', '지원하지 않는 실행 단계입니다.');
      const at = time();
      return transact((next) => withIdempotency(next, input.idempotencyKey, `communication-${id}-${action}`, { expectedVersion: input.expectedVersion, ...(action === 'vehicle-motion' ? { motion: input.motion } : {}), ...(action === 'vehicle-ux' ? { restriction: input.restriction } : {}), ...(action === 'vehicle-complete' ? { completionConfirmed: input.completionConfirmed } : {}) }, () => {
        const run = next.runs.find((entry) => entry.id === id);
        if (!run) fail(404, 'RUN_NOT_FOUND', '실행을 찾을 수 없습니다.');
        if (run.version !== input.expectedVersion) fail(409, 'STALE_VERSION', '더 최신 실행 상태가 있습니다. 새로고침 후 다시 시도해주세요.');
        if (TERMINAL.includes(effectiveStatus(run, at))) fail(409, 'RUN_CLOSED', '완료·종료·만료된 실행은 다시 진행할 수 없습니다. 새 실행을 시작해주세요.');
        const motion = run.vehicleSimulation?.motion || 'unknown';
        const uxAllowed = run.vehicleSimulation?.uxRestriction === 'allowed';
        const mappedAction = { 'vehicle-depart': 'depart', 'vehicle-approach': 'advance', 'vehicle-arrive': 'advance', 'vehicle-complete': 'complete' }[action] || action;
        if (action === 'vehicle-motion' && !['parked', 'moving'].includes(input.motion)) fail(400, 'INVALID_VEHICLE_MOTION', '정차 또는 주행 시뮬레이션만 가능합니다.');
        if (action === 'vehicle-ux' && !['allowed', 'blocked', 'unknown'].includes(input.restriction)) fail(400, 'INVALID_UX_RESTRICTION', 'UX 허용·제한·미확인 모의 상태만 가능합니다.');
        if (['vehicle-depart', 'vehicle-arrive', 'vehicle-complete'].includes(action) && (motion !== 'parked' || !uxAllowed)) fail(409, 'VEHICLE_ACTION_LOCKED', '정차와 UX 허용이 모두 모의 확인된 경우에만 업무를 기록할 수 있습니다.');
        if ((mappedAction === 'complete' || (mappedAction === 'advance' && run.status === 'approaching')) && run.vehicleSimulation && (motion !== 'parked' || !uxAllowed)) fail(409, 'VEHICLE_ACTION_LOCKED', '주행·UX 제한·상태 미확인 중에는 도착·완료를 기록할 수 없습니다.');
        if (action === 'vehicle-complete' && input.completionConfirmed !== true) fail(400, 'COMPLETION_CONFIRMATION_REQUIRED', '도착만으로 업무를 완료하지 않습니다. 완료 확인을 명시해주세요.');
        if (action === 'vehicle-approach' && run.status !== 'departed') fail(409, 'INVALID_TRANSITION', '출발 후에만 도착 임박 이벤트를 모의할 수 있습니다.');
        if (action === 'vehicle-arrive' && run.status !== 'approaching') fail(409, 'INVALID_TRANSITION', '도착 임박 단계에서만 도착을 확인할 수 있습니다.');
        let stage;
        if (action === 'vehicle-motion') { run.vehicleSimulation = { motion: input.motion, uxRestriction: run.vehicleSimulation?.uxRestriction || 'unknown', source: 'manual-simulation', realVehicleConnected: false }; }
        else if (action === 'vehicle-ux') { run.vehicleSimulation = { motion, uxRestriction: input.restriction, source: 'manual-simulation', realVehicleConnected: false }; }
        else if (mappedAction === 'depart' && run.status === 'ready') { run.status = 'departed'; stage = 'departure'; }
        else if (mappedAction === 'advance' && run.status === 'departed') { run.status = 'approaching'; stage = 'approaching'; }
        else if (mappedAction === 'advance' && run.status === 'approaching') { run.status = 'arrived'; stage = 'arrival'; }
        else if (mappedAction === 'complete' && run.status === 'arrived') { run.status = 'completed'; stage = 'completion'; run.completedAt = timestamp(at); }
        else if (action === 'stop') { run.status = 'stopped'; run.stoppedAt = timestamp(at); }
        else if (action === 'stale' && sharingView(run, at).status === 'active') { run.locationStale = true; }
        else fail(409, 'INVALID_TRANSITION', '현재 상태에서 실행할 수 없는 단계입니다.');
        run.version += 1;
        if (action === 'vehicle-depart') run.vehicleSimulation = { motion: 'moving', uxRestriction: run.vehicleSimulation?.uxRestriction || 'unknown', source: 'manual-simulation', realVehicleConnected: false };
        if (action === 'vehicle-complete') run.completionEvidence = { source: 'explicit-demo-confirmation', realWorldVerified: false, confirmedAt: timestamp(at) };
        if (['depart', 'advance'].includes(mappedAction)) { run.updatedAt = timestamp(at); run.locationStale = false; }
        event(run, vehicleAction ? action : action === 'advance' ? run.status : action, at);
        if (stage) notify(run, stage, at);
        return { run: runView(run, at) };
      }, at));
    },
    getCustomerLink(token, customerId) {
      // Validate both pieces of scope before inspecting status, expiry or customer data.
      if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token) || typeof customerId !== 'string') fail(404, 'CUSTOMER_LINK_NOT_FOUND', '고객 안내 링크를 확인할 수 없습니다.');
      const run = state.runs.find((entry) => entry.link.token === token && entry.customer.id === customerId);
      if (!run) fail(404, 'CUSTOMER_LINK_NOT_FOUND', '고객 안내 링크를 확인할 수 없습니다.');
      const at = time();
      return clone({ runId: run.id, status: effectiveStatus(run, at), customerName: run.customer.name, operatorLabel: run.operatorLabel, destinationLabel: run.destination.label, simulation: true, sharing: sharingView(run, at), updatedAt: run.updatedAt, expiresAt: run.expiresAt, notifications: notificationView(run, at, true), ...locationView(run, at) });
    },
  };
}

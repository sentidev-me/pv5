/** Versioned catalog for one supported executor. Nodes are a fixed contract, not arbitrary code. */
export const PICKUP_TEMPLATE_ID = 'pickup-change';
export const BASELINE_DESTINATIONS = Object.freeze(['새봄학교 정문', '한빛도서관', '푸른공원']);
const NODE_CONTRACT = [
  ['trigger', 'mock-inbound', '메시지 수신', '연결한 로컬 Slack·Discord·웹 fixture 메시지로 실행을 시작합니다.', 'mock'],
  ['interpret', 'deterministic-korean-demo', '변경 의도 해석', '목적지와 HH:MM 시간을 추출합니다. AI 노드 설계이며 현재 실행은 결정 규칙 데모입니다.', 'deterministic-demo'],
  ['policy', 'pickup-policy', '운영 규칙 검사', '허용 장소와 픽업 시간, 모호성을 검사합니다.', 'local-rules'],
  ['approval', 'human-approval', '운영자 승인', '운영자가 요청과 정책 결과를 확인하고 승인하거나 반려합니다.', 'manual'],
  ['dispatch', 'pleos-simulator', '경로 명령 전달', '전체 여정을 보존하고 최대 2개 경유지만 Pleos 시뮬레이터 경계에 전달합니다.', 'simulation'],
  ['acknowledge', 'explicit-demo-ack', '실행 응답 확인', '명시적인 성공 또는 실패 응답을 기다립니다. 탑승·인계와 분리합니다.', 'manual-simulation'],
  ['notify', 'mock-notification-preview', '결과 알림', '보호자 결과와 외부 채널용 mock payload를 표시합니다. 실제 발송하지 않습니다.', 'mock'],
];

export class TemplateError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (code, message, status = 400) => { throw new TemplateError(status, code, message); };
const text = (value, max, field) => { if (typeof value !== 'string' || !value.trim() || value.length > max) fail('INVALID_TEMPLATE_TEXT', `${field}는 1–${max}자로 입력해주세요.`); return value.trim(); };

export function defaultTemplates() {
  return [
    {
      id: PICKUP_TEMPLATE_ID, title: '픽업 변경 요청', description: '보호자 메시지를 해석하고 운영 규칙과 승인을 거쳐 경로 변경과 결과 알림을 연결합니다.', version: 1,
      status: 'available', available: true, disabled: false, category: '학원 · 돌봄 운영', executor: 'pickup-change-v1',
      executionMode: 'deterministic-demo', llmConfigured: false, instructionsMode: 'display-only',
      limitation: '7단계 고정 실행 계약만 지원합니다. 노드 이름·설명 편집은 실행 코드를 바꾸지 않으며 실제 LLM·앱 연동은 없습니다.',
      nodes: NODE_CONTRACT.map(([id, tool, label, instructions, executionMode]) => ({ id, kind: id, tool, label, instructions, executionMode, ...(['trigger', 'notify'].includes(id) ? { connector: 'slack-demo' } : id === 'dispatch' ? { connector: 'vehicle-mock' } : {}), ...(id === 'interpret' ? { llmConfigured: false, intendedCapability: 'AI interpretation' } : {}) })),
    },
    { id: 'driver-delay', title: '운행 지연 안내', description: '운전자 지연 정보를 받아 영향받는 사람에게 안내하는 예정 템플릿입니다.', version: 1, status: 'planned', available: false, disabled: true, category: '이동 안내', executor: null, nodes: [] },
    { id: 'calendar-sync', title: '일정 변경 동기화', description: '일정 변경을 이동 계획과 연결할 예정 템플릿입니다. API 접근은 미검증입니다.', version: 1, status: 'planned', available: false, disabled: true, category: '출석 관리', executor: null, nodes: [] },
  ];
}

export function applyTemplateEdit(current, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_BODY', '템플릿 편집 JSON 객체가 필요합니다.');
  if (Object.keys(input).some((key) => !['expectedVersion', 'title', 'description', 'nodes'].includes(key))) fail('UNSUPPORTED_TEMPLATE_FIELD', '제목·설명·노드 라벨과 안내만 편집할 수 있습니다.');
  if (!Number.isSafeInteger(input.expectedVersion)) fail('EXPECTED_VERSION_REQUIRED', '현재 템플릿의 expectedVersion이 필요합니다.');
  if (input.expectedVersion !== current.version) fail('STALE_TEMPLATE', '템플릿이 이미 변경되었습니다. 최신 버전을 확인해주세요.', 409);
  if (!Array.isArray(input.nodes) || input.nodes.length !== NODE_CONTRACT.length) fail('INVALID_NODE_CONTRACT', '필수 7개 노드를 순서대로 유지해야 합니다.');
  const nodes = input.nodes.map((node, index) => {
    const fixed = defaultTemplates()[0].nodes[index];
    if (!node || typeof node !== 'object' || node.id !== fixed.id || node.kind !== fixed.kind || node.tool !== fixed.tool) fail('INVALID_NODE_CONTRACT', '노드 순서·종류·실행 도구는 고정되어 있습니다.');
    for (const [key, value] of Object.entries(node)) {
      if (!['label', 'instructions', ...(['trigger', 'notify'].includes(fixed.id) ? ['connector'] : [])].includes(key) && (!Object.hasOwn(fixed, key) || value !== fixed[key])) fail('INVALID_NODE_CONTRACT', '실행 모드와 필수 승인 단계는 변경할 수 없습니다.');
    }
    if (['trigger', 'notify'].includes(fixed.id) && !['demo-web', 'slack-demo', 'discord-demo', 'http-demo'].includes(node.connector)) fail('UNSUPPORTED_CONNECTOR', '노드 연결은 로컬 mock 커넥터만 선택할 수 있습니다.');
    return { ...fixed, ...(['trigger', 'notify'].includes(fixed.id) ? { connector: node.connector } : {}), label: text(node.label, 80, '노드 이름'), instructions: text(node.instructions, 1000, '노드 안내') };
  });
  return { ...current, title: text(input.title, 100, '제목'), description: text(input.description, 1000, '설명'), nodes, version: current.version + 1, updatedAt: new Date().toISOString() };
}

export function validateInstanceConfig(input, template, connectors) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_BODY', '활성화 설정 JSON 객체가 필요합니다.');
  if (Object.keys(input).some((key) => !['templateId', 'templateVersion', 'sourceConnector', 'name', 'allowedDestinations', 'windowStart', 'windowEnd', 'approvalRequired', 'connectionLabel', 'idempotencyKey'].includes(key))) fail('UNSUPPORTED_INSTANCE_FIELD', '지원되는 로컬 연결과 규칙만 설정할 수 있습니다.');
  if (!template || template.id !== PICKUP_TEMPLATE_ID || !template.available) fail('TEMPLATE_UNAVAILABLE', '이 템플릿은 아직 활성화할 수 없습니다.', 422);
  if (input.templateVersion !== template.version) fail('STALE_TEMPLATE', '현재 카탈로그 버전으로 설정을 다시 확인해주세요.', 409);
  if (!connectors.includes(input.sourceConnector)) fail('UNSUPPORTED_CONNECTOR', '로컬 mock 연결만 선택할 수 있습니다.');
  if (input.sourceConnector !== template.nodes[0].connector) fail('CONNECTOR_MISMATCH', '관리자가 지정한 트리거 커넥터에만 연결할 수 있습니다.');
  if (input.connectionLabel !== undefined && (typeof input.connectionLabel !== 'string' || !/^DEMO_[A-Z0-9_]{1,60}$/.test(input.connectionLabel))) fail('INVALID_CONNECTION_LABEL', '연결 이름은 DEMO_로 시작하는 가상 영문·숫자·밑줄 식별자만 입력해주세요.');
  if (!Array.isArray(input.allowedDestinations) || !input.allowedDestinations.length || input.allowedDestinations.some((d) => !BASELINE_DESTINATIONS.includes(d)) || new Set(input.allowedDestinations).size !== input.allowedDestinations.length) fail('INVALID_DESTINATIONS', '등록된 가상 픽업 장소를 중복 없이 하나 이상 선택해주세요.');
  const validTime = (value) => typeof value === 'string' && /^\d{2}:\d{2}$/.test(value) && Number(value.slice(0, 2)) < 24 && Number(value.slice(3)) < 60;
  if (!validTime(input.windowStart) || !validTime(input.windowEnd) || input.windowStart < '15:00' || input.windowEnd > '16:30' || input.windowStart > input.windowEnd) fail('INVALID_RULE_WINDOW', '운영 시간은 15:00–16:30 범위 안에서만 좁힐 수 있습니다.');
  if (input.approvalRequired !== undefined && input.approvalRequired !== true) fail('APPROVAL_REQUIRED', '운영자 승인은 필수이며 비활성화할 수 없습니다.');
  return { name: text(input.name, 100, '워크플로 이름'), sourceConnector: input.sourceConnector, connectionLabel: input.connectionLabel || 'DEMO_TEAM_CHANNEL', allowedDestinations: [...input.allowedDestinations], windowStart: input.windowStart, windowEnd: input.windowEnd, approvalRequired: true, mode: 'mock' };
}

export function deriveRunTrace(request) {
  const nodes = request.templateSnapshot?.nodes || defaultTemplates()[0].nodes;
  const events = request.events || [];
  const eventFor = (types) => events.findLast((event) => types.includes(event.type));
  const blocked = request.policyChecks?.some((check) => !check.passed);
  const latest = events.at(-1);
  const detail = {
    trigger: { status: 'completed', event: eventFor(['created']), output: { connector: request.source?.connector || 'demo-web', mode: 'mock' } },
    interpret: { status: request.interpretation?.confidence === 'needs-review' ? 'needs-review' : 'completed', event: eventFor(['created']), output: request.interpretation },
    policy: { status: blocked ? 'blocked' : 'completed', event: eventFor(['created']), output: request.policyChecks },
    approval: { status: request.status === 'rejected' ? 'rejected' : ['approved', 'dispatched', 'executed', 'failed'].includes(request.status) ? 'completed' : blocked ? 'blocked' : 'waiting', event: eventFor(['approved', 'rejected']), output: { required: true, reason: request.reason || null } },
    dispatch: { status: request.dispatch ? 'completed' : request.status === 'rejected' ? 'skipped' : 'not-started', event: eventFor(['dispatched']), output: request.dispatch || null },
    acknowledge: { status: request.status === 'executed' ? 'completed' : request.status === 'failed' ? 'failed' : request.status === 'dispatched' ? 'waiting' : request.status === 'rejected' ? 'skipped' : 'not-started', event: eventFor(['executed', 'failed']), output: request.execution || null },
    notify: { status: 'preview-only', event: latest, output: { latestStatus: request.status, deliveredExternally: false, mode: 'mock' } },
  };
  return nodes.map((node) => { const trace = detail[node.id]; return { nodeId: node.id, kind: node.kind, label: node.label, tool: node.tool, executionMode: node.executionMode, status: trace.status, at: trace.event?.at || null, detail: trace.event?.detail || null, output: trace.output }; });
}

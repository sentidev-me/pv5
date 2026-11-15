import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { createServer } from '../server.mjs';
import { createWorkflow, parseDemoMessage, SAMPLE_MESSAGE, DESTINATIONS } from '../workflow.mjs';
import { simulateDispatch } from '../pleos-adapter.mjs';
import { normalizeDemoInbound, buildMockNotificationPayload, DEMO_CONNECTORS } from '../connectors.mjs';

function activation(store, overrides = {}) {
  const template = store.getState().templates.find((entry) => entry.id === 'pickup-change');
  return { templateId: template.id, templateVersion: template.version, name: '가상 학원 테스트', sourceConnector: template.nodes[0].connector, allowedDestinations: [...DESTINATIONS], windowStart: '15:00', windowEnd: '16:30', ...overrides };
}
function activate(store, overrides = {}) { const result = store.activateInstance(activation(store, overrides)); store.fixtureInstanceId = result.instance.id; return result.instance; }
function createRequest(store, body) { return store.createRequest(body && typeof body === 'object' && !Array.isArray(body) ? { instanceId: store.fixtureInstanceId, ...body } : body); }
function fixture(t, connector = 'slack-demo') {
  const directory = mkdtempSync(join(tmpdir(), 'mobflow-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = createWorkflow({ dataDir: directory });
  if (connector !== 'slack-demo') { const template = store.getState().templates[0]; store.saveTemplate({ expectedVersion: template.version, title: template.title, description: template.description, nodes: template.nodes.map((node) => ['trigger', 'notify'].includes(node.id) ? { ...node, connector } : node) }); }
  activate(store);
  return { directory, store }; 
}
const input = (message = SAMPLE_MESSAGE, idempotencyKey) => ({ message, childId: 'demo-child-1', ...(idempotencyKey ? { idempotencyKey } : {}) });
const checkError = (status, code) => (error) => error.status === status && error.code === code;
const create = (store, message, key) => createRequest(store, input(message, key)).request;
const action = (store, request, name, extra = {}) => store.transition(request.id, name, { expectedVersion: request.version, ...extra }).request;

async function httpFixture(t) {
  const { directory } = fixture(t);
  const publicDir = join(directory, 'public'); mkdirSync(publicDir); writeFileSync(join(publicDir, 'index.html'), '<!doctype html><title>PleosFlows test</title>');
  const server = createServer({ dataDir: join(directory, 'http-data'), publicDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const instance = activate(server.workflow);
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base, directory, instanceId: instance.id, post: async (path, body, headers = {}) => {
    const payload = path === '/api/requests' && body && typeof body === 'object' ? { instanceId: instance.id, ...body } : body;
    const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(payload) });
    return { status: response.status, body: await response.json() };
  } };
}

test('exact Korean sample creates structured pending request, policies, impact, and notification', (t) => {
  const { store } = fixture(t); const request = create(store);
  assert.equal(request.status, 'pending'); assert.equal(request.version, 1);
  assert.equal(request.interpretation.destination, '한빛도서관'); assert.equal(request.interpretation.time, '16:30');
  assert.equal(request.interpretation.parser, 'deterministic-demo'); assert.ok(request.policyChecks.every((check) => check.passed));
  assert.equal(request.routeImpact.measured, false); assert.equal(request.routeImpact.travelTimeEstimate, null);
  assert.equal(store.getState().notifications.length, 1);
  assert.equal(store.getState().route.stops[0].label, '새봄학교 정문');
});

test('complete flow requires explicit acknowledgment and never infers boarding or handover', (t) => {
  const { store } = fixture(t); let request = create(store);
  request = action(store, request, 'approve'); assert.equal(request.status, 'approved');
  assert.equal(store.getState().route.stops[0].label, '새봄학교 정문');
  request = action(store, request, 'dispatch'); assert.equal(request.status, 'dispatched');
  assert.equal(request.dispatch.executionConfirmed, false); assert.equal(request.dispatch.waypoints.length, 2);
  assert.equal(request.dispatch.fullItineraryStopCount, 3);
  assert.equal(store.getState().route.pendingItinerary.length, 3);
  assert.equal(store.getState().route.stops[0].label, '새봄학교 정문');
  request = action(store, request, 'acknowledge', { outcome: 'executed' });
  assert.equal(request.status, 'executed'); assert.equal(request.execution.vehicleVerified, false);
  assert.equal(request.execution.boardingConfirmed, false); assert.equal(request.execution.handoverConfirmed, false);
  const state = store.getState();
  assert.equal(state.route.stops[0].label, '한빛도서관'); assert.equal(state.route.stops.length, 3);
  assert.equal(state.route.pendingItinerary, null); assert.equal(state.route.activeRequestId, null);
  assert.equal(state.route.boardingStatus, 'not_confirmed'); assert.equal(state.route.handoverStatus, 'not_confirmed');
  assert.deepEqual(request.events.map((event) => event.type), ['created', 'approved', 'dispatched', 'executed']);
  assert.equal(state.notifications.length, 4);
});

test('unknown, ambiguous, out-of-window, unsupported date, and invalid time block approval', (t) => {
  const { store } = fixture(t);
  const messages = [
    '오늘 픽업을 미등록카페로 변경해주세요. 16:30에 도착할게요.',
    '오늘 픽업을 한빛도서관 또는 푸른공원으로 변경해주세요. 16:30',
    '오늘 픽업을 한빛도서관으로 변경해주세요. 오후 네 시쯤',
    '오늘 픽업을 한빛도서관으로 변경해주세요. 24:00',
    '오늘 픽업을 한빛도서관으로 변경해주세요. 16:75',
    '오늘 픽업을 한빛도서관으로 변경해주세요. 16:30 또는 16:00',
    '오늘 픽업을 한빛도서관으로 변경해주세요. 18:00',
    '내일 픽업을 한빛도서관으로 변경해주세요. 16:30',
    '오늘 픽업을 한빛도서관 옆 카페로 변경해주세요. 16:30',
    '한빛도서관 주소를 알려줘 16:30',
    '오늘 픽업을 한빛도서관2호점으로 변경해주세요. 16:30',
    '오늘 픽업을 한빛도서관으로 변경해주세요. 16:30이나 오후 5시',
    '오늘 픽업을 한빛도서관으로 변경해주세요. 16:30:00',
  ];
  for (const message of messages) {
    const request = create(store, message);
    assert.ok(request.policyChecks.some((check) => !check.passed), message);
    assert.throws(() => action(store, request, 'approve'), checkError(422, 'POLICY_BLOCKED'), message);
    assert.equal(store.getState().requests.find((r) => r.id === request.id).status, 'pending');
  }
});

test('a valid revised request does not deduplicate against an ambiguous one', (t) => {
  const { store } = fixture(t);
  const ambiguous = create(store, '아마 오늘 픽업을 한빛도서관으로 변경해주세요. 16:30');
  const exact = create(store);
  assert.notEqual(exact.id, ambiguous.id); assert.ok(exact.policyChecks.every((c) => c.passed));
});

test('unknown child, invalid body, missing version, and invalid reasons reject safely', (t) => {
  const { store } = fixture(t);
  assert.throws(() => createRequest(store, { ...input(), childId: 'real-child' }), checkError(400, 'UNKNOWN_CHILD'));
  for (const body of [null, [], { message: '' }, { message: 'x'.repeat(2001) }]) assert.throws(() => createRequest(store, body));
  const request = create(store);
  assert.throws(() => store.transition(request.id, 'approve', {}), checkError(400, 'EXPECTED_VERSION_REQUIRED'));
  assert.throws(() => action(store, request, 'reject'), checkError(400, 'REASON_REQUIRED'));
  assert.throws(() => action(store, request, 'reject', { reason: {} }), checkError(400, 'INVALID_REASON'));
});

test('rejection persists reason and creates parent-facing simulated result without route mutation', (t) => {
  const { store } = fixture(t); const original = store.getState().route;
  let request = create(store); request = action(store, request, 'reject', { reason: '운영 시간 조정이 필요합니다.' });
  assert.equal(request.status, 'rejected'); assert.match(request.reason, /운영 시간/);
  assert.deepEqual(store.getState().route, original);
  assert.equal(store.getState().notifications[0].type, 'rejected');
  assert.throws(() => action(store, request, 'approve'), checkError(409, 'INVALID_TRANSITION'));
});

test('explicit failed execution preserves confirmed itinerary and records failure', (t) => {
  const { store } = fixture(t); let request = create(store);
  request = action(store, request, 'approve'); request = action(store, request, 'dispatch');
  assert.throws(() => action(store, request, 'acknowledge', { outcome: 'failed' }), checkError(400, 'REASON_REQUIRED'));
  request = action(store, request, 'acknowledge', { outcome: 'failed', reason: '데모 전송 실패' });
  assert.equal(request.status, 'failed'); assert.equal(request.execution.outcome, 'failed');
  assert.equal(store.getState().route.stops[0].label, '새봄학교 정문');
  assert.equal(store.getState().route.version, 1); assert.equal(store.getState().route.activeRequestId, null);
  assert.equal(store.getState().notifications[0].type, 'failed');
});

test('pending, approved, and dispatched requests cannot skip workflow stages', (t) => {
  const { store } = fixture(t); let request = create(store);
  assert.throws(() => action(store, request, 'dispatch'), checkError(409, 'INVALID_TRANSITION'));
  assert.throws(() => action(store, request, 'acknowledge', { outcome: 'executed' }), checkError(409, 'INVALID_TRANSITION'));
  request = action(store, request, 'approve'); request = action(store, request, 'dispatch');
  assert.throws(() => action(store, request, 'acknowledge', { outcome: 'door_open' }), checkError(400, 'OUTCOME_REQUIRED'));
  assert.throws(() => action(store, request, 'reject', { reason: '늦은 거절' }), checkError(409, 'INVALID_TRANSITION'));
});

test('optimistic concurrency rejects stale approval and later stale route', (t) => {
  const { store } = fixture(t);
  let first = create(store); let second = create(store, '오늘 픽업을 푸른공원으로 변경해주세요. 16:15');
  first = action(store, first, 'approve');
  assert.throws(() => store.transition(first.id, 'approve', { expectedVersion: 1 }), checkError(409, 'STALE_VERSION'));
  first = action(store, first, 'dispatch'); first = action(store, first, 'acknowledge', { outcome: 'executed' });
  assert.throws(() => action(store, second, 'approve'), checkError(409, 'STALE_ROUTE'));
});

test('concurrent approved changes cannot dispatch over an active route', (t) => {
  const { store } = fixture(t);
  let first = create(store); let second = create(store, '오늘 픽업을 푸른공원으로 변경해주세요. 16:15');
  first = action(store, first, 'approve'); second = action(store, second, 'approve');
  first = action(store, first, 'dispatch');
  assert.throws(() => action(store, second, 'dispatch'), checkError(409, 'ROUTE_BUSY'));
  first = action(store, first, 'acknowledge', { outcome: 'executed' });
  assert.throws(() => action(store, second, 'dispatch'), checkError(409, 'STALE_ROUTE'));
});

test('identical and semantically identical pending requests are deduplicated', (t) => {
  const { store } = fixture(t);
  const first = createRequest(store, input());
  const same = createRequest(store, input());
  const semantic = createRequest(store, input('하늘이 픽업을 한빛도서관으로 변경해주세요 16:30'));
  assert.equal(same.request.id, first.request.id); assert.equal(same.duplicate, true);
  assert.equal(semantic.request.id, first.request.id); assert.equal(store.getState().requests.length, 1);
  assert.equal(store.getState().notifications.length, 1);
});

test('idempotency retries are stable, durable, and payload conflicts are rejected', (t) => {
  const { directory, store } = fixture(t);
  const first = createRequest(store, input(SAMPLE_MESSAGE, 'create-1'));
  const retry = createRequest(store, input(SAMPLE_MESSAGE, 'create-1'));
  assert.equal(retry.replayed, true); assert.equal(retry.request.id, first.request.id);
  assert.throws(() => createRequest(store, input('픽업을 푸른공원으로 변경 16:15', 'create-1')), checkError(409, 'IDEMPOTENCY_CONFLICT'));
  const approved = store.transition(first.request.id, 'approve', { expectedVersion: 1, idempotencyKey: 'approve-1' });
  const restarted = createWorkflow({ dataDir: directory });
  const approvedRetry = restarted.transition(first.request.id, 'approve', { expectedVersion: 1, idempotencyKey: 'approve-1' });
  assert.equal(approvedRetry.replayed, true); assert.equal(approvedRetry.request.version, approved.request.version);
  assert.equal(restarted.getState().notifications.length, 2); assert.equal(restarted.getState().requests[0].events.length, 2);
});

test('restarting restores in-flight route, requests, notifications, and eventual outcome', (t) => {
  const { directory, store } = fixture(t); let request = create(store);
  request = action(store, request, 'approve'); request = action(store, request, 'dispatch');
  const before = store.getState(); const restarted = createWorkflow({ dataDir: directory });
  assert.deepEqual(restarted.getState(), before);
  request = action(restarted, request, 'acknowledge', { outcome: 'executed' });
  const again = createWorkflow({ dataDir: directory });
  assert.equal(again.getState().requests[0].status, 'executed'); assert.equal(again.getState().notifications.length, 4);
  assert.equal(again.getState().route.stops[0].label, '한빛도서관');
});

test('corrupted persistence fails closed and does not overwrite original file', (t) => {
  const { directory } = fixture(t); const path = join(directory, 'store.json');
  writeFileSync(path, '{invalid'); assert.throws(() => createWorkflow({ dataDir: directory }));
  assert.equal(readFileSync(path, 'utf8'), '{invalid');
});

test('returned snapshots cannot mutate stored state and special idempotency keys are safe', (t) => {
  const { store } = fixture(t); const result = createRequest(store, input(SAMPLE_MESSAGE, '__proto__'));
  result.request.status = 'executed';
  assert.equal(store.getState().requests[0].status, 'pending');
  const state = store.getState(); state.route.stops = [];
  assert.equal(store.getState().route.stops.length, 3);
  assert.equal(createRequest(store, input(SAMPLE_MESSAGE, '__proto__')).replayed, true);
});

test('simulation adapter never sends more than two navigation waypoints', () => {
  const itinerary = Array.from({ length: 9 }, (_, n) => ({ id: `stop-${n}`, label: `가상 지점 ${n}`, time: '16:00' }));
  const result = simulateDispatch({ requestId: 'demo', itinerary });
  assert.equal(result.waypoints.length, 2); assert.equal(result.fullItineraryStopCount, 9);
  assert.equal(result.mode, 'simulation'); assert.equal(result.executionConfirmed, false);
  assert.equal(itinerary.length, 9);
});

test('HTTP API serves static assets, state, structured errors, and complete workflow', async (t) => {
  const { base, post } = await httpFixture(t);
  let response = await fetch(base + '/'); assert.equal(response.status, 200); assert.match(await response.text(), /PleosFlows test/);
  response = await fetch(base + '/api/health'); assert.equal((await response.json()).vehicleConnected, false);
  let result = await post('/api/requests', input(SAMPLE_MESSAGE, 'http-create'));
  assert.equal(result.status, 201); let request = result.body.request;
  for (const next of ['approve', 'dispatch', 'acknowledge']) {
    result = await post(`/api/requests/${request.id}/${next}`, { expectedVersion: request.version, idempotencyKey: `http-${next}`, ...(next === 'acknowledge' ? { outcome: 'executed' } : {}) });
    assert.equal(result.status, 200); request = result.body.request;
  }
  assert.equal(request.status, 'executed');
  response = await fetch(base + '/api/state'); const state = await response.json();
  assert.equal(state.requests.length, 1); assert.equal(state.notifications.length, 4);
  assert.equal(state.route.stops[0].label, '한빛도서관');
  result = await post(`/api/requests/${request.id}/approve`, { expectedVersion: 1 });
  assert.equal(result.status, 409); assert.equal(result.body.error.code, 'STALE_VERSION');
});

test('HTTP rejects invalid JSON, oversized bodies, unknown APIs, foreign origins, and traversal', async (t) => {
  const { base, post } = await httpFixture(t);
  let response = await fetch(base + '/api/requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' });
  assert.equal(response.status, 400); assert.equal((await response.json()).error.code, 'INVALID_JSON');
  response = await fetch(base + '/api/requests', { method: 'POST', body: '{}' }); assert.equal(response.status, 415);
  let result = await post('/api/requests', { message: 'x'.repeat(17000) }); assert.equal(result.status, 413);
  result = await post('/api/requests', input(), { Origin: 'https://untrusted.example' }); assert.equal(result.status, 403);
  response = await fetch(base + '/api/missing'); assert.equal(response.status, 404);
  response = await fetch(base + '/%2e%2e%2fstore.json'); assert.equal(response.status, 403);
  response = await fetch(base + '/data/store.json'); assert.equal(response.status, 404);
});

test('HTTP preserves Korean text when UTF-8 bytes arrive in separate chunks', async (t) => {
  const { base, instanceId } = await httpFixture(t); const bytes = Buffer.from(JSON.stringify({ ...input(), instanceId }));
  const result = await new Promise((resolve, reject) => {
    const request = http.request(base + '/api/requests', { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (response) => {
      const chunks = []; response.on('data', (chunk) => chunks.push(chunk)); response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }));
    });
    request.on('error', reject);
    for (const byte of bytes) request.write(Buffer.from([byte]));
    request.end();
  });
  assert.equal(result.status, 201); assert.equal(result.body.request.message, SAMPLE_MESSAGE);
});


test('HTTP server restart recovers a dispatched command and completes it exactly once', async (t) => {
  const { directory } = fixture(t);
  const dataDir = join(directory, 'restart-data');
  let server = createServer({ dataDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const instance = activate(server.workflow);
  let base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body) => {
    const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(path === '/api/requests' ? { instanceId: instance.id, ...body } : body) });
    assert.ok(response.ok); return response.json();
  };
  let { request } = await post('/api/requests', input());
  ({ request } = await post(`/api/requests/${request.id}/approve`, { expectedVersion: request.version }));
  ({ request } = await post(`/api/requests/${request.id}/dispatch`, { expectedVersion: request.version }));
  await new Promise((resolve) => server.close(resolve));
  server = createServer({ dataDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  base = `http://127.0.0.1:${server.address().port}`;
  const state = await (await fetch(base + '/api/state')).json();
  assert.equal(state.requests[0].status, 'dispatched');
  assert.equal(state.route.pendingItinerary.length, 3);
  const body = { expectedVersion: request.version, outcome: 'executed', idempotencyKey: 'restart-ack' };
  const confirmed = await post(`/api/requests/${request.id}/acknowledge`, body);
  const replayed = await post(`/api/requests/${request.id}/acknowledge`, body);
  assert.equal(confirmed.request.status, 'executed'); assert.equal(replayed.replayed, true);
  const after = await (await fetch(base + '/api/state')).json();
  assert.equal(after.notifications.length, 4); assert.equal(after.route.version, 2);
});


test('local connector fixtures normalize only supported demo sources', () => {
  for (const connector of DEMO_CONNECTORS) {
    const normalized = normalizeDemoInbound({ connector, message: SAMPLE_MESSAGE, externalMessageId: 'fixture-message-1' });
    assert.equal(normalized.message, SAMPLE_MESSAGE); assert.equal(normalized.source.connector, connector);
    assert.equal(normalized.source.mode, 'mock'); assert.equal(normalized.source.transport, 'local-fixture');
  }
  for (const connector of ['slack', 'discord', 'https://hooks.slack.com/example']) assert.throws(() => normalizeDemoInbound({ connector, message: SAMPLE_MESSAGE }), { code: 'UNSUPPORTED_CONNECTOR' });
  for (const unsafe of [{ token: 'fake-token' }, { webhookUrl: 'https://example.invalid/webhook' }, { channelId: 'real-channel' }]) assert.throws(() => normalizeDemoInbound({ connector: 'slack-demo', message: SAMPLE_MESSAGE, ...unsafe }), { code: 'LIVE_CONNECTOR_INPUT_REJECTED' });
  assert.throws(() => normalizeDemoInbound({ connector: 'slack-demo', message: SAMPLE_MESSAGE, externalMessageId: '123456.789' }), { code: 'INVALID_FIXTURE_ID' });
});

test('Slack and Discord status payloads are preview-only with placeholder recipients', (t) => {
  for (const connector of ['slack-demo', 'discord-demo']) {
    const { store, directory } = fixture(t, connector);
    let request = createRequest(store, { ...input(), sourceConnector: connector, externalMessageId: 'demo-message-1' }).request;
    assert.equal(request.source.connector, connector); assert.equal(request.source.mode, 'mock');
    request = action(store, request, 'approve'); request = action(store, request, 'dispatch');
    request = action(store, request, 'acknowledge', { outcome: 'executed' });
    const notifications = createWorkflow({ dataDir: directory }).getState().notifications;
    assert.equal(notifications.length, 4);
    for (const notification of notifications) {
      const preview = notification.payloadPreview;
      assert.equal(preview.mode, 'mock'); assert.equal(preview.networkEnabled, false);
      assert.equal(preview.deliveryStatus, 'preview-only'); assert.equal(preview.connector, connector);
      assert.match(preview.recipient.id, /^DEMO_/); assert.equal(preview.event.status, notification.type);
      assert.equal(notification.deliveryStatus, 'simulated');
      if (connector === 'slack-demo') assert.equal(preview.payload.blocks[0].text.type, 'plain_text');
      else assert.deepEqual(preview.payload.allowed_mentions.parse, []);
    }
  }
});

test('request API rejects live connector configuration and keeps idempotency scoped to fixture source', async (t) => {
  const { post } = await httpFixture(t);
  for (const extra of [{ sourceConnector: 'slack' }, { sourceConnector: 'discord' }, { sourceConnector: 'slack-demo', token: 'fake' }, { webhookUrl: 'https://example.invalid' }]) {
    const result = await post('/api/requests', { ...input(), ...extra }); assert.equal(result.status, 400);
  }
  const body = { ...input(SAMPLE_MESSAGE, 'fixture-source-key'), sourceConnector: 'slack-demo' };
  const accepted = await post('/api/requests', body); assert.equal(accepted.status, 201);
  assert.equal(accepted.body.request.source.connector, 'slack-demo');
  const replay = await post('/api/requests', body); assert.equal(replay.body.replayed, true);
  const conflict = await post('/api/requests', { ...body, sourceConnector: 'discord-demo' });
  assert.equal(conflict.status, 400); assert.equal(conflict.body.error.code, 'CONNECTOR_MISMATCH');
});

test('mock payload generation contains no delivery method and suppresses Discord mentions', () => {
  const preview = buildMockNotificationPayload({ connector: 'discord-demo', requestId: 'fixture-request', status: 'rejected', version: 2, title: '@everyone', body: '가상 테스트' });
  assert.deepEqual(preview.payload.allowed_mentions, { parse: [], users: [], roles: [], replied_user: false });
  assert.equal(preview.networkEnabled, false); assert.equal(preview.send, undefined);
  assert.equal(preview.token, undefined); assert.equal(preview.webhookUrl, undefined);
});


test('parser requires explicit pickup-change intent and blocks common Korean negations', (t) => {
  const { store } = fixture(t);
  const blocked = [
    '오늘 한빛도서관 행사 시작 시간은 16:30입니다.',
    '오늘 픽업 장소는 한빛도서관입니다. 16:30에 만나요.',
    '오늘 한빛도서관으로 변경해주세요. 16:30',
    '오늘 픽업을 한빛도서관으로 안 바꿔 주세요. 16:30',
    '오늘 픽업을 한빛도서관으로 안바꿔 주세요. 16:30',
    '오늘 픽업을 한빛도서관으로 바꾸지 마세요. 16:30',
    '오늘 픽업은 한빛도서관으로 변경 안 해도 돼요. 16:30',
    '오늘 픽업을 한빛도서관으로 변경할 필요 없어. 16:30',
    '오늘 픽업을 한빛도서관으로 변경할 필요없어요. 16:30',
  ];
  for (const message of blocked) {
    const parsed = parseDemoMessage(message);
    assert.equal(parsed.confidence, 'needs-review', message);
    assert.ok(parsed.uncertainties.length > 0, message);
    const request = create(store, message);
    assert.throws(() => action(store, request, 'approve'), checkError(422, 'POLICY_BLOCKED'), message);
  }
  for (const phrase of ['변경해주세요', '바꿔주세요', '바꾸어주세요']) {
    const parsed = parseDemoMessage(`오늘 픽업을 한빛도서관으로 ${phrase}. 16:30`);
    assert.equal(parsed.confidence, 'demo-exact-match', phrase);
  }
});

function editInput(template, changes = {}) { return { expectedVersion: template.version, title: template.title, description: template.description, nodes: structuredClone(template.nodes), ...changes }; }

test('catalog exposes one executable fixed-contract template and disabled planned templates', (t) => {
  const { store } = fixture(t); const { templates } = store.getState();
  assert.equal(templates.filter((entry) => entry.available).length, 1);
  const template = templates[0]; assert.equal(template.id, 'pickup-change');
  assert.deepEqual(template.nodes.map((node) => node.kind), ['trigger', 'interpret', 'policy', 'approval', 'dispatch', 'acknowledge', 'notify']);
  assert.equal(template.nodes[1].executionMode, 'deterministic-demo'); assert.equal(template.nodes[1].llmConfigured, false);
  assert.equal(template.instructionsMode, 'display-only');
  assert.ok(templates.slice(1).every((entry) => entry.disabled && !entry.available));
});

test('admin saves versioned template copy while active instances and runs keep immutable snapshots', (t) => {
  const { store, directory } = fixture(t); const oldInstance = store.getState().instances[0]; const template = store.getState().templates[0];
  const nodes = structuredClone(template.nodes); nodes[1].label = '새 해석 라벨'; nodes[1].instructions = '편집된 AI 의도 설명. 현재는 결정 규칙 데모.';
  const saved = store.saveTemplate(editInput(template, { title: '관리자가 편집한 픽업 템플릿', nodes })).template;
  assert.equal(saved.version, 2); assert.equal(saved.nodes[1].label, '새 해석 라벨');
  assert.throws(() => store.saveTemplate(editInput(template)), checkError(409, 'STALE_TEMPLATE'));
  const request = create(store);
  assert.equal(request.templateVersion, 1); assert.equal(request.templateSnapshot.title, template.title);
  assert.equal(request.templateSnapshot.nodes[1].label, template.nodes[1].label);
  assert.equal(store.getState().instances[0].templateSnapshot.version, 1);
  const newInstance = store.activateInstance(activation(store)).instance;
  assert.equal(newInstance.templateVersion, 2); assert.equal(newInstance.templateSnapshot.title, saved.title);
  const restored = createWorkflow({ dataDir: directory }).getState();
  assert.equal(restored.templates[0].version, 2);
  assert.equal(restored.instances.find((i) => i.id === oldInstance.id).templateVersion, 1);
  assert.equal(restored.requests[0].templateVersion, 1);
});

test('admin cannot reorder nodes, remove approval, change tools, or enable a real LLM', (t) => {
  const { store } = fixture(t); const template = store.getState().templates[0];
  for (const mutate of [
    (nodes) => nodes.reverse(),
    (nodes) => nodes.filter((node) => node.id !== 'approval'),
    (nodes) => { nodes[1].tool = 'real-llm'; return nodes; },
    (nodes) => { nodes[1].llmConfigured = true; return nodes; },
    (nodes) => { nodes[4].connector = 'real-vehicle'; return nodes; },
  ]) assert.throws(() => store.saveTemplate(editInput(template, { nodes: mutate(structuredClone(template.nodes)) })), checkError(400, 'INVALID_NODE_CONTRACT'));
  assert.equal(store.getState().templates[0].version, 1);
});

test('new runs require a known activated instance and cannot override its connector', (t) => {
  const { store } = fixture(t);
  assert.throws(() => store.createRequest(input()), checkError(400, 'INSTANCE_REQUIRED'));
  assert.throws(() => store.createRequest({ ...input(), instanceId: 'not-activated' }), checkError(422, 'INSTANCE_INACTIVE'));
  assert.throws(() => createRequest(store, { ...input(), sourceConnector: 'discord-demo' }), checkError(400, 'CONNECTOR_MISMATCH'));
  assert.equal(store.getState().requests.length, 0);
});

test('customer activation permits only narrower registered policy rules and mandatory approval', (t) => {
  const { store } = fixture(t);
  for (const [overrides, code] of [
    [{ windowStart: '14:59' }, 'INVALID_RULE_WINDOW'],
    [{ windowEnd: '16:31' }, 'INVALID_RULE_WINDOW'],
    [{ windowStart: '16:20', windowEnd: '16:10' }, 'INVALID_RULE_WINDOW'],
    [{ allowedDestinations: ['미등록 장소'] }, 'INVALID_DESTINATIONS'],
    [{ allowedDestinations: [] }, 'INVALID_DESTINATIONS'],
    [{ approvalRequired: false }, 'APPROVAL_REQUIRED'],
    [{ sourceConnector: 'discord-demo' }, 'CONNECTOR_MISMATCH'],
    [{ connectionLabel: 'https://example.invalid' }, 'INVALID_CONNECTION_LABEL'],
    [{ token: 'fake-token' }, 'UNSUPPORTED_INSTANCE_FIELD'],
  ]) assert.throws(() => store.activateInstance(activation(store, overrides)), checkError(400, code));
  assert.throws(() => store.activateInstance(activation(store, { templateVersion: 0 })), checkError(409, 'STALE_TEMPLATE'));
  assert.throws(() => store.activateInstance(activation(store, { templateId: 'arrival-notice' })), checkError(422, 'TEMPLATE_UNAVAILABLE'));
  const instance = activate(store, { allowedDestinations: ['푸른공원'], windowStart: '16:00', windowEnd: '16:20', connectionLabel: 'DEMO_ACADEMY_CHANNEL' });
  assert.equal(instance.config.approvalRequired, true); assert.equal(instance.config.connectionLabel, 'DEMO_ACADEMY_CHANNEL');
  const outside = create(store); assert.throws(() => action(store, outside, 'approve'), checkError(422, 'POLICY_BLOCKED'));
  const valid = create(store, '오늘 픽업을 푸른공원으로 변경해주세요. 16:15');
  assert.ok(valid.policyChecks.every((check) => check.passed));
  assert.equal(action(store, valid, 'approve').status, 'approved');
});

test('admin binds different inbound and outbound mock slots, including HTTP preview without URLs', (t) => {
  const { store } = fixture(t); const template = store.getState().templates[0];
  const nodes = structuredClone(template.nodes); nodes[0].connector = 'http-demo'; nodes[6].connector = 'discord-demo';
  store.saveTemplate(editInput(template, { nodes }));
  const instance = activate(store, { sourceConnector: 'http-demo' });
  const request = create(store); assert.equal(request.source.connector, 'http-demo');
  assert.equal(request.instanceId, instance.id);
  const preview = store.getState().notifications[0].payloadPreview;
  assert.equal(preview.connector, 'discord-demo'); assert.equal(preview.networkEnabled, false);
  assert.equal(preview.recipient.type, 'placeholder'); assert.equal(preview.recipient.id, instance.config.connectionLabel); assert.equal(request.source.connectionLabel, instance.config.connectionLabel);
  const httpPreview = buildMockNotificationPayload({ connector: 'http-demo', requestId: request.id, status: 'pending', version: 1, title: '테스트', body: '가상 안내' });
  assert.equal(httpPreview.payload.destination, 'LOCAL_FIXTURE_ONLY'); assert.equal(httpPreview.payload.url, undefined);
  assert.equal(httpPreview.deliveryStatus, 'preview-only');
  assert.throws(() => normalizeDemoInbound({ connector: 'http-demo', message: SAMPLE_MESSAGE, url: 'https://example.invalid' }), { code: 'LIVE_CONNECTOR_INPUT_REJECTED' });
});

test('run trace reflects actual approval wait, dispatch wait, failure, and preview-only notification', (t) => {
  const { store } = fixture(t); let request = create(store);
  assert.equal(request.trace.length, 7); assert.equal(request.trace.find((n) => n.nodeId === 'approval').status, 'waiting');
  assert.equal(request.trace.find((n) => n.nodeId === 'dispatch').status, 'not-started');
  request = action(store, request, 'approve'); request = action(store, request, 'dispatch');
  assert.equal(request.trace.find((n) => n.nodeId === 'approval').status, 'completed');
  assert.equal(request.trace.find((n) => n.nodeId === 'acknowledge').status, 'waiting');
  request = action(store, request, 'acknowledge', { outcome: 'failed', reason: '가상 실패' });
  assert.equal(request.trace.find((n) => n.nodeId === 'acknowledge').status, 'failed');
  assert.equal(request.trace.find((n) => n.nodeId === 'notify').status, 'preview-only');
  assert.equal(request.trace.find((n) => n.nodeId === 'notify').output.deliveredExternally, false);
});

test('activation idempotency survives restart and old schema gains catalog without activating anything', (t) => {
  const { store, directory } = fixture(t);
  const config = activation(store, { idempotencyKey: 'activate-once' });
  const first = store.activateInstance(config); const second = createWorkflow({ dataDir: directory }).activateInstance(config);
  assert.equal(second.replayed, true); assert.equal(second.instance.id, first.instance.id);
  const path = join(directory, 'store.json'); const legacy = JSON.parse(readFileSync(path, 'utf8'));
  legacy.schemaVersion = 1; delete legacy.templates; delete legacy.instances;
  writeFileSync(path, JSON.stringify(legacy));
  const migrated = createWorkflow({ dataDir: directory });
  assert.equal(migrated.getState().templates.length, 3); assert.equal(migrated.getState().instances.length, 0);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).schemaVersion, 2);
});

test('HTTP catalog edit and activation expose snapshots and reject unsupported template routes', async (t) => {
  const { base, post } = await httpFixture(t);
  const state = await (await fetch(base + '/api/state')).json(); const template = state.templates[0];
  const edited = await post('/api/templates/pickup-change', editInput(template, { title: '가상 학원용 워크플로' }));
  assert.equal(edited.status, 200); assert.equal(edited.body.template.version, 2);
  const activated = await post('/api/instances', { templateId: 'pickup-change', templateVersion: 2, name: '가상 고객 설정', sourceConnector: 'slack-demo', allowedDestinations: ['한빛도서관'], windowStart: '16:00', windowEnd: '16:30', connectionLabel: 'DEMO_CLIENT_CHANNEL' });
  assert.equal(activated.status, 201); assert.equal(activated.body.instance.templateSnapshot.title, '가상 학원용 워크플로');
  const created = await post('/api/requests', { ...input(), instanceId: activated.body.instance.id });
  assert.equal(created.status, 201); assert.equal(created.body.request.templateVersion, 2);
  assert.equal(created.body.request.trace.length, 7);
  const unsupported = await post('/api/templates/arrival-notice', editInput(template)); assert.equal(unsupported.status, 404);
});

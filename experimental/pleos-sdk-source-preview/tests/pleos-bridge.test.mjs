import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPleosBridge, validateRoute } from '../pleos-bridge.mjs';
import { createWorkflow, SAMPLE_MESSAGE, DESTINATIONS } from '../../../workflow.mjs';
import { createServer } from '../contract-server.mjs';
const code = value => error => error.code === value;
function setup(t, enabled = true) {
  const dataDir = mkdtempSync(join(tmpdir(), 'mobflow-sdk-')); t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const workflow = createWorkflow({ dataDir }); const template = workflow.getState().templates[0];
  const instance = workflow.activateInstance({ templateId: template.id, templateVersion: template.version, name: 'SDK fixture', sourceConnector: template.nodes[0].connector, allowedDestinations: [...DESTINATIONS], windowStart: '15:00', windowEnd: '16:30' }).instance;
  let request = workflow.createRequest({ instanceId: instance.id, message: SAMPLE_MESSAGE }).request;
  let time = 1000;
  const bridge = createPleosBridge({ dataDir, workflow, enabled, clock: () => time });
  return { dataDir, workflow, bridge, get request() { return request; }, advance: ms => { time += ms; }, approve: () => { request = workflow.transition(request.id, 'approve', { expectedVersion: request.version }).request; }, enqueue: (key = 'sdk-1') => bridge.enqueue({ requestId: request.id, expectedVersion: request.version, idempotencyKey: key }), claim: () => bridge.claim({ clientId: 'mobflow-pleos-emulator', runtime: 'android-emulator' }).job };
}
function reporter(bridge, job) { let seq = 0; return (type, payload = {}) => bridge.report(job.id, { attemptId: job.attemptId, sequence: ++seq, type, payload }); }
const xy = ({ latitude, longitude }) => ({ latitude, longitude });
test('SDK bridge disabled by default and no approval bypass', t => {
  const f = setup(t, false); f.approve(); assert.throws(() => f.enqueue(), code('BRIDGE_DISABLED'));
  const g = setup(t); assert.throws(() => g.enqueue(), code('APPROVAL_REQUIRED'));
});
test('one destination plus two waypoint fixture, no real child coordinates', t => {
  const f = setup(t); f.approve(); const { job } = f.enqueue();
  assert.equal(job.route.waypoints.length, 2); assert.equal(job.mode, 'emulator-only');
  assert.equal(job.route.waypoints[0].poiName, 'MOBFLOW TEST B'); assert.equal(job.vehicleVerified, false); assert.equal(job.routeApplied, false);
  assert.match(job.coordinateSource, /not-child/); assert.equal(job.attemptId, undefined);
});
test('waypoint overflow and invalid coordinates fail instead of truncating', () => {
  const p = { latitude: 37, longitude: 127 };
  assert.throws(() => validateRoute({ destination: p, waypoints: [p, p, p] }), code('WAYPOINT_LIMIT'));
  assert.throws(() => validateRoute({ destination: { latitude: 127, longitude: 37 }, waypoints: [] }), code('INVALID_COORDINATES'));
  assert.throws(() => validateRoute({ destination: { latitude: NaN, longitude: 37 }, waypoints: [] }), code('INVALID_COORDINATES'));
});
test('queue idempotency and request uniqueness prevent duplicate route attempt', t => {
  const f = setup(t); f.approve(); const first = f.enqueue(); assert.equal(f.enqueue().job.id, first.job.id); assert.equal(f.enqueue().replayed, true);
  assert.throws(() => f.enqueue('different'), code('BRIDGE_BUSY'));
  f.bridge.cancel(first.job.id); assert.throws(() => f.enqueue('new-key'), code('ALREADY_SUBMITTED'));
});
test('stale approved version cannot enqueue', t => {
  const f = setup(t); f.approve(); assert.throws(() => f.bridge.enqueue({ requestId: f.request.id, expectedVersion: 1, idempotencyKey: 'stale' }), code('STALE_APPROVAL'));
});
test('claim is single delivery, no lease expiry redispatch', t => {
  const f = setup(t); f.approve(); f.enqueue(); const job = f.claim(); assert.ok(job.attemptId); assert.equal(f.claim(), null);
  f.advance(120001); assert.equal(f.bridge.getState().jobs[0].status, 'uncertain'); assert.equal(f.claim(), null);
});
test('queued job expires without SDK call', t => {
  const f = setup(t); f.approve(); f.enqueue(); f.advance(120001); assert.equal(f.bridge.getState().jobs[0].status, 'expired'); assert.equal(f.claim(), null);
});
test('claim rechecks approval instead of using stale grant', t => {
  const f = setup(t); f.approve(); f.enqueue(); f.workflow.transition(f.request.id, 'reject', { expectedVersion: f.request.version, reason: 'changed mind' });
  assert.throws(() => f.claim(), code('APPROVAL_REQUIRED'));
});
test('SDK request return and route-search event never mean applied', t => {
  const f = setup(t); f.approve(); f.enqueue(); const job = f.claim(); const report = reporter(f.bridge, job);
  assert.equal(report('sdk-requested').job.status, 'request-sent');
  assert.equal(report('route-started').job.status, 'searching');
  const j = report('routing-completed').job; assert.equal(j.status, 'awaiting-readback'); assert.equal(j.routeApplied, false);
  assert.equal(f.workflow.getState().route.version, 1);
});
test('matching readback only after completion observes emulator result, never original route/boarding/handover', t => {
  const f = setup(t); f.approve(); f.enqueue(); const j = f.claim(); const report = reporter(f.bridge, j);
  report('sdk-requested'); report('destination', xy(j.route.destination)); report('waypoints', j.route.waypoints.map(xy));
  assert.equal(f.bridge.getState().jobs[0].status, 'request-sent');
  report('routing-completed'); report('destination', xy(j.route.destination));
  const result = report('waypoints', j.route.waypoints.map(xy)).job;
  assert.equal(result.status, 'readback-matched'); assert.equal(result.causalityVerified, false); assert.equal(result.routeApplied, false);
  assert.equal(result.boardingConfirmed, false); assert.equal(result.handoverConfirmed, false);
  assert.equal(f.workflow.getState().route.stops[0].label, '새봄학교 정문');
  assert.equal(f.workflow.getState().requests[0].status, 'approved');
});
test('mismatched destination, missing or reversed waypoint order cannot match', t => {
  const f = setup(t); f.approve(); f.enqueue(); const j = f.claim(); const report = reporter(f.bridge, j);
  report('sdk-requested'); report('routing-completed'); report('destination', { latitude: 1, longitude: 1 }); report('waypoints', j.route.waypoints.map(xy));
  assert.equal(f.bridge.getState().jobs[0].status, 'awaiting-readback');
  report('waypoints', []); report('destination', xy(j.route.destination)); assert.equal(f.bridge.getState().jobs[0].status, 'awaiting-readback');
  report('waypoints', j.route.waypoints.map(xy).reverse()); assert.equal(f.bridge.getState().jobs[0].status, 'awaiting-readback');
});
test('events strictly correlate attempt, sequence, payload and replay idempotently', t => {
  const f = setup(t); f.approve(); f.enqueue(); const j = f.claim();
  const event = { attemptId: j.attemptId, sequence: 1, type: 'sdk-requested', payload: {} };
  assert.throws(() => f.bridge.report(j.id, { ...event, attemptId: 'bad' }), code('ATTEMPT_MISMATCH'));
  assert.throws(() => f.bridge.report(j.id, { ...event, sequence: 2 }), code('EVENT_GAP'));
  f.bridge.report(j.id, event); assert.equal(f.bridge.report(j.id, event).replayed, true);
  assert.throws(() => f.bridge.report(j.id, { ...event, type: 'route-started' }), code('EVENT_CONFLICT'));
  assert.throws(() => f.bridge.report(j.id, { ...event, sequence: 2 }), code('DUPLICATE_SDK_CALL'));
});
test('only schema fields are accepted, SDK error only receives bounded code', t => {
  const f = setup(t); f.approve(); f.enqueue(); const j = f.claim();
  assert.throws(() => f.bridge.report(j.id, { attemptId: j.attemptId, sequence: 1, type: 'error', payload: { code: 'ERROR', privateLocation: 'no' } }), code('INVALID_BRIDGE_INPUT'));
  assert.throws(() => f.bridge.claim({ clientId: 'vehicle', runtime: 'real-car' }), code('EMULATOR_ONLY'));
});
test('terminal errors block late success and do not change original route', t => {
  const f = setup(t); f.approve(); f.enqueue(); const j = f.claim(); const report = reporter(f.bridge, j);
  report('sdk-requested'); report('error', { code: 'PERMISSION_DENIED' });
  const late = report('routing-completed'); assert.equal(late.eventIgnored, true); assert.equal(late.job.status, 'failed'); assert.equal(late.job.lastSequence, 2); assert.equal(f.workflow.getState().route.version, 1);
});
test('cancel after claim refuses to pretend SDK cancellation', t => {
  const f = setup(t); f.approve(); f.enqueue(); const j = f.claim(); assert.throws(() => f.bridge.cancel(j.id), code('CANCEL_UNSAFE'));
});
test('server restart quarantines in-flight attempt instead of redispatching', t => {
  const f = setup(t); f.approve(); f.enqueue(); f.claim();
  const recovered = createPleosBridge({ dataDir: f.dataDir, workflow: f.workflow, enabled: true, clock: () => 1000 });
  assert.equal(recovered.getState().jobs[0].status, 'uncertain'); assert.equal(recovered.claim({ clientId: 'mobflow-pleos-emulator', runtime: 'android-emulator' }).job, null);
});
test('emulator location is labeled and never copied to customer sharing or real GPS', t => {
  const f = setup(t); f.approve(); f.enqueue(); const j = f.claim(); const report = reporter(f.bridge, j);
  report('sdk-requested'); const result = report('location', { latitude: 37.5, longitude: 127.0 }).job;
  assert.equal(result.emulatorLocation.source, 'emulated-not-real-gps'); assert.equal(result.vehicleVerified, false);
});
test('HTTP integration exposes SDK state but defaults off; DNS-rebinding and cross-origin rejected', async t => {
  const f = setup(t); const server = createServer({ dataDir: f.dataDir }); await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => new Promise(r => server.close(r)));
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await (await fetch(url + '/api/pleos/state')).json()).enabled, false);
  assert.equal(await new Promise(resolve => { http.get(url + '/api/pleos/state', { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); }); }), 403);
  assert.equal((await fetch(url + '/api/pleos/claim', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}' })).status, 403);
});
test('HTTP rejects mock dispatch and withdrawal while SDK job active', async t => {
  const f = setup(t); f.approve(); const server = createServer({ dataDir: f.dataDir, pleosEnabled: true }); await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => new Promise(r => server.close(r)));
  const url = `http://127.0.0.1:${server.address().port}`; server.pleos.enqueue({ requestId: f.request.id, expectedVersion: f.request.version, idempotencyKey: 'http-test' });
  for (const action of ['dispatch', 'reject']) {
    const response = await fetch(`${url}/api/requests/${f.request.id}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: f.request.version, reason: 'test' }) });
    assert.equal(response.status, 409); assert.equal((await response.json()).error.code, 'SDK_JOB_ACTIVE');
  }
});
test('delayed HTTP body cannot pass approval guard before a queued SDK job', async t => {
  const f = setup(t); f.approve(); const server = createServer({ dataDir: f.dataDir, pleosEnabled: true }); await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => new Promise(r => server.close(r)));
  const body = JSON.stringify({ expectedVersion: f.request.version });
  let complete;
  const response = new Promise(resolve => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: `/api/requests/${f.request.id}/dispatch`, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => { let text = ''; res.on('data', x => text += x); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) })); });
    req.write(body.slice(0, 1)); complete = () => req.end(body.slice(1));
  });
  await new Promise(r => setTimeout(r, 30));
  server.pleos.enqueue({ requestId: f.request.id, expectedVersion: f.request.version, idempotencyKey: 'interleaved' });
  complete(); const result = await response; assert.equal(result.status, 409); assert.equal(result.body.error.code, 'SDK_JOB_ACTIVE'); assert.equal(server.workflow.getState().requests[0].status, 'approved');
});
test('restart/timeout terminal acknowledgement drains native outbox without accepting late success', t => {
  const f = setup(t); f.approve(); f.enqueue(); const j = f.claim(); f.advance(120001);
  const result = f.bridge.report(j.id, { attemptId: j.attemptId, sequence: 1, type: 'sdk-requested', payload: {} });
  assert.equal(result.terminal, true); assert.equal(result.eventIgnored, true); assert.equal(result.job.status, 'uncertain'); assert.equal(result.job.events.length, 0);
});

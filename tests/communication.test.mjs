import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCommunication, COMMUNICATION_TEMPLATE, COMMUNICATION_PRESETS, LOCATION_FRESHNESS_MS } from '../communication.mjs';
import { createServer } from '../server.mjs';
import { createWorkflow } from '../workflow.mjs';

const checkError = (status, code) => (error) => error.status === status && error.code === code;
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'mobflow-communication-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let now = Date.parse('2026-10-24T05:00:00Z');
  const clock = () => now;
  const store = createCommunication({ dataDir: directory, clock });
  return { directory, store, clock, advanceClock: (milliseconds) => { now += milliseconds; } };
}
const configuration = (store, changes = {}) => store.saveConfiguration({ templateVersion: 1, role: 'school', ...changes }).configuration;
const create = (store, config) => store.createRun({ configurationId: config.id, configurationVersion: config.version }).run;
const move = (store, run, action, extra = {}) => store.transition(run.id, action, { expectedVersion: run.version, ...extra }).run;
const customer = (store, run) => store.getCustomerLink(run.link.token, run.customer.id);
function noLocation(view) {
  for (const field of ['position', 'remainingDistanceMeters', 'etaMinutes']) assert.equal(Object.hasOwn(view, field), false, `${field} must be absent, not merely null`);
}
function finish(store, run) {
  for (const step of ['depart', 'advance', 'advance', 'complete']) run = move(store, run, step);
  return run;
}

test('communication template exposes a bounded versioned fixed contract and safe defaults', (t) => {
  const { store } = fixture(t); const state = store.getState();
  assert.equal(state.template.id, 'customer-communication'); assert.equal(state.template.version, 1);
  assert.equal(state.template.title, '이동·도착 고객 안내'); assert.equal(state.template.editable, false);
  assert.equal(state.template.capabilities.arbitraryGraphs, false);
  assert.deepEqual(state.template.capabilities.sharing.stopOn, ['completed', 'stopped', 'expired']);
  assert.deepEqual(state.presets.map((preset) => preset.id), ['school', 'instructor', 'delivery']);
  const config = configuration(store); assert.equal(config.sharingEnabled, false); assert.equal(config.kakaoEnabled, false);
  assert.deepEqual(config.notifications, { departure: true, approaching: true, arrival: true, completion: true });
  const run = create(store, config); assert.equal(run.sharing.status, 'disabled'); noLocation(customer(store, run));
  assert.equal(run.templateSnapshot.version, 1); assert.equal(state.mode, 'simulation');
});

test('three presets bind only their own fixed fictional recipient and service destination', (t) => {
  const { store } = fixture(t);
  for (const preset of COMMUNICATION_PRESETS) {
    const run = create(store, configuration(store, { role: preset.id }));
    assert.deepEqual(run.customer, preset.customer); assert.equal(run.operatorLabel, preset.operatorLabel);
    assert.deepEqual(run.destination, preset.destination); assert.match(run.customer.name, /가상/);
    assert.equal(customer(store, run).customerName, preset.customer.name);
  }
  assert.equal(store.getState().runs.length, 3);
});

test('configuration validation rejects live credentials, coordinates, recipients and unsupported graph controls', (t) => {
  const { store } = fixture(t);
  for (const changes of [{ token: 'credential' }, { phone: 'recipient' }, { customerId: 'someone' }, { latitude: 37 }, { longitude: 127 }, { coordinates: { x: 5 } }, { webhookUrl: 'https://example.invalid' }, { apiKey: 'key' }, { completionStopsSharing: false }, { nodes: [] }]) {
    assert.throws(() => configuration(store, changes), checkError(400, 'UNSUPPORTED_COMMUNICATION_FIELD'));
  }
  for (const input of [null, [], 'test']) assert.throws(() => store.saveConfiguration(input), checkError(400, 'INVALID_BODY'));
  for (const changes of [{ role: 'arbitrary' }, { kakaoEnabled: 'true' }, { sharingEnabled: 1 }, { showPosition: null }, { showDistance: 'false' }, { showEta: 0 }, { notifications: null }, { notifications: { arrival: 'yes' } }, { notifications: { unknown: true } }, { sharingStart: 'always' }, { ttlMinutes: 4 }, { ttlMinutes: 61 }, { ttlMinutes: 5.5 }, { name: '' }]) assert.throws(() => configuration(store, changes));
  assert.equal(store.getState().configurations.length, 0);
});

test('template, configuration and execution versions reject stale writes', (t) => {
  const { store } = fixture(t);
  assert.throws(() => configuration(store, { templateVersion: 0 }), checkError(409, 'STALE_TEMPLATE'));
  const config = configuration(store);
  assert.throws(() => store.createRun({ configurationId: config.id }), checkError(400, 'CONFIGURATION_VERSION_REQUIRED'));
  assert.throws(() => store.createRun({ configurationId: config.id, configurationVersion: 9 }), checkError(409, 'STALE_CONFIGURATION'));
  assert.throws(() => store.createRun({ configurationId: 'unknown', configurationVersion: 1 }), checkError(404, 'CONFIGURATION_NOT_FOUND'));
  const run = create(store, config);
  assert.throws(() => store.transition(run.id, 'depart', {}), checkError(400, 'EXPECTED_VERSION_REQUIRED'));
  const departed = move(store, run, 'depart');
  assert.throws(() => store.transition(run.id, 'depart', { expectedVersion: run.version }), checkError(409, 'STALE_VERSION'));
  assert.equal(store.getState().runs[0].version, departed.version);
});

test('departure sharing starts only at explicit departure and publishes fictional grid examples', (t) => {
  const { store } = fixture(t); let run = create(store, configuration(store, { sharingEnabled: true, kakaoEnabled: true }));
  let view = customer(store, run); assert.equal(view.sharing.status, 'waiting'); noLocation(view);
  run = move(store, run, 'depart'); view = customer(store, run);
  assert.equal(view.sharing.status, 'active'); assert.equal(view.position.coordinateSystem, 'fictional-grid');
  assert.ok(view.position.x >= 0 && view.position.x <= 100); assert.ok(view.position.y >= 0 && view.position.y <= 100);
  assert.equal(view.remainingDistanceMeters, 2400); assert.equal(view.etaMinutes, 8);
  assert.equal(run.notifications.length, 1); assert.equal(run.notifications[0].stage, 'departure');
  assert.equal(run.notifications[0].link.customerId, run.customer.id);
  assert.ok(!Object.hasOwn(view.position, 'latitude')); assert.ok(!Object.hasOwn(view.position, 'longitude'));
});

test('approaching rule withholds departure location and link then starts at approaching', (t) => {
  const { store } = fixture(t); let run = create(store, configuration(store, { sharingEnabled: true, sharingStart: 'approaching', kakaoEnabled: true }));
  run = move(store, run, 'depart'); assert.equal(run.sharing.status, 'waiting'); noLocation(customer(store, run));
  assert.equal(run.notifications[0].link, undefined);
  run = move(store, run, 'advance'); const view = customer(store, run);
  assert.equal(view.status, 'approaching'); assert.equal(view.sharing.status, 'active');
  assert.equal(view.remainingDistanceMeters, 450); assert.equal(view.etaMinutes, 2);
  assert.equal(run.notifications.find((entry) => entry.stage === 'approaching').link.customerId, run.customer.id);
});

test('sharing off never exposes location or notification links at any stage', (t) => {
  const { store } = fixture(t); let run = create(store, configuration(store, { sharingEnabled: false, kakaoEnabled: true }));
  for (const step of ['depart', 'advance', 'advance', 'complete']) {
    run = move(store, run, step); noLocation(run); noLocation(customer(store, run));
    assert.ok(run.notifications.every((entry) => !Object.hasOwn(entry, 'link')));
  }
  assert.equal(run.notifications.length, 4); assert.equal(run.sharing.status, 'completed');
});

test('each position, distance and ETA field is independently configurable', (t) => {
  const { store } = fixture(t);
  for (let bits = 0; bits < 8; bits++) {
    const flags = { showPosition: Boolean(bits & 1), showDistance: Boolean(bits & 2), showEta: Boolean(bits & 4) };
    let run = create(store, configuration(store, { sharingEnabled: true, ...flags })); run = move(store, run, 'depart');
    const view = customer(store, run);
    assert.equal(Object.hasOwn(view, 'position'), flags.showPosition);
    assert.equal(Object.hasOwn(view, 'remainingDistanceMeters'), flags.showDistance);
    assert.equal(Object.hasOwn(view, 'etaMinutes'), flags.showEta);
  }
});

test('Kakao disabled means zero notification previews but a local link preview still works', (t) => {
  const { store } = fixture(t); let run = create(store, configuration(store, { sharingEnabled: true, kakaoEnabled: false }));
  assert.match(run.link.url, /^\/customer.html\?token=/); run = move(store, run, 'depart');
  assert.equal(customer(store, run).sharing.status, 'active');
  for (const step of ['advance', 'advance', 'complete']) run = move(store, run, step);
  assert.equal(run.notifications.length, 0); assert.equal(store.getState().notifications.length, 0);
});

test('notification flags gate exactly the selected stages and every output is simulated', (t) => {
  const { store } = fixture(t);
  const run = finish(store, create(store, configuration(store, { kakaoEnabled: true, notifications: { departure: false, approaching: true, arrival: false, completion: true } })));
  assert.deepEqual(run.notifications.map((entry) => entry.stage), ['approaching', 'completion']);
  for (const entry of run.notifications) {
    assert.equal(entry.channel, 'kakaotalk-demo'); assert.equal(entry.deliveryStatus, 'simulated'); assert.equal(entry.networkEnabled, false);
    assert.equal(entry.customerId, run.customer.id); assert.equal(entry.runId, run.id);
    assert.equal(entry.type, entry.stage); assert.ok(entry.title); assert.ok(entry.body);
  }
});

test('wrong token, missing recipient and wrong recipient reject identically before revealing state', (t) => {
  const { store, advanceClock } = fixture(t); let run = create(store, configuration(store, { sharingEnabled: true })); run = move(store, run, 'depart');
  for (const [token, customerId] of [[run.link.token, 'demo-delivery-customer-1'], [run.link.token, undefined], ['x'.repeat(43), run.customer.id], ['', run.customer.id]]) {
    assert.throws(() => store.getCustomerLink(token, customerId), checkError(404, 'CUSTOMER_LINK_NOT_FOUND'));
  }
  advanceClock(61 * 60_000);
  assert.throws(() => store.getCustomerLink(run.link.token, 'wrong-recipient'), checkError(404, 'CUSTOMER_LINK_NOT_FOUND'));
});

test('customer response contains only this run and recipient, never itinerary, configuration or other customers', (t) => {
  const { store } = fixture(t); const config = configuration(store, { sharingEnabled: true, kakaoEnabled: true });
  let first = create(store, config); first = finish(store, first);
  let second = create(store, config); second = move(store, second, 'depart');
  const third = create(store, configuration(store, { role: 'delivery', sharingEnabled: true }));
  const view = customer(store, second); const serialized = JSON.stringify(view);
  assert.equal(view.runId, second.id); assert.notEqual(first.link.token, second.link.token);
  assert.ok(!serialized.includes(first.id)); assert.ok(!serialized.includes(third.id)); assert.ok(!serialized.includes(third.customer.id));
  for (const field of ['runs', 'customers', 'configurationId', 'configSnapshot', 'templateSnapshot', 'route', 'stops', 'itinerary', 'token', 'events', 'link']) assert.equal(Object.hasOwn(view, field), false);
  assert.ok(view.notifications.every((entry) => entry.runId === second.id && entry.customerId === second.customer.id && !entry.link));
  assert.throws(() => store.getCustomerLink(second.link.token, third.customer.id), checkError(404, 'CUSTOMER_LINK_NOT_FOUND'));
  assert.equal(customer(store, first).status, 'completed');
});

test('arrival exposes zero distance and ETA but completion immediately ends all location disclosure', (t) => {
  const { store } = fixture(t); let run = create(store, configuration(store, { sharingEnabled: true, kakaoEnabled: true }));
  for (const step of ['depart', 'advance', 'advance']) run = move(store, run, step);
  let view = customer(store, run); assert.equal(view.status, 'arrived'); assert.equal(view.remainingDistanceMeters, 0); assert.equal(view.etaMinutes, 0);
  run = move(store, run, 'complete'); view = customer(store, run);
  assert.equal(view.sharing.status, 'completed'); noLocation(view); noLocation(run);
  assert.ok(run.notifications.every((entry) => !entry.link)); assert.equal(run.notifications.at(-1).stage, 'completion');
  assert.throws(() => move(store, run, 'depart'), checkError(409, 'RUN_CLOSED'));
  assert.throws(() => move(store, run, 'complete'), checkError(409, 'RUN_CLOSED'));
});

test('manual stop revokes sharing immediately and blocks resumption or completion notices', (t) => {
  const { store } = fixture(t); let run = create(store, configuration(store, { sharingEnabled: true, kakaoEnabled: true }));
  run = move(store, run, 'depart'); run = move(store, run, 'stop');
  assert.equal(run.status, 'stopped'); assert.equal(customer(store, run).sharing.status, 'stopped'); noLocation(customer(store, run));
  assert.deepEqual(run.notifications.map((entry) => entry.stage), ['departure']); assert.ok(run.notifications.every((entry) => !entry.link));
  assert.throws(() => move(store, run, 'advance'), checkError(409, 'RUN_CLOSED'));
});

test('read-only GET semantics enforce wall-clock TTL with no transition and no persistence write', (t) => {
  const { store, advanceClock } = fixture(t); let run = create(store, configuration(store, { sharingEnabled: true, kakaoEnabled: true, ttlMinutes: 5 }));
  run = move(store, run, 'depart'); const bytes = readFileSync(store.filename, 'utf8');
  advanceClock(5 * 60_000); const view = customer(store, run);
  assert.equal(view.status, 'expired'); assert.equal(view.sharing.status, 'expired'); noLocation(view);
  assert.equal(store.getState().runs[0].status, 'expired'); assert.ok(store.getState().notifications.every((entry) => !entry.link));
  assert.equal(readFileSync(store.filename, 'utf8'), bytes);
  assert.throws(() => move(store, run, 'advance'), checkError(409, 'RUN_CLOSED'));
  assert.equal(readFileSync(store.filename, 'utf8'), bytes);
});

test('TTL starts at run creation, including when sharing has not started', (t) => {
  const { store, advanceClock } = fixture(t); const config = configuration(store, { sharingEnabled: true, sharingStart: 'approaching', ttlMinutes: 5 });
  const run = create(store, config); advanceClock(5 * 60_000);
  assert.equal(customer(store, run).status, 'expired'); noLocation(customer(store, run));
  assert.throws(() => move(store, run, 'depart'), checkError(409, 'RUN_CLOSED'));
  const newer = create(store, config); assert.notEqual(newer.id, run.id); assert.notEqual(newer.link.token, run.link.token);
});

test('explicit stale location masks position, distance and ETA until a fresh explicit simulation step', (t) => {
  const { store } = fixture(t); let run = create(store, configuration(store, { sharingEnabled: true, kakaoEnabled: true }));
  run = move(store, run, 'depart'); run = move(store, run, 'stale');
  assert.equal(run.status, 'departed'); assert.equal(run.sharing.status, 'stale'); noLocation(customer(store, run));
  assert.ok(run.notifications.every((entry) => !entry.link));
  run = move(store, run, 'advance'); assert.equal(customer(store, run).sharing.status, 'active'); assert.equal(customer(store, run).etaMinutes, 2);
  assert.deepEqual(run.notifications.map((entry) => entry.stage), ['departure', 'approaching']);
});

test('wall-clock freshness timeout masks old location without mutation or advancing a stage', (t) => {
  const { store, advanceClock } = fixture(t); let run = create(store, configuration(store, { sharingEnabled: true })); run = move(store, run, 'depart');
  advanceClock(LOCATION_FRESHNESS_MS - 1); assert.equal(customer(store, run).sharing.status, 'active');
  advanceClock(1); const view = customer(store, run); assert.equal(view.sharing.status, 'stale'); assert.equal(view.status, 'departed'); noLocation(view);
  run = move(store, run, 'advance'); assert.equal(customer(store, run).sharing.status, 'active');
});

test('saved configuration and template snapshots are immutable for a running workflow', (t) => {
  const { store } = fixture(t); const config = configuration(store, { sharingEnabled: true, sharingStart: 'departure', showEta: true });
  let run = create(store, config); configuration(store, { sharingEnabled: false, sharingStart: 'approaching', showEta: false });
  config.sharingEnabled = false; config.templateSnapshot.version = 999; run.configSnapshot.showEta = false;
  run = move(store, run, 'depart');
  assert.equal(run.configSnapshot.sharingEnabled, true); assert.equal(run.configSnapshot.sharingStart, 'departure');
  assert.equal(run.configSnapshot.showEta, true); assert.equal(run.templateSnapshot.version, 1);
  assert.equal(customer(store, run).etaMinutes, 8); assert.equal(store.getState().configurations.length, 2);
  const state = store.getState(); state.runs[0].link.token = 'modified'; state.template.defaults.sharingEnabled = true;
  assert.equal(customer(store, run).sharing.status, 'active'); assert.equal(store.getState().template.defaults.sharingEnabled, false);
  assert.equal(COMMUNICATION_TEMPLATE.defaults.sharingEnabled, false);
});

test('duplicate configuration and in-flight run creation reuse identities without duplicate events', (t) => {
  const { store } = fixture(t);
  const first = store.saveConfiguration({ templateVersion: 1, role: 'school' });
  const second = store.saveConfiguration({ role: 'school', templateVersion: 1, sharingEnabled: false });
  assert.equal(second.duplicate, true); assert.equal(second.configuration.id, first.configuration.id);
  const payload = { configurationId: first.configuration.id, configurationVersion: 1 };
  const one = store.createRun(payload); const two = store.createRun(payload);
  assert.equal(two.duplicate, true); assert.equal(two.run.id, one.run.id); assert.equal(two.run.events.length, 1);
  assert.equal(store.getState().configurations.length, 1); assert.equal(store.getState().runs.length, 1);
  const stopped = move(store, one.run, 'stop'); assert.equal(stopped.status, 'stopped');
  const three = store.createRun(payload); assert.notEqual(three.run.id, one.run.id); assert.equal(three.duplicate, false);
});

test('durable idempotency replays safely, rejects conflicts and never duplicates stage notifications', (t) => {
  const { store, directory, clock } = fixture(t);
  const configPayload = { templateVersion: 1, role: 'school', kakaoEnabled: true, sharingEnabled: true, idempotencyKey: '__proto__' };
  const config = store.saveConfiguration(configPayload).configuration;
  assert.equal(store.saveConfiguration(configPayload).replayed, true);
  assert.throws(() => store.saveConfiguration({ ...configPayload, role: 'delivery' }), checkError(409, 'IDEMPOTENCY_CONFLICT'));
  const runPayload = { configurationId: config.id, configurationVersion: 1, idempotencyKey: 'create-run-1' };
  let run = store.createRun(runPayload).run; assert.equal(store.createRun(runPayload).replayed, true);
  const bodies = [];
  for (const action of ['depart', 'advance', 'advance', 'complete']) {
    const body = { expectedVersion: run.version, idempotencyKey: `stage-${run.version}` }; bodies.push({ action, body });
    run = store.transition(run.id, action, body).run;
    assert.equal(store.transition(run.id, action, body).replayed, true);
  }
  assert.equal(run.notifications.length, 4); assert.equal(new Set(run.notifications.map((entry) => entry.stage)).size, 4);
  const restarted = createCommunication({ dataDir: directory, clock });
  assert.equal(restarted.saveConfiguration(configPayload).replayed, true);
  assert.equal(restarted.createRun(runPayload).run.status, 'completed');
  for (const { action, body } of bodies) {
    const replay = restarted.transition(run.id, action, body); assert.equal(replay.replayed, true); assert.equal(replay.run.status, 'completed'); noLocation(replay.run);
  }
  assert.equal(restarted.getState().notifications.length, 4); assert.equal(restarted.getState().runs[0].events.length, 5);
  assert.throws(() => restarted.transition(run.id, 'stop', bodies[0].body), checkError(409, 'IDEMPOTENCY_CONFLICT'));
});

test('idempotency replay after time expiry cannot return an old active location snapshot', (t) => {
  const { store, advanceClock } = fixture(t); const config = configuration(store, { sharingEnabled: true, ttlMinutes: 5 });
  const payload = { configurationId: config.id, configurationVersion: 1, idempotencyKey: 'create' };
  let run = store.createRun(payload).run; const departure = { expectedVersion: 1, idempotencyKey: 'depart' };
  run = store.transition(run.id, 'depart', departure).run; assert.equal(run.sharing.status, 'active');
  advanceClock(5 * 60_000);
  for (const result of [store.createRun(payload), store.transition(run.id, 'depart', departure)]) {
    assert.equal(result.replayed, true); assert.equal(result.run.status, 'expired'); noLocation(result.run);
  }
});

test('invalid and repeated actions cannot skip stages, revive runs or add notifications', (t) => {
  const { store } = fixture(t); let run = create(store, configuration(store, { sharingEnabled: true, kakaoEnabled: true }));
  for (const action of ['advance', 'complete', 'stale']) assert.throws(() => move(store, run, action), checkError(409, 'INVALID_TRANSITION'));
  assert.throws(() => store.transition(run.id, 'arrive', { expectedVersion: run.version }), checkError(400, 'INVALID_ACTION'));
  assert.throws(() => store.transition(run.id, 'depart', { expectedVersion: run.version, position: { x: 0, y: 0 } }), checkError(400, 'UNSUPPORTED_COMMUNICATION_FIELD'));
  run = move(store, run, 'depart'); assert.throws(() => move(store, run, 'depart'), checkError(409, 'INVALID_TRANSITION'));
  assert.throws(() => move(store, run, 'complete'), checkError(409, 'INVALID_TRANSITION'));
  run = move(store, run, 'advance'); run = move(store, run, 'advance');
  assert.throws(() => move(store, run, 'advance'), checkError(409, 'INVALID_TRANSITION'));
  run = move(store, run, 'complete'); assert.equal(run.notifications.length, 4); assert.equal(run.events.length, 5);
  assert.throws(() => move(store, run, 'complete'), checkError(409, 'RUN_CLOSED'));
});

test('refresh and process restart restore snapshots, tokens, stale state and exactly-once notifications', (t) => {
  const { store, directory, clock } = fixture(t); let run = create(store, configuration(store, { sharingEnabled: true, kakaoEnabled: true }));
  run = move(store, run, 'depart'); run = move(store, run, 'stale');
  let restarted = createCommunication({ dataDir: directory, clock }); assert.deepEqual(restarted.getState(), store.getState());
  assert.equal(customer(restarted, run).sharing.status, 'stale'); noLocation(customer(restarted, run));
  for (const action of ['advance', 'advance', 'complete']) run = move(restarted, run, action);
  restarted = createCommunication({ dataDir: directory, clock }); assert.equal(customer(restarted, run).status, 'completed');
  assert.equal(restarted.getState().notifications.length, 4); noLocation(customer(restarted, run));
});

test('communication persistence is isolated from the original pickup workflow store', (t) => {
  const { store, directory } = fixture(t); const workflow = createWorkflow({ dataDir: directory });
  const before = readFileSync(workflow.filename, 'utf8');
  finish(store, create(store, configuration(store, { sharingEnabled: true, kakaoEnabled: true })));
  assert.equal(readFileSync(workflow.filename, 'utf8'), before);
  assert.equal(workflow.getState().requests.length, 0); assert.equal(workflow.getState().route.stops.length, 3);
  assert.equal(workflow.getState().route.boardingStatus, 'not_confirmed');
});

test('corrupted or malformed communication storage fails closed without overwriting the original', (t) => {
  const { store, directory, clock } = fixture(t);
  for (const contents of ['{broken', JSON.stringify({ schemaVersion: 50, configurations: [], runs: [], idempotency: {} }), JSON.stringify({ schemaVersion: 1, configurations: [], runs: [{}], idempotency: {} })]) {
    writeFileSync(store.filename, contents); assert.throws(() => createCommunication({ dataDir: directory, clock }));
    assert.equal(readFileSync(store.filename, 'utf8'), contents);
  }
});

async function httpFixture(t) {
  const context = fixture(t); const server = createServer({ dataDir: context.directory, clock: context.clock });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body, headers = {}) => { const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };
  return { ...context, server, base, post };
}

test('communication HTTP API runs complete simulated flow with scoped no-store customer response', async (t) => {
  const { base, post } = await httpFixture(t);
  const state = await (await fetch(base + '/api/communication')).json(); assert.equal(state.template.version, 1);
  let result = await post('/api/communication/configurations', { templateVersion: 1, role: 'instructor', kakaoEnabled: true, sharingEnabled: true, sharingStart: 'approaching' });
  assert.equal(result.status, 201); const config = result.body.configuration;
  const payload = { configurationId: config.id, configurationVersion: config.version };
  result = await post('/api/communication/runs', payload); assert.equal(result.status, 201); let run = result.body.run;
  assert.equal((await post('/api/communication/runs', payload)).status, 200);
  for (const action of ['depart', 'advance', 'advance', 'complete']) {
    result = await post(`/api/communication/runs/${run.id}/${action}`, { expectedVersion: run.version });
    assert.equal(result.status, 200); run = result.body.run;
    const response = await fetch(base + `/api/customer-links/${run.link.token}?customerId=${run.customer.id}`);
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    const view = await response.json(); assert.equal(view.runId, run.id);
    if (['departed', 'completed'].includes(run.status)) noLocation(view);
  }
  assert.equal(run.notifications.length, 4); assert.equal(run.status, 'completed');
  const oldState = await (await fetch(base + '/api/state')).json(); assert.equal(oldState.requests.length, 0);
});

test('HTTP rejects foreign mutations, bad scope, recipient overrides and stale versions', async (t) => {
  const { base, post } = await httpFixture(t);
  const configInput = { templateVersion: 1, role: 'school', sharingEnabled: true };
  assert.equal((await post('/api/communication/configurations', configInput, { Origin: 'https://untrusted.example' })).status, 403);
  const { configuration: config } = (await post('/api/communication/configurations', configInput)).body;
  const input = { configurationId: config.id, configurationVersion: 1 };
  assert.equal((await post('/api/communication/runs', { ...input, customerId: 'real-person' })).status, 400);
  const { run } = (await post('/api/communication/runs', input)).body;
  const root = `/api/customer-links/${run.link.token}`;
  for (const suffix of ['', '?customerId=wrong', `?customerId=${run.customer.id}&runId=other`, `?customerId=${run.customer.id}&customerId=wrong`]) {
    const response = await fetch(base + root + suffix); assert.equal(response.status, 404);
    const body = await response.json(); assert.equal(body.error.code, 'CUSTOMER_LINK_NOT_FOUND');
    assert.ok(!JSON.stringify(body).includes(run.customer.name));
  }
  assert.equal((await post(`/api/communication/runs/${run.id}/depart`, { expectedVersion: run.version })).status, 200);
  const result = await post(`/api/communication/runs/${run.id}/advance`, { expectedVersion: run.version });
  assert.equal(result.status, 409); assert.equal(result.body.error.code, 'STALE_VERSION');
});

test('HTTP customer-link GET expires with wall time while server receives no mutation', async (t) => {
  const { base, post, advanceClock } = await httpFixture(t);
  const config = (await post('/api/communication/configurations', { templateVersion: 1, role: 'delivery', sharingEnabled: true, ttlMinutes: 5 })).body.configuration;
  let run = (await post('/api/communication/runs', { configurationId: config.id, configurationVersion: 1 })).body.run;
  run = (await post(`/api/communication/runs/${run.id}/depart`, { expectedVersion: run.version })).body.run;
  const link = base + `/api/customer-links/${run.link.token}?customerId=${run.customer.id}`;
  assert.equal((await (await fetch(link)).json()).sharing.status, 'active');
  advanceClock(5 * 60_000);
  const response = await fetch(link); assert.equal(response.status, 200);
  const view = await response.json(); assert.equal(view.status, 'expired'); noLocation(view);
});

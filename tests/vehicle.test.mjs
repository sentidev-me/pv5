import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCommunication, LOCATION_FRESHNESS_MS } from '../communication.mjs';
import { createServer } from '../server.mjs';

const ACTIONS = ['vehicle-motion', 'vehicle-ux', 'vehicle-depart', 'vehicle-approach', 'vehicle-arrive', 'vehicle-complete'];
const errorIs = (status, code) => (error) => error.status === status && error.code === code;
const move = (store, run, action, extra = {}) => store.transition(run.id, action, { expectedVersion: run.version, ...extra }).run;
const view = (store, run) => store.getCustomerLink(run.link.token, run.customer.id);

function fixture(t, changes = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'mobflow-vehicle-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let now = Date.parse('2026-10-24T06:00:00Z');
  const clock = () => now;
  const store = createCommunication({ dataDir: directory, clock });
  const configuration = store.saveConfiguration({ templateVersion: 1, role: 'school', sharingEnabled: true, kakaoEnabled: true, ...changes }).configuration;
  const run = store.createRun({ configurationId: configuration.id, configurationVersion: configuration.version }).run;
  return { directory, clock, store, configuration, run, advanceClock: (milliseconds) => { now += milliseconds; } };
}

function noLocation(value) {
  for (const key of ['position', 'remainingDistanceMeters', 'etaMinutes']) assert.equal(Object.hasOwn(value, key), false, `${key} must be absent`);
}

function noCompletion(run) {
  assert.notEqual(run.status, 'completed');
  assert.equal(Object.hasOwn(run, 'completedAt'), false);
  assert.equal(Object.hasOwn(run, 'completionEvidence'), false);
  assert.equal(run.notifications.some((notice) => notice.stage === 'completion'), false);
}

function assertUnchanged(store, action, expectedError) {
  const state = store.getState();
  const bytes = readFileSync(store.filename, 'utf8');
  assert.throws(action, expectedError);
  assert.deepEqual(store.getState(), state);
  assert.equal(readFileSync(store.filename, 'utf8'), bytes);
}

function prepare(store, run) {
  run = move(store, run, 'vehicle-motion', { motion: 'parked' });
  return move(store, run, 'vehicle-ux', { restriction: 'allowed' });
}

function arrive(store, run) {
  run = prepare(store, run);
  run = move(store, run, 'vehicle-depart');
  run = move(store, run, 'vehicle-approach');
  run = move(store, run, 'vehicle-motion', { motion: 'parked' });
  return move(store, run, 'vehicle-arrive');
}

test('vehicle actions treat an absent stored motion state as unknown and lock critical actions', (t) => {
  const { store, run } = fixture(t);
  assert.equal(Object.hasOwn(run, 'vehicleSimulation'), false);
  for (const action of ['vehicle-depart', 'vehicle-arrive', 'vehicle-complete']) {
    assertUnchanged(store, () => move(store, run, action, action === 'vehicle-complete' ? { completionConfirmed: true } : {}), errorIs(409, 'VEHICLE_ACTION_LOCKED'));
  }
  // Old stores remain readable, but their historical progress is not a parked signal.
  let legacy = move(store, run, 'depart');
  legacy = move(store, legacy, 'advance');
  assertUnchanged(store, () => move(store, legacy, 'vehicle-arrive'), errorIs(409, 'VEHICLE_ACTION_LOCKED'));
  legacy = move(store, legacy, 'advance');
  assertUnchanged(store, () => move(store, legacy, 'vehicle-complete', { completionConfirmed: true }), errorIs(409, 'VEHICLE_ACTION_LOCKED'));
});

test('every vehicle action requires a positive integer expectedVersion without mutating state', (t) => {
  const { store, run } = fixture(t);
  for (const action of ACTIONS) {
    for (const expectedVersion of [undefined, null, 0, -1, 1.5, '1', true]) {
      assertUnchanged(store, () => store.transition(run.id, action, { expectedVersion, ...(action === 'vehicle-motion' ? { motion: 'parked' } : {}), ...(action === 'vehicle-ux' ? { restriction: 'allowed' } : {}), ...(action === 'vehicle-complete' ? { completionConfirmed: true } : {}) }), errorIs(400, 'EXPECTED_VERSION_REQUIRED'));
    }
  }
});

test('motion accepts only explicit parked or moving values and cannot accept real GPS or connection data', (t) => {
  const { store, run } = fixture(t);
  for (const motion of [undefined, null, '', 'unknown', 'PARKED', 'stopped', true, 0, {}, []]) {
    assertUnchanged(store, () => move(store, run, 'vehicle-motion', { motion }), errorIs(400, 'INVALID_VEHICLE_MOTION'));
  }
  for (const extra of [{ latitude: 37 }, { longitude: 127 }, { position: { x: 84, y: 78 } }, { coordinates: [37, 127] }, { speed: 0 }, { source: 'gps' }, { realVehicleConnected: true }, { completionConfirmed: true }]) {
    assertUnchanged(store, () => move(store, run, 'vehicle-motion', { motion: 'parked', ...extra }), errorIs(400, 'UNSUPPORTED_COMMUNICATION_FIELD'));
  }
  for (const action of ACTIONS.filter((entry) => entry !== 'vehicle-motion')) {
    assertUnchanged(store, () => move(store, run, action, { motion: 'parked' }), errorIs(400, 'UNSUPPORTED_COMMUNICATION_FIELD'));
  }
});

test('changing simulated motion never advances a workflow or produces a notification', (t) => {
  const { store, run: initial } = fixture(t);
  let run = initial;
  for (const motion of ['moving', 'parked', 'parked', 'moving']) {
    const previous = run;
    run = move(store, run, 'vehicle-motion', { motion });
    assert.equal(run.status, 'ready');
    assert.equal(run.version, previous.version + 1);
    assert.equal(run.events.length, previous.events.length + 1);
    assert.equal(run.events.at(-1).type, 'vehicle-motion');
    assert.equal(run.events.at(-1).simulation, true);
    assert.deepEqual(run.vehicleSimulation, { motion, uxRestriction: 'unknown', source: 'manual-simulation', realVehicleConnected: false });
    assert.deepEqual(run.notifications, []);
    assert.equal(run.updatedAt, null);
    assert.equal(view(store, run).sharing.status, 'waiting');
    noLocation(view(store, run));
    noCompletion(run);
  }
});

test('simulated UX restriction validates independently and accepts only allowed, blocked or unknown', (t) => {
  const { store, run } = fixture(t);
  for (const restriction of [undefined, null, '', 'ALLOWED', 'parked', true, false, 0, {}, []]) {
    assertUnchanged(store, () => move(store, run, 'vehicle-ux', { restriction }), errorIs(400, 'INVALID_UX_RESTRICTION'));
  }
  for (const extra of [{ motion: 'parked' }, { realVehicleConnected: true }, { source: 'CarUxRestrictions' }, { completionConfirmed: true }, { uxRestriction: 'allowed' }]) {
    assertUnchanged(store, () => move(store, run, 'vehicle-ux', { restriction: 'allowed', ...extra }), errorIs(400, 'UNSUPPORTED_COMMUNICATION_FIELD'));
  }
});

test('UX permission is not parked evidence and changing either signal preserves the other', (t) => {
  const { store, run: initial } = fixture(t);
  let run = move(store, initial, 'vehicle-ux', { restriction: 'allowed' });
  assert.deepEqual(run.vehicleSimulation, { motion: 'unknown', uxRestriction: 'allowed', source: 'manual-simulation', realVehicleConnected: false });
  assertUnchanged(store, () => move(store, run, 'vehicle-depart'), errorIs(409, 'VEHICLE_ACTION_LOCKED'));
  run = move(store, run, 'vehicle-motion', { motion: 'parked' });
  assert.equal(run.vehicleSimulation.uxRestriction, 'allowed');
  run = move(store, run, 'vehicle-depart');
  assert.equal(run.vehicleSimulation.motion, 'moving');
  assert.equal(run.vehicleSimulation.uxRestriction, 'allowed');
  for (const restriction of ['blocked', 'unknown', 'allowed']) {
    const before = run;
    run = move(store, run, 'vehicle-ux', { restriction });
    assert.equal(run.vehicleSimulation.motion, 'moving');
    assert.equal(run.vehicleSimulation.uxRestriction, restriction);
    assert.equal(run.status, 'departed');
    assert.equal(run.updatedAt, before.updatedAt);
    assert.deepEqual(run.notifications, before.notifications);
    assert.equal(run.events.at(-1).type, 'vehicle-ux');
    assert.equal(run.events.at(-1).simulation, true);
    noCompletion(run);
  }
});

test('parked motion alone cannot unlock departure, arrival or completion when UX is blocked or unknown', (t) => {
  for (const status of ['ready', 'approaching', 'arrived']) {
    const { store, run: initial } = fixture(t);
    let run = prepare(store, initial);
    if (status !== 'ready') {
      run = move(store, run, 'vehicle-depart');
      run = move(store, run, 'vehicle-approach');
      run = move(store, run, 'vehicle-motion', { motion: 'parked' });
    }
    if (status === 'arrived') run = move(store, run, 'vehicle-arrive');
    for (const restriction of ['blocked', 'unknown']) {
      run = move(store, run, 'vehicle-ux', { restriction });
      assert.equal(run.vehicleSimulation.motion, 'parked');
      assert.equal(run.status, status);
      const actions = status === 'ready' ? ['vehicle-depart'] : status === 'approaching' ? ['vehicle-arrive', 'advance'] : ['vehicle-complete', 'complete'];
      for (const action of actions) assertUnchanged(store, () => move(store, run, action, action === 'vehicle-complete' ? { completionConfirmed: true } : {}), errorIs(409, 'VEHICLE_ACTION_LOCKED'));
      noCompletion(run);
    }
    run = move(store, run, 'vehicle-ux', { restriction: 'allowed' });
    const action = status === 'ready' ? 'vehicle-depart' : status === 'approaching' ? 'vehicle-arrive' : 'vehicle-complete';
    run = move(store, run, action, action === 'vehicle-complete' ? { completionConfirmed: true } : {});
    assert.equal(run.status, status === 'ready' ? 'departed' : status === 'approaching' ? 'arrived' : 'completed');
  }
});

test('outside-vehicle approaching simulation remains distinct from locked driver interactions', (t) => {
  const { store, run: initial } = fixture(t);
  let run = prepare(store, initial);
  run = move(store, run, 'vehicle-depart');
  run = move(store, run, 'vehicle-ux', { restriction: 'blocked' });
  run = move(store, run, 'vehicle-approach');
  assert.equal(run.status, 'approaching');
  assert.equal(run.vehicleSimulation.motion, 'moving');
  assert.equal(run.vehicleSimulation.uxRestriction, 'blocked');
  assert.deepEqual(run.notifications.map((notice) => notice.stage), ['departure', 'approaching']);
  assertUnchanged(store, () => move(store, run, 'vehicle-arrive'), errorIs(409, 'VEHICLE_ACTION_LOCKED'));
  noCompletion(run);
});

test('missing UX permission in a previously parked store is unknown, not automatically allowed', (t) => {
  const { store, directory, clock, run: initial } = fixture(t);
  let run = arrive(store, initial);
  const baseline = JSON.parse(readFileSync(store.filename, 'utf8'));
  for (const status of ['ready', 'approaching', 'arrived']) {
    const data = structuredClone(baseline);
    data.runs[0].status = status;
    delete data.runs[0].vehicleSimulation.uxRestriction;
    writeFileSync(store.filename, JSON.stringify(data));
    const restarted = createCommunication({ dataDir: directory, clock });
    run = restarted.getState().runs[0];
    assert.equal(run.vehicleSimulation.motion, 'parked');
    const actions = status === 'ready' ? ['vehicle-depart'] : status === 'approaching' ? ['vehicle-arrive', 'advance'] : ['vehicle-complete', 'complete'];
    for (const action of actions) assertUnchanged(restarted, () => move(restarted, run, action, action === 'vehicle-complete' ? { completionConfirmed: true } : {}), errorIs(409, 'VEHICLE_ACTION_LOCKED'));
  }
});

test('UX retries include restriction in their fingerprint and preserve newer restrictions after replay', (t) => {
  const { store, directory, clock, run: initial } = fixture(t);
  const body = { expectedVersion: initial.version, restriction: 'allowed', idempotencyKey: 'ux-permission' };
  let run = store.transition(initial.id, 'vehicle-ux', body).run;
  for (const restriction of ['blocked', 'unknown']) assertUnchanged(store, () => store.transition(run.id, 'vehicle-ux', { ...body, restriction }), errorIs(409, 'IDEMPOTENCY_CONFLICT'));
  run = move(store, run, 'vehicle-ux', { restriction: 'blocked' });
  const restarted = createCommunication({ dataDir: directory, clock });
  const replay = restarted.transition(run.id, 'vehicle-ux', body);
  assert.equal(replay.replayed, true);
  assert.equal(replay.run.vehicleSimulation.uxRestriction, 'blocked');
  assert.equal(replay.run.version, run.version);
  assert.equal(replay.run.events.length, 3);
  assert.deepEqual(replay.run.notifications, []);
});

test('vehicle departure requires parked state and atomically marks departed and moving', (t) => {
  const { store, run: initial } = fixture(t);
  let run = move(store, initial, 'vehicle-motion', { motion: 'moving' });
  assertUnchanged(store, () => move(store, run, 'vehicle-depart'), errorIs(409, 'VEHICLE_ACTION_LOCKED'));
  run = move(store, run, 'vehicle-motion', { motion: 'parked' });
  assertUnchanged(store, () => move(store, run, 'vehicle-depart'), errorIs(409, 'VEHICLE_ACTION_LOCKED'));
  run = move(store, run, 'vehicle-ux', { restriction: 'allowed' });
  const parkedVersion = run.version;
  run = move(store, run, 'vehicle-depart');
  assert.equal(run.status, 'departed');
  assert.equal(run.version, parkedVersion + 1);
  assert.equal(run.vehicleSimulation.motion, 'moving');
  assert.equal(run.vehicleSimulation.realVehicleConnected, false);
  assert.deepEqual(run.notifications.map((notice) => notice.stage), ['departure']);
  assert.equal(run.events.at(-1).type, 'vehicle-depart');
  assert.equal(view(store, run).sharing.status, 'active');
  assert.equal(view(store, run).position.coordinateSystem, 'fictional-grid');
  noCompletion(run);
});

test('approaching is a separate simulated event allowed only after departure, including while moving', (t) => {
  const { store, run: initial } = fixture(t, { sharingStart: 'approaching' });
  let run = prepare(store, initial);
  assertUnchanged(store, () => move(store, run, 'vehicle-approach'), errorIs(409, 'INVALID_TRANSITION'));
  run = move(store, run, 'vehicle-depart');
  assert.equal(view(store, run).sharing.status, 'waiting');
  noLocation(view(store, run));
  run = move(store, run, 'vehicle-approach');
  assert.equal(run.status, 'approaching');
  assert.equal(run.vehicleSimulation.motion, 'moving');
  assert.equal(view(store, run).sharing.status, 'active');
  assert.equal(view(store, run).remainingDistanceMeters, 450);
  assert.equal(run.events.at(-1).type, 'vehicle-approach');
  assert.deepEqual(run.notifications.map((notice) => notice.stage), ['departure', 'approaching']);
  assertUnchanged(store, () => move(store, run, 'vehicle-approach'), errorIs(409, 'VEHICLE_ACTION_LOCKED'));
  run = move(store, run, 'vehicle-motion', { motion: 'parked' });
  assertUnchanged(store, () => move(store, run, 'vehicle-approach'), errorIs(409, 'INVALID_TRANSITION'));
  noCompletion(run);
});

test('arrival requires both approaching and parked and does not mean work is complete', (t) => {
  const { store, run: initial } = fixture(t);
  let run = prepare(store, initial);
  assertUnchanged(store, () => move(store, run, 'vehicle-arrive'), errorIs(409, 'INVALID_TRANSITION'));
  run = move(store, run, 'vehicle-depart');
  run = move(store, run, 'vehicle-motion', { motion: 'parked' });
  assertUnchanged(store, () => move(store, run, 'vehicle-arrive'), errorIs(409, 'INVALID_TRANSITION'));
  run = move(store, run, 'vehicle-approach');
  run = move(store, run, 'vehicle-motion', { motion: 'moving' });
  assertUnchanged(store, () => move(store, run, 'vehicle-arrive'), errorIs(409, 'VEHICLE_ACTION_LOCKED'));
  run = move(store, run, 'vehicle-motion', { motion: 'parked' });
  run = move(store, run, 'vehicle-arrive');
  assert.equal(run.status, 'arrived');
  assert.equal(run.vehicleSimulation.motion, 'parked');
  assert.equal(view(store, run).remainingDistanceMeters, 0);
  assert.equal(view(store, run).etaMinutes, 0);
  assert.equal(view(store, run).sharing.status, 'active');
  assert.deepEqual(run.notifications.map((notice) => notice.stage), ['departure', 'approaching', 'arrival']);
  assertUnchanged(store, () => move(store, run, 'vehicle-arrive'), errorIs(409, 'INVALID_TRANSITION'));
  noCompletion(run);
});

test('completion cannot skip ready, departed or approaching even with parked motion and confirmation', (t) => {
  const { store, run: initial } = fixture(t);
  let run = prepare(store, initial);
  for (const status of ['ready', 'departed', 'approaching']) {
    assert.equal(run.status, status);
    assertUnchanged(store, () => move(store, run, 'vehicle-complete', { completionConfirmed: true }), errorIs(409, 'INVALID_TRANSITION'));
    noCompletion(run);
    if (status === 'ready') {
      run = move(store, run, 'vehicle-depart');
      run = move(store, run, 'vehicle-motion', { motion: 'parked' });
    } else if (status === 'departed') run = move(store, run, 'vehicle-approach');
  }
});

test('completion requires exact boolean confirmation as well as parked arrival', (t) => {
  const { store, run: initial } = fixture(t);
  let run = arrive(store, initial);
  for (const completionConfirmed of [undefined, false, null, 'true', 1, {}, []]) {
    assertUnchanged(store, () => move(store, run, 'vehicle-complete', { completionConfirmed }), errorIs(400, 'COMPLETION_CONFIRMATION_REQUIRED'));
  }
  run = move(store, run, 'vehicle-motion', { motion: 'moving' });
  assertUnchanged(store, () => move(store, run, 'vehicle-complete', { completionConfirmed: true }), errorIs(409, 'VEHICLE_ACTION_LOCKED'));
  run = move(store, run, 'vehicle-motion', { motion: 'parked' });
  assert.equal(run.status, 'arrived');
  noCompletion(run);
  run = move(store, run, 'vehicle-complete', { completionConfirmed: true });
  assert.equal(run.status, 'completed');
  assert.deepEqual(run.completionEvidence, { source: 'explicit-demo-confirmation', realWorldVerified: false, confirmedAt: run.completedAt });
  assert.equal(run.events.at(-1).type, 'vehicle-complete');
});

test('explicit completion immediately terminates customer and operator location and links', (t) => {
  const { store, run: initial } = fixture(t);
  let run = arrive(store, initial);
  assert.ok(run.notifications.some((notice) => notice.link));
  run = move(store, run, 'vehicle-complete', { completionConfirmed: true });
  const customer = view(store, run);
  assert.equal(customer.status, 'completed');
  assert.equal(customer.sharing.enabled, false);
  assert.equal(customer.sharing.status, 'completed');
  for (const projection of [run, customer, store.getState().runs[0]]) {
    noLocation(projection);
    assert.ok(projection.notifications.every((notice) => !Object.hasOwn(notice, 'link')));
  }
  assert.equal(run.notifications.filter((notice) => notice.stage === 'completion').length, 1);
  for (const notice of store.getState().notifications) {
    assert.equal(notice.networkEnabled, false);
    assert.equal(notice.deliveryStatus, 'simulated');
    assert.equal(Object.hasOwn(notice, 'link'), false);
  }
  for (const field of ['vehicleSimulation', 'completionEvidence', 'events', 'configSnapshot', 'link', 'token']) assert.equal(Object.hasOwn(customer, field), false);
});

test('legacy arrival and completion endpoints cannot bypass a moving vehicle guard', (t) => {
  const { store, run: initial } = fixture(t);
  let run = prepare(store, initial);
  run = move(store, run, 'vehicle-depart');
  run = move(store, run, 'advance');
  assert.equal(run.status, 'approaching');
  assertUnchanged(store, () => move(store, run, 'advance'), errorIs(409, 'VEHICLE_ACTION_LOCKED'));
  run = move(store, run, 'vehicle-motion', { motion: 'parked' });
  run = move(store, run, 'advance');
  run = move(store, run, 'vehicle-motion', { motion: 'moving' });
  assertUnchanged(store, () => move(store, run, 'complete'), errorIs(409, 'VEHICLE_ACTION_LOCKED'));
  noCompletion(run);
  run = move(store, run, 'vehicle-motion', { motion: 'parked' });
  run = move(store, run, 'complete');
  assert.equal(run.status, 'completed');
  noLocation(view(store, run));
});

test('persisted explicit unknown vehicle states fail closed for new and legacy critical actions', (t) => {
  const { store, directory, clock, run: initial } = fixture(t);
  let run = move(store, initial, 'depart');
  run = move(store, run, 'advance');
  const baseline = JSON.parse(readFileSync(store.filename, 'utf8'));
  for (const vehicleSimulation of [{}, { motion: 'unknown' }, { motion: 'unrecognized' }, { motion: null }]) {
    for (const status of ['ready', 'approaching', 'arrived']) {
      const data = structuredClone(baseline);
      data.runs[0].vehicleSimulation = vehicleSimulation;
      data.runs[0].status = status;
      writeFileSync(store.filename, JSON.stringify(data));
      const restarted = createCommunication({ dataDir: directory, clock });
      const current = restarted.getState().runs[0];
      const actions = status === 'ready' ? ['vehicle-depart'] : status === 'approaching' ? ['vehicle-arrive', 'advance'] : ['vehicle-complete', 'complete'];
      for (const action of actions) assertUnchanged(restarted, () => move(restarted, current, action, action === 'vehicle-complete' ? { completionConfirmed: true } : {}), errorIs(409, 'VEHICLE_ACTION_LOCKED'));
    }
  }
});

test('all vehicle mutations reject stale versions without duplicate events or notifications', (t) => {
  const { store, run: initial } = fixture(t);
  const run = move(store, initial, 'vehicle-motion', { motion: 'parked' });
  for (const action of ACTIONS) {
    assertUnchanged(store, () => store.transition(run.id, action, { expectedVersion: initial.version, ...(action === 'vehicle-motion' ? { motion: 'moving' } : {}), ...(action === 'vehicle-ux' ? { restriction: 'allowed' } : {}), ...(action === 'vehicle-complete' ? { completionConfirmed: true } : {}) }), errorIs(409, 'STALE_VERSION'));
  }
  assert.equal(store.getState().runs[0].version, run.version);
});

test('each vehicle action has durable idempotent replay without returning old active projections', (t) => {
  const { store, directory, clock, run: initial } = fixture(t);
  let run = initial;
  const operations = [];
  for (const [action, extra] of [
    ['vehicle-motion', { motion: 'parked' }], ['vehicle-ux', { restriction: 'allowed' }], ['vehicle-depart', {}], ['vehicle-approach', {}],
    ['vehicle-motion', { motion: 'parked' }], ['vehicle-arrive', {}], ['vehicle-complete', { completionConfirmed: true }],
  ]) {
    const body = { expectedVersion: run.version, idempotencyKey: `vehicle-${run.version}`, ...extra };
    operations.push({ action, body });
    const first = store.transition(run.id, action, body);
    assert.equal(first.replayed, false);
    run = first.run;
    const replay = store.transition(run.id, action, body);
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.run, run);
  }
  assert.equal(run.events.length, 8);
  assert.equal(run.notifications.length, 4);
  const restarted = createCommunication({ dataDir: directory, clock });
  assert.deepEqual(restarted.getState(), store.getState());
  for (const { action, body } of operations) {
    const replay = restarted.transition(run.id, action, body);
    assert.equal(replay.replayed, true);
    assert.equal(replay.run.status, 'completed');
    assert.equal(replay.run.vehicleSimulation.motion, 'parked');
    assert.equal(replay.run.completionEvidence.realWorldVerified, false);
    noLocation(replay.run);
    assert.ok(replay.run.notifications.every((notice) => !notice.link));
  }
  assert.equal(restarted.getState().runs[0].events.length, 8);
  assert.equal(restarted.getState().notifications.length, 4);
});

test('idempotency fingerprints include motion, explicit confirmation, version, action and run', (t) => {
  const { store, run: initial } = fixture(t);
  const motionBody = { expectedVersion: initial.version, motion: 'parked', idempotencyKey: 'same-key' };
  let run = store.transition(initial.id, 'vehicle-motion', motionBody).run;
  for (const body of [{ ...motionBody, motion: 'moving' }, { ...motionBody, expectedVersion: run.version }]) {
    assertUnchanged(store, () => store.transition(run.id, 'vehicle-motion', body), errorIs(409, 'IDEMPOTENCY_CONFLICT'));
  }
  assertUnchanged(store, () => store.transition(run.id, 'vehicle-depart', { expectedVersion: initial.version, idempotencyKey: 'same-key' }), errorIs(409, 'IDEMPOTENCY_CONFLICT'));
  assertUnchanged(store, () => store.transition('another-run', 'vehicle-motion', motionBody), errorIs(409, 'IDEMPOTENCY_CONFLICT'));
  run = arrive(store, run);
  const completeBody = { expectedVersion: run.version, completionConfirmed: true, idempotencyKey: 'complete-key' };
  run = store.transition(run.id, 'vehicle-complete', completeBody).run;
  for (const completionConfirmed of [false, undefined]) {
    assertUnchanged(store, () => store.transition(run.id, 'vehicle-complete', { ...completeBody, completionConfirmed }), errorIs(409, 'IDEMPOTENCY_CONFLICT'));
  }
  assert.equal(store.getState().notifications.filter((notice) => notice.stage === 'completion').length, 1);
});

test('failed vehicle requests do not consume retry keys and successful repeated stages do not duplicate notices', (t) => {
  const { store, run: initial } = fixture(t);
  assertUnchanged(store, () => move(store, initial, 'vehicle-motion', { motion: 'unknown', idempotencyKey: 'recover' }), errorIs(400, 'INVALID_VEHICLE_MOTION'));
  let run = move(store, initial, 'vehicle-motion', { motion: 'parked', idempotencyKey: 'recover' });
  run = move(store, run, 'vehicle-ux', { restriction: 'allowed' });
  const parked = run;
  run = move(store, run, 'vehicle-depart');
  assertUnchanged(store, () => move(store, parked, 'vehicle-depart'), errorIs(409, 'STALE_VERSION'));
  run = move(store, run, 'vehicle-motion', { motion: 'parked' });
  assertUnchanged(store, () => move(store, run, 'vehicle-depart'), errorIs(409, 'INVALID_TRANSITION'));
  run = move(store, run, 'vehicle-approach');
  assertUnchanged(store, () => move(store, run, 'vehicle-approach'), errorIs(409, 'INVALID_TRANSITION'));
  run = move(store, run, 'vehicle-arrive');
  assertUnchanged(store, () => move(store, run, 'vehicle-arrive'), errorIs(409, 'INVALID_TRANSITION'));
  run = move(store, run, 'vehicle-complete', { completionConfirmed: true });
  assertUnchanged(store, () => move(store, run, 'vehicle-complete', { completionConfirmed: true }), errorIs(409, 'RUN_CLOSED'));
  assert.equal(store.getState().notifications.length, 4);
});

test('motion simulation does not refresh stale location examples or clear explicit stale state', (t) => {
  const { store, advanceClock, run: initial } = fixture(t);
  let run = prepare(store, initial);
  run = move(store, run, 'vehicle-depart');
  const updatedAt = run.updatedAt;
  advanceClock(LOCATION_FRESHNESS_MS);
  run = move(store, run, 'vehicle-motion', { motion: 'parked' });
  assert.equal(run.updatedAt, updatedAt);
  assert.equal(view(store, run).sharing.status, 'stale');
  noLocation(view(store, run));
  run = move(store, run, 'vehicle-approach');
  assert.equal(view(store, run).sharing.status, 'active');
  run = move(store, run, 'stale');
  run = move(store, run, 'vehicle-motion', { motion: 'moving' });
  assert.equal(run.locationStale, true);
  assert.equal(view(store, run).sharing.status, 'stale');
  noLocation(view(store, run));
  noCompletion(run);
});

test('completed, stopped and expired runs reject every new vehicle action and never reopen sharing', (t) => {
  for (const terminal of ['completed', 'stopped', 'expired']) {
    const context = fixture(t, { ttlMinutes: 5 });
    let run = arrive(context.store, context.run);
    if (terminal === 'completed') run = move(context.store, run, 'vehicle-complete', { completionConfirmed: true });
    if (terminal === 'stopped') run = move(context.store, run, 'stop');
    if (terminal === 'expired') { context.advanceClock(5 * 60_000); run = context.store.getState().runs[0]; }
    for (const action of ACTIONS) {
      assertUnchanged(context.store, () => move(context.store, run, action, action === 'vehicle-motion' ? { motion: 'parked' } : action === 'vehicle-ux' ? { restriction: 'allowed' } : action === 'vehicle-complete' ? { completionConfirmed: true } : {}), errorIs(409, 'RUN_CLOSED'));
    }
    assert.equal(view(context.store, run).sharing.status, terminal);
    noLocation(view(context.store, run));
    if (terminal !== 'completed') noCompletion(run);
  }
});

test('replaying a vehicle departure after expiry cannot disclose its previously active location', (t) => {
  const { store, advanceClock, run: initial } = fixture(t, { ttlMinutes: 5 });
  let run = prepare(store, initial);
  const body = { expectedVersion: run.version, idempotencyKey: 'depart-before-expiry' };
  run = store.transition(run.id, 'vehicle-depart', body).run;
  assert.equal(run.sharing.status, 'active');
  advanceClock(5 * 60_000);
  const replay = store.transition(run.id, 'vehicle-depart', body);
  assert.equal(replay.replayed, true);
  assert.equal(replay.run.status, 'expired');
  noLocation(replay.run);
  assert.ok(replay.run.notifications.every((notice) => !notice.link));
  noCompletion(replay.run);
});

test('vehicle workflow respects notification and sharing settings for each fictional business preset', (t) => {
  for (const role of ['school', 'instructor', 'delivery']) {
    const { store, run: initial } = fixture(t, { role, sharingEnabled: false, notifications: { departure: false, approaching: false, arrival: false, completion: true } });
    let run = arrive(store, initial);
    assert.deepEqual(run.notifications, []);
    noLocation(run);
    noLocation(view(store, run));
    run = move(store, run, 'vehicle-complete', { completionConfirmed: true });
    assert.deepEqual(run.notifications.map((notice) => notice.stage), ['completion']);
    assert.equal(run.notifications[0].customerId, run.customer.id);
    assert.equal(run.notifications[0].networkEnabled, false);
    assert.equal(Object.hasOwn(run.notifications[0], 'link'), false);
    assert.match(run.customer.name, /가상/);
  }
  const { store, run: initial } = fixture(t, { kakaoEnabled: false });
  const run = move(store, arrive(store, initial), 'vehicle-complete', { completionConfirmed: true });
  assert.deepEqual(run.notifications, []);
  assert.equal(view(store, run).sharing.status, 'completed');
});

async function httpFixture(t) {
  const context = fixture(t);
  const server = createServer({ dataDir: context.directory, clock: context.clock });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const path = (action) => `/api/communication/runs/${context.run.id}/${action}`;
  const post = async (action, body, headers = {}) => {
    const response = await fetch(base + path(action), { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  return { ...context, server, base, path, post };
}

test('HTTP vehicle endpoints execute the complete simulated flow and expose only scoped customer results', async (t) => {
  const { base, post, run: initial } = await httpFixture(t);
  let run = initial;
  const customerUrl = `${base}/api/customer-links/${run.link.token}?customerId=${run.customer.id}`;
  for (const [action, extra, status] of [
    ['vehicle-motion', { motion: 'parked' }, 'ready'], ['vehicle-ux', { restriction: 'allowed' }, 'ready'], ['vehicle-depart', {}, 'departed'],
    ['vehicle-approach', {}, 'approaching'], ['vehicle-motion', { motion: 'parked' }, 'approaching'],
    ['vehicle-arrive', {}, 'arrived'], ['vehicle-complete', { completionConfirmed: true }, 'completed'],
  ]) {
    const result = await post(action, { expectedVersion: run.version, ...extra });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    run = result.body.run;
    assert.equal(run.status, status);
    const response = await fetch(customerUrl);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const customer = await response.json();
    assert.equal(customer.status, status);
    assert.equal(customer.runId, run.id);
    assert.equal(customer.simulation, true);
    assert.equal(Object.hasOwn(customer, 'vehicleSimulation'), false);
    if (['ready', 'completed'].includes(status)) noLocation(customer);
  }
  assert.equal(run.completionEvidence.realWorldVerified, false);
  assert.equal(run.notifications.length, 4);
  assert.equal((await (await fetch(`${base}/api/state`)).json()).requests.length, 0);
  const wrongCustomer = await fetch(`${base}/api/customer-links/${run.link.token}?customerId=somebody-else`);
  assert.equal(wrongCustomer.status, 404);
  assert.equal((await wrongCustomer.json()).error.code, 'CUSTOMER_LINK_NOT_FOUND');
});

test('HTTP vehicle guards reject unknown motion, invalid bodies, missing versions and foreign origins', async (t) => {
  const { post, server, run } = await httpFixture(t);
  const baseline = server.communication.getState();
  for (const action of ['vehicle-depart', 'vehicle-arrive', 'vehicle-complete']) {
    const result = await post(action, { expectedVersion: run.version, ...(action === 'vehicle-complete' ? { completionConfirmed: true } : {}) });
    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, 'VEHICLE_ACTION_LOCKED');
  }
  for (const [body, code] of [[{}, 'EXPECTED_VERSION_REQUIRED'], [{ expectedVersion: 1, motion: 'unknown' }, 'INVALID_VEHICLE_MOTION'], [{ expectedVersion: 1, motion: 'parked', latitude: 37 }, 'UNSUPPORTED_COMMUNICATION_FIELD'], [null, 'INVALID_BODY'], [[], 'INVALID_BODY']]) {
    const result = await post('vehicle-motion', body);
    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, code);
  }
  const foreign = await post('vehicle-motion', { expectedVersion: 1, motion: 'parked' }, { Origin: 'https://untrusted.example' });
  assert.equal(foreign.status, 403);
  assert.equal(foreign.body.error.code, 'ORIGIN_REJECTED');
  assert.deepEqual(server.communication.getState(), baseline);
});

test('concurrent HTTP departures allow one versioned transition and one simulated notice', async (t) => {
  const { post, server, run: initial } = await httpFixture(t);
  const motion = (await post('vehicle-motion', { expectedVersion: initial.version, motion: 'parked' })).body.run;
  const parked = (await post('vehicle-ux', { expectedVersion: motion.version, restriction: 'allowed' })).body.run;
  const results = await Promise.all([post('vehicle-depart', { expectedVersion: parked.version }), post('vehicle-depart', { expectedVersion: parked.version })]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  assert.equal(results.find((result) => result.status === 409).body.error.code, 'STALE_VERSION');
  const run = server.communication.getState().runs[0];
  assert.equal(run.version, parked.version + 1);
  assert.equal(run.status, 'departed');
  assert.equal(run.vehicleSimulation.motion, 'moving');
  assert.equal(run.events.filter((event) => event.type === 'vehicle-depart').length, 1);
  assert.deepEqual(run.notifications.map((notice) => notice.stage), ['departure']);
});

test('HTTP parked and simulated UX signals are separate and both are required before departure', async (t) => {
  const { post, run: initial } = await httpFixture(t);
  let result = await post('vehicle-motion', { expectedVersion: initial.version, motion: 'parked' });
  let run = result.body.run;
  assert.equal(run.vehicleSimulation.uxRestriction, 'unknown');
  result = await post('vehicle-depart', { expectedVersion: run.version });
  assert.equal(result.status, 409);
  assert.equal(result.body.error.code, 'VEHICLE_ACTION_LOCKED');
  result = await post('vehicle-ux', { expectedVersion: run.version, restriction: 'parked' });
  assert.equal(result.status, 400);
  assert.equal(result.body.error.code, 'INVALID_UX_RESTRICTION');
  result = await post('vehicle-ux', { expectedVersion: run.version, restriction: 'blocked' });
  assert.equal(result.status, 200);
  run = result.body.run;
  result = await post('vehicle-depart', { expectedVersion: run.version });
  assert.equal(result.status, 409);
  result = await post('vehicle-ux', { expectedVersion: run.version, restriction: 'allowed' });
  assert.equal(result.status, 200);
  run = result.body.run;
  result = await post('vehicle-depart', { expectedVersion: run.version });
  assert.equal(result.status, 200);
  assert.equal(result.body.run.status, 'departed');
  assert.equal(result.body.run.vehicleSimulation.motion, 'moving');
  assert.equal(result.body.run.vehicleSimulation.uxRestriction, 'allowed');
});

test('HTTP retry keys replay exactly once, conflict on changed motion, and GET never mutates vehicle state', async (t) => {
  const { base, path, post, server, run } = await httpFixture(t);
  const body = { expectedVersion: run.version, motion: 'parked', idempotencyKey: 'http-motion' };
  const results = await Promise.all([post('vehicle-motion', body), post('vehicle-motion', body)]);
  assert.deepEqual(results.map((result) => result.status), [200, 200]);
  assert.equal(results.filter((result) => result.body.replayed).length, 1);
  assert.equal(server.communication.getState().runs[0].events.length, 2);
  const conflict = await post('vehicle-motion', { ...body, motion: 'moving' });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error.code, 'IDEMPOTENCY_CONFLICT');
  const baseline = server.communication.getState();
  for (const action of ACTIONS) {
    const response = await fetch(base + path(action));
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, 'NOT_FOUND');
  }
  assert.deepEqual(server.communication.getState(), baseline);
});

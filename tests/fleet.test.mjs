import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ACTORS, FLEET_ACTIONS, FLEET_FIELDS, FLEET_ROLES, createFleet } from '../fleet.mjs';
import { createServer } from '../server.mjs';

const A = 'operator-a';
const B = 'operator-b';
const V1 = 'vehicle-101';
const V2 = 'vehicle-102';
const V3 = 'vehicle-201';
const READ = 'vehicle.read';
const REQUEST = 'destination.request';
const LOCK = 'door.lock';
const errorIs = (status, code) => error => error.status === status && error.code === code;
let sequence = 0;
const key = (prefix = 'fleet-test') => `${prefix}-${++sequence}`;
const input = (actorId = A, extra = {}) => ({ actorId, idempotencyKey: key(), ...extra });
const step = (batch, vehicleId = V1, action = READ) => batch.rows.find(row => row.vehicleId === vehicleId).steps.find(item => item.action === action);
const row = (batch, vehicleId = V1) => batch.rows.find(item => item.vehicleId === vehicleId);

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'mobflow-fleet-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let now = Date.parse('2026-10-24T06:00:00.000Z');
  const clock = () => now;
  const store = createFleet({ dataDir: directory, clock });
  return { store, directory, clock, setClock: value => { now = value; }, advanceClock: milliseconds => { now += milliseconds; } };
}

function configure(store, vehicleId = V1, overrides = {}, actorId = A) {
  const vehicle = store.getState(actorId).vehicles.find(item => item.id === vehicleId);
  return store.configure(input(actorId, { vehicleId, expectedVersion: vehicle.version, motion: vehicle.motion, ux: vehicle.ux, capabilities: vehicle.capabilities, fresh: true, failOnce: vehicle.failOnce, ...overrides }));
}

function changePolicy(store, edit, actorId = A) {
  const { policy } = store.getState(actorId);
  const rules = structuredClone(policy.rules);
  edit(rules);
  return store.changePolicy(input(actorId, { expectedVersion: policy.version, rules }));
}

function run(store, actorId = A, vehicleId = V1, action = READ) {
  return store.run(input(actorId, { vehicleId, action })).batch;
}

function transition(store, batch, action, extra = {}, actorId = A) {
  return store.transition(batch.id, action, input(actorId, { expectedVersion: batch.version, ...extra })).batch;
}

function approve(store, batch, vehicleId = V1, action = LOCK, actorId = A) {
  return transition(store, batch, 'approve', { rowId: row(batch, vehicleId).id, stepAction: action }, actorId);
}

function binding(store, vehicleIds = [V1, V2], actions = [READ], actorId = A) {
  return store.bind(input(actorId, { vehicleIds, actions })).state.bindings.at(-1);
}

function runBinding(store, selected, actorId = A) {
  return store.run(input(actorId, { bindingId: selected.id })).batch;
}

function persisted(directory) {
  const filename = join(directory, 'fleet.json');
  return existsSync(filename) ? readFileSync(filename, 'utf8') : null;
}

function unchanged(store, directory, perform, expected) {
  const state = ACTORS.map(actor => store.getState(actor.id));
  const bytes = persisted(directory);
  assert.throws(perform, expected);
  assert.deepEqual(ACTORS.map(actor => store.getState(actor.id)), state);
  assert.equal(persisted(directory), bytes);
}

function assertSimulation(output) {
  assert.equal(output.mode, 'simulation');
  assert.equal(output.networkCommandSent, false);
  assert.equal(output.realExecutionConfirmed, false);
  assert.equal(output.routeApplied, false);
}

async function httpFixture(t) {
  const { directory, clock } = fixture(t);
  const server = createServer({ dataDir: directory, clock });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body, headers = {}) => {
    const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return { response, status: response.status, body: await response.json() };
  };
  return { server, directory, base, post };
}

test('fleet demo seeds two fictional academy vehicles, a separate organization, and explicit non-authentication mode', t => {
  const { store } = fixture(t);
  const state = store.getState(A);
  assert.equal(state.mode, 'policy-enforcement-demo-not-authentication');
  assert.deepEqual(state.vehicles.map(vehicle => vehicle.id), [V1, V2]);
  assert.deepEqual(store.getState(B).vehicles.map(vehicle => vehicle.id), [V3]);
  assert.deepEqual(state.actors.map(actor => actor.id), ['operator-a', 'driver-a', 'parent-a', 'customer-a']);
  assert.deepEqual(Object.keys(state.roles), ['operator', 'driver', 'parent', 'customer']);
  assert.deepEqual(Object.keys(state.actions), [READ, REQUEST, LOCK]);
  assert.equal(state.vehicles[1].capabilities[LOCK], 'unknown');
  assert.equal(state.vehicles[1].failOnce, true);
  assert.equal(state.vehicles[0].capabilities[LOCK], 'supported');
  assert.deepEqual(state.bindings, []);
  assert.deepEqual(state.batches, []);
  for (const vehicle of state.vehicles) {
    assert.match(vehicle.name, /가상/);
    assert.equal(vehicle.motion, 'parked');
    assert.equal(vehicle.ux, 'allowed');
    assert.equal(vehicle.fresh, true);
    assert.equal(vehicle.decision.decision, 'allowed');
  }
});

test('unknown actors never fall back to an operator or accept caller-supplied roles and organizations', t => {
  const { store, directory } = fixture(t);
  for (const actorId of [undefined, null, '', 'operator', 'administrator', 'operator-c', {}, ['operator-a']]) {
    assert.throws(() => store.getState(actorId), errorIs(403, 'DEMO_ACTOR_REQUIRED'));
    unchanged(store, directory, () => store.run({ actorId, idempotencyKey: key(), vehicleId: V1, action: READ }), errorIs(403, 'DEMO_ACTOR_REQUIRED'));
  }
  for (const extra of [{ role: 'operator' }, { orgId: 'org-a' }, { vehicles: [V1] }, { tripId: 'trip-101' }]) {
    unchanged(store, directory, () => store.run(input('customer-a', { vehicleId: V1, action: READ, ...extra })), errorIs(422, 'INVALID_INPUT'));
  }
});

test('operator, assigned-driver, parent and customer scopes are deny-by-default', t => {
  const { store, directory } = fixture(t);
  const expected = { 'operator-a': [V1, V2], 'driver-a': [V1, V2], 'parent-a': [V1], 'customer-a': [V2], 'operator-b': [V3] };
  for (const [actorId, ids] of Object.entries(expected)) {
    assert.deepEqual(store.getState(actorId).vehicles.map(vehicle => vehicle.id), ids);
    for (const vehicleId of [V1, V2, V3, 'vehicle-999', undefined, null, {}]) {
      const result = store.inspect({ actorId, vehicleId, action: READ });
      assert.equal(result.decision.decision, ids.includes(vehicleId) ? 'allowed' : 'denied');
      if (!ids.includes(vehicleId)) {
        assert.equal(result.decision.code, 'SCOPE_DENIED');
        assert.deepEqual(result.fields, {});
        unchanged(store, directory, () => store.run(input(actorId, { vehicleId, action: READ })), errorIs(403, 'SCOPE_DENIED'));
      }
    }
  }
});

test('parent and customer receive only their own trip and the default field allowlist', t => {
  const { store } = fixture(t);
  const allowed = ['rider', 'schedule', 'attendance', 'status', 'eta'];
  for (const [actorId, vehicleId, tripId] of [['parent-a', V1, 'trip-101'], ['customer-a', V2, 'trip-102']]) {
    const state = store.getState(actorId);
    const vehicle = state.vehicles[0];
    assert.equal(vehicle.id, vehicleId);
    assert.equal(vehicle.tripId, tripId);
    assert.deepEqual(Object.keys(vehicle.fields), allowed);
    for (const privateField of ['position', 'destination', 'battery', 'doorState', 'capabilities', 'motion', 'ux', 'failOnce']) {
      assert.equal(Object.hasOwn(vehicle.fields, privateField), false);
      assert.equal(Object.hasOwn(vehicle, privateField), false);
    }
    const result = store.inspect({ actorId, vehicleId, tripId, action: READ });
    assert.deepEqual(Object.keys(result.fields), allowed);
    assert.equal(result.networkCommandSent, false);
    assert.equal(result.realExecutionConfirmed, false);
    const mismatched = store.inspect({ actorId, vehicleId, tripId: 'trip-201', action: READ });
    assert.equal(mismatched.decision.code, 'TRIP_MISMATCH');
    assert.deepEqual(mismatched.fields, {});
  }
});

test('read access is independent of control approval and non-read inspection never exposes data', t => {
  const { store } = fixture(t);
  for (const actorId of ['operator-a', 'driver-a', 'parent-a', 'customer-a']) {
    const vehicleId = actorId === 'customer-a' ? V2 : V1;
    assert.equal(store.inspect({ actorId, vehicleId, action: READ }).decision.decision, 'allowed');
    const request = store.inspect({ actorId, vehicleId, action: REQUEST });
    assert.equal(request.decision.decision, 'needs_approval');
    assert.deepEqual(request.fields, {});
    const lock = store.inspect({ actorId, vehicleId, action: LOCK });
    assert.equal(lock.decision.decision, ['parent-a', 'customer-a'].includes(actorId) ? 'denied' : 'needs_approval');
    assert.deepEqual(lock.fields, {});
  }
  assert.equal(store.inspect({ actorId: A, vehicleId: V2, action: LOCK }).decision.code, 'CAPABILITY_DENIED');
  assert.equal(store.inspect({ actorId: A, vehicleId: V1, action: 'engine.start' }).decision.code, 'UNKNOWN_ACTION');
});

test('only the matching organization operator can edit policies or configure/register simulated vehicles', t => {
  const { store, directory } = fixture(t);
  const state = store.getState(A);
  const vehicle = state.vehicles[0];
  for (const actorId of ['driver-a', 'parent-a', 'customer-a']) {
    unchanged(store, directory, () => store.changePolicy(input(actorId, { expectedVersion: 1, rules: state.policy.rules })), errorIs(403, 'ROLE_DENIED'));
    unchanged(store, directory, () => store.configure(input(actorId, { vehicleId: V1, expectedVersion: 1, motion: 'parked', ux: 'allowed', capabilities: vehicle.capabilities, failOnce: false, fresh: true })), errorIs(403, 'ROLE_DENIED'));
    unchanged(store, directory, () => store.register(input(actorId)), errorIs(403, 'ROLE_DENIED'));
  }
  unchanged(store, directory, () => store.configure(input(B, { vehicleId: V1, expectedVersion: 1, motion: 'parked', ux: 'allowed', capabilities: vehicle.capabilities, failOnce: false, fresh: true })), errorIs(403, 'SCOPE_DENIED'));
  changePolicy(store, rules => { rules.parent.fields = ['eta']; });
  assert.deepEqual(store.getState('parent-a').vehicles[0].fields, { eta: 3 });
  assert.equal(store.getState(A).policy.version, 2);
  assert.equal(store.getState(B).policy.version, 1);
  assert.equal(store.getState(B).policy.rules.parent.fields.length, 5);
});

test('policy editing cannot exceed legal role/field ceilings or turn control into unconditional allow', t => {
  const { store, directory } = fixture(t);
  const variants = [
    rules => { rules.parent.fields.push('battery'); },
    rules => { rules.customer.fields.push('doorState'); },
    rules => { rules.driver.fields.push('vin'); },
    rules => { rules.operator.fields.push('token'); },
    rules => { rules.parent.fields.push('eta'); },
    rules => { rules.parent.actions[LOCK] = 'approval'; },
    rules => { rules.customer.actions[LOCK] = 'allow'; },
    rules => { rules.driver.actions[LOCK] = 'allow'; },
    rules => { rules.operator.actions[LOCK] = 'allow'; },
    rules => { rules.operator.actions[REQUEST] = 'allow'; },
    rules => { rules.parent.actions[REQUEST] = 'allow'; },
    rules => { rules.driver.actions[READ] = 'approval'; },
    rules => { rules.operator.actions['engine.start'] = 'approval'; },
    rules => { rules.operator.admin = true; },
    rules => { rules.admin = structuredClone(rules.operator); },
    rules => { delete rules.parent; },
    rules => { delete rules.operator.actions[READ]; },
    rules => { rules.operator.fields = '*'; },
  ];
  for (const edit of variants) unchanged(store, directory, () => changePolicy(store, edit), errorIs(422, 'INVALID_INPUT'));
  changePolicy(store, rules => {
    rules.parent.fields = ['destination', 'position'];
    rules.customer.fields = [];
    rules.operator.actions[LOCK] = 'deny';
  });
  assert.deepEqual(Object.keys(store.getState('parent-a').vehicles[0].fields), ['destination', 'position']);
  assert.deepEqual(store.getState('customer-a').vehicles[0].fields, {});
  assert.equal(store.inspect({ actorId: A, vehicleId: V1, action: LOCK }).decision.code, 'POLICY_DENIED');
});

test('policy and vehicle writes reject stale and malformed expected versions without mutation', t => {
  const { store, directory } = fixture(t);
  const { policy, vehicles } = store.getState(A);
  for (const expectedVersion of [undefined, null, '1', 0, -1, 1.5, true, 999]) {
    unchanged(store, directory, () => store.changePolicy(input(A, { expectedVersion, rules: policy.rules })), errorIs(409, 'VERSION_CONFLICT'));
    unchanged(store, directory, () => configure(store, V1, { expectedVersion }), errorIs(409, 'VERSION_CONFLICT'));
  }
  configure(store, V1, { motion: 'moving' });
  assert.equal(store.getState(A).vehicles[0].version, vehicles[0].version + 1);
  unchanged(store, directory, () => configure(store, V1, { expectedVersion: vehicles[0].version }), errorIs(409, 'VERSION_CONFLICT'));
});

test('unknown and unsupported capabilities are denied even when the role policy grants approval', t => {
  const { store } = fixture(t);
  for (const action of [READ, REQUEST, LOCK]) {
    for (const capability of ['unknown', 'unsupported']) {
      const capabilities = structuredClone(store.getState(A).vehicles[0].capabilities);
      capabilities[action] = capability;
      configure(store, V1, { capabilities });
      const result = store.inspect({ actorId: A, vehicleId: V1, action });
      assert.equal(result.decision.code, 'CAPABILITY_DENIED');
      assert.deepEqual(result.fields, {});
    }
  }
});

test('unknown motion or UX fail closed while moving/restricted states allow reads but reject controls', t => {
  const { store } = fixture(t);
  for (const [motion, ux, code] of [['unknown', 'allowed', 'UNKNOWN_STATE'], ['parked', 'unknown', 'UNKNOWN_STATE'], ['moving', 'allowed', 'UNSAFE_STATE'], ['parked', 'restricted', 'UNSAFE_STATE'], ['moving', 'restricted', 'UNSAFE_STATE']]) {
    configure(store, V1, { motion, ux });
    for (const action of [REQUEST, LOCK]) assert.equal(store.inspect({ actorId: A, vehicleId: V1, action }).decision.code, code);
    const read = store.inspect({ actorId: A, vehicleId: V1, action: READ });
    assert.equal(read.decision.decision, code === 'UNKNOWN_STATE' ? 'denied' : 'allowed');
    if (code === 'UNKNOWN_STATE') assert.deepEqual(read.fields, {});
  }
});

test('freshness enforces an inclusive 120-second bound and rejects future timestamps', t => {
  for (const delta of [0, 120000, 120001, -1]) {
    const { store, advanceClock } = fixture(t);
    advanceClock(delta);
    for (const action of [READ, REQUEST, LOCK]) {
      const result = store.inspect({ actorId: A, vehicleId: V1, action });
      assert.equal(result.decision.code, delta >= 0 && delta <= 120000 ? 'POLICY_MATCH' : 'STALE_STATE');
      if (delta < 0 || delta > 120000) assert.deepEqual(result.fields, {});
    }
  }
  const { store } = fixture(t);
  configure(store, V1, { fresh: false });
  assert.equal(store.getState(A).vehicles[0].fresh, false);
  assert.equal(store.inspect({ actorId: A, vehicleId: V1, action: READ }).decision.code, 'STALE_STATE');
});

test('new vehicles are isolated, unassigned and unusable until explicitly configured in the demo', t => {
  const { store, directory } = fixture(t);
  const result = store.register(input());
  const registered = result.state.vehicles.at(-1);
  assert.equal(result.state.vehicles.length, 3);
  assert.match(registered.name, /가상/);
  assert.deepEqual(Object.values(registered.capabilities), ['unknown', 'unknown', 'unknown']);
  assert.equal(registered.motion, 'unknown');
  assert.equal(registered.ux, 'unknown');
  assert.deepEqual(registered.fields, {});
  assert.equal(store.getState('driver-a').vehicles.length, 2);
  assert.equal(store.getState('parent-a').vehicles.length, 1);
  assert.equal(store.getState(B).vehicles.length, 1);
  unchanged(store, directory, () => run(store, 'driver-a', registered.id), errorIs(403, 'SCOPE_DENIED'));
  for (let count = 3; count < 12; count++) store.register(input());
  unchanged(store, directory, () => store.register(input()), errorIs(422, 'LIMIT'));
  assert.equal(store.getState(A).vehicles.length, 12);
  assert.equal(store.register(input(B)).state.vehicles.length, 2);
});

test('bindings accept only scoped nonduplicate vehicles and supported bounded action steps', t => {
  const { store, directory } = fixture(t);
  for (const vehicleIds of [[], [V1, V1], [V1, V3], [V1, 'vehicle-999'], 'vehicle-101', null, Array(13).fill(V1)]) {
    unchanged(store, directory, () => store.bind(input(A, { vehicleIds, actions: [READ] })), vehicleIds?.includes?.(V3) || vehicleIds?.includes?.('vehicle-999') ? errorIs(403, 'SCOPE_DENIED') : errorIs(422, 'INVALID_INPUT'));
  }
  for (const actions of [[], [READ, READ], ['engine.start'], 'vehicle.read', null]) unchanged(store, directory, () => store.bind(input(A, { vehicleIds: [V1], actions })), errorIs(422, 'INVALID_INPUT'));
  for (const actorId of ['parent-a', 'customer-a']) unchanged(store, directory, () => binding(store, [actorId === 'parent-a' ? V1 : V2], [READ], actorId), errorIs(403, 'ROLE_DENIED'));
  const selected = binding(store, [V2, V1], [LOCK, READ, REQUEST], 'driver-a');
  assert.equal(selected.contract, 'bounded-fleet-v1');
  assert.deepEqual(selected.actions, [READ, REQUEST, LOCK]);
  assert.deepEqual(selected.vehicleIds, [V2, V1]);
  assert.equal(store.getState(A).bindings.length, 1);
  assert.equal(store.getState('driver-a').bindings.length, 1);
  assert.equal(store.getState('parent-a').bindings.length, 0);
  assert.equal(store.getState(B).bindings.length, 0);
});

test('binding IDs cannot bypass organization, creator or vehicle scope and cannot mix single-run inputs', t => {
  const { store, directory } = fixture(t);
  const selected = binding(store);
  for (const actorId of ['driver-a', 'parent-a', 'customer-a', B]) unchanged(store, directory, () => runBinding(store, selected, actorId), errorIs(404, 'BINDING_NOT_FOUND'));
  for (const extra of [{ vehicleId: V1 }, { action: READ }, { vehicleId: V1, action: READ }]) unchanged(store, directory, () => store.run(input(A, { bindingId: selected.id, ...extra })), errorIs(422, 'INVALID_INPUT'));
  const driverBinding = binding(store, [V1], [READ], 'driver-a');
  assert.equal(runBinding(store, driverBinding, A).rows[0].vehicleId, V1);
  assert.equal(runBinding(store, driverBinding, 'driver-a').actorId, 'driver-a');
});

test('creating a run snapshots its binding and policy without executing even a read', t => {
  const { store, directory } = fixture(t);
  const selected = binding(store, [V1], [READ, REQUEST, LOCK]);
  const batch = runBinding(store, selected);
  assert.equal(batch.version, 1);
  assert.equal(batch.policyVersion, 1);
  assert.equal(batch.bindingVersion, selected.version);
  assert.equal(batch.mode, 'simulation');
  assert.equal(batch.realVehicleConnected, false);
  for (const item of batch.rows[0].steps) {
    assert.equal(item.attempts, 0);
    assert.equal(item.output, null);
    assert.equal(item.approval, null);
    assert.equal(item.trace[0].stage, 'policy');
  }
  assert.equal(step(batch).status, 'allowed');
  assert.equal(step(batch, V1, REQUEST).status, 'needs_approval');
  assert.ok(step(batch, V1, REQUEST).trace.some(item => item.stage === 'request_recorded'));
  const saved = JSON.parse(persisted(directory)).batches[0];
  assert.equal(saved.bindingSnapshot.id, selected.id);
  assert.equal(saved.policySnapshot.version, 1);
  assert.equal(saved.rows[0].vehicleSnapshot.version, 1);
});

test('read-only execution has no approval step, and repeated execution cannot duplicate effects', t => {
  const { store, directory } = fixture(t);
  let batch = run(store, 'parent-a');
  unchanged(store, directory, () => approve(store, batch, V1, READ), errorIs(409, 'NOT_AWAITING'));
  batch = transition(store, batch, 'execute', {}, 'parent-a');
  assert.equal(batch.version, 2);
  assert.equal(batch.rows[0].status, 'simulated');
  assert.equal(step(batch).attempts, 1);
  assert.equal(step(batch).approval, null);
  assert.deepEqual(Object.keys(step(batch).output.fields), ['rider', 'schedule', 'attendance', 'status', 'eta']);
  assert.equal(step(batch).trace.filter(item => item.stage === 'local_record').length, 1);
  unchanged(store, directory, () => transition(store, batch, 'execute', {}, 'parent-a'), errorIs(409, 'NO_ELIGIBLE_STEP'));
  unchanged(store, directory, () => transition(store, batch, 'retry', {}, 'parent-a'), errorIs(409, 'NO_ELIGIBLE_STEP'));
});

test('operator approval is vehicle/action-specific and execution is a separate local-only transition', t => {
  const { store, directory } = fixture(t);
  const originalFields = structuredClone(store.getState(A).vehicles[0].fields);
  let batch = runBinding(store, binding(store, [V1], [REQUEST, LOCK], 'driver-a'), 'driver-a');
  unchanged(store, directory, () => transition(store, batch, 'execute', {}, 'driver-a'), errorIs(409, 'NO_ELIGIBLE_STEP'));
  for (const actorId of ['driver-a', 'parent-a']) unchanged(store, directory, () => approve(store, batch, V1, LOCK, actorId), errorIs(403, 'ROLE_DENIED'));
  unchanged(store, directory, () => transition(store, batch, 'approve'), errorIs(422, 'REVIEW_REQUIRED'));
  unchanged(store, directory, () => transition(store, batch, 'approve', { rowId: row(batch).id }), errorIs(422, 'REVIEW_REQUIRED'));
  batch = approve(store, batch);
  assert.equal(step(batch, V1, LOCK).status, 'approved');
  assert.equal(step(batch, V1, LOCK).attempts, 0);
  assert.equal(step(batch, V1, LOCK).output, null);
  assert.equal(step(batch, V1, REQUEST).status, 'needs_approval');
  assert.deepEqual(store.getState(A).vehicles[0].fields, originalFields);
  batch = transition(store, batch, 'execute', {}, 'driver-a');
  assert.equal(step(batch, V1, LOCK).status, 'simulated');
  assertSimulation(step(batch, V1, LOCK).output);
  assert.equal(step(batch, V1, REQUEST).status, 'needs_approval');
  assert.deepEqual(store.getState(A).vehicles[0].fields, originalFields);
  batch = approve(store, batch, V1, REQUEST);
  batch = transition(store, batch, 'execute', {}, 'driver-a');
  assertSimulation(step(batch, V1, REQUEST).output);
  assert.equal(step(batch, V1, LOCK).attempts, 1);
  assert.deepEqual(store.getState(A).vehicles[0].fields, originalFields);
});

test('non-operators may execute only their own requests and never an out-of-scope batch or row', t => {
  const { store, directory } = fixture(t);
  const batch = runBinding(store, binding(store));
  unchanged(store, directory, () => transition(store, batch, 'execute', { rowId: row(batch).id }, 'parent-a'), errorIs(403, 'ROLE_DENIED'));
  unchanged(store, directory, () => transition(store, batch, 'execute', { rowId: row(batch, V2).id }, 'parent-a'), errorIs(403, 'SCOPE_DENIED'));
  unchanged(store, directory, () => transition(store, batch, 'execute', {}, 'driver-a'), errorIs(403, 'ROLE_DENIED'));
  unchanged(store, directory, () => transition(store, batch, 'execute', {}, B), errorIs(404, 'BATCH_NOT_FOUND'));
  unchanged(store, directory, () => transition(store, batch, 'execute', { rowId: 'unknown-row' }), errorIs(404, 'ROW_NOT_FOUND'));
});

test('snapshot and live role policy must both permit controls at approval time', t => {
  const { store } = fixture(t);
  let batch = run(store, 'driver-a', V1, LOCK);
  changePolicy(store, rules => { rules.driver.actions[LOCK] = 'deny'; });
  batch = approve(store, batch);
  assert.equal(step(batch, V1, LOCK).status, 'denied');
  assert.equal(step(batch, V1, LOCK).decision.code, 'POLICY_DENIED');
  assert.equal(step(batch, V1, LOCK).approval, null);
  assert.equal(step(batch, V1, LOCK).attempts, 0);
  changePolicy(store, rules => { rules.driver.actions[LOCK] = 'approval'; });
  assert.equal(store.getState('driver-a').batches[0].rows[0].steps[0].status, 'denied');
});

test('even a non-restrictive policy version change requires a new control request before approval', t => {
  const { store } = fixture(t);
  let batch = run(store, A, V1, LOCK);
  changePolicy(store, () => {});
  batch = approve(store, batch);
  assert.equal(step(batch, V1, LOCK).decision.code, 'SNAPSHOT_CHANGED');
  assert.equal(step(batch, V1, LOCK).status, 'denied');
  assert.equal(step(batch, V1, LOCK).approval, null);
});

test('vehicle version changes between request and approval invalidate the vehicle snapshot', t => {
  const { store } = fixture(t);
  let batch = run(store, A, V1, LOCK);
  configure(store);
  batch = approve(store, batch);
  assert.equal(step(batch, V1, LOCK).decision.code, 'SNAPSHOT_CHANGED');
  assert.equal(step(batch, V1, LOCK).attempts, 0);
});

test('policy or capability-version changes after approval invalidate execution without an attempt', t => {
  for (const modify of [store => changePolicy(store, () => {}), store => configure(store)]) {
    const { store } = fixture(t);
    let batch = approve(store, run(store, A, V1, LOCK));
    modify(store);
    batch = transition(store, batch, 'execute');
    assert.equal(step(batch, V1, LOCK).status, 'denied');
    assert.equal(step(batch, V1, LOCK).decision.code, 'APPROVAL_INVALID');
    assert.equal(step(batch, V1, LOCK).attempts, 0);
    assert.equal(step(batch, V1, LOCK).output, null);
  }
});

test('execution rechecks capability, state, UX, freshness and current deny rules after approval', t => {
  const cases = [
    ['CAPABILITY_DENIED', store => configure(store, V1, { capabilities: { [READ]: 'supported', [REQUEST]: 'supported', [LOCK]: 'unknown' } })],
    ['UNSAFE_STATE', store => configure(store, V1, { motion: 'moving' })],
    ['UNSAFE_STATE', store => configure(store, V1, { ux: 'restricted' })],
    ['UNKNOWN_STATE', store => configure(store, V1, { ux: 'unknown' })],
    ['STALE_STATE', store => configure(store, V1, { fresh: false })],
    ['POLICY_DENIED', store => changePolicy(store, rules => { rules.operator.actions[LOCK] = 'deny'; })],
  ];
  for (const [code, modify] of cases) {
    const { store } = fixture(t);
    let batch = approve(store, run(store, A, V1, LOCK));
    modify(store);
    batch = transition(store, batch, 'execute');
    const item = step(batch, V1, LOCK);
    assert.equal(item.status, 'denied');
    assert.equal(item.decision.code, code);
    assert.equal(item.attempts, 0);
    assert.equal(item.output, null);
  }
  const { store, advanceClock } = fixture(t);
  let batch = approve(store, run(store, A, V1, LOCK));
  advanceClock(120001);
  batch = transition(store, batch, 'execute');
  assert.equal(step(batch, V1, LOCK).decision.code, 'STALE_STATE');
});

test('revocation before execution is durable and neither execute nor retry can restore the approval', t => {
  const { store, directory, clock } = fixture(t);
  let batch = approve(store, run(store, A, V1, LOCK));
  batch = transition(store, batch, 'revoke', { rowId: row(batch).id, stepAction: LOCK });
  const item = step(batch, V1, LOCK);
  assert.equal(item.status, 'denied');
  assert.equal(item.decision.code, 'APPROVAL_REVOKED');
  assert.equal(item.approval.status, 'revoked');
  assert.equal(item.attempts, 0);
  assert.equal(item.output, null);
  for (const operation of ['execute', 'retry']) unchanged(store, directory, () => transition(store, batch, operation), errorIs(409, 'NO_ELIGIBLE_STEP'));
  unchanged(store, directory, () => approve(store, batch), errorIs(409, 'NOT_AWAITING'));
  const reloaded = createFleet({ dataDir: directory, clock });
  assert.equal(step(reloaded.getState(A).batches[0], V1, LOCK).approval.status, 'revoked');
  unchanged(reloaded, directory, () => transition(reloaded, batch, 'execute'), errorIs(409, 'NO_ELIGIBLE_STEP'));
});

test('approval cannot be revoked after a local output has already been recorded', t => {
  const { store, directory } = fixture(t);
  let batch = approve(store, run(store, A, V1, LOCK));
  batch = transition(store, batch, 'execute');
  unchanged(store, directory, () => transition(store, batch, 'revoke', { rowId: row(batch).id, stepAction: LOCK }), errorIs(409, 'NO_APPROVAL'));
});

test('default fleet fan-out keeps successful, failed, denied and pending steps independent', t => {
  const { store } = fixture(t);
  let batch = runBinding(store, binding(store, [V1, V2], [READ, REQUEST, LOCK]));
  assert.equal(step(batch, V2, LOCK).status, 'denied');
  assert.equal(step(batch, V2, LOCK).decision.code, 'CAPABILITY_DENIED');
  batch = transition(store, batch, 'execute');
  assert.equal(step(batch, V1, READ).status, 'simulated');
  assert.equal(step(batch, V2, READ).status, 'failed');
  assert.equal(step(batch, V1, REQUEST).status, 'needs_approval');
  assert.equal(step(batch, V1, LOCK).status, 'needs_approval');
  assert.equal(step(batch, V2, LOCK).status, 'denied');
  batch = transition(store, batch, 'retry', { rowId: row(batch, V2).id, stepAction: READ });
  assert.equal(step(batch, V2, READ).status, 'simulated');
  assert.equal(step(batch, V2, READ).attempts, 2);
  assert.equal(step(batch, V1, READ).attempts, 1);
  assert.equal(step(batch, V2, LOCK).attempts, 0);
  assert.equal(step(batch, V2, REQUEST).attempts, 0);
  assert.equal(step(batch, V1, READ).trace.filter(item => item.stage === 'local_record').length, 1);
});

test('selective approval and retry do not execute another vehicle or duplicate successful control outputs', t => {
  const { store, directory } = fixture(t);
  configure(store, V2, { capabilities: { [READ]: 'supported', [REQUEST]: 'supported', [LOCK]: 'supported' } });
  let batch = runBinding(store, binding(store, [V1, V2], [LOCK]));
  batch = approve(store, batch, V1);
  batch = transition(store, batch, 'execute');
  assert.equal(step(batch, V1, LOCK).status, 'simulated');
  assert.equal(step(batch, V2, LOCK).status, 'needs_approval');
  batch = approve(store, batch, V2);
  batch = transition(store, batch, 'execute');
  assert.equal(step(batch, V2, LOCK).status, 'failed');
  assert.equal(step(batch, V2, LOCK).output, null);
  unchanged(store, directory, () => transition(store, batch, 'execute'), errorIs(409, 'NO_ELIGIBLE_STEP'));
  batch = transition(store, batch, 'retry', { rowId: row(batch, V2).id, stepAction: LOCK });
  assert.equal(step(batch, V2, LOCK).status, 'simulated');
  assert.equal(step(batch, V2, LOCK).attempts, 2);
  assert.equal(step(batch, V1, LOCK).attempts, 1);
  for (const selected of [V1, V2]) {
    assert.equal(step(batch, selected, LOCK).trace.filter(item => item.stage === 'local_record').length, 1);
    assertSimulation(step(batch, selected, LOCK).output);
  }
});

test('retry revalidates stale approval and state rather than treating adapter failure as permission', t => {
  const { store } = fixture(t);
  configure(store, V2, { capabilities: { [READ]: 'supported', [REQUEST]: 'supported', [LOCK]: 'supported' } });
  let batch = approve(store, run(store, A, V2, LOCK), V2);
  batch = transition(store, batch, 'execute');
  assert.equal(step(batch, V2, LOCK).status, 'failed');
  changePolicy(store, () => {});
  batch = transition(store, batch, 'retry');
  assert.equal(step(batch, V2, LOCK).status, 'denied');
  assert.equal(step(batch, V2, LOCK).decision.code, 'APPROVAL_INVALID');
  assert.equal(step(batch, V2, LOCK).attempts, 1);
  assert.equal(step(batch, V2, LOCK).output, null);
});

test('batch state and stored read outputs are scoped and field-masked for every viewer', t => {
  const { store } = fixture(t);
  let batch = runBinding(store, binding(store));
  batch = transition(store, batch, 'execute');
  batch = transition(store, batch, 'retry');
  for (const [actorId, vehicleId, forbiddenVehicle] of [['parent-a', V1, V2], ['customer-a', V2, V1]]) {
    const view = store.getState(actorId).batches[0];
    assert.deepEqual(view.rows.map(item => item.vehicleId), [vehicleId]);
    assert.deepEqual(Object.keys(step(view, vehicleId).output.fields), ['rider', 'schedule', 'attendance', 'status', 'eta']);
    assert.equal(JSON.stringify(view).includes(forbiddenVehicle), false);
    assert.equal(Object.hasOwn(step(view, vehicleId).output.fields, 'position'), false);
    assert.equal(Object.hasOwn(step(view, vehicleId).output.fields, 'battery'), false);
    assert.equal(Object.hasOwn(step(view, vehicleId).output.fields, 'doorState'), false);
  }
  assert.deepEqual(store.getState(B).batches, []);
  assert.equal(store.getState('driver-a').batches[0].rows.length, 2);
  changePolicy(store, rules => { rules.parent.fields = ['eta']; rules.customer.actions[READ] = 'deny'; });
  assert.deepEqual(step(store.getState('parent-a').batches[0]).output.fields, { eta: 3 });
  const customerBatch = store.getState('customer-a').batches[0];
  assert.deepEqual(customerBatch.actions, []);
  assert.deepEqual(customerBatch.rows[0].steps, []);
  assert.deepEqual(store.getState('customer-a').vehicles[0].fields, {});
});

test('later field broadening cannot widen historical read output beyond its captured role policy', t => {
  const { store } = fixture(t);
  changePolicy(store, rules => { rules.parent.fields = ['eta']; });
  let batch = run(store, 'parent-a');
  batch = transition(store, batch, 'execute', {}, 'parent-a');
  changePolicy(store, rules => { rules.parent.fields = ['eta', 'position', 'destination']; });
  const view = store.getState('parent-a');
  assert.deepEqual(Object.keys(view.vehicles[0].fields), ['eta', 'position', 'destination']);
  assert.deepEqual(step(view.batches[0]).output.fields, { eta: 3 });
  assert.deepEqual(step(batch).output.fields, { eta: 3 });
});

test('read execution applies both snapshot and current field allowlists and current read denial', t => {
  const { store } = fixture(t);
  let batch = run(store, 'parent-a');
  changePolicy(store, rules => { rules.parent.fields = ['eta', 'position']; });
  batch = transition(store, batch, 'execute', {}, 'parent-a');
  assert.deepEqual(step(batch).output.fields, { eta: 3 });
  let second = run(store, 'parent-a');
  changePolicy(store, rules => { rules.parent.actions[READ] = 'deny'; });
  second = transition(store, second, 'execute', {}, 'parent-a');
  assert.equal(step(second).status, 'denied');
  assert.equal(step(second).decision.code, 'POLICY_DENIED');
  assert.equal(step(second).attempts, 0);
  assert.equal(step(second).output, null);
});

test('idempotency keys are mandatory, length-bounded and not consumed by rejected mutations', t => {
  const { store, directory } = fixture(t);
  for (const idempotencyKey of [undefined, null, '', 'short', 12345678, 'x'.repeat(101)]) unchanged(store, directory, () => store.run({ actorId: A, vehicleId: V1, action: READ, idempotencyKey }), errorIs(422, 'KEY_REQUIRED'));
  const idempotencyKey = 'same-key-after-denial';
  unchanged(store, directory, () => store.run({ actorId: A, vehicleId: V3, action: READ, idempotencyKey }), errorIs(403, 'SCOPE_DENIED'));
  const result = store.run({ actorId: A, vehicleId: V1, action: READ, idempotencyKey });
  assert.equal(result.replayed, false);
  assert.equal(store.getState(A).batches.length, 1);
});

test('idempotency is scoped per actor and refuses a changed payload, operation or transition target', t => {
  const { store, directory } = fixture(t);
  const body = { actorId: A, vehicleId: V1, action: READ, idempotencyKey: 'shared-idempotency-key' };
  const first = store.run(body);
  const replay = store.run(structuredClone(body));
  assert.equal(replay.replayed, true);
  assert.equal(replay.batch.id, first.batch.id);
  assert.equal(store.getState(A).batches.length, 1);
  unchanged(store, directory, () => store.run({ ...body, vehicleId: V2 }), errorIs(409, 'IDEMPOTENCY_CONFLICT'));
  unchanged(store, directory, () => store.register({ actorId: A, idempotencyKey: body.idempotencyKey }), errorIs(409, 'IDEMPOTENCY_CONFLICT'));
  assert.equal(store.run({ ...body, actorId: 'driver-a' }).replayed, false);
  assert.equal(store.run({ ...body, actorId: B, vehicleId: V3 }).replayed, false);
  const transitionBody = input(A, { expectedVersion: first.batch.version });
  const executed = store.transition(first.batch.id, 'execute', transitionBody);
  const repeated = store.transition(first.batch.id, 'execute', transitionBody);
  assert.equal(repeated.replayed, true);
  assert.equal(repeated.batch.version, executed.batch.version);
  assert.equal(step(repeated.batch).attempts, 1);
  unchanged(store, directory, () => store.transition(first.batch.id, 'retry', transitionBody), errorIs(409, 'IDEMPOTENCY_CONFLICT'));
  const other = run(store);
  unchanged(store, directory, () => store.transition(other.id, 'execute', transitionBody), errorIs(409, 'IDEMPOTENCY_CONFLICT'));
});

test('persisted reload recovers approvals, failed steps, outputs and durable idempotency without duplicate effects', t => {
  const { store, directory, clock } = fixture(t);
  configure(store, V2, { capabilities: { [READ]: 'supported', [REQUEST]: 'supported', [LOCK]: 'supported' } });
  const selected = binding(store, [V1, V2], [LOCK]);
  let batch = runBinding(store, selected);
  batch = approve(store, batch, V1);
  batch = approve(store, batch, V2);
  const executeBody = input(A, { expectedVersion: batch.version });
  batch = store.transition(batch.id, 'execute', executeBody).batch;
  assert.equal(step(batch, V1, LOCK).status, 'simulated');
  assert.equal(step(batch, V2, LOCK).status, 'failed');
  const reloaded = createFleet({ dataDir: directory, clock });
  assert.deepEqual(reloaded.getState(A), store.getState(A));
  const replay = reloaded.transition(batch.id, 'execute', executeBody);
  assert.equal(replay.replayed, true);
  assert.equal(replay.batch.version, batch.version);
  const retryBody = input(A, { expectedVersion: batch.version, rowId: row(batch, V2).id, stepAction: LOCK });
  batch = reloaded.transition(batch.id, 'retry', retryBody).batch;
  assert.equal(step(batch, V1, LOCK).attempts, 1);
  assert.equal(step(batch, V2, LOCK).attempts, 2);
  const twiceReloaded = createFleet({ dataDir: directory, clock });
  assert.equal(twiceReloaded.transition(batch.id, 'retry', retryBody).replayed, true);
  assert.equal(step(twiceReloaded.getState(A).batches[0], V2, LOCK).trace.filter(item => item.stage === 'local_record').length, 1);
});

test('idempotent replay returns a freshly scoped view rather than an old unmasked response', t => {
  const { store } = fixture(t);
  const body = input('parent-a', { vehicleId: V1, action: READ });
  let batch = store.run(body).batch;
  batch = transition(store, batch, 'execute', {}, 'parent-a');
  changePolicy(store, rules => { rules.parent.fields = ['eta']; });
  const replay = store.run(body);
  assert.equal(replay.replayed, true);
  assert.equal(replay.batch.id, batch.id);
  assert.deepEqual(step(replay.batch).output.fields, { eta: 3 });
});

test('unknown top-level and nested inputs reject live credentials, coordinates and arbitrary commands atomically', t => {
  const { store, directory } = fixture(t);
  const batch = run(store);
  const current = store.getState(A);
  const vehicle = current.vehicles[0];
  const operations = [
    extra => store.inspect({ actorId: A, vehicleId: V1, action: READ, ...extra }),
    extra => store.run(input(A, { vehicleId: V1, action: READ, ...extra })),
    extra => store.bind(input(A, { vehicleIds: [V1], actions: [READ], ...extra })),
    extra => store.register(input(A, extra)),
    extra => store.changePolicy(input(A, { expectedVersion: 1, rules: current.policy.rules, ...extra })),
    extra => store.configure(input(A, { vehicleId: V1, expectedVersion: 1, motion: 'parked', ux: 'allowed', capabilities: vehicle.capabilities, fresh: true, failOnce: false, ...extra })),
    extra => store.transition(batch.id, 'execute', input(A, { expectedVersion: batch.version, ...extra })),
  ];
  for (const perform of operations) {
    for (const extra of [{ token: 'fixture-not-a-secret' }, { endpoint: 'https://example.invalid' }, { latitude: 37 }, { realVehicleConnected: true }, { command: 'unlock' }, { approval: true }]) unchanged(store, directory, () => perform(extra), errorIs(422, 'INVALID_INPUT'));
  }
  unchanged(store, directory, () => configure(store, V1, { capabilities: { ...vehicle.capabilities, 'engine.start': 'supported' } }), errorIs(422, 'INVALID_INPUT'));
  for (const invalid of [undefined, null, [], 'text', 1]) {
    assert.throws(() => store.inspect(invalid), errorIs(422, 'INVALID_INPUT'));
    unchanged(store, directory, () => store.run(invalid), errorIs(422, 'INVALID_INPUT'));
  }
});

test('vehicle configuration strictly validates its simulated enums and booleans', t => {
  const { store, directory } = fixture(t);
  for (const overrides of [{ motion: 'stopped' }, { motion: null }, { ux: 'unrestricted' }, { ux: true }, { failOnce: 'false' }, { failOnce: 0 }, { fresh: 'true' }, { fresh: null }, { capabilities: { [READ]: 'supported', [REQUEST]: 'supported' } }, { capabilities: [] }, { capabilities: { [READ]: 'supported', [REQUEST]: 'supported', [LOCK]: true } }]) unchanged(store, directory, () => configure(store, V1, overrides), errorIs(422, 'INVALID_INPUT'));
});

test('returned state and batch values cannot mutate stored policies, data, snapshots or global allowlists', t => {
  const { store } = fixture(t);
  const batch = run(store);
  const before = store.getState(A);
  const response = store.getState(A);
  response.policy.rules.operator.fields.length = 0;
  response.vehicles[0].fields.rider = 'tampered';
  response.vehicles[0].capabilities[READ] = 'unsupported';
  response.batches[0].actions.push('engine.start');
  response.batches[0].rows[0].steps[0].trace[0].detail = 'tampered';
  response.actors[0].id = 'admin';
  response.actor.role = 'customer';
  response.ceilings.parent.push('battery');
  assert.deepEqual(store.getState(A), before);
  batch.rows[0].steps[0].status = 'simulated';
  assert.equal(step(store.getState(A).batches[0]).status, 'allowed');
  // Restore exported constants even if the regression fails, avoiding cross-test pollution.
  const fieldNames = structuredClone(FLEET_FIELDS);
  const actionNames = structuredClone(FLEET_ACTIONS);
  const roleNames = structuredClone(FLEET_ROLES);
  try {
    response.fields.injected = 'unexpected';
    response.actions['engine.start'] = 'unexpected';
    response.roles.admin = 'unexpected';
    assert.deepEqual(store.getState(A).fields, fieldNames);
    assert.deepEqual(store.getState(A).actions, actionNames);
    assert.deepEqual(store.getState(A).roles, roleNames);
  } finally {
    delete FLEET_FIELDS.injected;
    delete FLEET_ACTIONS['engine.start'];
    delete FLEET_ROLES.admin;
  }
});

test('malformed persisted stores fail closed rather than silently reset existing records', t => {
  for (const content of ['not JSON', '{}', '{"schema":999}', '{"schema":1,"vehicles":[],"policies":[],"bindings":[],"batches":[]}']) {
    const { directory, clock } = fixture(t);
    writeFileSync(join(directory, 'fleet.json'), content);
    assert.throws(() => createFleet({ dataDir: directory, clock }), errorIs(500, 'CORRUPT_FLEET'));
    assert.equal(readFileSync(join(directory, 'fleet.json'), 'utf8'), content);
  }
});

test('HTTP fleet endpoints enforce demo actor, scope, input validation and local-only result labels', async t => {
  const { base, post } = await httpFixture(t);
  let response = await fetch(base + '/api/fleet');
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'DEMO_ACTOR_REQUIRED');
  response = await fetch(base + '/api/fleet?actorId=parent-a');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const state = await response.json();
  assert.deepEqual(state.vehicles.map(vehicle => vehicle.id), [V1]);
  assert.equal(Object.hasOwn(state.vehicles[0].fields, 'position'), false);
  let result = await post('/api/fleet/inspect', { actorId: 'parent-a', vehicleId: V2, action: READ });
  assert.equal(result.status, 200);
  assert.equal(result.body.decision.code, 'SCOPE_DENIED');
  assert.deepEqual(result.body.fields, {});
  result = await post('/api/fleet/runs', input('parent-a', { vehicleId: V2, action: READ }));
  assert.equal(result.status, 403);
  assert.equal(result.body.error.code, 'SCOPE_DENIED');
  result = await post('/api/fleet/runs', input(A, { vehicleId: V1, action: READ, token: 'fake' }));
  assert.equal(result.status, 422);
  assert.equal(result.body.error.code, 'INVALID_INPUT');
  result = await post('/api/fleet/runs', input(A, { vehicleId: V1, action: LOCK }));
  let batch = result.body.batch;
  assert.equal(result.status, 200);
  assert.equal(step(batch, V1, LOCK).status, 'needs_approval');
  result = await post(`/api/fleet/runs/${batch.id}/approve`, input(A, { expectedVersion: batch.version, rowId: row(batch).id, stepAction: LOCK }));
  batch = result.body.batch;
  assert.equal(result.status, 200);
  assert.equal(step(batch, V1, LOCK).output, null);
  result = await post(`/api/fleet/runs/${batch.id}/execute`, input(A, { expectedVersion: batch.version }));
  assert.equal(result.status, 200);
  assertSimulation(step(result.body.batch, V1, LOCK).output);
  assert.equal(result.body.batch.realVehicleConnected, false);
});

test('HTTP fleet writes reject foreign origins, non-JSON bodies, oversized inputs and unsupported routes', async t => {
  const { base, post, server } = await httpFixture(t);
  const before = server.fleet.getState(A);
  let result = await post('/api/fleet/vehicles', input(), { origin: 'https://example.invalid' });
  assert.equal(result.status, 403);
  assert.equal(result.body.error.code, 'ORIGIN_REJECTED');
  result = await post('/api/fleet/vehicles', input(), { 'content-type': 'text/plain' });
  assert.equal(result.status, 415);
  result = await post('/api/fleet/vehicles', input(A, { padding: 'x'.repeat(32768) }));
  assert.equal(result.status, 413);
  const malformed = await fetch(base + '/api/fleet/vehicles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, 'INVALID_JSON');
  result = await post('/api/fleet/connect-live', input());
  assert.equal(result.status, 404);
  assert.deepEqual(server.fleet.getState(A), before);
});

test('historical trip rows never become visible to the next trip occupant after reassignment', t => {
  const { store, directory, clock } = fixture(t);
  const executed = transition(store, run(store), 'execute');
  assert.equal(step(executed).output.fields.rider, '가상 원생 A');
  // Simulate a future provider-side reassignment without adding a live or admin API.
  const saved = JSON.parse(persisted(directory));
  saved.vehicles.find(vehicle => vehicle.id === V1).tripId = 'trip-102';
  saved.vehicles.find(vehicle => vehicle.id === V1).data.rider = '새 운행의 가상 원생';
  writeFileSync(join(directory, 'fleet.json'), JSON.stringify(saved));
  const reloaded = createFleet({ dataDir: directory, clock });
  assert.deepEqual(reloaded.getState('parent-a').vehicles, []);
  assert.deepEqual(reloaded.getState('parent-a').batches, []);
  assert.ok(reloaded.getState('customer-a').vehicles.some(vehicle => vehicle.id === V1));
  const customerBatches = reloaded.getState('customer-a').batches;
  assert.deepEqual(customerBatches, []);
  assert.equal(JSON.stringify(customerBatches).includes('가상 원생 A'), false);
  assert.deepEqual(reloaded.getState(A).batches, []);
  assert.equal(JSON.parse(persisted(directory)).batches[0].id, executed.id);
});

test('a stored trip reassignment blocks an existing read request before any adapter attempt', t => {
  const { store, directory, clock } = fixture(t);
  const pending = run(store);
  const saved = JSON.parse(persisted(directory));
  saved.vehicles.find(vehicle => vehicle.id === V1).tripId = 'trip-reassigned';
  writeFileSync(join(directory, 'fleet.json'), JSON.stringify(saved));
  const reloaded = createFleet({ dataDir: directory, clock });
  const batch = transition(reloaded, pending, 'execute');
  assert.deepEqual(batch.rows, []);
  const savedStep = JSON.parse(persisted(directory)).batches[0].rows[0].steps[0];
  assert.equal(savedStep.status, 'denied');
  assert.equal(savedStep.decision.code, 'TRIP_CHANGED');
  assert.equal(savedStep.attempts, 0);
  assert.equal(savedStep.output, null);
});

test('own historical outputs are masked when current read state becomes stale or policy denies reading', t => {
  const { store, advanceClock } = fixture(t);
  transition(store, run(store, 'parent-a'), 'execute', {}, 'parent-a');
  advanceClock(120001);
  let visible = store.getState('parent-a').batches[0];
  assert.deepEqual(step(visible).output.fields, {});
  assert.equal(step(visible).output.masked, true);
  configure(store);
  changePolicy(store, rules => { rules.parent.actions[READ] = 'deny'; });
  visible = store.getState('parent-a').batches[0];
  assert.deepEqual(step(visible).output.fields, {});
  assert.equal(step(visible).output.masked, true);
});

test('parent/customer views suppress forbidden control actions from other actors’ batch histories', t => {
  const { store } = fixture(t);
  let batch = runBinding(store, binding(store, [V1, V2], [READ, REQUEST, LOCK]));
  batch = approve(store, batch, V1);
  batch = transition(store, batch, 'execute');
  for (const actorId of ['parent-a', 'customer-a']) {
    const view = store.getState(actorId).batches[0];
    assert.equal(view.actions.includes(LOCK), false);
    assert.equal(view.rows.some(item => item.steps.some(action => action.action === LOCK)), false);
    assert.equal(JSON.stringify(view).includes('문 잠금 모의 기록 생성'), false);
  }
});

test('changing the current policy cannot revive a step denied under the original snapshot', t => {
  const { store, directory } = fixture(t);
  changePolicy(store, rules => { rules.driver.actions[LOCK] = 'deny'; });
  const batch = run(store, 'driver-a', V1, LOCK);
  assert.equal(step(batch, V1, LOCK).status, 'denied');
  changePolicy(store, rules => { rules.driver.actions[LOCK] = 'approval'; });
  for (const operation of ['execute', 'retry']) unchanged(store, directory, () => transition(store, batch, operation, {}, 'driver-a'), errorIs(409, 'NO_ELIGIBLE_STEP'));
  unchanged(store, directory, () => approve(store, batch), errorIs(409, 'NOT_AWAITING'));
});

test('batch transitions enforce optimistic version checks and preserve exactly-once approval traces', t => {
  const { store, directory } = fixture(t);
  let batch = run(store, A, V1, LOCK);
  for (const expectedVersion of [undefined, null, '1', 0, -1, 1.5, true, 999]) unchanged(store, directory, () => store.transition(batch.id, 'approve', input(A, { expectedVersion, rowId: row(batch).id, stepAction: LOCK })), errorIs(409, 'VERSION_CONFLICT'));
  const approvalBody = input(A, { expectedVersion: batch.version, rowId: row(batch).id, stepAction: LOCK });
  batch = store.transition(batch.id, 'approve', approvalBody).batch;
  const replay = store.transition(batch.id, 'approve', approvalBody);
  assert.equal(replay.replayed, true);
  assert.equal(replay.batch.version, batch.version);
  assert.equal(step(replay.batch, V1, LOCK).trace.filter(item => item.stage === 'approval').length, 1);
  unchanged(store, directory, () => transition(store, batch, 'execute', { expectedVersion: 1 }), errorIs(409, 'VERSION_CONFLICT'));
  unchanged(store, directory, () => approve(store, batch), errorIs(409, 'NOT_AWAITING'));
});

test('reading and inspecting expiry does not mutate fleet persistence or advance a batch', t => {
  const { store, directory, advanceClock } = fixture(t);
  const batch = run(store);
  const bytes = persisted(directory);
  advanceClock(120001);
  assert.equal(store.inspect({ actorId: A, vehicleId: V1, action: READ }).decision.code, 'STALE_STATE');
  assert.equal(store.getState(A).vehicles[0].decision.code, 'STALE_STATE');
  assert.equal(store.getState(A).batches[0].version, batch.version);
  assert.equal(step(store.getState(A).batches[0]).attempts, 0);
  assert.equal(persisted(directory), bytes);
});

test('concurrent HTTP requests with the same key return one durable run identity', async t => {
  const { server, post } = await httpFixture(t);
  const body = input(A, { vehicleId: V1, action: READ });
  const results = await Promise.all([post('/api/fleet/runs', body), post('/api/fleet/runs', body)]);
  assert.deepEqual(results.map(result => result.status), [200, 200]);
  assert.equal(results[0].body.batch.id, results[1].body.batch.id);
  assert.deepEqual(results.map(result => result.body.replayed).sort(), [false, true]);
  assert.equal(server.fleet.getState(A).batches.length, 1);
});

test('concurrent HTTP execution is version-guarded and produces only one local output', async t => {
  const { server, post } = await httpFixture(t);
  const batch = (await post('/api/fleet/runs', input(A, { vehicleId: V1, action: READ }))).body.batch;
  const results = await Promise.all([
    post(`/api/fleet/runs/${batch.id}/execute`, input(A, { expectedVersion: batch.version })),
    post(`/api/fleet/runs/${batch.id}/execute`, input(A, { expectedVersion: batch.version })),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal(results.find(result => result.status === 409).body.error.code, 'VERSION_CONFLICT');
  const saved = server.fleet.getState(A).batches[0];
  assert.equal(saved.version, 2);
  assert.equal(step(saved).attempts, 1);
  assert.equal(step(saved).trace.filter(item => item.stage === 'local_record').length, 1);
});

test('explicit malformed transition selectors never broaden a selective request into fleet-wide execution', t => {
  const { store, directory } = fixture(t);
  const batch = runBinding(store, binding(store, [V1, V2], [READ, LOCK]));
  const malformed = [
    ...[undefined, null, '', '   ', false, true, 0, [], {}, [row(batch).id]].map(rowId => ({ rowId })),
    ...[undefined, null, '', false, true, 0, [], {}, [READ], 'engine.start', 'vehicle.READ'].map(stepAction => ({ stepAction })),
  ];
  for (const action of ['approve', 'revoke', 'execute', 'retry']) {
    for (const selector of malformed) {
      unchanged(store, directory, () => transition(store, batch, action, selector), errorIs(422, 'INVALID_INPUT'));
    }
  }
  const executed = transition(store, batch, 'execute', { rowId: row(batch).id, stepAction: READ });
  assert.equal(step(executed, V1, READ).status, 'simulated');
  assert.equal(step(executed, V1, READ).attempts, 1);
  assert.equal(step(executed, V2, READ).status, 'allowed');
  assert.equal(step(executed, V2, READ).attempts, 0);
  assert.equal(step(executed, V1, LOCK).status, 'needs_approval');
  assert.equal(step(executed, V1, LOCK).attempts, 0);
});

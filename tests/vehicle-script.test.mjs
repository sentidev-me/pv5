import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCommunication } from '../communication.mjs';
import { esc } from '../public/customer-view.js';
import { vehicleDisplay, communicationSummary, isClosed } from '../public/vehicle-view.js';

// Executes the actual controller and renderers with a small DOM/fetch harness.
// These cover async controller logic, not real-browser layout or accessibility.
const source = readFileSync(new URL('../public/vehicle.js', import.meta.url), 'utf8').replace(/^import[^\n]+\n/gm, '');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function fixture(t, status = null) {
  const directory = mkdtempSync(join(tmpdir(), 'mobflow-vehicle-script-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = createCommunication({ dataDir: directory });
  const control = { store, calls: [], getPlans: [], failMutation: null, loseCreateOnce: false, loseMutationOnce: null };
  if (status) {
    const configuration = store.saveConfiguration({ templateVersion: 1, role: 'school', kakaoEnabled: true, sharingEnabled: true }).configuration;
    let run = store.createRun({ configurationId: configuration.id, configurationVersion: 1 }).run;
    const actions = [['vehicle-motion', { motion: 'parked' }], ['vehicle-ux', { restriction: 'allowed' }]];
    if (status === 'arrived') actions.push(['vehicle-depart', {}], ['vehicle-approach', {}], ['vehicle-motion', { motion: 'parked' }], ['vehicle-arrive', {}]);
    for (const [action, body] of actions) run = store.transition(run.id, action, { expectedVersion: run.version, ...body }).run;
  }
  control.handle = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : undefined;
    control.calls.push({ url, body });
    if (url === '/api/communication') {
      const plan = control.getPlans.shift();
      return plan ? plan() : store.getState();
    }
    if (url === '/api/communication/configurations') return store.saveConfiguration(body);
    if (url === '/api/communication/runs') {
      const result = store.createRun(body);
      if (control.loseCreateOnce) { control.loseCreateOnce = false; throw Error('Create response lost after commit'); }
      return result;
    }
    const match = url.match(/^\/api\/communication\/runs\/([^/]+)\/([^/]+)$/);
    assert.ok(match, `Unexpected endpoint: ${url}`);
    const [, id, action] = match;
    if (control.failMutation === action) throw Error('Mutation connection failed');
    const result = store.transition(id, action, body);
    if (control.loseMutationOnce === action) { control.loseMutationOnce = null; throw Error('Mutation response lost after commit'); }
    return result;
  };
  return control;
}

function mockDocument() {
  let elements = [];
  const app = {
    html: '',
    get innerHTML() { return this.html; },
    set innerHTML(html) {
      this.html = html;
      elements = [...html.matchAll(/<button\b([^>]*)>/g)].map(([, attributes]) => {
        const attrs = Object.fromEntries([...attributes.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]));
        return { id: attrs.id, disabled: /(?:^|\s)disabled(?:\s|$)/.test(attributes), dataset: Object.fromEntries(Object.entries(attrs).filter(([key]) => key.startsWith('data-')).map(([key, value]) => [key.slice(5), value])) };
      });
    },
  };
  return { app, document: { querySelector: (selector) => selector === '#app' ? app : elements.find((element) => `#${element.id}` === selector) || null } };
}

async function page(control) {
  const { app, document } = mockDocument();
  const intervals = [], storage = new Map();
  let serial = 0;
  const context = vm.createContext({
    document, esc, vehicleDisplay, communicationSummary, isClosed, AbortController,
    crypto: { randomUUID: () => `test-key-${++serial}` },
    sessionStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    setTimeout: () => 1, clearTimeout() {},
    setInterval: (callback) => { intervals.push(callback); return intervals.length; },
    fetch: async (url, options) => {
      try {
        const result = await control.handle(url, options);
        return { ok: true, json: async () => structuredClone(result) };
      } catch (error) {
        if (!error.status) throw error;
        return { ok: false, json: async () => ({ error: { code: error.code, message: error.message } }) };
      }
    },
  });
  const inspect = await new vm.Script(`(async()=>{${source}\nreturn ()=>({busy,error,confirming,selected,preparedRun});})()`, { filename: 'public/vehicle.js' }).runInContext(context);
  assert.equal(intervals.length, 1);
  const idle = async () => {
    for (let tries = 0; tries < 100 && inspect().busy; tries++) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(inspect().busy, false, 'Controller should settle');
  };
  return {
    app, document, inspect, poll: () => intervals[0](),
    click: async (id) => {
      const element = document.querySelector(`#${id}`);
      assert.ok(element, `${id} should exist`);
      assert.equal(element.disabled, false, `${id} should be enabled`);
      await element.onclick();
      await idle();
    },
  };
}

async function completeThroughUi(ui) {
  if (!ui.document.querySelector('#sim-parked').disabled) await ui.click('sim-parked');
  if (!ui.document.querySelector('#vehicle-action')) await ui.click('sim-ux');
  await ui.click('vehicle-action');
  await ui.click('sim-approach');
  await ui.click('sim-parked');
  await ui.click('vehicle-action');
  await ui.click('vehicle-action');
  await ui.click('confirm-completion');
}

test('vehicle controller ignores an old successful poll after a newer failed action and failed recovery', async (t) => {
  const control = fixture(t, 'ready'), ui = await page(control);
  const old = deferred(), snapshot = control.store.getState();
  control.getPlans.push(() => old.promise, () => { throw Error('New state unavailable'); });
  const polling = ui.poll();
  control.failMutation = 'vehicle-depart';
  await ui.click('vehicle-action');
  assert.match(ui.inspect().error, /Mutation connection failed/);
  assert.equal(ui.document.querySelector('#vehicle-action').disabled, true);
  old.resolve(snapshot);
  await polling;
  assert.match(ui.inspect().error, /Mutation connection failed/);
  assert.equal(ui.document.querySelector('#vehicle-action').disabled, true);
  assert.equal(control.store.getState().runs[0].status, 'ready');
});

test('vehicle controller ignores an old poll failure after a newer successful action and reload', async (t) => {
  const control = fixture(t, 'ready'), ui = await page(control);
  const old = deferred();
  control.getPlans.push(() => old.promise);
  const polling = ui.poll();
  await ui.click('vehicle-action');
  assert.equal(control.store.getState().runs[0].status, 'departed');
  assert.equal(ui.inspect().error, '');
  old.reject(Error('Superseded poll failed'));
  await polling;
  assert.equal(ui.inspect().error, '');
  assert.match(ui.app.html, /주행 모의 · 조작 잠금/);
});

test('partial preparation can be finished manually and next preparation creates a new run', async (t) => {
  const control = fixture(t), ui = await page(control);
  control.failMutation = 'vehicle-motion';
  await ui.click('prepare-demo');
  assert.equal(control.store.getState().runs.length, 1);
  const first = control.store.getState().runs[0];
  assert.equal(first.status, 'ready');
  assert.equal(ui.document.querySelector('#prepare-demo').disabled, true);
  assert.equal(ui.inspect().preparedRun, null);
  control.failMutation = null;
  await ui.click('retry-load');
  await completeThroughUi(ui);
  assert.equal(control.store.getState().runs[0].status, 'completed');
  await ui.click('prepare-demo');
  assert.equal(ui.inspect().error, '');
  const runs = control.store.getState().runs;
  assert.equal(runs.length, 2);
  assert.notEqual(runs[0].id, first.id);
  assert.equal(runs[0].status, 'ready');
  assert.equal(runs[0].vehicleSimulation.motion, 'parked');
  assert.equal(runs[0].vehicleSimulation.uxRestriction, 'allowed');
  const creates = control.calls.filter((call) => call.url === '/api/communication/runs');
  assert.notEqual(creates[0].body.idempotencyKey, creates[1].body.idempotencyKey);
});

test('unacknowledged create response keeps its retry key and never creates a second live run', async (t) => {
  const control = fixture(t), ui = await page(control);
  control.loseCreateOnce = true;
  await ui.click('prepare-demo');
  assert.equal(control.store.getState().runs.length, 1);
  assert.equal(ui.inspect().preparedRun, null);
  await ui.click('prepare-demo');
  assert.equal(ui.inspect().error, '');
  const creates = control.calls.filter((call) => call.url === '/api/communication/runs');
  assert.equal(creates.length, 2);
  assert.equal(creates[0].body.idempotencyKey, creates[1].body.idempotencyKey);
  assert.equal(control.store.getState().runs.length, 1);
  assert.equal(control.store.getState().runs[0].vehicleSimulation.uxRestriction, 'allowed');
});

test('polling cancels pending completion when motion or UX becomes unsafe and cannot resurrect it', async (t) => {
  for (const [action, extra] of [['vehicle-motion', { motion: 'moving' }], ['vehicle-ux', { restriction: 'blocked' }]]) {
    const control = fixture(t, 'arrived'), ui = await page(control);
    await ui.click('vehicle-action');
    assert.ok(ui.document.querySelector('#confirm-completion'));
    let run = control.store.getState().runs[0];
    run = control.store.transition(run.id, action, { expectedVersion: run.version, ...extra }).run;
    await ui.poll();
    assert.equal(ui.inspect().confirming, false);
    assert.equal(ui.document.querySelector('#confirm-completion'), null);
    const restore = action === 'vehicle-motion' ? { motion: 'parked' } : { restriction: 'allowed' };
    control.store.transition(run.id, action, { expectedVersion: run.version, ...restore });
    await ui.poll();
    assert.ok(ui.document.querySelector('#vehicle-action'));
    assert.equal(ui.document.querySelector('#confirm-completion'), null);
    assert.equal(control.store.getState().runs[0].status, 'arrived');
    assert.equal(control.store.getState().notifications.filter((notice) => notice.stage === 'completion').length, 0);
  }
});

test('failed poll cancels completion intent and recovery requires a fresh intent click', async (t) => {
  const control = fixture(t, 'arrived'), ui = await page(control);
  await ui.click('vehicle-action');
  assert.ok(ui.document.querySelector('#confirm-completion'));
  control.getPlans.push(() => { throw Error('Cannot confirm current vehicle state'); });
  await ui.poll();
  assert.equal(ui.document.querySelector('#confirm-completion'), null);
  assert.equal(ui.inspect().confirming, false);
  await ui.poll();
  assert.equal(ui.inspect().error, '');
  assert.ok(ui.document.querySelector('#vehicle-action'));
  assert.equal(ui.document.querySelector('#confirm-completion'), null);
});

test('lost completion response reloads the terminal result and never duplicates a completion notice', async (t) => {
  const control = fixture(t, 'arrived'), ui = await page(control);
  await ui.click('vehicle-action');
  control.loseMutationOnce = 'vehicle-complete';
  await ui.click('confirm-completion');
  assert.equal(control.store.getState().runs[0].status, 'completed');
  assert.equal(ui.document.querySelector('#confirm-completion'), null);
  assert.equal(ui.document.querySelector('#vehicle-action'), null);
  await ui.click('retry-load');
  await ui.poll();
  assert.equal(ui.inspect().error, '');
  assert.equal(control.store.getState().notifications.filter((notice) => notice.stage === 'completion').length, 1);
  assert.equal(control.calls.filter((call) => call.url.endsWith('/vehicle-complete')).length, 1);
  assert.match(ui.app.html, /위치 공유 종료/);
});

test('cancelling completion does not mutate and repeated confirmation clicks are busy-guarded', async (t) => {
  const control = fixture(t, 'arrived'), ui = await page(control);
  const version = control.store.getState().runs[0].version;
  await ui.click('vehicle-action');
  await ui.click('cancel-completion');
  assert.equal(control.store.getState().runs[0].version, version);
  await ui.click('vehicle-action');
  const button = ui.document.querySelector('#confirm-completion');
  const first = button.onclick();
  const second = button.onclick();
  await Promise.all([first, second]);
  assert.equal(control.calls.filter((call) => call.url.endsWith('/vehicle-complete')).length, 1);
  assert.equal(control.store.getState().notifications.filter((notice) => notice.stage === 'completion').length, 1);
  assert.equal(ui.document.querySelector('#confirm-completion'), null);
});

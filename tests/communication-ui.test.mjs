import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { customerPhone, esc } from '../public/customer-view.js';

// These are frontend logic regressions, not browser/layout/accessibility tests.
// Run the actual script and customer renderer against a small mocked DOM/fetch.
// Only its static import is replaced with the same imported renderer functions.
const source = readFileSync(new URL('../public/communication.js', import.meta.url), 'utf8')
  .replace(/^import\s+\{customerPhone,esc\}\s+from\s+'\.\/customer-view\.js';\s*/, '');

const config = {
  id: 'config-1', version: 1, templateVersion: 1, role: 'school',
  kakaoEnabled: true, sharingEnabled: true, sharingStart: 'departure',
  showPosition: true, showDistance: true, showEta: true, ttlMinutes: 30,
  notifications: { departure: true, approaching: true, arrival: true, completion: true },
};

function makeRun(id = 'run-1', status = 'departed', sharingStatus = 'active') {
  return {
    id, version: 2, status, configSnapshot: structuredClone(config),
    operatorLabel: '가상 운영자', customer: { id: 'demo-parent-1', name: '가상 고객' },
    destination: { label: '가상 목적지' }, notifications: [],
    link: { token: `mock-${id}`, customerId: 'demo-parent-1', url: `/customer.html?token=mock-${id}&customerId=demo-parent-1` },
    sharing: { status: sharingStatus, enabled: sharingStatus === 'active' },
  };
}

function backend(initialRuns = [makeRun()]) {
  const state = {
    template: { version: 1 }, configurations: [], runs: initialRuns,
    notifications: [], presets: [{ id: 'school', label: '학원·학교', operatorLabel: '가상 운영자', customer: { name: '가상 고객' }, destination: { label: '가상 목적지' } }],
  };
  const creationKeys = new Map();
  const control = { state, failState: false, failCreateOnce: false, saveWait: null, calls: [] };
  control.handle = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : undefined;
    control.calls.push({ url, body });
    if (url === '/api/communication') {
      if (control.failState) throw new Error('Simulated connection failure');
      return state;
    }
    if (url.startsWith('/api/customer-links/')) {
      const run = state.runs.find((entry) => url.includes(entry.link.token));
      assert.ok(run, 'The client should fetch the selected run link');
      return {
        runId: run.id, status: run.status, sharing: run.sharing,
        operatorLabel: run.operatorLabel, customerName: run.customer.name,
        destinationLabel: run.destination.label, notifications: run.notifications,
        ...(run.sharing.status === 'active' ? {
          position: { x: 12, y: 18 }, remainingDistanceMeters: 2400, etaMinutes: 8,
        } : {}),
      };
    }
    if (url === '/api/communication/configurations') {
      if (control.saveWait) await control.saveWait;
      const saved = { ...structuredClone(config), ...body };
      state.configurations = [saved];
      return { configuration: saved };
    }
    if (url === '/api/communication/runs') {
      if (control.failCreateOnce) {
        control.failCreateOnce = false;
        throw new Error('Simulated unacknowledged create failure');
      }
      if (creationKeys.has(body.idempotencyKey)) return { run: creationKeys.get(body.idempotencyKey), replayed: true };
      const run = makeRun(`run-${state.runs.length + 1}`, 'ready', 'waiting');
      run.configSnapshot = structuredClone(state.configurations[0]);
      state.runs.unshift(run);
      creationKeys.set(body.idempotencyKey, run);
      return { run };
    }
    const completion = url.match(/^\/api\/communication\/runs\/([^/]+)\/complete$/);
    if (completion) {
      const run = state.runs.find((entry) => entry.id === completion[1]);
      assert.equal(run.status, 'arrived');
      assert.equal(body.expectedVersion, run.version);
      run.version += 1;
      run.status = 'completed';
      run.sharing = { status: 'completed', enabled: false };
      return { run };
    }
    throw new Error(`Unexpected mock request: ${url}`);
  };
  return control;
}

function mockDocument() {
  let elements = [];
  const document = { activeElement: null };
  const toast = { textContent: '', classList: { add() {}, remove() {} } };
  const app = {
    html: '', renders: 0,
    get innerHTML() { return this.html; },
    set innerHTML(html) {
      this.html = html;
      this.renders += 1;
      elements = [...html.matchAll(/<(input|select|button)\b([^>]*)>/g)].map(([, tag, attributes]) => {
        const attrs = Object.fromEntries([...attributes.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]));
        return {
          tagName: tag.toUpperCase(), id: attrs.id,
          disabled: /(?:^|\s)disabled(?:\s|$)/.test(attributes),
          checked: /(?:^|\s)checked(?:\s|$)/.test(attributes),
          dataset: Object.fromEntries(Object.entries(attrs).filter(([key]) => key.startsWith('data-')).map(([key, value]) => [key.slice(5), value])),
        };
      });
    },
  };
  document.querySelector = (selector) => {
    if (selector === '#app') return app;
    if (selector === '#toast') return toast;
    return elements.find((element) => selector === `#${element.id}`) || null;
  };
  document.querySelectorAll = (selector) => {
    if (selector === '[data-role]') return elements.filter((element) => element.dataset.role);
    if (selector === '[data-notice]') return elements.filter((element) => element.dataset.notice);
    if (selector === '[data-role],.panel-content input,.panel-content select') {
      return elements.filter((element) => element.dataset.role || ['INPUT', 'SELECT'].includes(element.tagName));
    }
    throw new Error(`Unsupported mock selector: ${selector}`);
  };
  return { document, app };
}

async function page(control) {
  const { document, app } = mockDocument();
  const storage = new Map();
  const intervals = [];
  const timeouts = new Map();
  let serial = 0;
  let timeoutSerial = 0;
  const context = vm.createContext({
    document, customerPhone, esc, AbortController,
    crypto: { randomUUID: () => `mock-key-${++serial}` },
    sessionStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    setTimeout: (callback, delay) => {
      const id = ++timeoutSerial;
      timeouts.set(id, { callback, delay });
      return id;
    },
    clearTimeout: (id) => timeouts.delete(id),
    setInterval: (callback) => { intervals.push(callback); return intervals.length; },
    fetch: async (url, options) => {
      const result = await control.handle(url, options);
      return { ok: true, json: async () => structuredClone(result) };
    },
  });
  await new vm.Script(`(async () => {\n${source}\n})()`, { filename: 'public/communication.js' }).runInContext(context);
  assert.equal(intervals.length, 1);
  return {
    document, app, poll: () => intervals[0](),
    fireTimeouts: (delay) => {
      const matches = [...timeouts.entries()].filter(([, entry]) => entry.delay === delay);
      for (const [id, entry] of matches) {
        timeouts.delete(id);
        entry.callback();
      }
      return matches.length;
    },
    click: (id) => {
      const element = document.querySelector(`#${id}`);
      assert.ok(element, `${id} should exist`);
      assert.equal(element.disabled, false, `${id} should be enabled`);
      return element.onclick();
    },
  };
}

test('UI rotates the successful create key so unchanged settings can start a new run after completion', async () => {
  const control = backend([]);
  const ui = await page(control);
  await ui.click('activate');
  const first = control.state.runs[0];
  first.status = 'completed';
  first.sharing = { status: 'completed', enabled: false };
  await ui.poll();
  await ui.click('activate');
  const creates = control.calls.filter(({ url }) => url === '/api/communication/runs');
  assert.equal(creates.length, 2);
  assert.notEqual(creates[0].body.idempotencyKey, creates[1].body.idempotencyKey);
  assert.equal(control.state.runs.length, 2);
  assert.notEqual(control.state.runs[0].id, first.id);
  assert.equal(control.state.runs[0].status, 'ready');
});

test('UI preserves the create key when a failed create has not been acknowledged', async () => {
  const control = backend([]);
  const ui = await page(control);
  control.failCreateOnce = true;
  await ui.click('activate');
  await ui.click('activate');
  const creates = control.calls.filter(({ url }) => url === '/api/communication/runs');
  assert.equal(creates.length, 2);
  assert.equal(creates[0].body.idempotencyKey, creates[1].body.idempotencyKey);
  assert.equal(control.state.runs.length, 1);
});

test('UI masks location on every failed poll and clears connection errors after recovery', async () => {
  const control = backend();
  const ui = await page(control);
  assert.match(ui.app.html, /class="tracking-map"/);
  control.failState = true;
  await ui.poll();
  assert.doesNotMatch(ui.app.html, /class="tracking-map"|class="tracking-metrics"/);
  assert.match(ui.app.html, /로컬 서버와 연결되지 않았어요/);
  control.failState = false;
  await ui.poll();
  assert.match(ui.app.html, /class="tracking-map"/);
  assert.doesNotMatch(ui.app.html, /class="error-banner"/);
  control.failState = true;
  await ui.poll();
  assert.doesNotMatch(ui.app.html, /class="tracking-map"|class="tracking-metrics"/);
  assert.match(ui.app.html, /연결을 확인해주세요/);
});

test('UI renders stale-sharing safety changes even when a configuration control has focus', async () => {
  const control = backend();
  const ui = await page(control);
  assert.match(ui.app.html, /class="tracking-map"/);
  ui.document.activeElement = ui.document.querySelector('#sharingStart');
  assert.equal(ui.document.activeElement.tagName, 'SELECT');
  const previousRenders = ui.app.renders;
  control.state.runs[0].sharing = { status: 'stale', enabled: false };
  await ui.poll();
  assert.ok(ui.app.renders > previousRenders);
  assert.doesNotMatch(ui.app.html, /class="tracking-map"|class="tracking-metrics"/);
  assert.match(ui.app.html, /위치 업데이트가 지연됐어요/);
});

test('UI disables every role and configuration control while activation is pending', async () => {
  const control = backend([]);
  let release;
  control.saveWait = new Promise((resolve) => { release = resolve; });
  const ui = await page(control);
  const activation = ui.click('activate');
  try {
    const controls = ui.document.querySelectorAll('[data-role],.panel-content input,.panel-content select');
    assert.equal(controls.length, 14, 'Three roles, nine checkboxes and two selects should be covered');
    assert.ok(controls.every((element) => element.disabled));
    assert.equal(ui.document.querySelector('#activate').disabled, true);
  } finally {
    release();
    await activation;
  }
  assert.ok(ui.document.querySelectorAll('[data-role],.panel-content input,.panel-content select').every((element) => !element.disabled));
});

test('UI ignores an older active customer response after a newer completion action and load', async () => {
  const control = backend([makeRun('run-1', 'arrived')]);
  const ui = await page(control);
  assert.match(ui.app.html, /class="tracking-map"/);
  const handle = control.handle;
  let release;
  let markPending;
  const responsePending = new Promise((resolve) => { markPending = resolve; });
  const responseReleased = new Promise((resolve) => { release = resolve; });
  let delayOnce = true;
  control.handle = async (url, options) => {
    const result = await handle(url, options);
    if (url.startsWith('/api/customer-links/') && delayOnce) {
      delayOnce = false;
      // Capture the old active response before the simulated server completes.
      // This mock deliberately ignores abort signals to test the sequence guard.
      const olderResponse = structuredClone(result);
      markPending();
      await responseReleased;
      return olderResponse;
    }
    return result;
  };
  const oldPoll = ui.poll();
  await responsePending;
  try {
    await ui.click('progress-run');
    assert.equal(control.state.runs[0].status, 'completed');
    assert.doesNotMatch(ui.app.html, /class="tracking-map"|class="tracking-metrics"/);
    assert.match(ui.app.html, /업무 완료 · 공유 종료/);
  } finally {
    release();
    await oldPoll;
  }
  assert.doesNotMatch(ui.app.html, /class="tracking-map"|class="tracking-metrics"/);
  assert.match(ui.app.html, /업무 완료 · 공유 종료/);
});

test('UI aborts a hung poll at the configured five-second timeout and masks location', async () => {
  const control = backend();
  const ui = await page(control);
  assert.match(ui.app.html, /class="tracking-map"/);
  const handle = control.handle;
  let signal;
  control.handle = async (url, options) => {
    if (url === '/api/communication') {
      signal = options.signal;
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('Simulated fetch abort')), { once: true });
      });
    }
    return handle(url, options);
  };
  const pendingPoll = ui.poll();
  assert.equal(signal.aborted, false);
  assert.equal(ui.fireTimeouts(5000), 1, 'One pending fetch should have a five-second deadline');
  await pendingPoll;
  assert.equal(signal.aborted, true);
  assert.doesNotMatch(ui.app.html, /class="tracking-map"|class="tracking-metrics"/);
  assert.match(ui.app.html, /연결을 확인해주세요/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { defaultDefinition } from '../platform.mjs';

// Execute the actual event binding and session persistence code with a minimal
// DOM. These are frontend logic regressions, not browser rendering tests.
const source = readFileSync(new URL('../public/platform.js', import.meta.url), 'utf8').split('restore();render();window.addEventListener')[0];
function harness(elements = []) {
  const saved = new Map();
  let htmlWrites = 0;
  const ids = new Map(elements.filter(x => x.id).map(x => ['#' + x.id, x]));
  ids.set('.save-state', { textContent: '' });
  ids.set('#app', { set innerHTML(value) { htmlWrites++; }, get innerHTML() { return ''; } });
  const context = vm.createContext({
    document: { querySelector: s => ids.get(s) || null, querySelectorAll: s => s === '[data-path]' ? elements.filter(x => x.dataset?.path) : [] },
    sessionStorage: { setItem: (k,v) => saved.set(k,v), getItem: k => saved.get(k) || null },
    structuredClone, crypto: { randomUUID: () => 'fixed-demo-key-1234' }, location: { hash: '#builder' },
    setTimeout, clearTimeout, AbortController,
    fetch: async () => { throw new Error('Simulated unavailable read'); }
  });
  vm.runInContext(source + '\nglobalThis.testApi = {bind, restore, remember, action, setDraft: v => {draft=v;}, getDraft:()=>draft, getReview:()=>reviewEdits, getPending:()=>pending, selectRun: v=>{selectedRun=v;}, setPending:v=>{pending=v;}};', context);
  return { api: context.testApi, saved, get htmlWrites() { return htmlWrites; } };
}

test('numeric and title input commit immediately without DOM replacement before direct save', () => {
  const threshold = { tagName:'INPUT', type:'number', value:'30', dataset:{path:'condition.value'} };
  const freshness = { tagName:'INPUT', type:'number', value:'300', dataset:{path:'aggregate.freshnessSeconds'} };
  const title = { tagName:'INPUT', type:'text', value:'검토할 배송 흐름', dataset:{path:'title'} };
  const h=harness([threshold,freshness,title]);h.api.setDraft(defaultDefinition('delivery'));h.api.bind();
  threshold.oninput();freshness.oninput();title.oninput();
  assert.equal(h.api.getDraft().condition.value,30);assert.equal(h.api.getDraft().aggregate.freshnessSeconds,300);assert.equal(h.api.getDraft().title,'검토할 배송 흐름');
  threshold.onchange();title.onchange();assert.equal(h.htmlWrites,0);
  const stored=JSON.parse([...h.saved.values()][0]);assert.equal(stored.draft.condition.value,30);assert.equal(stored.draft.aggregate.freshnessSeconds,300);
});

test('edited review message and selected role survive persistence and restore', () => {
  const message={id:'review-message',value:'수정한 가상 고객 문안입니다.'},role={id:'review-role',value:'operator'};
  const h=harness([message,role]);h.api.setDraft(defaultDefinition());h.api.selectRun('run-demo');h.api.bind();message.oninput();role.onchange();
  assert.equal(h.api.getReview()['run-demo'].message,message.value);h.api.restore();assert.equal(h.api.getReview()['run-demo'].role,'operator');
  assert.equal(h.api.getReview()['run-demo'].message,message.value);
});

test('uncertain mutation retry key is stored before request and restored after reload', async () => {
  const h=harness();h.api.setDraft(defaultDefinition());
  await h.api.action('save',{definition:defaultDefinition()},async()=>{throw new Error('Lost mutation response');});
  assert.equal(h.api.getPending().idempotencyKey,'fixed-demo-key-1234');
  h.api.setPending(null);h.api.restore();assert.equal(h.api.getPending().idempotencyKey,'fixed-demo-key-1234');assert.equal(h.api.getPending().key,'save');
});

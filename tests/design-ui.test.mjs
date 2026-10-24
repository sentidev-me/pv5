import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../server.mjs';
import { customerPhone } from '../public/customer-view.js';
const asset = (name, encoding = 'utf8') => readFileSync(new URL(`../public/${name}`, import.meta.url), encoding);

// These guard assets and semantics. Pixel layout, font rendering, and real pointer
// workflows are separately checked in a real browser; this is not a browser test.
test('all four entry points load bundled Pretendard and the shared local design foundation', () => {
  for (const name of ['index.html', 'customer.html', 'pickup.html', 'studio.html']) {
    const html = asset(name);
    assert.match(html, /lang="ko"/);
    assert.match(html, /name="viewport"/);
    assert.match(html, /href="\/fonts\/PretendardVariable\.woff2"[^>]+as="font"/);
    assert.match(html, /href="\/design-system\.css"/);
    assert.doesNotMatch(html, /(?:src|href)="https?:/);
  }
  for (const name of ['pickup.html', 'studio.html']) assert.match(asset(name), /href="\/legacy-theme\.css"/);
});

test('the supplied Pretendard is real WOFF2 bytes with its redistribution license', () => {
  const font = asset('fonts/PretendardVariable.woff2', null);
  assert.equal(font.subarray(0, 4).toString('ascii'), 'wOF2');
  assert.equal(font.length, 2057688);
  assert.match(asset('fonts/OFL.txt'), /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.match(asset('fonts/OFL.txt'), /Pretendard/);
  assert.match(asset('fonts/README.txt'), /orioncactus\/pretendard\/v1\.3\.9/);
  assert.match(asset('design-system.css'), /font-family:'Pretendard';src:url\('\/fonts\/PretendardVariable\.woff2'\)/);
  assert.doesNotMatch(asset('design-system.css'), /src:local|@import/);
});

test('main workspace navigation and the existing simulation control hooks remain accessible', () => {
  const js = asset('communication.js');
  assert.match(js, /aria-label="주요 메뉴"/);
  assert.match(js, /aria-current="page"/);
  for (const path of ['/pickup.html', '/studio.html#catalog', '/studio.html#admin']) assert.ok(js.includes(`href="${path}"`));
  for (const id of ['activate', 'progress-run', 'new-run', 'stale-run', 'stop-run', 'sharingStart', 'ttlMinutes']) assert.ok(js.includes(`id="${id}"`));
  assert.match(js, /aria-live="polite"/);
  assert.match(js, /실제 GPS·차량·교통 데이터는 사용하지 않아요/);
  assert.match(js, /두 고정 실행 템플릿/);
});

test('blue customer view still labels the simulated map and removes it after sharing ends', () => {
  const data = { status: 'approaching', sharing: {status: 'active'}, position: {x: 71, y: 62}, etaMinutes: 2, remainingDistanceMeters: 450, destinationLabel: '가상 목적지', notifications: [] };
  const active = customerPhone(data);
  assert.match(active, /role="img" aria-label="실제 지도가 아닌 가상 격자/);
  assert.match(active, /stroke="#3a7bff"/);
  assert.match(active, /450/);
  const closed = customerPhone({...data, status: 'completed', sharing: {status: 'completed'}});
  assert.doesNotMatch(closed, /tracking-map|tracking-metrics/);
  assert.match(closed, /업무 완료 · 공유 종료/);
});

test('responsive and keyboard treatments exist without external font or CSS dependencies', () => {
  for (const name of ['design-system.css', 'communication.css', 'legacy-theme.css']) assert.doesNotMatch(asset(name), /@import\s|url\(['"]?https?:/);
  assert.match(asset('design-system.css'), /:focus-visible/);
  for (const name of ['communication.css', 'legacy-theme.css']) {
    assert.match(asset(name), /@media\(max-width:590px\)/);
    assert.match(asset(name), /prefers-reduced-motion:reduce/);
  }
});

test('HTTP serves the bundled font and design assets locally with the correct font MIME', async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'mobflow-design-'));
  const server = createServer({dataDir});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); rmSync(dataDir, {recursive:true, force:true}); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const font = await fetch(`${base}/fonts/PretendardVariable.woff2`);
  assert.equal(font.status, 200);
  assert.equal(font.headers.get('content-type'), 'font/woff2');
  assert.equal(Buffer.from(await font.arrayBuffer()).subarray(0,4).toString(), 'wOF2');
  for (const path of ['/design-system.css', '/communication.css', '/legacy-theme.css', '/fonts/OFL.txt']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    assert.ok((await response.text()).length > 100);
  }
});

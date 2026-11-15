import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
const asset=name=>readFileSync(new URL(`../public/${name}`,import.meta.url),'utf8');
test('all entry titles use the exact user-selected PleosFlows spelling',()=>{
 for(const name of readdirSync(new URL('../public/',import.meta.url)).filter(n=>n.endsWith('.html'))){
  assert.match(asset(name),/<title>PleosFlows · /,name);
  assert.doesNotMatch(asset(name),/MOBFLOW|MobFlow|mobflow/,name);
 }
});
test('primary route exposes selected concept and independent proposal disclosure',()=>{
 const js=asset('unified.js');assert.match(js,/차량의 움직임을 업무의 흐름으로/);assert.match(js,/PV5 운영자를 위한 고객 안내·반복 업무 자동화 플랫폼/);
 for(const name of ['index.html','unified.html']){assert.match(asset(name),/PleosFlows <span>PV5 WORKFLOW/);assert.match(asset(name),/Kia·Pleos의 공식 제품 또는 제휴 서비스가 아닙니다/);assert.match(asset(name),/실제 인증·외부 알림 없음/);assert.match(asset(name),/이 브라우저의 신호 입력은 모의/);assert.match(asset(name),/별도 네이티브 APK/);assert.match(asset(name),/출처 표기는 기기 인증·실차 검증이 아닙니다/);}
});
test('old browser selection keys are preserved without visible legacy branding',()=>{
 const keys={'platform.js':['mobflow-platform-editor-v1'],'fleet.js':['mobflow-fleet-console-v1'],'communication.js':['mobflow-communication-run'],'vehicle.js':['mobflow-communication-run'],'story.js':['mobflow-story-run','mobflow-story-instance']};
 for(const [name,values] of Object.entries(keys)){for(const key of values)assert.ok(asset(name).includes(key));assert.doesNotMatch(asset(name),/>mobflow[.< ]|>MOBFLOW|aria-label="MOBFLOW/);}
 assert.doesNotMatch(asset('legacy-theme.css'),/text-transform:lowercase|content:'m\.'/);
});
test('package brand changes do not remove legacy persistent-data environment override',()=>{
 const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));assert.equal(pkg.name,'pleosflows-prototype');assert.equal(pkg.version,'0.9.0');
 for(const name of ['server.mjs','workflow.mjs','communication.mjs'])assert.match(readFileSync(new URL(`../${name}`,import.meta.url),'utf8'),/process\.env\.MOBFLOW_DATA_DIR/);
});

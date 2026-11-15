import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createFleet} from '../fleet.mjs';
import {createUnified} from '../unified.mjs';
import {createNativeVehicle} from '../native-vehicle.mjs';
import vm from 'node:vm';
const source=readFileSync(new URL('../public/unified.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/unified.html',import.meta.url),'utf8');
// These VM tests exercise browser-side request/state logic with a minimal DOM.
// Pixel layout, real input focus and native browser navigation require browser QA.
function harness(search=''){
 const nodes=new Map(), storage=new Map(), listeners=new Map(), requests=[], timers=[];
 const element=()=>({innerHTML:'',textContent:'',style:{},classList:{add(){},remove(){}},disabled:false,options:[],append(){},removeAttribute(){},addEventListener(){}});
 const context=vm.createContext({URL,URLSearchParams,AbortController,crypto:{randomUUID:()=>`key-${Math.random().toString(16).slice(2)}`},Date,Number,JSON,Math,Set,Object,String,console,
  location:{search,href:'http://localhost/unified.html'+search},history:{replaceState(){}},
  sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
  document:{createElement:()=>element(),querySelector:s=>{if(!nodes.has(s))nodes.set(s,element());return nodes.get(s);},querySelectorAll:()=>[],addEventListener:(name,fn)=>listeners.set(name,fn)},
  setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout:()=>{},setInterval:()=>0,window:{addEventListener(){}},fetch:async(path,options)=>{requests.push({path,options});return {ok:true,json:async()=>({})};}
 });
 const boot=source.lastIndexOf('\nrenderShell();refresh();');assert.ok(boot>0);
 vm.runInContext(source.slice(0,boot),context);
 return {context,nodes,storage,listeners,requests,timers,run:s=>vm.runInContext(s,context)};
}
test('uncertain dispatch retry retains exact idempotency key across attempts',async()=>{
 const h=harness();h.run('refresh=async()=>{};notice=()=>{};var calls=[];api=async(p,b)=>{calls.push(b);if(calls.length===1)throw Error("network");return {run:{id:"run-a"}}}');
 await h.run('mutation("/api/unified/dispatch",{workflowId:"wf-a"})');assert.equal(JSON.parse(h.storage.get('unified-pending')).constructor,Object);
 await h.run('mutation("/api/unified/dispatch",{workflowId:"wf-a"})');
 assert.equal(h.run('calls[0].idempotencyKey'),h.run('calls[1].idempotencyKey'));assert.deepEqual(JSON.parse(h.storage.get('unified-pending')),{});
 await h.run('mutation("/api/unified/dispatch",{workflowId:"wf-a"})');assert.notEqual(h.run('calls[1].idempotencyKey'),h.run('calls[2].idempotencyKey'));
});
test('uncertain events retain original eventId and never add unsupported idempotencyKey',async()=>{
 const h=harness();h.run('refresh=async()=>{};notice=()=>{};var calls=[];api=async(p,b)=>{calls.push(b);if(calls.length===1)throw Error("timeout");return {run:{id:"r"}}}');
 await h.run('mutation("/api/unified/runs/r/events",{eventId:"event-original",vehicleId:"v",tripId:"t",kind:"departed"})');
 await h.run('mutation("/api/unified/runs/r/events",{eventId:"event-retry-new",vehicleId:"v",tripId:"t",kind:"departed"})');
 assert.equal(h.run('calls[1].eventId'),'event-original');assert.equal(h.run('Object.hasOwn(calls[1],"idempotencyKey")'),false);
});
test('definitive validation rejection clears pending identity; 5xx preserves it',async()=>{
 const h=harness();h.run('refresh=async()=>{};notice=()=>{};api=async()=>{const e=Error("invalid");e.status=422;throw e}');
 await h.run('mutation("/api/unified/dispatch",{workflowId:"wf"})');assert.deepEqual(JSON.parse(h.storage.get('unified-pending')),{});
 h.run('api=async()=>{const e=Error("unknown");e.status=500;throw e}');await h.run('mutation("/api/unified/dispatch",{workflowId:"wf"})');assert.equal(Object.keys(JSON.parse(h.storage.get('unified-pending'))).length,1);
});
test('customer refresh requests only exact scoped token API, never operator state',async()=>{
 const h=harness('?mode=customer&token=token-a&customerId=customer-a');h.run('var seen=[];api=async(p)=>{seen.push(p);return {runId:"run-a",sharing:"active",fields:{eta:8},validUntil:Date.now()+5000}};renderCustomer=()=>{}');await h.run('refresh()');
 assert.deepEqual(JSON.parse(h.run('JSON.stringify(seen)')),['/api/unified/customer/token-a?customerId=customer-a']);assert.equal(h.run('customerPayload.runId'),'run-a');
});
test('customer fetch failure drops previous protected payload and masks display',async()=>{
 const h=harness('?mode=customer&token=token-a&customerId=customer-a');h.run('customerPayload={sharing:"active",fields:{eta:8,position:{x:2,y:3}}};validUntil=Date.now()+60000;var rendered=[];renderCustomer=(v,e)=>rendered.push([v,e]);api=async()=>{throw Error("offline")}');
 await h.run('refresh()');assert.equal(h.run('customerPayload'),null);assert.equal(h.run('validUntil'),0);assert.equal(h.run('rendered[0][0]'),null);assert.equal(h.run('rendered[0][1]'),'offline');
});
test('missing customer identity fails closed without making an API call',async()=>{
 const h=harness('?mode=customer&token=token-a');h.run('var apiCalls=0;api=async()=>{apiCalls++;return {}};renderCustomer=()=>{}');await h.run('refresh()');assert.equal(h.run('apiCalls'),0);assert.equal(h.run('customerPayload'),null);
});
test('selected run remains explicit with concurrent newer runs',()=>{
 const h=harness('?run=run-a');h.run('state={runs:[{id:"run-b"},{id:"run-a",customerToken:"ta",customerId:"ca"},{id:"run-c"}]}');assert.equal(h.run('chosen().id'),'run-a');assert.match(h.run('runLink(chosen(),"driver")'),/run=run-a/);assert.match(h.run('runLink(chosen(),"customer")'),/token=ta&customerId=ca/);h.run('selected="missing"');assert.equal(h.run('chosen()'),undefined);
});
test('hidden customer data does not render protected fields even if accidentally present',()=>{
 const h=harness('?mode=customer');h.run('renderCustomer({runId:"r",workflowVersion:1,state:"completed",sharing:"hidden",fields:{eta:99,position:{x:93,y:94}},reason:"COMPLETED"})');
 const output=h.nodes.get('#customer-view').innerHTML;assert.doesNotMatch(output,/class="eta"/);assert.doesNotMatch(output,/class="map"/);
 assert.doesNotMatch(output,/"eta": 99/); // Hidden debug payload is also masked.
});
test('mutations invalidate older refresh generations and block when disconnected',async()=>{
 const h=harness();h.run('refresh=async()=>{};notice=()=>{};var count=0;api=async()=>{count++;return {}};generation=10');await h.run('mutation("/api/unified/dispatch",{workflowId:"x"})');assert.equal(h.run('generation'),11);h.run('disconnected=true');await h.run('mutation("/api/unified/dispatch",{workflowId:"y"})');assert.equal(h.run('count'),1);
});
test('driver completion has review step, cancel, and server-expiry gate',()=>{
 const h=harness('?mode=driver&run=r');h.run('state={runs:[{id:"r",state:"arrived",accepted:true,motion:"parked",ux:"allowed",vehicleStateAt:Date.now(),workflowVersion:1,vehicleId:"v",tripId:"t",customerId:"c",jobId:"j"}]};renderDriver()');assert.match(h.nodes.get('#driver-view').innerHTML,/인계 \/ 전달 확인 · 업무 완료/);
 h.run('completionReview="r";renderDriver()');assert.match(h.nodes.get('#driver-view').innerHTML,/인계 확인 완료 · 공유 종료/);assert.match(h.nodes.get('#driver-view').innerHTML,/cancel-completion/);
 h.run('state.runs[0].expired=true;renderDriver()');assert.doesNotMatch(h.nodes.get('#driver-view').innerHTML,/data-command="complete"/);
});
test('observer actions are separated from driver card and no implicit prepare default exists',()=>{
 const h=harness('?mode=driver&run=r');h.run('state={runs:[{id:"r",state:"departed",accepted:true,motion:"moving",ux:"restricted",vehicleStateAt:Date.now(),workflowVersion:1,vehicleId:"v",tripId:"t",customerId:"c",jobId:"j"}]};renderDriver()');assert.doesNotMatch(h.nodes.get('#driver-view').innerHTML,/data-event/);assert.match(h.nodes.get('#observer-view').innerHTML,/시연 관찰자 패널/);assert.doesNotMatch(source,/runs\[0\]/);
});
test('static contract: customer local-expiry timer and bundled font foundation exist',()=>{
 assert.match(source,/Date\.now\(\)>=validUntil/);assert.match(source,/customerPayload=null;validUntil=0;renderCustomer\(null/);assert.match(html,/PretendardVariable\.woff2/);assert.match(html,/design-system\.css/);
});

test('already-expired successful customer response is masked before render',async()=>{
 const h=harness('?mode=customer&token=a&customerId=c');h.run('var seen=[];api=async()=>({sharing:"active",fields:{eta:88},validUntil:Date.now()-1});renderCustomer=(v,e)=>seen.push([v,e])');await h.run('refresh()');assert.equal(h.run('customerPayload'),null);assert.equal(h.run('seen[0][0]'),null);assert.match(h.run('seen[0][1]'),/유효 시간/);
});
test('API timeout aborts hanging fetch and leaves uncertain mutation identity',async()=>{
 const h=harness();h.run('refresh=async()=>{};notice=()=>{};fetch=(path,opts)=>new Promise((resolve,reject)=>{opts.signal.addEventListener("abort",()=>{const error=Error("aborted");error.name="AbortError";reject(error)})})');
 const promise=h.run('mutation("/api/unified/dispatch",{workflowId:"wf-timeout"})');const timer=h.timers.find(t=>t.ms===8000);assert.ok(timer);timer.fn();await promise;assert.equal(h.run('busy'),false);assert.equal(Object.keys(JSON.parse(h.storage.get('unified-pending'))).length,1);
});


// Render actual persisted native bindings, not a hand-invented frontend flag.
function nativeFixture(t,source='aaos',target='assigned'){
 const dir=mkdtempSync(join(tmpdir(),'native-web-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const clock=()=>1700000000000,fleet=createFleet({dataDir:dir,clock}),u=createUnified({dataDir:dir,fleet,clock}),native=createNativeVehicle({unified:u,clock});
 let context=native.fixture({vehicleId:'vehicle-101',source,idempotencyKey:'ui-native-fixture-key'});
 if(target!=='assigned'){
  context=native.observe({runId:context.assignment.runId,clientId:'pleosflows-android',sessionId:'ui-session',sequence:1,source,connected:true,speedMps:0,gear:'P',uxRestricted:false,observedAt:clock()});
  for(const action of ['accept','depart','arrive',...(target==='completed'?['complete']:[])])context=native.command(context.assignment.runId,{clientId:'pleosflows-android',sessionId:'ui-session',expectedVersion:context.assignment.version,idempotencyKey:`ui-native-${action}-key`,action,...(action==='complete'?{completionConfirmed:true}:{})});
 }
 const run=u.getState().runs.find(r=>r.id===context.assignment.runId);
 return {u,native,run};
}
for(const [source,label] of [['aaos','AAOS 에뮬레이터 입력'],['debug-fixture','개발자 모의 입력 (debug-fixture)']])test(`actual ${source} binding renders explicit provenance without browser accept or injected signals`,t=>{
 const {u,run}=nativeFixture(t,source),h=harness(`?mode=driver&run=${run.id}`);
 h.run(`state=${JSON.stringify(u.getState())};renderDriver()`);
 const driver=h.nodes.get('#driver-view').innerHTML,observer=h.nodes.get('#observer-view').innerHTML;
 assert.ok(driver.includes(label));assert.match(driver,/기기 인증·실차 검증이 아닙니다/);assert.match(driver,/네이티브 ETA·위치 미수집/);
 assert.match(driver,/이 브라우저는 읽기 전용/);assert.doesNotMatch(driver,/data-command="accept"/);assert.doesNotMatch(observer,/data-event|fail-notice/);assert.match(observer,/웹 모의 입력 차단/);
});
test('actual native arrival removes stale browser completion review and never renders complete button',t=>{
 const {u,run}=nativeFixture(t,'aaos','arrived'),h=harness(`?mode=driver&run=${run.id}`);
 h.run(`state=${JSON.stringify(u.getState())};completionReview=${JSON.stringify(run.id)};renderDriver()`);
 assert.equal(h.run('completionReview'),null);assert.doesNotMatch(h.nodes.get('#driver-view').innerHTML,/data-command="complete"|cancel-completion/);assert.match(h.nodes.get('#driver-view').innerHTML,/정차 중 별도 네이티브 APK/);
});
test('native operator view preserves revoke and exact-run audit while observer is read-only',t=>{
 const {u,run}=nativeFixture(t,'aaos','arrived'),h=harness(`?run=${run.id}`);
 h.run(`state=${JSON.stringify(u.getState())};renderOperator()`);
 const detail=h.nodes.get('#run-detail').innerHTML,audit=h.nodes.get('#audit-list').innerHTML;
 assert.match(detail,/data-command="revoke"/);assert.match(detail,/차량 앱 연결 기록/);assert.doesNotMatch(detail,/data-event|fail-notice|data-command="complete"|data-command="accept"/);
 assert.ok(detail.includes(run.id));assert.match(audit,/native_accept/);assert.match(audit,/native_arrive/);assert.equal(h.nodes.get('#audit-run').textContent,run.id.slice(0,8));
});
test('native delegated clicks reject stale simulated controls but still allow operator revoke',async t=>{
 const {u,run}=nativeFixture(t),h=harness(`?run=${run.id}`);h.run(`state=${JSON.stringify(u.getState())};var calls=[];mutation=async(p,b)=>calls.push({p,b});notice=()=>{}`);
 const click=h.listeners.get('click');for(const dataset of [{command:'accept'},{command:'complete'},{event:'arrived'},{retry:'fake-action'}])await click({target:{closest:()=>({dataset})}});
 assert.equal(h.run('calls.length'),0);await click({target:{closest:()=>({dataset:{command:'revoke'}})}});assert.equal(h.run('calls.length'),1);assert.equal(h.run('calls[0].p'),`/api/unified/runs/${run.id}/revoke`);
});
test('native failed notices stay read-only and cannot expose legacy retry button',t=>{
 const {run}=nativeFixture(t),h=harness();const view={...run,actions:[{id:'failure-a',kind:'departure',status:'failed',attempts:1,eventId:'event-a'}]};
 const rendered=h.run(`actions(${JSON.stringify(view)})`);assert.doesNotMatch(rendered,/data-retry/);assert.match(rendered,/읽기 전용 실패 기록/);
});
test('actual native customer projection shows no ETA/location and does not imply pre-departure after departure',t=>{
 const {u,run}=nativeFixture(t,'aaos','arrived'),h=harness('?mode=customer');const response=u.customer(run.customerToken,run.customerId);
 h.run(`renderCustomer(${JSON.stringify(response)})`);const rendered=h.nodes.get('#customer-view').innerHTML;
 assert.doesNotMatch(rendered,/class="eta"|class="map"|class="distance"/);assert.doesNotMatch(rendered,/업무 출발 전입니다/);assert.match(rendered,/네이티브 앱 연동의 ETA·위치는 제공하지 않습니다/);assert.ok(rendered.includes(run.id));
});
test('current HTML footer distinguishes browser simulation and native APK without blanket unconnected claim',()=>{
 for(const file of ['unified.html','index.html']){const markup=readFileSync(new URL('../public/'+file,import.meta.url),'utf8');assert.match(markup,/통합 실행 · v0.9.0/);assert.match(markup,/별도 네이티브 APK/);assert.doesNotMatch(markup,/실제 인증, Pleos SDK, 외부 알림 미연결/);assert.match(markup,/출처 표기는 기기 인증·실차 검증이 아닙니다/);}
});

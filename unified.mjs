/** Authoritative bounded workflow slice. Local simulator, not authentication or vehicle SDK. */
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { WorkflowError } from './workflow.mjs';
const clone = x => structuredClone(x);
const fail = (code, message, status = 422) => { throw new WorkflowError(status, code, message); };
const validObject = (x, keys) => { if (!x || typeof x !== 'object' || Array.isArray(x) || Object.keys(x).some(k => !keys.includes(k))) fail('INVALID_INPUT','허용된 모의 입력만 사용할 수 있습니다.'); };
const canonical = x => Array.isArray(x) ? x.map(canonical) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])) : x;
const fingerprint = x => createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
export const UNIFIED_ASSIGNMENTS = Object.freeze([
 {vehicleId:'vehicle-101',tripId:'trip-101',customerId:'demo-parent-1',actorId:'parent-a',label:'차량 101 · 운행 A · 가상 고객 A'},
 {vehicleId:'vehicle-102',tripId:'trip-102',customerId:'demo-customer-2',actorId:'customer-a',label:'차량 102 · 운행 B · 가상 고객 B'}
]);
const FRESH_MS = 120000;
export function createUnified({dataDir, fleet, clock=Date.now}) {
 mkdirSync(dataDir,{recursive:true}); const path=join(dataDir,'unified.json');
 let state = {schema:1,workflows:[],runs:[],keys:{}};
 if(existsSync(path)){try{state=JSON.parse(readFileSync(path,'utf8'));if(state.schema!==1||!Array.isArray(state.workflows)||!Array.isArray(state.runs)||!state.keys)throw Error();}catch{fail('CORRUPT_UNIFIED','통합 업무 저장소를 읽을 수 없습니다. 원본을 보존했습니다.',500);}}
 const now=()=>{const v=Number(clock());if(!Number.isFinite(v))throw Error('Invalid clock');return v;};
 const persist=()=>{writeFileSync(path+'.tmp',JSON.stringify(state,null,2));renameSync(path+'.tmp',path);};
 const audit=(r,type,detail)=>r.audit.push({at:now(),type,detail,runId:r.id,jobId:r.jobId,workflowVersion:r.workflowVersion,vehicleId:r.vehicleId,tripId:r.tripId});
 const workflow=id=>{const w=state.workflows.find(w=>w.id===id);if(!w)fail('WORKFLOW_NOT_FOUND','활성화한 업무를 찾을 수 없습니다.',404);return w;};
 const run=id=>{const r=state.runs.find(r=>r.id===id);if(!r)fail('RUN_NOT_FOUND','업무 실행을 찾을 수 없습니다.',404);return r;};
 const active=r=>!r.revoked&&!['completed','revoked'].includes(r.state)&&now()<r.expiresAt;
 const fresh=r=>r.telemetry&&Number.isFinite(r.telemetry.at)&&now()>=r.telemetry.at&&now()-r.telemetry.at<=FRESH_MS;
 const publicRun=r=>({...clone(r),version:r.version||0,expired:now()>=r.expiresAt,validUntil:r.telemetry?Math.min(r.expiresAt,r.telemetry.at+FRESH_MS):null});
 const policy=()=>fleet.getState('operator-a').policy;
 function mutate(op,input,keys,fn){
  validObject(input,[...keys,'idempotencyKey']);
  if(typeof input.idempotencyKey!=='string'||input.idempotencyKey.length<8||input.idempotencyKey.length>120)fail('KEY_REQUIRED','8–120자 중복 방지 키가 필요합니다.');
  const key=input.idempotencyKey,fp=fingerprint({op,input});
  if(Object.hasOwn(state.keys,key)){const old=state.keys[key];if(old.fp!==fp)fail('IDEMPOTENCY_CONFLICT','같은 키에 다른 요청을 사용할 수 없습니다.',409);return {replayed:true,...(old.runId?{run:publicRun(run(old.runId))}:{workflow:clone(workflow(old.workflowId))})};}
  const before=clone(state);try{const result=fn();if(result.runId){const changed=run(result.runId);changed.version=(changed.version||0)+1;}Object.defineProperty(state.keys,key,{value:{fp,...result},enumerable:true,writable:true,configurable:true});persist();return {replayed:false,...(result.runId?{run:publicRun(run(result.runId))}:{workflow:clone(workflow(result.workflowId))})};}catch(e){state=before;throw e;}
 }
 function save(input){return mutate('workflow',input,['name','template','vehicleId','thresholdMinutes','fields','notifications'],()=>{
  if(typeof input.name!=='string'||!input.name.trim()||input.name.length>80)fail('INVALID_NAME','업무 이름은 1–80자로 입력하세요.');
  if(!['school','delivery'].includes(input.template))fail('INVALID_TEMPLATE','통학 또는 배송 템플릿을 선택하세요.');
  const a=UNIFIED_ASSIGNMENTS.find(a=>a.vehicleId===input.vehicleId);if(!a)fail('SCOPE_DENIED','이 조직에 배정된 차량만 선택할 수 있습니다.',403);
  if(!Number.isInteger(input.thresholdMinutes)||input.thresholdMinutes<1||input.thresholdMinutes>10)fail('INVALID_THRESHOLD','임박 안내 조건은 1–10분입니다.');
  if(!Array.isArray(input.fields)||new Set(input.fields).size!==input.fields.length||input.fields.some(f=>!['eta','distance','position'].includes(f)))fail('INVALID_FIELDS','허용된 공개 항목을 선택하세요.');
  validObject(input.notifications,['departure','approaching','completion']);for(const k of ['departure','approaching','completion'])if(typeof input.notifications[k]!=='boolean')fail('INVALID_NOTIFICATIONS','안내 여부를 선택하세요.');
  const version=1+Math.max(0,...state.workflows.filter(w=>w.vehicleId===a.vehicleId).map(w=>w.version));
  const w={id:randomUUID(),tenantId:'org-a',version,name:input.name.trim(),template:input.template,...a,thresholdMinutes:input.thresholdMinutes,fields:clone(input.fields),notifications:clone(input.notifications),active:true,createdAt:now(),mode:'local-simulation'};
  state.workflows.push(w);return {workflowId:w.id};
 });}
 function dispatch(input,studioOrigin=null){return mutate('dispatch',input,['workflowId'],()=>{
  const w=workflow(input.workflowId); const currentPolicy=policy();
  const r={id:randomUUID(),tenantId:w.tenantId,jobId:randomUUID(),vehicleId:w.vehicleId,tripId:w.tripId,customerId:w.customerId,actorId:w.actorId,workflowId:w.id,workflowVersion:w.version,workflowSnapshot:clone(w),policySnapshot:clone(currentPolicy),state:'assigned',accepted:false,motion:'parked',ux:'allowed',vehicleStateAt:now(),telemetry:null,createdAt:now(),expiresAt:now()+15*60000,revoked:false,customerToken:randomBytes(24).toString('base64url'),actions:[],events:[],audit:[]};
  if(studioOrigin)r.studioOrigin=clone(studioOrigin);
  audit(r,'dispatched','활성화된 업무 버전과 차량·운행·수신자를 고정해 배정했습니다.');state.runs.push(r);return {runId:r.id};
 });}
 function action(r,eventId,kind,failOnce=false){
  if(r.actions.some(a=>a.kind===kind))return;
  const gate=fleet.disclosurePolicy({actorId:r.actorId,vehicleId:r.vehicleId,tripId:r.tripId,snapshot:r.policySnapshot});
  const a={id:randomUUID(),eventId,runId:r.id,jobId:r.jobId,workflowVersion:r.workflowVersion,vehicleId:r.vehicleId,tripId:r.tripId,customerId:r.customerId,kind,status:!gate.allowed?'denied':failOnce?'failed':'simulated',attempts:gate.allowed?1:0,decision:gate.reason,networkSent:false,policyVersion:policy().version};
  r.actions.push(a);audit(r,a.status==='denied'?'policy_denied':a.status==='failed'?'action_failed':'action_simulated',`${kind}: ${!gate.allowed?'현재 정책이 차단함':failOnce?'모의 커넥터 실패':'로컬 안내 기록 생성'} · 실제 외부 발송 없음`);
 }
 function manual(id,operation,input){return mutate(`${operation}:${id}`,input,operation==='retry'?['actionId']:[],()=>{
  const r=run(id);
  if(r.nativeBinding&&operation!=='revoke')fail('NATIVE_PATH_REQUIRED','차량 앱에 연결된 업무는 네이티브 안전 확인 경로에서만 변경할 수 있습니다.',409);
  if(operation==='revoke'){if(r.revoked)fail('ALREADY_REVOKED','이미 철회된 업무입니다.',409);r.revoked=true;r.state='revoked';audit(r,'revoked','운영자가 실행과 고객 공유를 철회했습니다.');return {runId:r.id};}
  if(!active(r))fail('RUN_CLOSED','종료·철회·만료된 업무입니다.',409);
  if(operation==='accept'){
   if(r.accepted||r.state!=='assigned')fail('ALREADY_ACCEPTED','이미 수락한 업무입니다.',409);
   if(r.motion!=='parked'||r.ux!=='allowed'||now()-r.vehicleStateAt>FRESH_MS||now()<r.vehicleStateAt)fail('UNSAFE_STATE','정차·UX 허용 상태에서 배정을 확인하세요.',409);
   r.accepted=true;r.state='ready';audit(r,'accepted','담당 기사가 정차 모의 상태에서 배정을 확인했습니다.');
  }else if(operation==='complete'){
   if(r.state!=='arrived'||r.motion!=='parked'||r.ux!=='allowed'||!fresh(r))fail('COMPLETION_REQUIRES_CONFIRMATION','신선한 정차·도착 상태에서 직접 인계를 확인해야 합니다.',409);
   r.state='completed';audit(r,'completion_confirmed','기사가 인계/업무 완료를 별도로 확인했습니다. 위치만으로 완료하지 않습니다.');
   if(r.workflowSnapshot.notifications.completion)action(r,'manual-completion','completion');
  }else if(operation==='retry'){
   const a=r.actions.find(a=>a.id===input.actionId);if(!a||a.status!=='failed')fail('NO_FAILED_ACTION','이 실행의 실패한 액션만 재시도할 수 있습니다.',409);
   const gate=fleet.disclosurePolicy({actorId:r.actorId,vehicleId:r.vehicleId,tripId:r.tripId,snapshot:r.policySnapshot});
   if(!gate.allowed||!fresh(r))fail('RETRY_BLOCKED','현재 정책과 신선도를 재검사한 결과 재시도가 차단되었습니다.',409);
   a.status='simulated';a.attempts++;audit(r,'retry_simulated',`${a.kind} 실패 액션만 로컬 재시도했습니다. 실제 외부 발송 없음`);
  }else fail('UNKNOWN_ACTION','지원하지 않는 동작입니다.');
  return {runId:r.id};
 });}
 function event(id,input){
  validObject(input,['eventId','vehicleId','tripId','kind','eta','distance','position','failNotification']);
  if(typeof input.eventId!=='string'||input.eventId.length<8||input.eventId.length>100)fail('EVENT_ID_REQUIRED','8–100자 이벤트 ID가 필요합니다.');
  const r=run(id);if(r.nativeBinding)fail('NATIVE_PATH_REQUIRED','차량 앱에 연결된 업무에 웹 모의 이벤트를 적용할 수 없습니다.',409);if(input.vehicleId!==r.vehicleId||input.tripId!==r.tripId)fail('SCOPE_DENIED','이 실행에 배정된 차량·운행 이벤트가 아닙니다.',403);
  const fp=fingerprint(input),old=r.events.find(e=>e.eventId===input.eventId);
  if(old){if(old.fingerprint!==fp)fail('EVENT_CONFLICT','동일 이벤트 ID의 내용이 다릅니다.',409);return {replayed:true,run:publicRun(r)};}
  if(!active(r)||!r.accepted)fail('RUN_NOT_READY','수락한 활성 업무에만 이벤트를 적용할 수 있습니다.',409);
  if(!['departed','telemetry','arrived','stale'].includes(input.kind))fail('UNKNOWN_EVENT','지원하지 않는 이벤트입니다.');
  if(input.failNotification!==undefined&&typeof input.failNotification!=='boolean')fail('INVALID_INPUT','실패 모의 값은 boolean입니다.');
  if(input.kind==='departed'&&r.state!=='ready')fail('INVALID_TRANSITION','업무 준비 상태에서 출발 신호를 받습니다.',409);
  if(['telemetry','arrived','stale'].includes(input.kind)&&!['departed','approaching','arrived'].includes(r.state))fail('INVALID_TRANSITION','출발한 업무에만 이 신호를 적용합니다.',409);
  if(input.kind==='telemetry'&&r.state==='arrived')fail('INVALID_TRANSITION','도착 후 이전 운행 신호를 적용하지 않습니다.',409);
  if(input.eta!==undefined&&(!Number.isFinite(input.eta)||input.eta<0||input.eta>120))fail('INVALID_TELEMETRY','가상 ETA 범위는 0–120분입니다.');
  if(input.distance!==undefined&&(!Number.isFinite(input.distance)||input.distance<0||input.distance>100000))fail('INVALID_TELEMETRY','가상 거리를 확인하세요.');
  if(input.position!==undefined){validObject(input.position,['x','y']);if(!['x','y'].every(k=>Number.isFinite(input.position[k])&&input.position[k]>=0&&input.position[k]<=100))fail('INVALID_TELEMETRY','가상 격자만 허용합니다.');}
  const before=clone(state);try{
   if(input.kind==='stale'){r.telemetry.at=now()-FRESH_MS-1;audit(r,'stale','오래된 신호 모의: 고객 정보 공개를 차단합니다.');}
   else {
    const defaults=input.kind==='departed'?{eta:8,distance:2400,position:{x:12,y:18}}:input.kind==='arrived'?{eta:0,distance:0,position:{x:84,y:78}}:{eta:2,distance:450,position:{x:71,y:66}};
    r.vehicleStateAt=now();
    r.telemetry={eta:input.eta??defaults.eta,distance:input.distance??defaults.distance,position:clone(input.position??defaults.position),at:now(),source:'simulation'};
    if(input.kind==='departed'){r.state='departed';r.motion='moving';r.ux='restricted';if(r.workflowSnapshot.notifications.departure)action(r,input.eventId,'departure',input.failNotification);}
    if(input.kind==='arrived'){r.state='arrived';r.motion='parked';r.ux='allowed';}
    if(input.kind!=='arrived'&&r.telemetry.eta<=r.workflowSnapshot.thresholdMinutes){r.state='approaching';if(r.workflowSnapshot.notifications.approaching)action(r,input.eventId,'approaching',input.failNotification);}
    audit(r,'event_applied',`${input.kind} 신호 적용 · ETA ${r.telemetry.eta}분 / 설정 조건 ${r.workflowSnapshot.thresholdMinutes}분`);
   }
   r.version=(r.version||0)+1;
   r.events.push({eventId:input.eventId,kind:input.kind,fingerprint:fp,runId:r.id,vehicleId:r.vehicleId,tripId:r.tripId,at:now(),source:'simulation'});persist();return {replayed:false,run:publicRun(r)};
  }catch(e){state=before;throw e;}
 }
 function customer(token,customerId){
  const r=state.runs.find(r=>r.customerToken===token&&r.customerId===customerId);if(!r)fail('CUSTOMER_LINK_NOT_FOUND','고객 안내 링크를 확인할 수 없습니다.',404);
  const base={runId:r.id,workflowVersion:r.workflowVersion,state:r.state,mode:'simulation',sharing:'hidden',reason:'NOT_STARTED',fields:{},validUntil:null};
  if(!active(r))return {...base,reason:r.revoked?'REVOKED':r.state==='completed'?'COMPLETED':'EXPIRED'};
  if(!r.telemetry)return base;
  if(!fresh(r))return {...base,reason:'STALE'};
  // Same current fleet role policy as the policy console. It cannot grant OEM/SDK access.
  const p=fleet.disclosurePolicy({actorId:r.actorId,vehicleId:r.vehicleId,tripId:r.tripId,snapshot:r.policySnapshot});
  if(!p.allowed)return {...base,reason:p.reason};
  const map={eta:'eta',position:'position',distance:'position'};
  const allowed=r.workflowSnapshot.fields.filter(f=>p.fields.includes(map[f]));
  const fields=Object.fromEntries(allowed.map(f=>[f,clone(r.telemetry[f])]));
  return {...base,sharing:Object.keys(fields).length?'active':'hidden',reason:Object.keys(fields).length?'POLICY_ALLOWED':'NO_FIELDS',fields,validUntil:Math.min(r.expiresAt,r.telemetry.at+FRESH_MS),policyVersion:p.version};
 }

 // Native bridge uses the same persisted run, workflow snapshot and notification policy.
 // Binding is identity/context only, never authentication or a production permission grant.
 function nativeBind(id,{clientId,source}) {
  const r=run(id);
  if(!active(r))fail('RUN_CLOSED','종료·철회·만료된 업무입니다.',409);
  if(r.nativeBinding) {
   if(r.nativeBinding.clientId!==clientId||r.nativeBinding.source!==source)fail('NATIVE_BINDING_CONFLICT','다른 앱/신호 출처에 연결된 업무입니다.',409);
   return publicRun(r);
  }
  const before=clone(state);try{
   r.nativeBinding={clientId,source,boundAt:now(),authentication:false};
   r.motion='unknown';r.ux='unknown';r.vehicleStateAt=0;
   // Do not expose previously simulated coordinates as native sensor data.
   r.telemetry=null;r.version=(r.version||0)+1;
   audit(r,'native_bound',`${source} 차량 앱 연결 · 로컬 테스트 식별자, 인증 아님`);persist();return publicRun(r);
  }catch(e){state=before;throw e;}
 }
 function nativeCommand(id,input,guard){return mutate(`native:${id}`,input,['clientId','sessionId','expectedVersion','action','completionConfirmed'],()=>{
  const r=run(id);
  if(!r.nativeBinding||r.nativeBinding.clientId!==input.clientId)fail('NATIVE_BINDING_REQUIRED','이 차량 앱에 연결된 업무가 아닙니다.',409);
  if(!active(r))fail('RUN_CLOSED','종료·철회·만료된 업무입니다.',409);
  if(!Number.isInteger(input.expectedVersion)||input.expectedVersion!==(r.version||0))fail('VERSION_CONFLICT','업무가 변경되었습니다. 새로 고침하고 다시 확인하세요.',409);
  const evidence=guard(r);
  if(input.action==='accept'){
   if(r.state!=='assigned'||r.accepted)fail('INVALID_TRANSITION','배정된 업무만 수락할 수 있습니다.',409);
   r.accepted=true;r.state='ready';
  }else if(input.action==='depart'){
   if(r.state!=='ready'||!r.accepted)fail('INVALID_TRANSITION','수락한 준비 업무만 출발 처리할 수 있습니다.',409);
   r.state='departed';if(r.workflowSnapshot.notifications.departure)action(r,input.idempotencyKey,'departure');
  }else if(input.action==='arrive'){
   if(!['departed','approaching'].includes(r.state))fail('INVALID_TRANSITION','운행 중인 업무만 도착 확인할 수 있습니다.',409);
   r.state='arrived';
  }else if(input.action==='complete'){
   if(r.state!=='arrived'||input.completionConfirmed!==true)fail('COMPLETION_REQUIRES_CONFIRMATION','도착 후 인계/업무 완료를 별도로 확인하세요.',409);
   r.state='completed';if(r.workflowSnapshot.notifications.completion)action(r,input.idempotencyKey,'completion');
  }else fail('UNKNOWN_ACTION','지원하지 않는 차량 업무 동작입니다.');
  r.motion='parked';r.ux='allowed';r.vehicleStateAt=evidence.receivedAt;
  r.nativeEvidence={...clone(evidence),realVehicleVerified:false,completionIsOperatorAssertion:input.action==='complete'};
  audit(r,`native_${input.action}`,`${r.nativeBinding.source} 신호를 안전 조건으로 확인한 사용자의 명시적 ${input.action} · 실제 인계/실차 검증 아님`);
  return {runId:r.id};
 });}

 const getState=()=>({mode:'local-demo-not-authentication',templates:[{id:'school',name:'통학 운행 안내'},{id:'delivery',name:'배송 방문 안내'}],assignments:clone(UNIFIED_ASSIGNMENTS),workflows:clone(state.workflows),runs:state.runs.map(publicRun),policy:policy(),limitations:{vehicleSdk:false,externalMessages:false,productionAuthentication:false,freeformGraph:false}});
 return {getState,save,dispatch,event,manual,customer,nativeBind,nativeCommand};
}

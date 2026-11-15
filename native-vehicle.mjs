/** Local emulator bridge. Client IDs and sources are assertions, NOT authentication.
 * Vehicle observations never imply arrival, delivery, boarding or completion.
 */
import { createHash } from 'node:crypto';
import { WorkflowError } from './workflow.mjs';
export const NATIVE_FRESH_MS = 10_000;
const fail = (code,message,status=422) => { throw new WorkflowError(status,code,message); };
const copy = x => structuredClone(x);
const canonical = x => Array.isArray(x) ? x.map(canonical) : x && typeof x==='object' ? Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])) : x;
const hash = x => createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
const object = (x,keys) => { if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).some(k=>!keys.includes(k)))fail('INVALID_INPUT','허용된 차량 앱 입력만 사용할 수 있습니다.'); };
const identifier = (value,name) => {if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(value))fail('INVALID_INPUT',`${name} 식별자가 올바르지 않습니다.`);};
const sources = ['aaos','debug-fixture'];
const active = r => !r.expired && !r.revoked && !['completed','revoked'].includes(r.state);

export function createNativeVehicle({unified,clock=Date.now}) {
 const observations=new Map();
 const now=()=>{const n=Number(clock());if(!Number.isFinite(n))throw Error('Invalid clock');return n;};
 function find(id){const r=unified.getState().runs.find(r=>r.id===id);if(!r)fail('RUN_NOT_FOUND','배정 업무를 찾을 수 없습니다.',404);return r;}
 function safety(r){
  const o=observations.get(r.id); let reason='NO_VEHICLE_STATE';
  if(o){
   if(!o.connected)reason='DISCONNECTED';
   else if(now()<o.receivedAt||now()-o.receivedAt>NATIVE_FRESH_MS||now()<o.observedAt-2000||now()-o.observedAt>NATIVE_FRESH_MS)reason='STALE_VEHICLE_STATE';
   else if(o.speedMps===null||o.gear==='unknown'||o.uxRestricted===null)reason='UNKNOWN_VEHICLE_STATE';
   else if(Math.abs(o.speedMps)>0.1)reason='VEHICLE_MOVING';
   else if(o.gear!=='P')reason='PARK_REQUIRED';
   else if(o.uxRestricted)reason='UX_RESTRICTED';
   else reason='PARKED_UNRESTRICTED';
  }
  return {safe:reason==='PARKED_UNRESTRICTED',reason,...(o?{source:o.source,connected:o.connected,speedMps:o.speedMps,gear:o.gear,uxRestricted:o.uxRestricted,observedAt:o.observedAt,receivedAt:o.receivedAt,validUntil:Math.min(o.observedAt,o.receivedAt)+NATIVE_FRESH_MS,sessionId:o.sessionId,sequence:o.sequence}:{})};
 }
 function context(r,replayed=false){
  const vehicleState=r?safety(r):{safe:false,reason:'NO_ASSIGNMENT'};
  const potential=r&&active(r)?({assigned:['accept'],ready:['depart'],departed:['arrive'],approaching:['arrive'],arrived:['complete']}[r.state]||[]):[];
  return {
   mode:'local-emulator-not-authentication',replayed,serverTime:now(),
   assignment:r?{runId:r.id,jobId:r.jobId,vehicleId:r.vehicleId,tripId:r.tripId,title:r.workflowSnapshot.name,template:r.workflowSnapshot.template,state:r.state,version:r.version,workflowVersion:r.workflowVersion,expiresAt:r.expiresAt,expired:r.expired,source:r.nativeBinding?.source||null,
    studioOrigin:r.studioOrigin||null,
    customerLabel:r.studioOrigin?'Studio의 가상 서비스 입력':r.customerId==='demo-parent-1'?'가상 고객 A · 통학 보호자':'가상 고객 B · 배송 수신자',
    destination:r.studioOrigin?'가상 일정·업무 목적지 (내비 연동 없음)':r.workflowSnapshot.template==='school'?'가상 통학 정류장 A':'가상 배송 장소 B',destinationIsFixture:true,
    nextAction:potential[0]||null,timeline:r.audit.slice(-12).map(a=>({at:a.at,type:a.type,detail:a.detail})),
    notices:r.actions.map(a=>({kind:a.kind,status:a.status,networkSent:a.networkSent})),
    completionEvidence:r.nativeEvidence?.completionIsOperatorAssertion?'operator-assertion-not-real-world-verification':null}:null,
   vehicleState,allowedActions:vehicleState.safe?potential:[],
   limitations:{authentication:false,externalMessages:false,realVehicleVerified:false,locationOrEtaFromSdk:false,sourceIsClientAssertion:true,foregroundOnly:true}
  };
 }
 function assignment({vehicleId='vehicle-101',runId}={}){
  identifier(vehicleId,'vehicleId');if(!['vehicle-101','vehicle-102'].includes(vehicleId))fail('SCOPE_DENIED','가상 배정 차량이 아닙니다.',403);
  if(runId){identifier(runId,'runId');const r=find(runId);if(r.vehicleId!==vehicleId)fail('SCOPE_DENIED','차량과 업무 배정이 다릅니다.',403);return context(r);}
  const candidates=unified.getState().runs.filter(r=>r.vehicleId===vehicleId&&active(r));
  if(candidates.length>1)fail('ASSIGNMENT_AMBIGUOUS','여러 업무가 있습니다. 정확한 runId를 선택하세요.',409);
  return context(candidates[0]||null);
 }
 function fixture(input){
  object(input,['vehicleId','source','idempotencyKey']);
  const {vehicleId,source,idempotencyKey}=input;
  if(!['vehicle-101','vehicle-102'].includes(vehicleId)||!sources.includes(source))fail('INVALID_INPUT','가상 차량과 명시적 신호 출처를 선택하세요.');
  if(typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>96)fail('KEY_REQUIRED','8–96자 중복 방지 키가 필요합니다.');
  // Separate deterministic scoped keys: retry reuses this workflow AND this run.
  const k='native-fixture-'+hash({idempotencyKey});
  const {workflow}=unified.save({name:vehicleId==='vehicle-101'?'통학 · 정류장 도착과 인계 확인':'배송 · 방문과 인계 확인',template:vehicleId==='vehicle-101'?'school':'delivery',vehicleId,thresholdMinutes:3,fields:[],notifications:{departure:true,approaching:false,completion:true},idempotencyKey:k+'-workflow'});
  const dispatched=unified.dispatch({workflowId:workflow.id,idempotencyKey:k+'-dispatch'});
  if(dispatched.run.nativeBinding?.source&&dispatched.run.nativeBinding.source!==source)fail('NATIVE_BINDING_CONFLICT','같은 데모 키의 신호 출처를 바꿀 수 없습니다.',409);
  if(active(dispatched.run))unified.nativeBind(dispatched.run.id,{clientId:'pleosflows-android',source});
  return context(find(dispatched.run.id),dispatched.replayed);
 }
 function observe(input){
  object(input,['runId','clientId','sessionId','sequence','source','connected','speedMps','gear','uxRestricted','observedAt']);
  for(const k of ['runId','clientId','sessionId'])identifier(input[k],k);
  if(!sources.includes(input.source)||typeof input.connected!=='boolean'||!Number.isSafeInteger(input.sequence)||input.sequence<1)fail('INVALID_INPUT','신호 출처/연결/순번이 올바르지 않습니다.');
  if(input.speedMps!==null&&(!Number.isFinite(input.speedMps)||Math.abs(input.speedMps)>100))fail('INVALID_INPUT','속도는 m/s 또는 null입니다.');
  if(!['P','R','N','D','unknown'].includes(input.gear)||!(input.uxRestricted===null||typeof input.uxRestricted==='boolean'))fail('INVALID_INPUT','기어/UX 상태가 올바르지 않습니다.');
  if(!Number.isSafeInteger(input.observedAt)||input.observedAt>now()+2000||now()-input.observedAt>NATIVE_FRESH_MS)fail('STALE_OBSERVATION','오래되거나 미래의 차량 관측은 사용할 수 없습니다.',409);
  let r=find(input.runId);if(!active(r))fail('RUN_CLOSED','종료·철회·만료된 업무입니다.',409);
  if(r.nativeBinding&&(r.nativeBinding.source!==input.source||r.nativeBinding.clientId!==input.clientId))fail('NATIVE_BINDING_CONFLICT','이 업무의 앱/신호 출처가 다릅니다.',409);
  const previous=observations.get(r.id),fp=hash(input);
  let retired=previous?.retired||new Set();
  if(previous){
   if(retired.has(input.sessionId))fail('RETIRED_SESSION','이미 끝난 앱 세션입니다.',409);
   if(previous.sessionId===input.sessionId){
    if(input.sequence===previous.sequence&&fp===previous.fp)return context(r,true); // Never refresh freshness on duplicate upload.
    if(input.sequence<=previous.sequence)fail('SEQUENCE_CONFLICT','지난 순번이나 바뀐 중복 신호를 적용할 수 없습니다.',409);
    if(input.observedAt<previous.observedAt)fail('STALE_OBSERVATION','더 오래된 관측을 적용할 수 없습니다.',409);
   }else{
    if(input.sequence!==1)fail('SESSION_START_REQUIRED','새 세션의 첫 신호는 순번 1이어야 합니다.',409);
    if(input.observedAt<previous.observedAt)fail('STALE_OBSERVATION','이전 세션보다 오래된 관측은 세션을 바꿀 수 없습니다.',409);
    retired=new Set(retired);retired.add(previous.sessionId);
   }
  }else if(input.sequence!==1)fail('SESSION_START_REQUIRED','연결/서버 재시작 후 첫 신호는 순번 1이어야 합니다.',409);
  if(!r.nativeBinding)r=unified.nativeBind(r.id,{clientId:input.clientId,source:input.source});
  observations.set(r.id,{...copy(input),receivedAt:now(),fp,retired});
  return context(r);
 }
 function command(id,input){
  object(input,['clientId','sessionId','expectedVersion','idempotencyKey','action','completionConfirmed']);
  for(const k of ['clientId','sessionId'])identifier(input[k],k);
  if(!['accept','depart','arrive','complete'].includes(input.action)||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0)fail('INVALID_INPUT','업무 동작/버전이 올바르지 않습니다.');
  if(input.completionConfirmed!==undefined&&(input.action!=='complete'||input.completionConfirmed!==true))fail('INVALID_INPUT','완료 확인은 완료 동작의 true 값만 허용합니다.');
  const result=unified.nativeCommand(id,input,r=>{
   const o=observations.get(id),safe=safety(r);
   if(!o||o.clientId!==input.clientId||o.sessionId!==input.sessionId)fail('SESSION_MISMATCH','현재 차량 관측 세션과 다릅니다.',409);
   if(!safe.safe)fail('UNSAFE_STATE',`정차/P/UX 허용을 다시 확인하세요: ${safe.reason}`,409);
   return {source:o.source,observedAt:o.observedAt,receivedAt:o.receivedAt,speedMps:o.speedMps,gear:o.gear,uxRestricted:o.uxRestricted};
  });
  return context(result.run,result.replayed);
 }
 return {assignment,fixture,observe,command};
}

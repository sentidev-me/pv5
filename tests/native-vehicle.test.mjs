import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import http from 'node:http';
import { join } from 'node:path';
import { createFleet } from '../fleet.mjs';
import { createUnified } from '../unified.mjs';
import { createNativeVehicle } from '../native-vehicle.mjs';
import { createServer } from '../server.mjs';
let serial=0;const key=()=>`native-test-${++serial}`;
const error=code=>e=>e.code===code;
function setup(t){
 const dir=mkdtempSync(join(tmpdir(),'pleos-native-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 let time=1700000000000;const clock=()=>time;const fleet=createFleet({dataDir:dir,clock});const u=createUnified({dataDir:dir,fleet,clock});const n=createNativeVehicle({unified:u,clock});
 return {dir,clock,fleet,u,n,tick:ms=>time+=ms};
}
function fixture(n,extra={}){return n.fixture({vehicleId:'vehicle-101',source:'aaos',idempotencyKey:key(),...extra});}
function state(f,c,extra={}){return {runId:c.assignment.runId,clientId:'pleosflows-android',sessionId:'session-one',sequence:1,source:'aaos',connected:true,speedMps:0,gear:'P',uxRestricted:false,observedAt:f.clock(),...extra};}
function cmd(c,action,extra={}){return {clientId:'pleosflows-android',sessionId:'session-one',expectedVersion:c.assignment.version,idempotencyKey:key(),action,...extra};}
function advance(f,c,action,extra={}){return f.n.command(c.assignment.runId,cmd(c,action,extra));}

test('no implicit assignment or fabricated vehicle state; explicit seed binds source',t=>{
 const f=setup(t);assert.equal(f.n.assignment().assignment,null);
 const c=fixture(f.n);assert.equal(c.assignment.source,'aaos');assert.equal(c.vehicleState.safe,false);assert.deepEqual(c.allowedActions,[]);assert.equal(c.assignment.state,'assigned');
 assert.equal(c.assignment.destinationIsFixture,true);assert.equal(c.limitations.authentication,false);assert.equal(c.limitations.locationOrEtaFromSdk,false);
});
test('fixture retry returns same run and source change conflicts',t=>{
 const f=setup(t),k=key(),a=fixture(f.n,{idempotencyKey:k}),b=fixture(f.n,{idempotencyKey:k});assert.equal(a.assignment.runId,b.assignment.runId);assert.equal(b.replayed,true);assert.equal(f.u.getState().runs.length,1);
 assert.throws(()=>fixture(f.n,{idempotencyKey:k,source:'debug-fixture'}),error('NATIVE_BINDING_CONFLICT'));
});
test('multiple assignments never silently select newest and exact run isolation holds',t=>{
 const f=setup(t),a=fixture(f.n),b=fixture(f.n);assert.throws(()=>f.n.assignment(),error('ASSIGNMENT_AMBIGUOUS'));
 assert.equal(f.n.assignment({vehicleId:'vehicle-101',runId:a.assignment.runId}).assignment.runId,a.assignment.runId);
 assert.throws(()=>f.n.assignment({vehicleId:'vehicle-102',runId:b.assignment.runId}),error('SCOPE_DENIED'));
});
test('vehicle observation does not advance workflow or fabricate ETA/position',t=>{
 const f=setup(t),c=fixture(f.n);const before=f.u.getState().runs[0];const result=f.n.observe(state(f,c));const after=f.u.getState().runs[0];
 assert.equal(result.assignment.state,'assigned');assert.deepEqual(result.allowedActions,['accept']);assert.deepEqual(after,before);assert.equal(after.telemetry,null);
});
test('same authoritative run supports accept depart explicit arrival and confirmed completion',t=>{
 const f=setup(t);let c=fixture(f.n);c=f.n.observe(state(f,c));c=advance(f,c,'accept');assert.equal(c.assignment.state,'ready');c=advance(f,c,'depart');assert.equal(c.assignment.state,'departed');c=advance(f,c,'arrive');assert.equal(c.assignment.state,'arrived');
 assert.throws(()=>advance(f,c,'complete'),error('COMPLETION_REQUIRES_CONFIRMATION'));
 c=advance(f,c,'complete',{completionConfirmed:true});assert.equal(c.assignment.state,'completed');assert.equal(c.assignment.completionEvidence,'operator-assertion-not-real-world-verification');
 const r=f.u.getState().runs[0];assert.equal(r.nativeEvidence.realVehicleVerified,false);assert.equal(r.telemetry,null);assert.deepEqual(r.actions.map(a=>a.kind),['departure','completion']);assert.ok(r.actions.every(a=>a.networkSent===false));assert.ok(r.audit.some(a=>a.type==='native_complete'));
 assert.equal(f.u.customer(r.customerToken,r.customerId).sharing,'hidden');
});
test('motion telemetry never triggers departure arrival completion or notification',t=>{
 const f=setup(t);let c=fixture(f.n);c=f.n.observe(state(f,c));c=advance(f,c,'accept');f.n.observe(state(f,c,{sequence:2,speedMps:12,gear:'D',uxRestricted:true}));
 const r=f.u.getState().runs[0];assert.equal(r.state,'ready');assert.equal(r.actions.length,0);
});
for(const [label,fields,reason] of [
 ['moving',{speedMps:1},'VEHICLE_MOVING'],['reverse moving',{speedMps:-1,gear:'R'},'VEHICLE_MOVING'],['gear D',{gear:'D'},'PARK_REQUIRED'],['restricted',{uxRestricted:true},'UX_RESTRICTED'],['unknown speed',{speedMps:null},'UNKNOWN_VEHICLE_STATE'],['unknown gear',{gear:'unknown'},'UNKNOWN_VEHICLE_STATE'],['unknown UX',{uxRestricted:null},'UNKNOWN_VEHICLE_STATE'],['disconnected',{connected:false},'DISCONNECTED']
])test(`${label} observation locks every command`,t=>{const f=setup(t),c=fixture(f.n),result=f.n.observe(state(f,c,fields));assert.equal(result.vehicleState.reason,reason);assert.deepEqual(result.allowedActions,[]);assert.throws(()=>advance(f,result,'accept'),error('UNSAFE_STATE'));});
test('stale telemetry locks and replay cannot refresh freshness',t=>{
 const f=setup(t),c=fixture(f.n),s=state(f,c);f.n.observe(s);f.tick(5000);assert.equal(f.n.observe(s).replayed,true);f.tick(5001);
 assert.equal(f.n.assignment({runId:c.assignment.runId}).vehicleState.reason,'STALE_VEHICLE_STATE');assert.throws(()=>advance(f,c,'accept'),error('UNSAFE_STATE'));
 assert.throws(()=>f.n.observe(s),error('STALE_OBSERVATION'));
});
test('future observations, old timestamps and out-of-order sequence fail closed',t=>{
 const f=setup(t),c=fixture(f.n);assert.throws(()=>f.n.observe(state(f,c,{observedAt:f.clock()+2001})),error('STALE_OBSERVATION'));f.n.observe(state(f,c));f.tick(10);f.n.observe(state(f,c,{sequence:3}));
 assert.throws(()=>f.n.observe(state(f,c,{sequence:2})),error('SEQUENCE_CONFLICT'));assert.throws(()=>f.n.observe(state(f,c,{sequence:4,observedAt:f.clock()-1})),error('STALE_OBSERVATION'));
});
test('duplicate observation changed payload conflicts',t=>{
 const f=setup(t),c=fixture(f.n);f.n.observe(state(f,c));assert.throws(()=>f.n.observe(state(f,c,{gear:'D'})),error('SEQUENCE_CONFLICT'));
});
test('source client and retired session cannot override current safety state',t=>{
 const f=setup(t),c=fixture(f.n);f.n.observe(state(f,c));assert.throws(()=>f.n.observe(state(f,c,{sequence:2,source:'debug-fixture'})),error('NATIVE_BINDING_CONFLICT'));assert.throws(()=>f.n.observe(state(f,c,{sequence:2,clientId:'another-app'})),error('NATIVE_BINDING_CONFLICT'));
 f.tick(10);f.n.observe(state(f,c,{sessionId:'session-two',sequence:1,gear:'D'}));
 assert.throws(()=>f.n.observe(state(f,c,{sequence:2,gear:'P'})),error('RETIRED_SESSION'));assert.throws(()=>f.n.observe(state(f,c,{sessionId:'session-old',observedAt:f.clock()-1})),error('STALE_OBSERVATION'));
 assert.throws(()=>advance(f,c,'accept'),error('SESSION_MISMATCH'));
});
test('new session and server restart require first sequence, never restore old safe state',t=>{
 const f=setup(t),c=fixture(f.n);f.n.observe(state(f,c));assert.throws(()=>f.n.observe(state(f,c,{sessionId:'two',sequence:2})),error('SESSION_START_REQUIRED'));
 const reloaded=createNativeVehicle({unified:createUnified({dataDir:f.dir,fleet:f.fleet,clock:f.clock}),clock:f.clock});assert.equal(reloaded.assignment({runId:c.assignment.runId}).vehicleState.safe,false);
 assert.throws(()=>reloaded.observe(state(f,c,{sequence:2})),error('SESSION_START_REQUIRED'));assert.throws(()=>reloaded.command(c.assignment.runId,cmd(c,'accept')),error('SESSION_MISMATCH'));
});
test('commands replay exactly once even after stale telemetry and terminal completion',t=>{
 const f=setup(t);let c=fixture(f.n);c=f.n.observe(state(f,c));c=advance(f,c,'accept');const depart=cmd(c,'depart');c=f.n.command(c.assignment.runId,depart);assert.equal(f.n.command(c.assignment.runId,depart).replayed,true);assert.equal(f.u.getState().runs[0].actions.length,1);
 c=advance(f,c,'arrive');const completion=cmd(c,'complete',{completionConfirmed:true});c=f.n.command(c.assignment.runId,completion);f.tick(20000);const again=f.n.command(c.assignment.runId,completion);assert.equal(again.replayed,true);assert.equal(again.assignment.state,'completed');assert.equal(f.u.getState().runs[0].actions.length,2);
 assert.throws(()=>f.n.command(c.assignment.runId,{...completion,expectedVersion:completion.expectedVersion+1}),error('IDEMPOTENCY_CONFLICT'));
});
test('stale expected version rejects a new command; failed precondition does not consume key',t=>{
 const f=setup(t);let c=fixture(f.n);c=f.n.observe(state(f,c));const accept=cmd(c,'accept');c=f.n.command(c.assignment.runId,accept);assert.throws(()=>f.n.command(c.assignment.runId,{...cmd(c,'depart'),expectedVersion:accept.expectedVersion}),error('VERSION_CONFLICT'));
 const depart=cmd(c,'depart');f.n.observe(state(f,c,{sequence:2,gear:'D'}));assert.throws(()=>f.n.command(c.assignment.runId,depart),error('UNSAFE_STATE'));f.n.observe(state(f,c,{sequence:3}));assert.equal(f.n.command(c.assignment.runId,depart).assignment.state,'departed');
});
test('native-bound runs reject legacy accept complete and web simulation events, allow operator revoke',t=>{
 const f=setup(t),c=fixture(f.n),r=f.u.getState().runs[0];assert.throws(()=>f.u.manual(r.id,'accept',{idempotencyKey:key()}),error('NATIVE_PATH_REQUIRED'));assert.throws(()=>f.u.manual(r.id,'complete',{idempotencyKey:key()}),error('NATIVE_PATH_REQUIRED'));
 assert.throws(()=>f.u.event(r.id,{eventId:key(),vehicleId:r.vehicleId,tripId:r.tripId,kind:'departed'}),error('NATIVE_PATH_REQUIRED'));
 f.n.observe(state(f,c));f.u.manual(r.id,'revoke',{idempotencyKey:key()});assert.throws(()=>advance(f,c,'accept'),error('RUN_CLOSED'));assert.equal(f.n.assignment({runId:r.id}).assignment.state,'revoked');
});
test('native departures and completion honor existing current disclosure policy',t=>{
 const f=setup(t);let c=fixture(f.n);c=f.n.observe(state(f,c));c=advance(f,c,'accept');const policy=f.fleet.getState('operator-a').policy;policy.rules.parent.actions['vehicle.read']='deny';f.fleet.changePolicy({actorId:'operator-a',expectedVersion:policy.version,rules:policy.rules,idempotencyKey:key()});c=advance(f,c,'depart');assert.equal(f.u.getState().runs[0].actions[0].status,'denied');assert.equal(f.u.getState().runs[0].actions[0].networkSent,false);
});
test('invalid extra properties and malformed safety values are rejected',t=>{
 const f=setup(t),c=fixture(f.n);for(const extra of [{latitude:37},{speedMps:'0'},{uxRestricted:'false'},{gear:'parked'},{connected:1},{sequence:0},{observedAt:null}])assert.throws(()=>f.n.observe(state(f,c,extra)),e=>['INVALID_INPUT','STALE_OBSERVATION'].includes(e.code));
 assert.throws(()=>f.n.command(c.assignment.runId,cmd(c,'accept',{completionConfirmed:true})),error('INVALID_INPUT'));
});
test('debug fixture source stays explicitly labelled; it is not AAOS evidence',t=>{
 const f=setup(t),c=fixture(f.n,{source:'debug-fixture'}),observed=f.n.observe(state(f,c,{source:'debug-fixture'}));assert.equal(observed.vehicleState.source,'debug-fixture');assert.equal(observed.assignment.source,'debug-fixture');assert.equal(observed.limitations.realVehicleVerified,false);assert.equal(advance(f,observed,'accept').assignment.state,'ready');
});
test('freshness expiry after arrival blocks completion until new parked observation',t=>{
 const f=setup(t);let c=fixture(f.n);c=f.n.observe(state(f,c));for(const a of ['accept','depart','arrive'])c=advance(f,c,a);f.tick(10001);assert.throws(()=>advance(f,c,'complete',{completionConfirmed:true}),error('UNSAFE_STATE'));c=f.n.observe(state(f,c,{sequence:2}));assert.equal(advance(f,c,'complete',{completionConfirmed:true}).assignment.state,'completed');
});
async function httpFixture(t,nativeEmulator){const f=setup(t),server=createServer({dataDir:f.dir,nativeEmulator,clock:f.clock});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const root=`http://127.0.0.1:${server.address().port}`;return {...f,server,root,post:async(path,body,headers={})=>{const res=await fetch(root+path,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});return {status:res.status,body:await res.json()};}};}
test('HTTP native routes are opt-in and reject foreign origin and nonloopback Host',async t=>{
 const f=await httpFixture(t,false);assert.equal((await fetch(f.root+'/api/native/assignment')).status,404);
 const g=await httpFixture(t,true);assert.equal(await new Promise((resolve,reject)=>{http.get(g.root+'/api/native/assignment',{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject);}),403);assert.equal((await g.post('/api/native/fixture',{}, {origin:'https://evil.example'})).status,403);
 assert.equal((await fetch(g.root+'/api/native/assignment?vehicleId=vehicle-101&vehicleId=vehicle-102')).status,422);
});
test('HTTP app lifecycle uses actual unified run and returns no customer bearer URL',async t=>{
 const f=await httpFixture(t,true);let response=await f.post('/api/native/fixture',{vehicleId:'vehicle-101',source:'aaos',idempotencyKey:key()});assert.equal(response.status,200);let c=response.body;const id=c.assignment.runId;
 response=await f.post('/api/native/state',state(f,c));assert.equal(response.status,200);c=response.body;
 for(const action of ['accept','depart','arrive','complete']){response=await f.post(`/api/native/runs/${id}/commands`,cmd(c,action,action==='complete'?{completionConfirmed:true}:{}));assert.equal(response.status,200);c=response.body;}
 assert.equal(c.assignment.state,'completed');assert.equal(JSON.stringify(c).includes('customerToken'),false);assert.equal(f.server.unified.getState().runs[0].state,'completed');
});

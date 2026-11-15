import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createServer} from '../server.mjs';
test('Agent Studio serves distinct UI and executes Calendar/Slack, approval and retry with no external sends',async t=>{
 const dataDir=mkdtempSync(join(tmpdir(),'agent-studio-'));const s=createServer({dataDir});await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>s.close(r));rmSync(dataDir,{recursive:true,force:true});});const base=`http://127.0.0.1:${s.address().port}`;
 const get=async p=>(await fetch(base+p)).json();const post=async(p,b)=>{const r=await fetch(base+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...b,idempotencyKey:randomUUID()})});assert.equal(r.status,200);return r.json();};
 for(const path of ['/agent-studio.html','/agent-studio.css','/agent-studio.js'])assert.equal((await fetch(base+path)).status,200);
 const state=await get('/api/platform');
 for(const templateId of ['visit','delivery']){const d=state.defaults.find(d=>d.templateId===templateId);if(templateId==='delivery')d.trigger.connector='slack';d.actions=templateId==='visit'?['customer.notify','slack.notify']:['sheet.update','slack.notify'];const draft=(await post('/api/platform/drafts',{definition:d})).draft;const a=(await post('/api/platform/activate',{draftId:draft.id,draftVersion:draft.version})).activation;let r=(await post('/api/platform/runs',{activationId:a.id,input:{etaMinutes:3,delayMinutes:18,batteryPercent:65,scenario:'normal',failureAction:'slack.notify'}})).run;assert.equal(r.status,'awaiting_approval');assert.equal(r.outputs.length,0);r=(await post(`/api/platform/runs/${r.id}/approve`,{expectedVersion:r.version,role:d.approval.role,message:r.assistance.text})).run;assert.equal(r.status,'action_failed');r=(await post(`/api/platform/runs/${r.id}/retry`,{expectedVersion:r.version})).run;assert.equal(r.status,'completed');assert.ok(r.outputs.every(o=>o.networkSent===false));assert.equal(r.outputs[0].attempt,1);assert.equal(r.outputs[1].attempt,2);let blocked=(await post('/api/platform/runs',{activationId:a.id,input:{etaMinutes:3,delayMinutes:18,batteryPercent:65,scenario:'unknown-state',failureAction:null}})).run;assert.equal(blocked.status,'blocked');assert.equal(blocked.outputs.length,0);}
});
test('Studio states simulation boundaries and keeps external credentials out of UI',()=>{const src=readFileSync(new URL('../public/agent-studio.js',import.meta.url),'utf8');assert.match(src,/미연결/);assert.match(src,/실제 LLM이 아니며/);assert.match(src,/실제 차량 명령은 호출하지 않습니다/);assert.match(src,/if\(busy\)return/);assert.doesNotMatch(src,/api[_-]?key|password|secret/i);});

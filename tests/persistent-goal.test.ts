import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {createGoalService,type GoalDependencies} from '../src/persistent-goal.js';
import {aggregationContract} from '../src/acceptance.js';import {readRun,writeRun} from '../src/engineering-store.js';
import type {ChatOptions} from '../src/chat-options.js';
const goal='Aggregate numbers [3,1,2]: write aggregate.json with sum and sorted.';const contract=aggregationContract(goal)!;
const options:ChatOptions={model:'gpt-6-sol',effort:'medium',permission:'workspace-write',agents:0,delegation:{mode:'auto',count:10}};
const dispatch=(id:string,backend='codex')=>({action:'dispatch',reason:'Choose route from prior evidence',tasks:[{id,backend,...contract}],concurrency:1,selected:[],contract});
const finish=(id:string)=>({action:'finish',reason:'Request external integration verification',tasks:[],selected:[id],concurrency:1});
const challenge:GoalDependencies['challenge']=async c=>({checks:c.acceptance.map((criterion,i)=>({criterion,source:`import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';const value=JSON.parse(readFileSync('aggregate.json','utf8'));${i===0?'assert.equal(value.sum,6);':'assert.deepEqual(value.sorted,[1,2,3]);'}`})),limitations:[]});
async function fixture(){const root=await mkdtemp(join(tmpdir(),'persistent-goal-'));const project=join(root,'project');await mkdir(project);return {root,project};}
const good:GoalDependencies['worker']=async(_s,j)=>{await mkdir(j.workspace,{recursive:true});await writeFile(join(j.workspace,'aggregate.json'),JSON.stringify({sum:6,sorted:[1,2,3]}));return {status:'completed',text:'claim',durationMs:0,usage:{fixture:true}};};

test('persistent manager changes backend after failure, resumes evidence across services, and integrates',async()=>{
 const {root,project}=await fixture();const used:string[]=[];let pauseAt=1;let service:ReturnType<typeof createGoalService>;
 const deps:GoalDependencies={challenge,decide:async s=>s.rounds.length===0?dispatch('bad'):s.rounds.length===1?dispatch('good','commandcode'):finish('good'),worker:async(spec,j)=>{
 used.push(spec.backend);await mkdir(j.workspace,{recursive:true});await promisify(execFile)(process.execPath,['-e',`require('node:fs').writeFileSync('aggregate.json',JSON.stringify({sum:${j.id==='bad'?0:6},sorted:[1,2,3]}))`],{cwd:j.workspace,windowsHide:true});return {status:'completed',text:'claim',durationMs:1,usage:{fixture:true}};},onCheckpoint:async s=>{if(s.events.at(-1)?.type==='round-completed'&&s.rounds.length===pauseAt)void service.pause();}};
 service=createGoalService(root,deps);const {id}=await service.create({goal,project,options});await service.resume(id);await service.wait();const first=await service.detail(id);assert.equal(first.status,'paused');assert.equal(first.tasks[0]!.acceptance?.status,'rejected');assert.equal(used.length,3);
 pauseAt=2;service=createGoalService(root,deps);await service.resume(id);await service.wait();const second=await service.detail(id);assert.equal(second.status,'paused');assert.equal(second.tasks[1]!.acceptance?.status,'accepted');assert.equal(second.deadline,first.deadline);assert.ok(second.calls>first.calls);
 pauseAt=-1;service=createGoalService(root,deps);await service.resume(id);await service.wait();const last=await service.detail(id);assert.equal(last.status,'completed');assert.equal(last.rounds.length,3);assert.deepEqual(used,['codex','codex','codex','commandcode']);assert.equal(last.tasks.length,2);assert.equal(last.delivery?.acceptance.status,'accepted');assert.ok(last.checks>second.checks);assert.equal(JSON.parse(await readFile(join(await service.folder(id),'aggregate.json'),'utf8')).sum,6);
 await service.resume(id);assert.equal((await service.detail(id)).calls,last.calls);
});

test('unsupported verifier never completes goal and evidence survives round limit',async()=>{
 const {root,project}=await fixture();const service=createGoalService(root,{registry:[],challenge,worker:good,decide:async()=>dispatch('one')});const {id}=await service.create({goal,project,options,maxRounds:1});await service.resume(id);await service.wait();const s=await service.detail(id);assert.equal(s.status,'incomplete');assert.equal(s.tasks[0]!.acceptance?.status,'unverified');await assert.rejects(service.folder(id));await assert.rejects(service.resume(id),/budget/);
});

test('saved accepted candidate is rechecked and tampering blocks recovery',async()=>{
 const {root,project}=await fixture();let service:ReturnType<typeof createGoalService>;service=createGoalService(root,{challenge,worker:good,decide:async()=>dispatch('one'),onCheckpoint:async s=>{if(s.events.at(-1)?.type==='round-completed')void service.pause();}});const {id}=await service.create({goal,project,options});await service.resume(id);await service.wait();const s=await service.detail(id);await writeFile(join(s.tasks[0]!.functional!.candidate.snapshot,'aggregate.json'),'{}');const next=createGoalService(root,{challenge,worker:good,decide:async()=>{throw Error('No dispatch after changed evidence');}});await next.resume(id);await next.wait();assert.equal((await next.detail(id)).status,'blocked');
});

test('unknown execution, cancellation and configuration changes prevent replay',async()=>{
 const {root,project}=await fixture();const service=createGoalService(root);const {id}=await service.create({goal,project,options});const path=join(root,'.goals',id);const state=await readRun<any>(path);state.safe=false;state.inflight.x={id:'worker',path:'unknown'};await writeRun(path,state,{});await assert.rejects(service.resume(id),/unknown/);await service.cancel(id);await assert.rejects(service.resume(id),/取消/);
 const other=await service.create({goal,project,options});const altered=await readRun<any>(join(root,'.goals',other.id));altered.options.model='different';await writeRun(join(root,'.goals',other.id),altered,{});await assert.rejects(service.resume(other.id),/configuration/);assert.equal((await service.list()).find(r=>r.id===other.id)?.status,'blocked');
});

test('runtime enforces concurrency cap before worker dispatch',async()=>{
 const {root,project}=await fixture();let calls=0;const service=createGoalService(root,{decide:async()=>({...dispatch('one'),concurrency:3}),worker:async(s,j)=>{calls++;return good!(s,j);}});const {id}=await service.create({goal,project,options,concurrency:2});await service.resume(id);await service.wait();assert.equal(calls,0);assert.match((await service.detail(id)).reason!,/limits/);
});

test('workers without backend session IDs can hand off verified dependencies and finish',async()=>{
 const {root,project}=await fixture();const started:string[]=[];
 const service=createGoalService(root,{challenge,decide:async s=>!s.rounds.length?{...dispatch('a'),tasks:[{id:'a',backend:'codex',...contract},{id:'b',backend:'commandcode',...contract,dependsOn:['a']}]}:finish('b'),worker:async(spec,j)=>{
  started.push(j.id);if(j.id==='b')assert.equal(JSON.parse(await readFile(join(j.workspace,'inputs','a','aggregate.json'),'utf8')).sum,6);return good!(spec,j);
 }});
 const {id}=await service.create({goal,project,options});await service.resume(id);await service.wait();const state=await service.detail(id);
 assert.equal(state.status,'completed',state.reason??'');assert.deepEqual(started,['a','b']);assert.ok(state.tasks.every(t=>t.acceptance?.status==='accepted'));assert.equal(state.calls,4);
});

test('cancelling during integration settlement prevents a completed checkpoint',async()=>{
 const {root,project}=await fixture();let cancelled=false;let service:ReturnType<typeof createGoalService>;
 service=createGoalService(root,{challenge,worker:good,decide:async s=>!s.rounds.length?dispatch('one'):finish('one'),onCheckpoint:async s=>{
  if(s.delivery&&s.events.at(-1)?.type==='settled'){cancelled=true;void service.cancel(s.id);}
 }});
 const {id}=await service.create({goal,project,options});await service.resume(id);await service.wait();const state=await service.detail(id);
 assert.equal(cancelled,true);assert.equal(state.status,'cancelled');assert.ok(!state.events.some(e=>e.type==='delivery'));await assert.rejects(service.folder(id));await assert.rejects(service.resume(id),/取消/);
});

test('cancel and resume racing on an inactive goal never dispatch a cancelled goal',async()=>{
 const {root,project}=await fixture();let calls=0;const service=createGoalService(root,{decide:async()=>{calls++;return dispatch('one');},worker:good,challenge});
 const {id}=await service.create({goal,project,options});const cancel=service.cancel(id),resume=service.resume(id);const rejected=assert.rejects(resume,/取消/);await cancel;await rejected;assert.equal(calls,0);assert.equal((await service.detail(id)).status,'cancelled');
});

test('contact cleaning uses frozen input and independent external verifier',async()=>{
 const {root,project}=await fixture();await writeFile(join(project,'contacts.json'),JSON.stringify([{name:' Alice ',email:' A@EXAMPLE.COM '},{name:'duplicate',email:'a@example.com'},{name:'Bad',email:'bad'},{name:'Bob',email:'b@example.com'}]));
 const {contactDomain}=await import('../src/contact-verifier.js');const text='清洗联系人 contacts.json',domain=(await contactDomain(text,project))!;
 const service=createGoalService(root,{decide:async s=>!s.rounds.length?{...dispatch('clean'),contract:domain.contract,tasks:[{id:'clean',backend:'commandcode',...domain.contract}]}:finish('clean'),challenge:async c=>({checks:c.acceptance.map(criterion=>({criterion,source:`import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';assert.deepEqual(JSON.parse(readFileSync('cleaned-contacts.json','utf8')),[{name:'Alice',email:'a@example.com'},{name:'Bob',email:'b@example.com'}]);`})),limitations:[]}),worker:async(_s,j)=>{assert.equal(JSON.parse(await readFile(join(j.workspace,'contacts.json'),'utf8')).length,4);await writeFile(join(j.workspace,'cleaned-contacts.json'),JSON.stringify([{name:'Alice',email:'a@example.com'},{name:'Bob',email:'b@example.com'}]));return {status:'completed',text:'done',usage:null,durationMs:0};}});
 const {id}=await service.create({goal:text,project,options});await writeFile(join(project,'contacts.json'),'[]');await service.resume(id);await service.wait();const s=await service.detail(id);assert.equal(s.status,'completed');assert.equal(s.delivery?.verifier?.id,'contact-cleaning');assert.equal(s.domain?.input.length,4);
});

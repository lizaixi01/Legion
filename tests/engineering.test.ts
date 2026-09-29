import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {evidencePolicy} from '../src/team.js';
import {createEngineeringService} from '../src/engineering.js';
import {defaultChatOptions,modelCatalog} from '../src/chat-options.js';
import type {ModelSelection} from '../src/model-selection.js';
import {validatePlan,type Plan} from '../src/engineering-plan.js';
const source="export const sum = (a,b) => a+b;";
const baseline="import {test} from 'node:test';import assert from 'node:assert/strict';import {sum} from './sum.mjs';test('existing sum',()=>assert.equal(sum(1,2),3));";
const testSource="import {test} from 'node:test';import assert from 'node:assert/strict';import {sum} from './sum.mjs';test('new case',()=>assert.equal(sum(-2,1),0));";
async function fixture(){const root=await mkdtemp(join(tmpdir(),'engineering-'));const project=join(root,'project');await mkdir(project);await writeFile(join(project,'sum.mjs'),source);await writeFile(join(project,'sum.test.mjs'),baseline);return {root,project};}
async function idle(service:ReturnType<typeof createEngineeringService>){for(let i=0;i<500&&service.isActive();i++)await new Promise(r=>setTimeout(r,10));assert.equal(service.isActive(),false);}
test('GUI engineering contract drives failure repair, frozen tests and accepted delivery without changing source',async()=>{
 const {root,project}=await fixture();let calls=0;const sessions:(string|undefined)[]=[];
 const service=createEngineeringService(root,process.execPath,{decideFactory:()=>evidencePolicy,plan:async()=>({summary:'Clamp sum',outputs:['sum.mjs'],acceptance:['nonnegative sum'],testSource,limitations:['Only selected inputs checked']}),worker:async request=>{sessions.push(request.sessionId);calls++;await writeFile(join(request.attemptDir,'stdout.jsonl'),'worker log');await writeFile(join(request.workspace,'sum.mjs'),calls===1?source:'export const sum=(a,b)=>Math.max(0,a+b);');await writeFile(join(request.workspace,'sum.test.mjs'),'// worker tries to remove tests');return {status:'completed',sessionId:'worker-one',durationMs:1,usage:[]};}});
 const {id}=await service.plan({project,goal:'Clamp sum at zero',options:defaultChatOptions});await idle(service);assert.equal((await service.detail(id)).status,'ready');
 await service.start(id);await idle(service);const result=await service.detail(id);assert.equal(result.status,'checks_passed');assert.deepEqual(sessions,[undefined,'worker-one']);
 assert.equal(await readFile(join(project,'sum.mjs'),'utf8'),source);
 assert.match(await readFile(join(await service.folder(id),'sum.mjs'),'utf8'),/Math.max/);
 const state=JSON.parse(await readFile(join(root,'.runs',result.runId!,'state.json'),'utf8'));assert.equal(state.tasks.implementation.attempts[0].report.checks[0].status,'fail');assert.equal(state.tasks.implementation.attempts[1].report.checks[0].status,'pass');
 await assert.rejects(service.start(id),/不可执行/);
});

function graphPlan(): Plan {
 const unit=(id:string,value:number)=>({id,goal:'Implement '+id,dependsOn:[] as string[],outputs:[id+'.mjs'],acceptance:['returns '+value],testSource:`import {test} from 'node:test';import assert from 'node:assert/strict';import {value} from './${id}.mjs';test('${id}',()=>assert.equal(value,${value}));`});
 return {summary:'Compose two independent modules',outputs:['left.mjs','right.mjs','total.mjs'],acceptance:['total is five'],limitations:[],testSource:"import {test} from 'node:test';import assert from 'node:assert/strict';import {value} from './total.mjs';test('integrated',()=>assert.equal(value,5));",tasks:[unit('left',2),unit('right',3),{...unit('total',5),dependsOn:['left','right']}]};
}

test('engineering graph runs independent tasks concurrently and checks assembled delivery',async()=>{
 const {root,project}=await fixture();let active=0,peak=0,entered=0;let release!:()=>void;
 const barrier=new Promise<void>(resolve=>{release=resolve;});const called:string[]=[];
 const service=createEngineeringService(root,process.execPath,{plan:async()=>graphPlan(),worker:async(request,task)=>{
   called.push(task.id);active++;peak=Math.max(peak,active);
   if(task.id!=='total'){entered++;if(entered===2)release();await barrier;await writeFile(join(request.workspace,task.id+'.mjs'),`export const value=${task.id==='left'?2:3};`);}
   else {
     assert.match(await readFile(join(request.workspace,'left.mjs'),'utf8'),/value=2/);
     assert.match(await readFile(join(request.workspace,'right.mjs'),'utf8'),/value=3/);
     await writeFile(join(request.workspace,'left.mjs'),'export const value=999;');
     await writeFile(join(request.workspace,'total.mjs'),"import {value as a} from './left.mjs';import {value as b} from './right.mjs';export const value=a+b;");
   }
   active--;return {status:'completed',sessionId:task.id,durationMs:1,usage:[]};
 }});
 const {id}=await service.plan({project,goal:'Compose modules',options:defaultChatOptions});await idle(service);await service.start(id);await idle(service);
 const result=await service.detail(id);assert.equal(result.status,'checks_passed');assert.equal(peak,2);assert.equal(called.at(-1),'total');
 assert.match(await readFile(join(await service.folder(id),'left.mjs'),'utf8'),/value=2/);
 assert.equal(result.integration?.checks[0]?.status,'pass');
});

test('integration failure prevents delivery even when all task checks pass',async()=>{
 const {root,project}=await fixture();const plan=graphPlan();plan.tasks=plan.tasks!.slice(0,2);plan.outputs=['left.mjs','right.mjs'];
 plan.testSource="import {test} from 'node:test';import assert from 'node:assert/strict';import {value as a} from './left.mjs';import {value as b} from './right.mjs';test('integration',()=>assert.equal(a+b,100));";
 const service=createEngineeringService(root,process.execPath,{plan:async()=>plan,worker:async(request,task)=>{await writeFile(join(request.workspace,task.id+'.mjs'),`export const value=${task.id==='left'?2:3};`);return {status:'completed',sessionId:task.id,durationMs:1,usage:[]};}});
 const {id}=await service.plan({project,goal:'Compose',options:defaultChatOptions});await idle(service);await service.start(id);await idle(service);
 const result=await service.detail(id);assert.equal(result.status,'incomplete');assert.equal(result.integration?.checks[0]?.status,'fail');await assert.rejects(service.folder(id));
});

test('plan rejects cycles, unknown dependencies, overlapping owners and incomplete delivery lists',()=>{
 for(const mutate of [
   (p:Plan)=>{p.tasks![0]!.dependsOn=['total'];},
   (p:Plan)=>{p.tasks![0]!.dependsOn=['missing'];},
   (p:Plan)=>{p.tasks![1]!.outputs=['LEFT.mjs'];},
   (p:Plan)=>{p.outputs=['left.mjs'];},
 ]){const plan=graphPlan();mutate(plan);assert.throws(()=>validatePlan(plan,{}));}
});

test('manager and per-task worker models remain independent, validated and recorded across restart',async()=>{
 const {root,project}=await fixture(),catalog=await modelCatalog();
 const other=catalog.find(m=>m.id!==defaultChatOptions.model)!;assert.ok(other);
 const selected:ModelSelection={model:other.id,effort:other.efforts[0] as ModelSelection['effort']};
 const manager={...defaultChatOptions,effort:'high' as const};
 const planner=createEngineeringService(root,process.execPath,{plan:async(_goal,_files,options)=>{assert.equal(options.model,manager.model);assert.equal(options.effort,manager.effort);return graphPlan();}});
 const {id}=await planner.plan({project,goal:'Compose',options:manager,workerOptions:selected});await idle(planner);
 assert.deepEqual((await planner.detail(id)).workerOptions,selected);
 const seen:ModelSelection[]=[];
 const service=createEngineeringService(root,process.execPath,{workerFactory:selection=>{seen.push(selection);return async(request,task)=>{await writeFile(join(request.workspace,task.id+'.mjs'),task.id==='total'?"import {value as a} from './left.mjs';import {value as b} from './right.mjs';export const value=a+b;":`export const value=${task.id==='left'?2:3};`);return {status:'completed',sessionId:task.id,durationMs:1,usage:[]};};}});
 await assert.rejects(service.start(id,{worker:selected,tasks:{unknown:selected}}),/未知任务/);
 await assert.rejects(service.start(id,{worker:{model:'missing-model',effort:'high'},tasks:{}}),/模型/);
 assert.equal(service.isActive(),false);
 const override:ModelSelection={model:manager.model,effort:'low'};
 await service.start(id,{worker:selected,tasks:{total:override}});await idle(service);
 const result=await service.detail(id);assert.equal(result.status,'checks_passed');assert.deepEqual(seen,[selected,selected,override]);
 for(const task of ['left','right','total']){const record=JSON.parse(await readFile(join(root,'.runs',result.runId!,'tasks',task,'attempt-1','options.json'),'utf8'));assert.equal(record.model,task==='total'?override.model:selected.model);assert.equal(record.effort,task==='total'?override.effort:selected.effort);}
 assert.equal(JSON.parse(await readFile(join(root,'.engineering',id,'planner','options.json'),'utf8')).model,manager.model);
});
test('engineering refuses missing baseline and attempts to change frozen tests',async()=>{
 const {root,project}=await fixture();const service=createEngineeringService(root,process.execPath,{plan:async()=>({summary:'bad',outputs:['sum.test.mjs'],acceptance:['ok'],testSource,limitations:[]})});
 const {id}=await service.plan({project,goal:'change',options:defaultChatOptions});await idle(service);assert.equal((await service.detail(id)).status,'error');await assert.rejects(service.start(id));
 const empty=join(root,'empty');await mkdir(empty);const next=await service.plan({project:empty,goal:'change',options:defaultChatOptions});await idle(service);assert.match((await service.detail(next.id)).error!,/没有可直接运行/);
});

test('saved ready plans can start after restart and cancellation prevents delivery',async()=>{
 const {root,project}=await fixture();
 const planner=createEngineeringService(root,process.execPath,{plan:async()=>({summary:'Clamp',outputs:['sum.mjs'],acceptance:['nonnegative'],testSource,limitations:[]})});
 const {id}=await planner.plan({project,goal:'Clamp',options:defaultChatOptions});await idle(planner);
 let entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;});
 const restarted=createEngineeringService(root,process.execPath,{worker:async request=>{assert.ok(request.signal);const signal=request.signal;entered();await new Promise<void>(resolve=>{if(signal.aborted)resolve();else signal.addEventListener('abort',()=>resolve(),{once:true});});return {status:'cancelled',durationMs:1,usage:[]};}});
 await restarted.start(id);await started;assert.equal((await restarted.detail(id)).status,'running');
 await restarted.stop();assert.equal((await restarted.detail(id)).status,'cancelled');await assert.rejects(restarted.folder(id),/没有通过检查/);
 assert.equal(await readFile(join(project,'sum.mjs'),'utf8'),source);
});


test('engineering Manager chooses a fresh route with failure memory and its own model',async()=>{
 const {root,project}=await fixture();let calls=0,decisions=0;
 const manager={...defaultChatOptions,effort:'high' as const};
 const service=createEngineeringService(root,process.execPath,{
  plan:async()=>({summary:'Clamp',outputs:['sum.mjs'],acceptance:['nonnegative'],testSource,limitations:[]}),
  decideFactory:selection=>{assert.deepEqual(selection,{model:manager.model,effort:manager.effort});return (input)=>{
   decisions++;assert.equal(input.report.checks[0]?.status,'fail');
   return {action:'switch',reason:'Use the failed negative-input case',guidance:'Clamp the result at zero'};
  };},
  worker:async request=>{
   calls++;assert.equal(request.sessionId,undefined);
   if(calls===2){assert.match(request.prompt,/Prior attempt evidence/);assert.match(request.prompt,/new case/);assert.match(request.prompt,/Clamp the result/);
    const memory=JSON.parse(await readFile(join(request.attemptDir,'memory.json'),'utf8'));
    assert.equal(memory[0].route,0);assert.equal(memory[0].decisions[0].action,'switch');assert.equal(memory[0].checks[0].status,'fail');
   }
   await writeFile(join(request.workspace,'sum.mjs'),calls===1?source:'export const sum=(a,b)=>Math.max(0,a+b);');
   return {status:'completed',sessionId:'route-'+calls,durationMs:1,usage:[]};
  }
 });
 const {id}=await service.plan({project,goal:'Clamp',options:manager});await idle(service);await service.start(id);await idle(service);
 const result=await service.detail(id);assert.equal(result.status,'checks_passed');assert.equal(decisions,1);assert.equal(calls,2);
});

test('engineering rejects Manager acceptance of failed checks and preserves decision evidence',async()=>{
 const {root,project}=await fixture();
 const service=createEngineeringService(root,process.execPath,{
  plan:async()=>({summary:'Clamp',outputs:['sum.mjs'],acceptance:['nonnegative'],testSource,limitations:[]}),
  decideFactory:()=>()=>({action:'accept',reason:'Ignore the test'}),
  worker:async request=>{await writeFile(join(request.workspace,'sum.mjs'),source);return {status:'completed',sessionId:'bad',durationMs:1,usage:[]};}
 });
 const {id}=await service.plan({project,goal:'Clamp',options:defaultChatOptions});await idle(service);await service.start(id);await idle(service);
 const result=await service.detail(id);assert.equal(result.status,'incomplete');await assert.rejects(service.folder(id));
 const state=JSON.parse(await readFile(join(root,'.runs',result.runId!,'state.json'),'utf8'));
 assert.match(state.tasks.implementation.reason,/cannot accept/);assert.equal(state.tasks.implementation.attempts[0].decisions[0].action,'accept');
});

test('competing engineering routes overlap, select a checked candidate and deliver without combining alternatives',async()=>{
 const {root,project}=await fixture();let entered=0,release!:()=>void;const barrier=new Promise<void>(r=>{release=r;});const workspaces=new Set<string>();
 const service=createEngineeringService(root,process.execPath,{
  plan:async()=>({summary:'Clamp',outputs:['sum.mjs'],acceptance:['nonnegative'],testSource,limitations:[]}),
  decideFactory:()=>()=>({action:'stop',reason:'Discard failed candidate'}),
  worker:async request=>{workspaces.add(request.workspace);entered++;if(entered===2)release();await barrier;
   const first=request.workspace.includes('candidate-1');
   await writeFile(join(request.workspace,'sum.mjs'),first?source:'export const sum=(a,b)=>Math.max(0,a+b);');
   return {status:'completed',sessionId:first?'first':'second',durationMs:1,usage:[]};
  }
 });
 const {id}=await service.plan({project,goal:'Clamp',options:defaultChatOptions});await idle(service);
 await service.start(id,{worker:{model:defaultChatOptions.model,effort:defaultChatOptions.effort},tasks:{},candidates:2});await idle(service);
 const result=await service.detail(id);assert.equal(result.status,'checks_passed');assert.equal(workspaces.size,2);
 const state=JSON.parse(await readFile(join(root,'.runs',result.runId!,'state.json'),'utf8'));
 assert.equal(state.tasks.implementation.selectedCandidate,'candidate-2');
 assert.equal(state.tasks.implementation.candidates['candidate-1'].status,'failed');
 assert.equal(state.tasks.implementation.selectionReport.checks[0].status,'pass');
 assert.match(await readFile(join(await service.folder(id),'sum.mjs'),'utf8'),/Math.max/);
});

test('new engineering mode automatically executes the Manager plan without a manual start',async()=>{
 const {root,project}=await fixture();let calls=0;
 const service=createEngineeringService(root,process.execPath,{decideFactory:()=>evidencePolicy,plan:async()=>({summary:'Clamp',outputs:['sum.mjs'],acceptance:['nonnegative'],testSource,limitations:[]}),worker:async(request)=>{calls++;await writeFile(join(request.workspace,'sum.mjs'),'export const sum=(a,b)=>Math.max(0,a+b);');return {status:'completed',sessionId:'automatic-worker',durationMs:1,usage:[]};}});
 const {id}=await service.plan({project,goal:'Clamp sum at zero',options:{...defaultChatOptions,delegation:{mode:'auto',count:10}}});await idle(service);
 assert.equal((await service.detail(id)).status,'checks_passed');assert.equal(calls,1);
});

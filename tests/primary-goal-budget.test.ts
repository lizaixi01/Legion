import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {createGoalBudget,openGoalBudget,readGoalBudget} from '../src/primary-goal-budget.js';
import {createPrimaryTasks} from '../src/primary-agent.js';
import {defaultChatOptions} from '../src/chat-options.js';

async function fixture(workers=2){const root=await mkdtemp(join(tmpdir(),'goal-budget-')),directory=join(root,'budget'),config={id:randomUUID(),objective:'original',deadline:Date.now()+60000,workers,checks:1};await createGoalBudget(directory,config);return {root,directory,config};}

test('goal reservations persist across connections and serialize the last slot',async()=>{
 const {directory,config}=await fixture(1);let budget=await openGoalBudget(directory,config);
 await assert.rejects(openGoalBudget(directory,config),/alive/);
 const outcomes=await Promise.allSettled([budget.reserve('worker','a'),budget.reserve('worker','b')]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
 for(const r of outcomes)if(r.status==='fulfilled')await r.value();
 await budget.close();budget=await openGoalBudget(directory,config);
 assert.equal(budget.remaining('worker'),0);await assert.rejects(budget.reserve('worker','c'),/exhausted/);
 const settle=await budget.reserve('check','check');await settle();await settle();await budget.close();
 assert.equal((await readGoalBudget(directory)).checksUsed,1);
});

test('unknown outcomes, changed objectives and damaged checkpoints cannot resume',async()=>{
 const {directory,config}=await fixture();await assert.rejects(openGoalBudget(directory,{...config,objective:'weakened'}),/original/);
 const budget=await openGoalBudget(directory,config);await budget.reserve('worker','unknown');await budget.close();
 await assert.rejects(openGoalBudget(directory,config),/unknown/);
 await writeFile(join(directory,'run.json'),'{}');await assert.rejects(openGoalBudget(directory,config),/damaged/);
});

test('worker and independent reviewer share a durable goal budget after reopening',async()=>{
 const {root,directory,config}=await fixture(1);let count=0,budget=await openGoalBudget(directory,config);
 const options={...defaultChatOptions,delegation:{mode:'fixed' as const,count:2}};
 const run=async()=>{count++;return {status:'completed' as const,text:'done',durationMs:1,usage:null};};
 let tasks=await createPrimaryTasks(root,join(root,'tasks'),root,options,undefined,run,config.deadline,undefined,budget);
 const task=await tasks.call('legion_dispatch',{backend:'codex',prompt:'work'}) as {id:string};await tasks.call('legion_tasks',{action:'wait',id:task.id});await tasks.close();await budget.close();
 budget=await openGoalBudget(directory,config);tasks=await createPrimaryTasks(root,join(root,'tasks'),root,options,undefined,run,config.deadline,undefined,budget);
 assert.equal(tasks.capacity().remainingCalls,0);await assert.rejects(tasks.call('legion_dispatch',{backend:'commandcode',prompt:'new'}),/capacity/);
 await assert.rejects(tasks.review({backend:'codex',command:'fixture',model:'fixture',effort:'medium',prefix:[]}, {id:'review',prompt:'review',workspace:root,logDir:root,timeoutMs:1000}),/capacity/);
 assert.equal(count,1);await tasks.close();await budget.close();
});

test('a runner with unknown outcome leaves its reservation unresolved',async()=>{
 const {root,directory,config}=await fixture();const budget=await openGoalBudget(directory,config);
 const tasks=await createPrimaryTasks(root,join(root,'tasks'),root,{...defaultChatOptions,delegation:{mode:'fixed',count:1}},undefined,async()=>{throw Error('unknown transport outcome');},config.deadline,undefined,budget);
 const task=await tasks.call('legion_dispatch',{backend:'codex',prompt:'work'}) as {id:string};await tasks.call('legion_tasks',{action:'wait',id:task.id});await tasks.close();await budget.close();
 assert.equal(Object.keys((await readGoalBudget(directory)).inflight).length,1);await assert.rejects(openGoalBudget(directory,config),/unknown/);
});

test('shutdown waits for every worker even when another reservation fails to settle',async()=>{
 const {root,config}=await fixture();let slowDone!:()=>void,slowStarted!:()=>void;const started=new Promise<void>(r=>{slowStarted=r;}),slow=new Promise<void>(r=>{slowDone=r;});let reserves=0,settlementFailed!:()=>void;const failure=new Promise<void>(r=>{settlementFailed=r;});
 const budget={remaining:()=>5,unsettled:()=>0,close:async()=>{},reserve:async()=>{const first=++reserves===1;return async()=>{if(first){settlementFailed();throw Error('settlement disk failure');}};}};
 const tasks=await createPrimaryTasks(root,join(root,'tasks'),root,{...defaultChatOptions,delegation:{mode:'fixed',count:2}},undefined,async(_s,job,signal)=>{
  if(job.prompt.endsWith('slow')){slowStarted();await slow;}else await new Promise<void>(r=>{if(signal?.aborted)r();else signal?.addEventListener('abort',()=>r(),{once:true});});return {status:'cancelled',text:'',durationMs:1,usage:null};
 },config.deadline,undefined,budget);
 await tasks.call('legion_dispatch',{backend:'codex',prompt:'fast'});await tasks.call('legion_dispatch',{backend:'codex',prompt:'slow'});await started;
 let finished=false;const closing=tasks.close().finally(()=>{finished=true;});void closing.catch(()=>{});
 try{await failure;await new Promise(r=>setImmediate(r));assert.equal(finished,false);}finally{slowDone();}
 await assert.rejects(closing,/settlement disk failure/);assert.equal(tasks.pending(),0);
});

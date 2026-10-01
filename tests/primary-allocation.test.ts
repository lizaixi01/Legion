import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createPrimaryTasks} from '../src/primary-agent.js';
import {createPrimaryStrategy} from '../src/primary-strategy.js';
import {defaultChatOptions} from '../src/chat-options.js';

test('a frozen mixed-backend plan drains within one slot and repeat execute never duplicates workers',async()=>{
 const root=await mkdtemp(join(tmpdir(),'allocation-')),evidenceId=randomUUID(),jobs:{backend:string;id:string;timeout:number}[]=[];
 let release=()=>{};
 const tasks=await createPrimaryTasks(root,join(root,'tasks'),root,{...defaultChatOptions,delegation:{mode:'fixed',count:1}},undefined,async(spec,job)=>{
  jobs.push({backend:spec.backend,id:job.id,timeout:job.timeoutMs});await new Promise<void>(r=>{release=r;});return {status:'completed',text:'claim',usage:null,durationMs:1};
 },Date.now()+60000);
 const strategy=createPrimaryStrategy(join(root,'decisions'),{ids:()=>[evidenceId],inspect:async(id)=>({id,status:'verified'})},{capacity:tasks.capacity,dispatch:(work,link)=>tasks.call('legion_dispatch',work,link)});
 const decision=await strategy.call({action:'continue',reason:'compare two hypotheses',evidenceIds:[evidenceId],nextExperiment:'measure tradeoff',workers:[{backend:'codex',prompt:'hypothesis A',timeoutSeconds:1800},{backend:'commandcode',prompt:'hypothesis B',timeoutSeconds:30}]}) as {id:string};
 await Promise.all([1,2].map(()=>strategy.call({action:'execute',decisionId:decision.id})));
 while(!jobs.length)await new Promise(r=>setTimeout(r,5));assert.equal(jobs.length,1);assert.ok(jobs[0]!.timeout<=60000);assert.equal(strategy.pending(),true);
 release();await tasks.call('legion_tasks',{action:'wait',id:jobs[0]!.id});
 await strategy.call({action:'execute',decisionId:decision.id});while(jobs.length<2)await new Promise(r=>setTimeout(r,5));assert.equal(jobs[1]!.backend,'commandcode');assert.ok(jobs[1]!.timeout<=30000);
 release();await tasks.call('legion_tasks',{action:'wait',id:jobs[1]!.id});await strategy.call({action:'execute',decisionId:decision.id});assert.equal(jobs.length,2);assert.equal(strategy.pending(),false);
 const task=JSON.parse(await readFile(join(root,'tasks',jobs[0]!.id,'task.json'),'utf8'));assert.equal(task.decisionId,decision.id);assert.ok(task.allocationId);
 const plan=JSON.parse(await readFile(join(root,'decisions',decision.id+'.execution.json'),'utf8'));assert.equal(plan.workerSeconds,1830);assert.ok(plan.allocations.every((a:{status:string})=>a.status==='dispatched'));
 await strategy.close();await tasks.close();
});

test('stale evidence, cancelled plans, failed dispatch and shutdown cannot be replayed',async()=>{
 const root=await mkdtemp(join(tmpdir(),'allocation-fail-')),evidenceId=randomUUID();let stale=false,calls=0;
 const strategy=createPrimaryStrategy(root,{ids:()=>[evidenceId],inspect:async(id)=>{if(stale)throw Error('stale evidence');return {id,status:'verified'};}},{capacity:()=>({limit:1,active:0,remainingCalls:64,available:1,deadline:Infinity}),dispatch:async()=>{calls++;throw Error('unknown transport outcome');}});
 const create=()=>strategy.call({action:'continue',reason:'test',evidenceIds:[evidenceId],nextExperiment:'test hypothesis',workers:[{backend:'codex',prompt:'work'}]}) as Promise<{id:string}>;
 const first=await create();await strategy.call({action:'execute',decisionId:first.id});await strategy.call({action:'execute',decisionId:first.id});assert.equal(calls,1);
 const second=await create();await strategy.call({action:'cancel',decisionId:second.id});await strategy.call({action:'execute',decisionId:second.id});assert.equal(calls,1);
 const third=await create();stale=true;await strategy.call({action:'execute',decisionId:third.id});assert.equal(calls,1);
 stale=false;const fourth=await create();await strategy.close();await assert.rejects(strategy.call({action:'execute',decisionId:fourth.id}),/stopped/);assert.equal(strategy.pending(),false);
});

test('disabled delegation and exhausted calls refuse a plan before execution',async()=>{
 const root=await mkdtemp(join(tmpdir(),'allocation-budget-')),id=randomUUID();
 for(const capacity of [{limit:0,remainingCalls:64},{limit:10,remainingCalls:0}]){
  const strategy=createPrimaryStrategy(root,{ids:()=>[id],inspect:async(id)=>({id,status:'verified'})},{capacity:()=>({...capacity,active:0,available:0,deadline:Infinity}),dispatch:async()=>assert.fail('must not run')});
  await assert.rejects(strategy.call({action:'continue',reason:'test',evidenceIds:[id],nextExperiment:'hypothesis',workers:[{backend:'codex',prompt:'work'}]}),/budget|disabled/);await strategy.close();
 }
});

test('a launch-intent write failure prevents dispatch and cannot be retried implicitly',async()=>{
 const root=await mkdtemp(join(tmpdir(),'allocation-write-')),id=randomUUID();let calls=0;
 const strategy=createPrimaryStrategy(root,{ids:()=>[id],inspect:async(id)=>({id,status:'verified'})},{capacity:()=>({limit:1,active:0,remainingCalls:64,available:1,deadline:Infinity}),dispatch:async()=>{calls++;}});
 const decision=await strategy.call({action:'continue',reason:'test',evidenceIds:[id],nextExperiment:'hypothesis',workers:[{backend:'codex',prompt:'work'}]}) as {id:string};
 // A directory at the temporary file path makes the atomic write fail.
 const {mkdir}=await import('node:fs/promises');await mkdir(join(root,decision.id+'.execution.json.tmp'));
 await assert.rejects(strategy.call({action:'execute',decisionId:decision.id}));await strategy.call({action:'execute',decisionId:decision.id});assert.equal(calls,0);
});

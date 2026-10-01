import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {backendSpec} from '../src/managed-queue.js';
import {codexRuntime} from '../src/codex-runtime.js';
import {guardPrimaryCompletion} from '../src/primary-completion.js';
import {createPrimaryTasks} from '../src/primary-agent.js';
import {defaultChatOptions} from '../src/chat-options.js';
import {parseOutput} from '../src/worker-pool.js';
import {createChatService} from '../src/chat-service.js';
import {workerSpecsFor} from '../src/account-capacity.js';

test('delegated Codex uses the project runtime, never the global npm CLI',()=>{
 const root=join(tmpdir(),'isolated experiment');const spec=backendSpec(root,'codex');
 assert.equal(spec.command,codexRuntime(root));assert.deepEqual(spec.prefix,[]);
 assert.equal(spec.permission,'workspace-write');
 assert.equal(workerSpecsFor(root).codex.command,spec.command);
 assert.deepEqual(workerSpecsFor(root).codex.prefix,[]);
 assert.notEqual(backendSpec(root,'commandcode').command,codexRuntime(root));
});

test('unsupported worker model blocks task completion while preserving unknown usage',()=>{
 const message="The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account.";
 const worker=parseOutput('codex',JSON.stringify({type:'turn.failed',error:{message}}),1);
 assert.equal(worker.status,'error');assert.equal(worker.usage,null);
 const result=guardPrimaryCompletion({status:'completed',durationMs:1,usage:[]},[worker.detail!]);
 assert.equal(result.status,'error');assert.equal(result.acceptance?.status,'blocked');
 assert.match(result.detail!,/not supported/);
});

test('normal conversation stays completed; accepted repair can supersede a failed attempt',()=>{
 const reply={status:'completed' as const,durationMs:1,usage:[]};
 assert.equal(guardPrimaryCompletion(reply,[]),reply);
 const accepted={...reply,acceptance:{status:'accepted' as const,detail:'independent checks passed',uncovered:[]}};
 assert.equal(guardPrimaryCompletion(accepted,['earlier failed worker']),accepted);
 const cancelled={...reply,status:'cancelled' as const};
 assert.equal(guardPrimaryCompletion(cancelled,['failure']),cancelled);
});

test('failed worker stays blocked until its subsequent attempt succeeds',async()=>{
 const root=await mkdtemp(join(tmpdir(),'worker-blocker-'));let calls=0;
 const tasks=await createPrimaryTasks(root,join(root,'tasks'),root,{...defaultChatOptions,delegation:{mode:'fixed',count:1}},undefined,async()=>({status:++calls===1?'error':'completed',durationMs:1,text:'',usage:null,detail:calls===1?'HTTP 400 unsupported model':undefined}));
 try{
  const first=await tasks.call('legion_dispatch',{backend:'codex',prompt:'work'}) as {id:string};
  await tasks.call('legion_tasks',{action:'wait',id:first.id});assert.equal(tasks.failures().length,1);
  await tasks.call('legion_tasks',{action:'continue',id:first.id,prompt:'repair'});
  await tasks.call('legion_tasks',{action:'wait',id:first.id});assert.deepEqual(tasks.failures(),[]);
 }finally{await tasks.close();}
});

test('GUI chat data preserves the reply but persists blocked acceptance after model completion',async()=>{
 const root=await mkdtemp(join(tmpdir(),'blocked-chat-'));
 const service=createChatService(root,async request=>{
  await writeFile(join(request.attemptDir,'stdout.jsonl'),JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Worker could not start'}}));
  return guardPrimaryCompletion({status:'completed',durationMs:1,usage:[]},['Worker HTTP 400']);
 });
 const {id}=await service.send({text:'run benchmark'});
 while(service.isActive())await new Promise(r=>setTimeout(r,5));
 const restored=await createChatService(root).detail(id);
 assert.equal(restored.status,'error');assert.equal(restored.acceptance?.status,'blocked');
  assert.match(restored.error!,/任务受阻/);assert.equal(restored.messages.at(-1)?.text,'Worker could not start');
});

test('the turn worker budget is enforced by the runtime, not by the prompt',async() => {
 const root=await mkdtemp(join(tmpdir(),'worker-budget-'));
 const options={...defaultChatOptions,delegation:{mode:'fixed' as const,count:2,maxWorkers:2}};
 const tasks=await createPrimaryTasks(root,join(root,'tasks'),root,options,undefined,async()=>({status:'completed' as const,durationMs:1,text:'',usage:null}));
 try{
  const first=await tasks.call('legion_dispatch',{backend:'codex',prompt:'one'}) as {id:string};
  const second=await tasks.call('legion_dispatch',{backend:'codex',prompt:'two'}) as {id:string};
  assert.equal(tasks.capacity().maxCalls,2);
  await tasks.call('legion_tasks',{action:'wait',id:first.id});
  await tasks.call('legion_tasks',{action:'wait',id:second.id});
  assert.equal(tasks.capacity().active,0);
  assert.equal(tasks.capacity().remainingCalls,0);
  await assert.rejects(tasks.call('legion_dispatch',{backend:'codex',prompt:'three'}),/capacity exhausted/);
  await assert.rejects(tasks.call('legion_tasks',{action:'continue',id:first.id,prompt:'repair'}),/capacity exhausted/);
 }finally{await tasks.close();}
});

test('a small maxWorkers allocation does not block independent acceptance review',async() => {
 const root=await mkdtemp(join(tmpdir(),'worker-budget-review-'));
 const options={...defaultChatOptions,delegation:{mode:'fixed' as const,count:1,maxWorkers:1}};
 let reviews=0;
 const tasks=await createPrimaryTasks(root,join(root,'tasks'),root,options,undefined,async()=>{reviews++;return {status:'completed' as const,durationMs:1,text:'',usage:null};});
 try{
  const first=await tasks.call('legion_dispatch',{backend:'codex',prompt:'one'}) as {id:string};
  await tasks.call('legion_tasks',{action:'wait',id:first.id});
  assert.equal(tasks.capacity().active,0);
  assert.equal(tasks.capacity().remainingCalls,0);
  const review=await tasks.review({command:'codex',model:'gpt-6-astra','effort':'medium',permission:'read-only'} as never,{id:'review',prompt:'verify',workspace:root,logDir:root,timeoutMs:1000});
  assert.equal(review.status,'completed');
  assert.equal(reviews,2);
  assert.equal(tasks.capacity().remainingCalls,0);
 }finally{await tasks.close();}
});

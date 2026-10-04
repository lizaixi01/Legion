import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPrimaryTasks,primaryTools} from '../src/primary-agent.js';
import {codexAppServerWorker} from '../src/codex-app-server.js';
import {defaultChatOptions} from '../src/chat-options.js';
import {createChatService} from '../src/chat-service.js';

test('failed attempts remain readable after repair, restart and concurrent follow-up requests',async()=>{
 const root=await mkdtemp(join(tmpdir(),'primary-history-'));let count=0;let release:()=>void=()=>{};
 const options={...defaultChatOptions,serviceTier:'fast' as const,worker:{model:defaultChatOptions.model,effort:defaultChatOptions.effort,serviceTier:'default' as const},delegation:{mode:'fixed' as const,count:2}};
 const tasks=await createPrimaryTasks(root,join(root,'tasks'),root,options,undefined,async spec=>{
  assert.equal(spec.serviceTier,'default');
  count++;if(count===2)await new Promise<void>(r=>{release=r;});
  return {status:count===1?'error':'completed',text:count===1?'original failure':'repair claim',usage:null,durationMs:1,sessionId:'session'};
 });
 const first=await tasks.call('legion_dispatch',{backend:'codex',prompt:'initial work'}) as any;
 await tasks.call('legion_tasks',{action:'wait',id:first.id});
 const attempts=await Promise.allSettled([1,2].map(()=>tasks.call('legion_tasks',{action:'continue',id:first.id,prompt:'repair using failure'})));
 assert.equal(attempts.filter(a=>a.status==='fulfilled').length,1);
 while(count<2)await new Promise(r=>setTimeout(r,5));release();
 await tasks.call('legion_tasks',{action:'wait',id:first.id});await tasks.close();
 const restored=await createPrimaryTasks(root,join(root,'tasks'),root,options);
 const record=await restored.call('legion_tasks',{action:'read',id:first.id}) as any;
 assert.equal(record.history.length,2);assert.equal(record.history[0].result.text,'original failure');
 assert.equal(record.history[1].prompt,'repair using failure');assert.equal(record.history[1].result.text,'repair claim');
 assert.ok(record.history[0].model);assert.ok(record.history[0].finishedAt);
 assert.equal(record.history[0].serviceTier,'default');
 assert.equal(JSON.parse(await readFile(join(record.history[0].logs,'request.json'),'utf8')).serviceTier,'default');
 assert.equal(JSON.parse(await readFile(join(record.history[0].logs,'attempt.json'),'utf8')).result.text,'original failure');
 assert.equal(record.trust,'unverified');await restored.close();
});

test('simultaneous dispatch respects the configured capacity',async()=>{
 const root=await mkdtemp(join(tmpdir(),'primary-capacity-'));
 const tasks=await createPrimaryTasks(root,join(root,'tasks'),root,{...defaultChatOptions,delegation:{mode:'fixed',count:1}},undefined,async(_s,_j,signal)=>{
  await new Promise<void>(r=>{if(signal?.aborted)r();else signal?.addEventListener('abort',()=>r(),{once:true});});
  return {status:'cancelled',text:'',usage:null,durationMs:1};
 });
 const results=await Promise.allSettled(Array.from({length:10},()=>tasks.call('legion_dispatch',{backend:'codex',prompt:'work'})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(tasks.pending(),1);await tasks.close();
});

test('primary delegation supports both backends, limits, follow-up sessions and durable evidence',async()=>{
 const root=await mkdtemp(join(tmpdir(),'primary-')),jobs:any[]=[];let release:()=>void=()=>{};
 const tasks=await createPrimaryTasks(root,join(root,'tasks'),root,{...defaultChatOptions,delegation:{mode:'fixed',count:1}},undefined,async(spec,job)=>{jobs.push({spec,job});if(jobs.length===1)await new Promise<void>(r=>{release=r;});return {status:'completed',text:'claim',durationMs:1,usage:{},sessionId:'worker-session'};});
 const first=await tasks.call('legion_dispatch',{backend:'codex',prompt:'inspect'}) as any;
 await assert.rejects(tasks.call('legion_dispatch',{backend:'commandcode',prompt:'parallel'}),/capacity/);while(!jobs.length)await new Promise(r=>setTimeout(r,5));release();
 const result=await tasks.call('legion_tasks',{action:'wait',id:first.id}) as any;assert.equal(result.status,'completed');assert.equal(result.trust,'unverified');
 await tasks.call('legion_tasks',{action:'continue',id:first.id,prompt:'check result'});await tasks.call('legion_tasks',{action:'wait',id:first.id});assert.equal(jobs[1].job.sessionId,'worker-session');
 const other=await tasks.call('legion_dispatch',{backend:'commandcode',prompt:'file task'}) as any;await tasks.call('legion_tasks',{action:'wait',id:other.id});assert.equal(jobs[2].spec.backend,'commandcode');
 await tasks.close();const restored=await createPrimaryTasks(root,join(root,'tasks'),root,{...defaultChatOptions,delegation:{mode:'off',count:10}});
 assert.equal((await restored.call('legion_tasks',{action:'read',id:first.id}) as any).result.text,'claim');
 await assert.rejects(restored.call('legion_dispatch',{backend:'codex',prompt:'forbidden'}),/disabled/);await restored.close();
});

test('closing primary turn cancels children and unknown prior executions cannot be replayed',async()=>{
 const root=await mkdtemp(join(tmpdir(),'primary-stop-'));const tasks=await createPrimaryTasks(root,join(root,'tasks'),root,{...defaultChatOptions,delegation:{mode:'auto',count:10}},undefined,async(_s,_j,signal)=>{await new Promise<void>(r=>{if(signal?.aborted)r();else signal?.addEventListener('abort',()=>r(),{once:true});});return {status:'cancelled',text:'',usage:null,durationMs:1};});
 const r=await tasks.call('legion_dispatch',{backend:'codex',prompt:'long task'}) as any;await tasks.close();assert.equal(JSON.parse(await readFile(join(root,'tasks',r.id,'task.json'),'utf8')).status,'cancelled');
 await writeFile(join(root,'tasks',r.id,'task.json'),JSON.stringify({...r,status:'running'}));const restored=await createPrimaryTasks(root,join(root,'tasks'),root,{...defaultChatOptions,delegation:{mode:'auto',count:10}});
 await assert.rejects(restored.call('legion_tasks',{action:'continue',id:r.id,prompt:'retry'}),/unknown/);await restored.close();
});

test('app-server primary streams, handles tool requests, preserves native instructions and resumes thread',async()=>{
 const root=await mkdtemp(join(tmpdir(),'primary-rpc-'));
 await writeFile(join(root,'app-server'),`const fs=require('fs');const rl=require('readline').createInterface({input:process.stdin});const send=x=>console.log(JSON.stringify(x));let turn='t';rl.on('line',line=>{const m=JSON.parse(line);fs.appendFileSync('wire.jsonl',line+'\\n');if(!m.method){if(m.id==='server-tool'){if(!m.result.success)process.exit(5);send({method:'item/completed',params:{threadId:'thread',item:{id:'final',type:'agentMessage',text:'done'}}});send({method:'turn/completed',params:{threadId:'thread',turn:{id:turn,status:'completed'}}});}return;}if(m.method==='initialize')send({id:m.id,result:{}});if(m.method==='thread/start'||m.method==='thread/resume')send({id:m.id,result:{thread:{id:'thread'}}});if(m.method==='turn/start'){send({id:m.id,result:{turn:{id:turn}}});send({id:'server-tool',method:'item/tool/call',params:{threadId:'thread',tool:'legion_tasks',arguments:{action:'list'}}});}});`);
 let saved='';for(const resume of [false,true]){const attempt=join(root,resume?'two':'one');await mkdir(attempt);const result=await codexAppServerWorker(process.execPath,'gpt-6-sol',{workspace:root,attemptDir:attempt,prompt:'run',timeoutMs:10000,sessionId:resume?saved:undefined},{permission:'workspace-write',effort:'medium',instructions:'primary instructions',tools:primaryTools,callTool:async()=>[],onSession:async id=>{saved=id;}});assert.equal(result.status,'completed');assert.match(await readFile(join(attempt,'stdout.jsonl'),'utf8'),/done/);}
 const wire=(await readFile(join(root,'wire.jsonl'),'utf8')).trim().split('\n').map(x=>JSON.parse(x));const start=wire.find(x=>x.method==='thread/start');assert.equal(start.params.baseInstructions,undefined);assert.deepEqual(start.params.dynamicTools.map((tool:{name:string})=>tool.name),['legion_delivery','legion_dispatch','legion_tasks']);assert.ok(wire.some(x=>x.method==='thread/resume'&&x.params.threadId==='thread'));assert.equal(wire.find(x=>x.method==='turn/start').params.sandboxPolicy.type,'workspaceWrite');
});

test('file attachments reach the executable prompt and remain visible in history',async()=>{
 const root=await mkdtemp(join(tmpdir(),'primary-file-')),file=join(root,'input.txt');await writeFile(file,'context');let prompt='';
 const service=createChatService(root,async r=>{prompt=r.prompt;await writeFile(join(r.attemptDir,'stdout.jsonl'),JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'read'}}));return {status:'completed',durationMs:1,usage:[]};});
 const chat=await service.send({text:'read this',attachments:[file]});while(service.isActive())await new Promise(r=>setTimeout(r,10));assert.ok(prompt.includes(file));assert.ok((await service.detail(chat.id)).messages[0]!.text.includes(file));
});

test('worker inputs are copied independently and outside project paths are rejected',async()=>{
 const root=await mkdtemp(join(tmpdir(),'primary-input-')),project=join(root,'project');await mkdir(project);await writeFile(join(project,'data.json'),'[1,2]');await writeFile(join(root,'outside.txt'),'private');
 const tasks=await createPrimaryTasks(root,join(root,'tasks'),project,{...defaultChatOptions,delegation:{mode:'auto',count:10}},undefined,async(_s,j)=>{assert.equal(await readFile(join(j.workspace,'data.json'),'utf8'),'[1,2]');await writeFile(join(j.workspace,'data.json'),'changed');return {status:'completed',text:'done',usage:null,durationMs:1};});
 await assert.rejects(tasks.call('legion_dispatch',{backend:'commandcode',prompt:'read',inputs:['../outside.txt']}),/inside project/);
 const result=await tasks.call('legion_dispatch',{backend:'commandcode',prompt:'read',inputs:['data.json']}) as any;await tasks.call('legion_tasks',{action:'wait',id:result.id});assert.equal(await readFile(join(project,'data.json'),'utf8'),'[1,2]');await tasks.close();
});

test('independent reviewer shares worker capacity and cancellation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'primary-review-limit-'));let started=false;
 const tasks=await createPrimaryTasks(root,join(root,'tasks'),root,{...defaultChatOptions,delegation:{mode:'fixed',count:1}},undefined,async(_s,_j,signal)=>{
  started=true;await new Promise<void>(r=>{if(signal?.aborted)r();else signal?.addEventListener('abort',()=>r(),{once:true});});return {status:'cancelled',text:'',usage:null,durationMs:1};
 });
 const reviewing=tasks.review({backend:'codex',model:'test',effort:'medium',command:'unused',prefix:[]},{id:'review',prompt:'review',workspace:root,logDir:join(root,'review'),timeoutMs:1000});
 assert.equal(started,true);await assert.rejects(tasks.call('legion_dispatch',{backend:'codex',prompt:'over capacity'}),/capacity/);
 await tasks.close();assert.equal((await reviewing).status,'cancelled');assert.equal(tasks.pending(),0);
});

test('worker contract survives follow-up and submission snapshots preserve earlier files',async()=>{
 const root=await mkdtemp(join(tmpdir(),'primary-contract-'));let runs=0;
 const contract={goal:'write output',outputs:['result.txt'],acceptance:['contains requested content']};
 const tasks=await createPrimaryTasks(root,join(root,'tasks'),root,{...defaultChatOptions,delegation:{mode:'auto',count:10}},undefined,async(_spec,job)=>{
  assert.equal(job.timeoutMs,45000);assert.match(job.prompt,/contains requested content/);await writeFile(join(job.workspace,'result.txt'),'version '+(++runs));return {status:'completed',text:'claim',usage:null,durationMs:1};
 });
 const first=await tasks.call('legion_dispatch',{backend:'codex',prompt:'write',contract,timeoutSeconds:45}) as any;
 const one=await tasks.call('legion_tasks',{action:'wait',id:first.id}) as any;
 assert.equal(one.history[0].submission.status,'captured');assert.equal(await readFile(join(one.history[0].submission.snapshot,'result.txt'),'utf8'),'version 1');
 await tasks.call('legion_tasks',{action:'continue',id:first.id,prompt:'revise'});const two=await tasks.call('legion_tasks',{action:'wait',id:first.id}) as any;
 assert.equal(await readFile(join(two.history[0].submission.snapshot,'result.txt'),'utf8'),'version 1');assert.equal(await readFile(join(two.history[1].submission.snapshot,'result.txt'),'utf8'),'version 2');assert.deepEqual(two.contract,contract);assert.equal(two.trust,'unverified');await tasks.close();
});

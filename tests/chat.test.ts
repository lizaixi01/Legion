import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChatService } from '../src/chat-service.js';

test('chat preserves user text, assistant replies and session across follow-ups and restarts', async () => {
  const root=await mkdtemp(join(tmpdir(),'chat-'));const sessions:(string|undefined)[]=[];
  const service=createChatService(root,async request=>{sessions.push(request.sessionId);await writeFile(join(request.attemptDir,'stdout.jsonl'),JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'回复：'+request.prompt}})+'\n');return {status:'completed',sessionId:'session-one',durationMs:1,usage:[]};});
  const first=await service.send({text:'做一个真正的任务',options:{model:'gpt-6-sol',effort:'medium',permission:'read-only',agents:2}});
  while(service.isActive())await new Promise(r=>setTimeout(r,10));
  await service.send({id:first.id,text:'继续'});
  while(service.isActive())await new Promise(r=>setTimeout(r,10));
  assert.deepEqual(sessions,[undefined,'session-one']);
  const restored=createChatService(root);
  assert.equal((await restored.list()).length,1);
  assert.deepEqual((await restored.detail(first.id)).options,{model:'gpt-6-sol',effort:'medium',permission:'read-only',agents:2});
  assert.deepEqual((await restored.detail(first.id)).messages.map(m=>m.text),['做一个真正的任务','回复：做一个真正的任务','继续','回复：继续']);
  await assert.rejects(restored.detail('../x'), /无效/);
});

test('chat cancellation stops work and concurrent sends cannot start overlapping workers',async()=>{
  const root=await mkdtemp(join(tmpdir(),'chat-'));
  const service=createChatService(root,async request=>{await new Promise<void>(r=>{if(request.signal?.aborted)r();else request.signal?.addEventListener('abort',()=>r(),{once:true});});return {status:'cancelled',durationMs:1,usage:[]};});
  const first=await service.send({text:'开始'});
  await assert.rejects(service.send({text:'重叠'}), /等待/);
  await assert.rejects(service.deleteChat(first.id),/正在运行/);
  await service.stop();assert.equal(service.isActive(),false);
  assert.equal((await service.detail(first.id)).status,'cancelled');
});

test('chat hides drafts and interim completed messages until the worker finishes, then publishes the reply once',async()=>{
 const root=await mkdtemp(join(tmpdir(),'chat-bulk-'));
 let ready!:()=>void,finish!:()=>void;
 const started=new Promise<void>(resolve=>{ready=resolve;}),gate=new Promise<void>(resolve=>{finish=resolve;});
 const service=createChatService(root,async request=>{
  await writeFile(join(request.attemptDir,'stdout.jsonl'),[
   {type:'agent_message_delta',delta:'**正在生成'},
   {type:'item.completed',item:{type:'agent_message',text:'**完整回复**\n\n- 第一项\n- 第二项'}},
   {type:'item.started',item:{type:'command_execution'}}
  ].map(event=>JSON.stringify(event)).join('\n')+'\n');
  ready();await gate;return {status:'completed' as const,durationMs:1,usage:[]};
 });
 const first=await service.send({text:'帮我解释'});await started;
 try{
  const running=await service.detail(first.id);
  assert.equal(running.status,'running');assert.deepEqual(running.messages,[{role:'user',text:'帮我解释'}]);
  assert.deepEqual(running.live,{activity:'正在执行命令'});
 }finally{finish();}
 while(service.isActive())await new Promise(resolve=>setTimeout(resolve,10));
 const completed=await service.detail(first.id);
 assert.equal(completed.status,'completed');assert.equal(completed.live,undefined);
 assert.deepEqual(completed.messages.map(message=>message.text),['帮我解释','**完整回复**\n\n- 第一项\n- 第二项']);
 assert.deepEqual((await service.detail(first.id)).messages,completed.messages);
});

test('live progress shows bounded completed commentary without revealing reasoning or final drafts',async()=>{
 const root=await mkdtemp(join(tmpdir(),'chat-progress-'));let ready!:()=>void,finish!:()=>void;
 const started=new Promise<void>(r=>{ready=r;}),gate=new Promise<void>(r=>{finish=r;});
 const service=createChatService(root,async request=>{
  const events=Array.from({length:12},(_,i)=>({type:'app_server_event',method:'item/completed',params:{item:{id:String(i),type:'agentMessage',phase:'commentary',text:'阶段 '+i}}}));
  await writeFile(join(request.attemptDir,'stdout.jsonl'),[...events,events[11],{type:'app_server_event',method:'item/completed',params:{item:{id:'secret',type:'reasoning',text:'private reasoning'}}},{type:'app_server_event',method:'item/completed',params:{item:{id:'draft',type:'agentMessage',phase:'final_answer',text:'not finished'}}},{type:'item.completed',item:{type:'agent_message',text:'final reply'}}].map(e=>JSON.stringify(e)).join('\n')+'\n{partial');
  ready();await gate;return {status:'completed',durationMs:1,usage:[]};
 });
 const chat=await service.send({text:'long task'});await started;
 try{const current=await service.detail(chat.id);assert.deepEqual(current.live?.progress,Array.from({length:8},(_,i)=>'阶段 '+(i+4)));assert.deepEqual(current.messages,[{role:'user',text:'long task'}]);}finally{finish();}
 while(service.isActive())await new Promise(r=>setTimeout(r,5));assert.equal((await service.detail(chat.id)).live,undefined);
});

test('chat pin state persists and deleted conversations disappear from the list',async()=>{
 const root=await mkdtemp(join(tmpdir(),'chat-pin-'));
 const worker=async(request:import('../src/types.js').WorkerRequest)=>{await writeFile(join(request.attemptDir,'stdout.jsonl'),JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'done'}})+'\n');return {status:'completed' as const,durationMs:1,usage:[]};};
 const service=createChatService(root,worker),first=await service.send({text:'no project'});while(service.isActive())await new Promise(r=>setTimeout(r,10));
 await service.setPinned(first.id,true);assert.equal((await service.detail(first.id)).pinned,true);
 const restored=createChatService(root,worker);assert.equal((await restored.list())[0]?.pinned,true);
 await restored.deleteChat(first.id);assert.equal((await restored.list()).length,0);await assert.rejects(restored.detail(first.id),/ENOENT/);
});

test('project archive clears all associated chat histories, including pinned chats, and preserves project files',async()=>{
 const root=await mkdtemp(join(tmpdir(),'chat-archive-')),project=join(root,'Project A'),otherProject=join(root,'Project B');await mkdir(project);await mkdir(otherProject);await writeFile(join(project,'keep.txt'),'project files stay');
 const worker=async(request:import('../src/types.js').WorkerRequest)=>{await writeFile(join(request.attemptDir,'stdout.jsonl'),JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'done'}})+'\n');return {status:'completed' as const,durationMs:1,usage:[]};};
 const service=createChatService(root,worker),send=async(input:{project?:string;text:string})=>{const chat=await service.send(input);while(service.isActive())await new Promise(r=>setTimeout(r,10));return chat;};
 const pinned=await send({project,text:'pinned project chat'}),regular=await send({project,text:'regular project chat'}),other=await send({project:otherProject,text:'other project chat'}),loose=await send({text:'unrelated chat'});await service.setPinned(pinned.id,true);
 const result=await service.archiveProject(project);assert.deepEqual(new Set(result.deleted),new Set([pinned.id,regular.id]));assert.deepEqual(new Set((await service.list()).map(chat=>chat.id)),new Set([other.id,loose.id]));assert.equal(await readFile(join(project,'keep.txt'),'utf8'),'project files stay');await assert.rejects(service.detail(pinned.id),/ENOENT/);
});

test('project archive refuses to clear a project while one of its chats is running',async()=>{
 const root=await mkdtemp(join(tmpdir(),'chat-archive-running-')),project=join(root,'Project');await mkdir(project);
 const service=createChatService(root,async request=>{await new Promise<void>(resolve=>{if(request.signal?.aborted)resolve();else request.signal?.addEventListener('abort',()=>resolve(),{once:true});});return {status:'cancelled' as const,durationMs:1,usage:[]};});
 await service.send({project,text:'running'});await assert.rejects(service.archiveProject(project),/正在运行/);await service.stop();assert.equal((await service.list()).length,1);
});

for(const mode of ['off','auto','fixed'] as const)test(`arbitrary project conversation works in ${mode} mode and persists its working directory`,async()=>{
 const root=await mkdtemp(join(tmpdir(),'chat-project-')),project=join(root,'Python project');await mkdir(project);await writeFile(join(project,'main.py'),'print("hello")');await writeFile(join(project,'asset.bin'),Buffer.alloc(3*1024*1024));
 const workspaces:string[]=[];const worker=async(request:import('../src/types.js').WorkerRequest)=>{workspaces.push(request.workspace);assert.match(await readFile(join(request.workspace,'main.py'),'utf8'),/hello/);await writeFile(join(request.attemptDir,'stdout.jsonl'),JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'你好'}})+'\n');return {status:'completed' as const,durationMs:1,usage:[]};};
 const service=createChatService(root,worker);const first=await service.send({project,text:'hi',options:{model:'gpt-6-sol',effort:'medium',permission:'read-only',agents:0,delegation:{mode,count:10}}});while(service.isActive())await new Promise(r=>setTimeout(r,10));assert.equal((await service.detail(first.id)).status,'completed');
 const restored=createChatService(root,worker);await restored.send({id:first.id,text:'查看项目'});while(restored.isActive())await new Promise(r=>setTimeout(r,10));assert.deepEqual(workspaces,[await realpath(project),await realpath(project)]);assert.equal((await restored.detail(first.id)).project,await realpath(project));
 await assert.rejects(restored.send({id:first.id,text:'switch',project:root}),/新建对话/);
});

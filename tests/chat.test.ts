import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
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
  await service.stop();assert.equal(service.isActive(),false);
  assert.equal((await service.detail(first.id)).status,'cancelled');
});

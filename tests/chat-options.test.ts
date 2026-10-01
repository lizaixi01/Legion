import {test} from 'node:test';
import assert from 'node:assert/strict';
import {codexArguments} from '../src/codex.js';
import {validateChatOptions,ChatOptionsSchema} from '../src/chat-options.js';
test('chat settings reject unsupported models, effort and permission escalation values',async()=>{
  await assert.rejects(validateChatOptions({model:'invented'}));
  assert.throws(()=>ChatOptionsSchema.parse({permission:'unrestricted'}));
  assert.throws(()=>ChatOptionsSchema.parse({agents:999}));
  const result=await validateChatOptions({model:'gpt-6-sol',effort:'low',permission:'read-only',agents:2});
  assert.equal(result.effort,'low');
});
test('model, effort, sandbox and delegation limits reach initial and resumed CLI invocations',()=>{
  for(const session of [undefined,'saved-session'])for(const permission of ['read-only','workspace-write','danger-full-access'] as const){
    const args=codexArguments('gpt-6-sol','medium',session,'win32',{permission,agents:2});
    assert.equal(args[args.indexOf('--sandbox')+1],permission);
    assert.equal(args[args.indexOf('--model')+1],'gpt-6-sol');
    assert.ok(args.includes('model_reasoning_effort="medium"'));
    assert.ok(args.includes('agents.max_threads=2'));
    assert.ok(args.includes('agents.max_depth=1'));
    assert.equal(args[args.indexOf('multi_agent')-1],'--enable');
    if(session)assert.ok(args.includes(session));
  }
  const disabled=codexArguments('gpt-6-sol','high');
  assert.equal(disabled[disabled.indexOf('multi_agent')-1],'--disable');
  assert.ok(!disabled.some(a=>a.startsWith('agents.max_threads')));
});

test('worker selection is independently validated and preserved',async()=>{
 await assert.rejects(validateChatOptions({worker:{model:'invented',effort:'high'}}),/Worker/);
 const result=await validateChatOptions({model:'gpt-6-sol',effort:'high',worker:{model:'gpt-6-sol',effort:'low'}});
 assert.equal(result.effort,'high');assert.equal(result.worker?.effort,'low');
});

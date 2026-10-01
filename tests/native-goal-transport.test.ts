import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {codexAppServerWorker} from '../src/codex-app-server.js';
import {createChatService} from '../src/chat-service.js';
import type {WorkerRequest} from '../src/types.js';

test('app-server goal transport preserves one session through native continuation turns',async()=>{
 const root=await mkdtemp(join(tmpdir(),'goal-rpc-')),script=join(root,'app-server');
 await writeFile(script,`const fs=require('fs'),rl=require('readline').createInterface({input:process.stdin});const send=x=>console.log(JSON.stringify(x));let goal={threadId:'thread',objective:'goal',status:'paused',tokensUsed:0,timeUsedSeconds:0,createdAt:1,updatedAt:1};rl.on('line',line=>{const m=JSON.parse(line);fs.appendFileSync('wire.jsonl',line+'\\n');if(!m.method||m.method==='initialized')return;const params=m.params||{};if(m.method==='initialize')send({id:m.id,result:{}});if(m.method==='thread/start')send({id:m.id,result:{thread:{id:'thread'}}});if(m.method==='thread/goal/get')send({id:m.id,result:{goal}});if(m.method==='thread/goal/set'){goal={...goal,status:params.status,objective:params.objective||goal.objective};send({id:m.id,result:{goal}});if(params.status==='active'){send({method:'item/completed',params:{threadId:'thread',item:{id:'one',type:'agentMessage',text:'First turn'}}});send({method:'turn/completed',params:{threadId:'thread',turn:{id:'t1',status:'completed'}}});setTimeout(()=>{send({method:'turn/started',params:{threadId:'thread',turn:{id:'t2',status:'inProgress'}}});goal={...goal,status:'complete',tokensUsed:100};send({method:'thread/goal/updated',params:{threadId:'thread',goal}});send({method:'item/completed',params:{threadId:'thread',item:{id:'two',type:'agentMessage',text:'Goal finished'}}});send({method:'turn/completed',params:{threadId:'thread',turn:{id:'t2',status:'completed'}}});},40);}}if(m.method==='turn/start'){send({id:m.id,result:{turn:{id:'t1'}}});send({method:'turn/started',params:{threadId:'thread',turn:{id:'t1',status:'inProgress'}}});}});`);
 const command=process.execPath;
 const result=await codexAppServerWorker(command,'fixture',{workspace:root,attemptDir:root,prompt:'goal',timeoutMs:10000,continuousGoal:{objective:'goal',deadline:Date.now()+10000}},{effort:'low',permission:'read-only',instructions:'fixture'});
 assert.equal(result.status,'completed',result.detail??'');assert.equal(result.nativeGoal?.status,'complete');
 const events=(await readFile(join(root,'stdout.jsonl'),'utf8'));assert.match(events,/First turn/);assert.match(events,/Goal finished/);
 const wire=(await readFile(join(root,'wire.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));assert.equal(wire.filter(m=>m.method==='turn/start').length,1);assert.equal(wire.filter(m=>m.method==='thread/start').length,1);
});

test('resuming an active goal pauses durable state before loading the thread runtime',async()=>{
 const root=await mkdtemp(join(tmpdir(),'goal-resume-order-'));
 await writeFile(join(root,'app-server'),`const fs=require('fs'),rl=require('readline').createInterface({input:process.stdin});const send=x=>console.log(JSON.stringify(x));let goal={threadId:'thread',objective:'goal',status:'active',tokensUsed:10,timeUsedSeconds:1,createdAt:1,updatedAt:1};rl.on('line',line=>{const m=JSON.parse(line);fs.appendFileSync('wire.jsonl',line+'\\n');if(!m.method||m.method==='initialized')return;const p=m.params||{};if(m.method==='initialize')send({id:m.id,result:{}});if(m.method==='thread/goal/get')send({id:m.id,result:{goal}});if(m.method==='thread/goal/set'){goal={...goal,status:p.status};send({id:m.id,result:{goal}});if(p.status==='active'){goal={...goal,status:'complete'};send({method:'thread/goal/updated',params:{threadId:'thread',goal}});send({method:'item/completed',params:{threadId:'thread',item:{id:'answer',type:'agentMessage',text:'done'}}});send({method:'turn/completed',params:{threadId:'thread',turn:{id:'t1',status:'completed'}}});}}if(m.method==='thread/resume'){if(goal.status!=='paused')send({id:m.id,error:{message:'resumed an active goal'}});else send({id:m.id,result:{thread:{id:'thread'}}});}if(m.method==='turn/start')send({id:m.id,result:{turn:{id:'t1'}}});});`);
 const result=await codexAppServerWorker(process.execPath,'fixture',{workspace:root,attemptDir:root,sessionId:'thread',prompt:'continue',timeoutMs:10000,continuousGoal:{objective:'goal',deadline:Date.now()+10000}},{effort:'low',permission:'read-only',instructions:'fixture'});
 assert.equal(result.status,'completed',result.detail??'');const messages=(await readFile(join(root,'wire.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
 const paused=messages.findIndex(m=>m.method==='thread/goal/set'&&m.params.status==='paused'),resumed=messages.findIndex(m=>m.method==='thread/resume'),started=messages.findIndex(m=>m.method==='turn/start'),activated=messages.findIndex(m=>m.method==='thread/goal/set'&&m.params.status==='active');
 assert.ok(paused<resumed&&resumed<started&&started<activated);assert.equal(messages.filter(m=>m.method==='turn/start').length,1);
});

test('chat goal shares ordinary entry and original deadline across explicit resumes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'goal-chat-')),requests:WorkerRequest[]=[];
 const chats=createChatService(root,async request=>{requests.push(request);await writeFile(join(request.attemptDir,'stdout.jsonl'),JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'paused fixture'}})+'\n');return {status:'cancelled',durationMs:0,usage:[],sessionId:'same-thread'};});
 const created=await chats.send({text:'original objective',continuous:true});while(chats.isActive())await new Promise(r=>setTimeout(r,5));
 const deadline=requests[0]!.continuousGoal!.deadline;await chats.send({id:created.id,text:'continue',continuous:true});while(chats.isActive())await new Promise(r=>setTimeout(r,5));
 assert.ok(requests[0]!.continuousGoal!.budgetId);assert.equal(requests[1]!.continuousGoal!.budgetId,requests[0]!.continuousGoal!.budgetId);assert.equal((await chats.detail(created.id)).goalBudget?.workersUsed,0);assert.equal(requests[1]!.continuousGoal!.objective,'original objective');assert.equal(requests[1]!.continuousGoal!.deadline,deadline);assert.equal(requests[1]!.sessionId,'same-thread');
 await chats.send({id:created.id,text:'hello'});while(chats.isActive())await new Promise(r=>setTimeout(r,5));assert.equal(requests[2]!.continuousGoal,undefined);
});

test('native completion cannot reset the goal when host acceptance failed',async()=>{
 const root=await mkdtemp(join(tmpdir(),'goal-rejected-')),requests:WorkerRequest[]=[];
 const chats=createChatService(root,async request=>{requests.push(request);return {status:'error',detail:'delivery rejected',durationMs:0,usage:[],nativeGoal:{threadId:'thread',objective:request.continuousGoal!.objective,status:'complete',tokensUsed:2,timeUsedSeconds:1,createdAt:1,updatedAt:2}};});
 const created=await chats.send({text:'original',continuous:true});while(chats.isActive())await new Promise(r=>setTimeout(r,5));
 await chats.send({id:created.id,text:'repair and continue',continuous:true});while(chats.isActive())await new Promise(r=>setTimeout(r,5));
 assert.deepEqual(requests[1]!.continuousGoal,requests[0]!.continuousGoal);
});

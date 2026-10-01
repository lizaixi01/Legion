import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createPrimaryTasks} from '../src/primary-agent.js';
import {defaultChatOptions} from '../src/chat-options.js';
import {taskSummary} from '../src/primary-task-summary.js';

test('task summaries preserve failures and source records without reloading full claims into context',async()=>{
 const root=await mkdtemp(join(tmpdir(),'task-summary-'));let calls=0;
 const tasks=await createPrimaryTasks(root,join(root,'tasks'),root,{...defaultChatOptions,delegation:{mode:'fixed',count:1}},undefined,async()=>({status:++calls<5?'error':'completed',text:'BEGIN '+('中😀'.repeat(30000))+' END',detail:calls<5?'failure '+calls:undefined,durationMs:1,usage:null}));
 const {id}=await tasks.call('legion_dispatch',{backend:'codex',prompt:'work'}) as {id:string};await tasks.call('legion_tasks',{action:'wait',id});
 for(let i=1;i<5;i++){await tasks.call('legion_tasks',{action:'continue',id,prompt:'repair'});await tasks.call('legion_tasks',{action:'wait',id});}
 const record=join(root,'tasks',id,'task.json'),before=await readFile(record,'utf8');const summary=await tasks.call('legion_tasks',{action:'summary',id}) as ReturnType<typeof taskSummary>;
 assert.equal(summary.trust,'unverified');assert.equal(summary.status,'completed');assert.deepEqual({...summary.attemptCounts},{error:4,completed:1});assert.equal(summary.omittedAttempts,2);assert.equal(summary.recentAttempts[0]!.detail!.text,'failure 3');assert.equal(summary.record,record);
 assert.equal(summary.claim!.truncated,true);assert.match(summary.claim!.text,/^BEGIN/);assert.match(summary.claim!.text,/END$/);assert.ok(JSON.stringify(summary).length<6000);assert.equal(await readFile(record,'utf8'),before);assert.equal(calls,5);
 await tasks.close();const restored=await createPrimaryTasks(root,join(root,'tasks'),root,{...defaultChatOptions,delegation:{mode:'off',count:1}});
 assert.deepEqual(await restored.call('legion_tasks',{action:'summary',id}),summary);const full=await restored.call('legion_tasks',{action:'read',id}) as {history:unknown[]};assert.equal(full.history.length,5);await restored.close();
});

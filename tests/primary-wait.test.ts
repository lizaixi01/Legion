import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createPrimaryTasks} from '../src/primary-agent.js';
import {defaultChatOptions} from '../src/chat-options.js';

test('batch wait wakes on the first finished worker and capacity reflects remaining work',async()=>{
 const root=await mkdtemp(join(tmpdir(),'primary-wait-')),release=new Map<string,()=>void>();
 const tasks=await createPrimaryTasks(root,join(root,'tasks'),root,{...defaultChatOptions,delegation:{mode:'fixed',count:2}},undefined,async(_spec,job)=>{await new Promise<void>(r=>{release.set(job.id,r);});return {status:'completed',text:'large result'.repeat(1000),durationMs:1,usage:null};});
 try{
  const a=await tasks.call('legion_dispatch',{backend:'codex',prompt:'first'}) as {id:string},b=await tasks.call('legion_dispatch',{backend:'commandcode',prompt:'second'}) as {id:string};
  assert.equal((await tasks.call('legion_tasks',{action:'read',id:a.id}) as {status:string}).status,'running');
  const capacity=await tasks.call('legion_tasks',{action:'capacity'}) as {turn:{active:number;available:number;remainingCalls:number}};assert.deepEqual([capacity.turn.active,capacity.turn.available,capacity.turn.remainingCalls],[2,0,62]);
  const waiting=tasks.call('legion_tasks',{action:'wait',ids:[a.id,b.id],timeoutMs:1000});release.get(b.id)!();
  const result=await waiting as {timedOut:boolean;tasks:{status:string}[]};assert.equal(result.timedOut,false);assert.deepEqual(result.tasks.map(t=>t.status),['running','completed']);assert.ok(JSON.stringify(result).length<2000);
  const timeout=await tasks.call('legion_tasks',{action:'wait',ids:[a.id],timeoutMs:0}) as {timedOut:boolean};assert.equal(timeout.timedOut,true);
  await assert.rejects(tasks.call('legion_tasks',{action:'wait',ids:[a.id,a.id]}),/unique/);
  await assert.rejects(tasks.call('legion_tasks',{action:'cancel',ids:[a.id]}),/only valid/);
  release.get(a.id)!();await tasks.call('legion_tasks',{action:'wait',id:a.id});
 }finally{for(const done of release.values())done();await tasks.close();}
});

for(const mode of ['read','batch','cancel','completed-cancel','continue','orphan','save-failure','transient-save-failure'])test(`task ${mode} status stays consistent across an in-flight disk read`,{timeout:20000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'primary-wait-race-'));
 const {stdout}=await promisify(execFile)(process.execPath,['--unhandled-rejections=strict','--import','tsx','tests/fixtures/task-read-race.ts',root,mode],{timeout:15000,windowsHide:true});
 const result=JSON.parse(stdout.trim()) as {statuses:string[];diskStatus:string;injected:boolean};
 const expected=mode==='cancel'||mode==='completed-cancel'?['cancelled']:mode==='continue'?['running']:mode==='orphan'||mode==='save-failure'?['interrupted']:mode==='batch'?['completed','completed']:['completed'];
 assert.deepEqual(result.statuses,expected);
 assert.equal(result.diskStatus,expected[0]==='interrupted'?'running':expected[0]);
 assert.equal(result.injected,mode!=='orphan');
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,readFile,appendFile,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPrimaryTasks} from '../src/primary-agent.js';
import {defaultChatOptions} from '../src/chat-options.js';
import {createChatService} from '../src/chat-service.js';
import {createChatOutput} from '../src/chat-output.js';
import {aggregationContract,freezeContract,captureCandidate,verifyCandidate} from '../src/acceptance.js';
import {verifySnapshot} from '../src/challenge.js';
import {runChallengedTask,type TaskEvidence} from '../src/challenged-task.js';
import {createPrimaryDelivery} from '../src/primary-delivery.js';
import {writeRun,readRun} from '../src/engineering-store.js';
import type {WorkerSpec} from '../src/worker-pool.js';
const temp=()=>mkdtemp(join(tmpdir(),'legion-reliability-'));
const tick=()=>new Promise(r=>setTimeout(r,5));
const spec:WorkerSpec={backend:'codex',command:'unused',prefix:[],model:'test',effort:'medium'};
const goal='Aggregate numbers [3,1,2]: write aggregate.json with sum and sorted.',contract=aggregationContract(goal)!;

for(const mode of ['pipe','stdout','stderr','cleanup'])test(`transport ${mode} failure returns an error in a strict real subprocess`,async()=>{
  const root=await temp();const {stdout}=await promisify(execFile)(process.execPath,['--unhandled-rejections=strict','--import','tsx','tests/fixtures/transport-failure.ts',root,mode],{timeout:12000,windowsHide:true});
  const result=JSON.parse(stdout.trim());assert.equal(result.status,'error');assert.match(result.detail,mode==='pipe'?/EPIPE|pipe|exited|退出/i:/log write failed/);
});

test('cancel races a continuation without launching another worker, including after reload',async()=>{
  const root=await temp();let started=0;const options={...defaultChatOptions,delegation:{mode:'auto' as const,count:10}};
  const run=async()=>{started++;return {status:'completed' as const,text:'done',usage:null,durationMs:0};};
  let tasks=await createPrimaryTasks(root,join(root,'tasks'),root,options,undefined,run);
  const {id}=await tasks.call('legion_dispatch',{backend:'codex',prompt:'first'}) as {id:string};await tasks.call('legion_tasks',{action:'wait',id});
  const continuing=tasks.call('legion_tasks',{action:'continue',id,prompt:'next'});const rejected=assert.rejects(continuing,/cancelled|stopped/i);const cancelled=await tasks.call('legion_tasks',{action:'cancel',id});await rejected;
  assert.equal((cancelled as {status:string}).status,'cancelled');assert.equal(started,1);await tasks.close();
  tasks=await createPrimaryTasks(root,join(root,'tasks'),root,options,undefined,run);await assert.rejects(tasks.call('legion_tasks',{action:'continue',id,prompt:'replay'}),/cancelled/i);await tasks.close();assert.equal(started,1);
});

test('a worker that ignores abort cannot settle as completed',async()=>{
  const root=await temp();let release!:()=>void;
  const tasks=await createPrimaryTasks(root,join(root,'tasks'),root,{...defaultChatOptions,delegation:{mode:'auto',count:10}},undefined,async(_s,_j,signal)=>{
    await new Promise<void>(r=>{release=r;signal?.addEventListener('abort',()=>r(),{once:true});});return {status:'completed',text:'late success',usage:null,durationMs:0};
  });
  const {id}=await tasks.call('legion_dispatch',{backend:'codex',prompt:'first'}) as {id:string};while(!release)await tick();
  const cancelled=await tasks.call('legion_tasks',{action:'cancel',id}) as {status:string;result:{status:string}};assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.result.status,'cancelled');await tasks.close();
});

test('concurrent chat metadata and worker completion preserve the session, pin and full reply',async()=>{
  const root=await temp();let release!:()=>void;
  const chats=createChatService(root,async request=>{await new Promise<void>(r=>{release=r;});await writeFile(join(request.attemptDir,'stdout.jsonl'),JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'reply'}}));return {status:'completed',sessionId:'durable-session',durationMs:0,usage:[]};});
  const {id}=await chats.send({text:'hello'});while(!release)await tick();
  const pins=Array.from({length:25},(_,i)=>chats.setPinned(id,i===24));release();await Promise.all(pins);while(chats.isActive())await tick();
  const restored=await createChatService(root).detail(id);assert.equal(restored.pinned,true);assert.equal(restored.sessionId,'durable-session');assert.equal(restored.status,'completed');assert.equal(restored.messages.at(-1)?.text,'reply');
});

test('mixed reviewer, Codex and Command Code launches share the absolute 64-call budget',async()=>{
  const root=await temp();let launches=0;
  const tasks=await createPrimaryTasks(root,join(root,'tasks'),root,{...defaultChatOptions,delegation:{mode:'auto',count:10}},undefined,async()=>{launches++;return {status:'completed',text:'',durationMs:0,usage:null};});
  for(let i=0;i<62;i++)await tasks.review(spec,{id:'review-'+i,prompt:'verify',workspace:root,logDir:root,timeoutMs:1000});
  const jobs=await Promise.all(['codex','commandcode'].map(backend=>tasks.call('legion_dispatch',{backend,prompt:'work'}))) as {id:string}[];
  for(const {id} of jobs)await tasks.call('legion_tasks',{action:'wait',id});
  assert.equal(launches,64);assert.equal(tasks.capacity().remainingCalls,0);assert.equal(tasks.capacity().totalRemaining,0);assert.equal(tasks.capacity().available,0);
  await assert.rejects(tasks.call('legion_dispatch',{backend:'codex',prompt:'overflow'}),/capacity/);await assert.rejects(tasks.review(spec,{id:'overflow',prompt:'verify',workspace:root,logDir:root,timeoutMs:1000}),/capacity/);await tasks.close();
});

test('functional verification aborts at the absolute deadline even if an adapter ignores abort',async()=>{
  const root=await temp();await writeFile(join(root,'aggregate.json'),'{"sum":6,"sorted":[1,2,3]}');
  const frozen=freezeContract('test',contract,goal,Date.now()+1000),candidate=await captureCandidate(frozen,root,join(root,'snapshot'),'1');let aborted=false;
  const started=Date.now();await assert.rejects(verifyCandidate(frozen,candidate,join(root,'check'),[{id:'slow',version:'1',covers:()=>true,check:async(_c,_f,_d,signal)=>{signal!.addEventListener('abort',()=>{aborted=true;},{once:true});return new Promise(()=>{});}}]),/deadline/);
  assert.equal(aborted,true);assert.ok(Date.now()-started<2000);
});

test('a real independent checker is stopped at the delivery deadline, rather than its 15s step cap',async()=>{
  const root=await temp();await writeFile(join(root,'aggregate.json'),'{"sum":6,"sorted":[1,2,3]}');
  const delivery=createPrimaryDelivery(root,join(root,'delivery'),goal,Date.now()+1500,true,{challenger:spec,run:async()=>{throw Error('No model');},challenge:async()=>({checks:contract.acceptance.map(criterion=>({criterion,source:"import {readFileSync} from 'node:fs';readFileSync('aggregate.json');while(true){}"})),limitations:[]})});
  await delivery.call({action:'prepare',contract});const started=Date.now(),state=await delivery.call({action:'check'});
  assert.equal(state.acceptance.status,'blocked');assert.match(state.acceptance.detail,/deadline/);assert.ok(Date.now()-started<3000);
  const {pid}=JSON.parse(await readFile(join(root,'delivery','version-1','review','0-candidate','process.json'),'utf8')) as {pid:number};
  let alive=true;for(let i=0;i<100;i++){try{process.kill(pid,0);}catch{alive=false;break;}await tick();}assert.equal(alive,false,'only the fixture checker process must exit');
});

test('a failed semantic challenge outranks another criterion with insufficient coverage',async()=>{
  const root=await temp();await writeFile(join(root,'aggregate.json'),'{"sum":0,"sorted":[1,2,3]}');
  const result=await verifySnapshot(contract,{checks:[{criterion:contract.acceptance[0]!,source:"import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';assert.equal(JSON.parse(readFileSync('aggregate.json','utf8')).sum,6);"},{criterion:contract.acceptance[1]!,source:'// insufficient evidence'}],limitations:[]},root,join(root,'review'),1);
  assert.equal(result.status,'needs_repair');assert.ok(result.checks.some(c=>c.status==='fail'));assert.ok(result.checks.some(c=>c.status==='unverified'));
});

test('incomplete review cannot erase a host failure or stop the repair loop',async()=>{
  const root=await temp();let attempts=0;const e:TaskEvidence={id:'test',backend:'codex',status:'queued',reply:'',workspace:root,checks:[]};
  await runChallengedTask(e,contract,spec,spec,{id:'test',prompt:goal,workspace:root,logDir:join(root,'task'),timeoutMs:60000},{originalRequirement:goal,save:async()=>{},usage:()=>{},structural:async()=>[],challenge:async()=>({checks:contract.acceptance.map(criterion=>({criterion,source:'// insufficient evidence'})),limitations:['incomplete']}),run:async()=>{await writeFile(join(root,'aggregate.json'),JSON.stringify({sum:++attempts===1?0:6,sorted:[1,2,3]}));return {status:'completed',text:'claim',durationMs:0,usage:null};}});
  assert.equal(attempts,2);assert.equal(e.functional?.acceptance.status,'accepted');assert.equal(e.acceptance?.status,'unverified');assert.equal(e.status,'unverified');
});

test('incremental log polls do not reread history and preserve split UTF-8 and progress',async()=>{
  const root=await temp(),file=join(root,'stdout.jsonl');await writeFile(file,'');const output=createChatOutput(file);
  const line=Buffer.from(JSON.stringify({type:'app_server_event',method:'item/completed',params:{item:{id:'p',type:'agentMessage',phase:'commentary',text:'正在验证'}}})+'\n');
  const split=line.indexOf(Buffer.from('正在'))+1;await appendFile(file,line.subarray(0,split));await output.read(false);await appendFile(file,line.subarray(split));assert.deepEqual((await output.read(false)).progress,['正在验证']);
  await appendFile(file,(JSON.stringify({type:'ignored',payload:'x'.repeat(1000)})+'\n').repeat(4000));await output.read(false);const bytes=output.bytesRead();
  await Promise.all(Array.from({length:30},()=>output.read(false)));assert.equal(output.bytesRead(),bytes);
  const final=JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'完成'}});await appendFile(file,final);assert.equal((await output.read()).text,'完成');assert.equal(output.bytesRead()-bytes,Buffer.byteLength(final));
  await writeFile(file,'');assert.equal((await output.read()).text,'');const replacement=join(root,'new.jsonl');await writeFile(replacement,JSON.stringify({type:'agent_message_delta',delta:'新回复'})+'\n');await rename(replacement,file);assert.equal((await output.read()).text,'新回复');
});

test('checkpoint append preserves a large partial audit tail without using it as state authority',async()=>{
  const root=await temp(),file=join(root,'run-events.jsonl'),history='x'.repeat(4_000_000);
  await writeFile(file,history);await writeRun(root,{status:'paused'},{type:'paused'});
  const bytes=await readFile(file,'utf8');assert.equal(bytes,history+'\n'+JSON.stringify({type:'paused'})+'\n');assert.deepEqual(await readRun(root),{status:'paused'});
});

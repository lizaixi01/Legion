import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHweDeps,type hweCall} from '../src/hwe.js';
import {ResearchConfigSchema,type ResearchConfig,type ResearchContext,type Candidate} from '../src/research-loop.js';
import {hash} from '../src/provenance.js';
import {tarGz} from './fixtures/rtl-archive.js';

const config:ResearchConfig={goal:'Offline Manager timeout regression',maxRounds:2,maxWorkers:4,concurrency:2,totalMs:21600000,manager:{model:'fixture',effort:'high'},worker:{model:'fixture',effort:'medium'}};
const finish={action:'finish',reason:'Fixture only',hypotheses:[],discard:[]};
const usage={input_tokens:100,cached_input_tokens:80,output_tokens:20};
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'hwe-manager-timeout-'));await mkdir(join(root,'baseline'));
 const bytes=tarGz([{name:'core.sv',body:'module core; endmodule\n'}]),path=join(root,'baseline','rtl.tar.gz');await writeFile(path,bytes);
 const baseline:Candidate={id:'baseline',round:0,hypothesis:{id:'baseline',parent:'',claim:'Fixture',experiment:'Offline',expected:'Fixture',workerSeconds:30},status:'verified',snapshot:{path,sha256:hash(bytes)},evidence:{status:'pass',checks:{},metrics:{fitness:1,fmax_mhz:1,lut4:1,cycles:1},limitations:['Fixture only']}};
 const ctx:ResearchContext={goal:config.goal,round:1,remainingWorkers:4,remainingMs:3600000,best:'baseline',records:[baseline],decisions:[]};
 const dir=join(root,'round-1-0');await mkdir(dir);return {root,ctx,dir};
}
function bridge(events:unknown[],inspect?:(payload:Record<string,unknown>,timeoutMs:number)=>void):typeof hweCall{
 return async(_action,dir,_owner,payload,timeoutMs)=>{
  inspect?.(payload,timeoutMs);await writeFile(join(dir,'response.json'),JSON.stringify(finish));const logs=join(dir,'fake-bridge');await mkdir(logs);await writeFile(join(logs,'stdout.jsonl'),events.map(e=>JSON.stringify(e)).join('\n')+'\n');return {logs,result:{status:'completed',exitCode:0,durationMs:1}};
 };
}
test('Manager role tier reaches its call independently of Worker tier',async()=>{
 const f=await fixture();let observed=false;
 const deps=createHweDeps(f.root,{...config,manager:{...config.manager,serviceTier:'fast'},worker:{...config.worker,serviceTier:'default'}},'hypothesis',bridge([{type:'turn.completed',usage}],payload=>{observed=true;assert.equal(payload.serviceTier,'fast');assert.equal(payload.model,config.manager.model);}));
 await deps.decide(f.ctx,f.dir,new AbortController().signal);assert.equal(observed,true);
});
test('a completed Manager decision has a longer bounded window and recorded actual limits',async()=>{
 const f=await fixture();let calls=0;
 const deps=createHweDeps(f.root,config,'hypothesis',bridge([{type:'turn.completed',usage}],(payload,timeout)=>{calls++;assert.equal(payload.seconds,900);assert.equal(timeout,1500000);}));
 assert.deepEqual(await deps.decide(f.ctx,f.dir,new AbortController().signal),finish);assert.equal(calls,1);
 const record=JSON.parse(await readFile(join(f.dir,'decision-invocation.json'),'utf8'));assert.equal(record.configuredSeconds,900);assert.equal(record.seconds,900);assert.equal(record.timeoutMs,1500000);
});
test('an explicit Manager limit is respected and remains in the frozen configuration',async()=>{
 const custom={...config,manager:{...config.manager,timeoutSeconds:600}};assert.equal(ResearchConfigSchema.parse(custom).manager.timeoutSeconds,600);
 const f=await fixture();const deps=createHweDeps(f.root,custom,'hypothesis',bridge([{type:'turn.completed',usage}],(payload,timeout)=>{assert.equal(payload.seconds,600);assert.equal(timeout,1200000);}));
 assert.deepEqual(await deps.decide(f.ctx,f.dir,new AbortController().signal),finish);
 const record=JSON.parse(await readFile(join(f.dir,'decision-invocation.json'),'utf8'));assert.equal(record.configuredSeconds,600);
});
test('the bridge deadline cannot exceed the remaining total budget, including context preparation',async()=>{
 const f=await fixture();f.ctx.remainingMs=3500;
 const deps=createHweDeps(f.root,config,'hypothesis',bridge([{type:'turn.completed',usage}],(payload,timeout)=>{assert.ok(Number(payload.seconds)>=1&&Number(payload.seconds)<=4);assert.ok(timeout>0&&timeout<=3500);}));
 await deps.decide(f.ctx,f.dir,new AbortController().signal);const record=JSON.parse(await readFile(join(f.dir,'decision-invocation.json'),'utf8'));assert.ok(record.remainingMs<=3500);assert.equal(record.timeoutMs,record.remainingMs);
});
test('complete-looking JSON without a terminal completion still fails and retains timeout usage',async()=>{
 const f=await fixture();const deps=createHweDeps(f.root,config,'hypothesis',bridge([{type:'item.completed',item:{type:'agent_message',text:JSON.stringify(finish)}},{type:'worker.snapshot',timedOut:true,usage}]));
 await assert.rejects(deps.decide(f.ctx,f.dir,new AbortController().signal),/timed out/);
 const saved=JSON.parse(await readFile(join(f.dir,'usage.json'),'utf8'));assert.equal(saved.completed,false);assert.deepEqual(saved.usage,[usage]);
});
test('a timed-out bridge cannot certify a decision even with a completion event',async()=>{
 const f=await fixture();const deps=createHweDeps(f.root,config,'hypothesis',bridge([{type:'turn.completed',usage},{type:'worker.snapshot',timedOut:true,usage}]));
 await assert.rejects(deps.decide(f.ctx,f.dir,new AbortController().signal),/timed out/);const saved=JSON.parse(await readFile(join(f.dir,'usage.json'),'utf8'));assert.deepEqual(saved.usage,[usage]);
});
test('provider failures keep their diagnostics and bridge usage without becoming completed',async()=>{
 const f=await fixture();const deps=createHweDeps(f.root,config,'hypothesis',bridge([{type:'turn.failed',error:{message:'usage limit reached'}},{type:'worker.snapshot',timedOut:false,usage}]));
 await assert.rejects(deps.decide(f.ctx,f.dir,new AbortController().signal),/usage-limit/);const saved=JSON.parse(await readFile(join(f.dir,'usage.json'),'utf8'));assert.equal(saved.failed,true);assert.deepEqual(saved.usage,[usage]);
});
test('invalid configuration, exhausted budget or cancellation never dispatches a Manager',async()=>{
 for(const timeoutSeconds of [0,29,1801,1.5,Infinity])assert.throws(()=>createHweDeps('unused',{...config,manager:{...config.manager,timeoutSeconds}}));
 for(const remainingMs of [0,-1,Infinity,Number.NaN]){
  const f=await fixture();f.ctx.remainingMs=remainingMs;let calls=0;const deps=createHweDeps(f.root,config,'hypothesis',bridge([] ,()=>{calls++;}));await assert.rejects(deps.decide(f.ctx,f.dir,new AbortController().signal),/remaining time/);assert.equal(calls,0);
 }
 const f=await fixture(),controller=new AbortController();controller.abort();let calls=0;const deps=createHweDeps(f.root,config,'hypothesis',bridge([],()=>{calls++;}));await assert.rejects(deps.decide(f.ctx,f.dir,controller.signal));assert.equal(calls,0);
});

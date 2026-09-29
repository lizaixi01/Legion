import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runAdapter,type ExecutionAdapter} from '../src/execution-adapter.js';
import {hash} from '../src/provenance.js';
import {ProgramBenchConfig,linuxPath} from '../src/programbench.js';
const config={concurrency:1,maxAttempts:1,attemptMs:1000,totalMs:5000,tasks:[{id:'task',goal:'do',dependsOn:[],routes:['one'],requiredChecks:['public'],outputs:['submission.tar.gz']}]};

test('single-call baseline grades a finished submission despite public failures without repairing it',async()=>{
 const root=join(await mkdtemp(join(tmpdir(),'baseline-')),'run');let calls=0;
 const adapter:ExecutionAdapter={prepare:async()=>({}),worker:async r=>{calls++;await writeFile(join(r.workspace,'submission.tar.gz'),'source');return {status:'completed',sessionId:'s',durationMs:1,usage:[]};},check:async()=>({checks:[{id:'public',status:'fail',detail:'mismatch'}],artifacts:[]}),collect:async team=>({path:join(team.tasks.task!.workspace!,'submission.tar.gz'),sha256:hash('source')}),stop:async()=>{},grade:async()=>({score:0.2})};
 const result=await runAdapter(root,config,adapter,new AbortController().signal,{gradeCompletedBaseline:true});
 assert.equal(calls,1);assert.equal(result.status,'evaluated');assert.equal(result.publicChecksPassed,false);
 await assert.rejects(runAdapter(root,{...config,maxAttempts:2},adapter,new AbortController().signal,{gradeCompletedBaseline:true}),/exactly one/);
});

test('baseline scores a preserved timeout checkpoint while retaining timeout status',async()=>{
 const root=join(await mkdtemp(join(tmpdir(),'timeout-baseline-')),'run');let calls=0;
 const adapter:ExecutionAdapter={prepare:async()=>({}),worker:async r=>{calls++;await writeFile(join(r.workspace,'submission.tar.gz'),'checkpoint');return {status:'timeout',durationMs:1000,usage:[{input_tokens:10,output_tokens:2}]};},check:async()=>{throw Error('worker did not complete');},collect:async team=>({path:join(team.tasks.task!.workspace!,'submission.tar.gz'),sha256:hash('checkpoint')}),stop:async()=>{},grade:async()=>({score:0.1})};
 const result=await runAdapter(root,config,adapter,new AbortController().signal,{gradeCompletedBaseline:true});
 assert.equal(result.status,'evaluated');assert.equal(result.workerTimedOut,true);assert.equal(calls,1);
});
test('adapter freezes selected artifact and tears down workers before hidden grading',async()=>{
 const root=join(await mkdtemp(join(tmpdir(),'adapter-')),'run');const order:string[]=[];
 const adapter:ExecutionAdapter={
  prepare:async()=>({environment:'fixture'}),
  worker:async request=>{order.push('worker');await writeFile(join(request.workspace,'submission.tar.gz'),'source');return {status:'completed',sessionId:'s',durationMs:1,usage:[]};},
  check:async()=>({checks:[{id:'public',status:'pass',detail:'public only'}],artifacts:[]}),
  collect:async()=>{order.push('select');const path=join(root,'selected.tar.gz');await copyFile(join(root,'team','accepted','task','submission.tar.gz'),path);return {path,sha256:hash('source')};},
  stop:async()=>{order.push('stop');},
  grade:async selected=>{order.push('grade');assert.deepEqual(order,['worker','select','stop','grade']);assert.equal(JSON.parse(await readFile(join(root,'selection.json'),'utf8')).sha256,selected.sha256);return {score:0.5};},
 };
 const result=await runAdapter(root,config,adapter,new AbortController().signal);assert.equal(result.status,'evaluated');
 assert.doesNotMatch(await readFile(join(root,'team','state.json'),'utf8'),/"score"\s*:/);
});
test('adapter never grades failing public checks and always cleans up',async()=>{
 const root=join(await mkdtemp(join(tmpdir(),'adapter-')),'run');let stopped=0;
 const adapter:ExecutionAdapter={prepare:async()=>({}),worker:async()=>({status:'completed',sessionId:'s',durationMs:1,usage:[]}),check:async()=>({checks:[{id:'public',status:'fail',detail:'bad'}],artifacts:[]}),collect:async()=>{throw Error('must not collect');},stop:async()=>{stopped++;},grade:async()=>{throw Error('must not grade');}};
 const result=await runAdapter(root,config,adapter,new AbortController().signal);assert.equal(result.status,'incomplete');assert.equal(stopped,1);
});
test('adapter handles preparation cancellation and refuses a changed selected artifact',async()=>{
 for(const cancel of [true,false]){
 const root=join(await mkdtemp(join(tmpdir(),'adapter-')),'run');let stopped=0,graded=0;const controller=new AbortController();
 const adapter:ExecutionAdapter={prepare:async()=>{if(cancel)controller.abort();return {};},worker:async r=>{await writeFile(join(r.workspace,'submission.tar.gz'),'ok');return {status:'completed',sessionId:'s',durationMs:1,usage:[]};},check:async()=>({checks:[{id:'public',status:'pass',detail:'ok'}],artifacts:[]}),collect:async()=>({path:join(root,'team','accepted','task','submission.tar.gz'),sha256:hash('wrong')}),stop:async()=>{stopped++;},grade:async()=>{graded++;return {};}};
 const result=await runAdapter(root,config,adapter,controller.signal);assert.equal(result.status,cancel?'cancelled':'error');assert.equal(stopped,1);assert.equal(graded,0);
 }
});
test('single-task ProgramBench configuration rejects batch scope and maps Windows paths without shell interpolation',()=>{
 assert.equal(linuxPath('D:\\Projects\\Proactive Agent'),'/mnt/d/Projects/Proactive Agent');
 assert.throws(()=>ProgramBenchConfig.parse({instance:'all'}));
 assert.equal(linuxPath('/home/user/tool'),'/home/user/tool');
});

test('cancellation during grading cleans up again and cannot publish an evaluated result',async()=>{
 const root=join(await mkdtemp(join(tmpdir(),'adapter-')),'run');const controller=new AbortController();let stops=0;
 const adapter:ExecutionAdapter={prepare:async()=>({}),worker:async r=>{await writeFile(join(r.workspace,'submission.tar.gz'),'source');return {status:'completed',sessionId:'s',durationMs:1,usage:[]};},check:async()=>({checks:[{id:'public',status:'pass',detail:'ok'}],artifacts:[]}),collect:async()=>({path:join(root,'team','accepted','task','submission.tar.gz'),sha256:hash('source')}),stop:async()=>{stops++;},grade:async()=>{controller.abort();return {score:1};}};
 const result=await runAdapter(root,config,adapter,controller.signal);
 assert.equal(result.status,'cancelled');assert.equal(stops,2);
 await assert.rejects(readFile(join(root,'grade.json')));
});

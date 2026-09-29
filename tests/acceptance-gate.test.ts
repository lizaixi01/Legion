import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {managedChatWorker} from '../src/managed-chat.js';
const options={model:'gpt-6-sol',effort:'medium',permission:'workspace-write',agents:0,delegation:{mode:'off',count:10}} as const;
for(const action of ['work','finish'] as const)test(`${action} cannot certify a deliverable without a frozen contract and functional evidence`,async()=>{
 const root=await mkdtemp(join(tmpdir(),'acceptance-gate-'));const attemptDir=join(root,'turn');await mkdir(attemptDir);
 const result=await managedChatWorker(root,options,[],{decide:async()=>({action,reason:'Claim success',answer:'Perfectly completed',tasks:[]}),worker:async()=>({status:'completed',text:'Perfectly completed',usage:null,durationMs:1})})({workspace:root,attemptDir,prompt:'Implement a JSON aggregation program',timeoutMs:30000});
 assert.notEqual((result as any).acceptance?.status,'accepted');
 const state=JSON.parse(await readFile(join(attemptDir,'management.json'),'utf8'));
 assert.notEqual(state.phase,'completed');
 assert.ok(state.acceptance,'Delivery must have an explicit acceptance verdict');
});
import {runAcceptanceDemo,demoGoal} from '../src/acceptance-demo.js';
import {aggregationContract,freezeContract,captureCandidate,verifyCandidate,currentEvidence,builtinVerifiers} from '../src/acceptance.js';
import {rolePrompt} from '../src/agent-roles.js';
import {writeFile,symlink} from 'node:fs/promises';
async function temp(){return mkdtemp(join(tmpdir(),'legion-evidence-'));}
for(const mode of ['work','delegate'] as const)test(`${mode}: real functional checks reject wrong sum, repair and integrate new candidate`,async()=>{
 const r=await runAcceptanceDemo(await temp(),mode);assert.equal(r.result.status,'completed');assert.equal(r.result.acceptance?.status,'accepted');assert.equal(r.attempts,2);
 const attempts=r.state.tasks[0].validation.attempts;assert.deepEqual(attempts.map((v:any)=>v.status),['needs_repair','accepted']);assert.notEqual(attempts[0].artifactHash,attempts[1].artifactHash);
 assert.equal(r.state.tasks[0].functional.verifier.id,'json-aggregation');assert.notEqual(r.result.acceptance?.candidateId,r.state.tasks[0].acceptance.candidateId);
 assert.ok(r.result.acceptance?.evidence?.includes('delivery'));const events=(await readFile(join(r.dir,'turn','events.jsonl'),'utf8')).trim().split('\n').map(x=>JSON.parse(x));assert.equal(new Set(events.map(e=>e.sequence)).size,events.length);
});
test('second model plus passing proposed checks alone stays unverified',async()=>{
 const r=await runAcceptanceDemo(await temp(),'delegate',{registry:[]});assert.equal(r.result.acceptance?.status,'unverified');assert.notEqual(r.state.tasks[0].acceptance.status,'accepted');
});
test('per-task passes cannot bypass a failed final integration check',async()=>{
 const r=await runAcceptanceDemo(await temp(),'delegate',{worker:async(_s,j)=>{await mkdir(j.workspace,{recursive:true});await writeFile(join(j.workspace,'aggregate.json'),'{"sum":6,"sorted":[1,2,3]}');return {status:'completed',text:'Claim',usage:null,durationMs:1};},registry:[{id:'integration-fixture',version:'1',covers:()=>true,check:async(_c,contract)=>({checks:contract.requirements.map(r=>({id:r.id,status:contract.taskId==='root'?'fail':'pass',detail:'Root-specific integration requirement'})),artifacts:[]})}]});
 assert.equal(r.result.acceptance?.status,'rejected');assert.equal(r.state.tasks[0].acceptance.status,'accepted');
});
test('missing checks, malformed reports and arbitrary PASS JSON cannot create acceptance',async()=>{
 const dir=await temp(),c=freezeContract('x',aggregationContract(demoGoal)!,demoGoal,Date.now()+60000);await writeFile(join(dir,'aggregate.json'),'{"sum":6,"sorted":[1,2,3]}');const candidate=await captureCandidate(c,dir,join(dir,'snapshot'),'1');
 for(const [i,report] of [{checks:[{id:'r1',status:'pass',detail:'Missing r2'}],artifacts:[]},{accepted:true},{checks:[{id:'r1',status:'not_checked',detail:'Unknown'},{id:'r2',status:'pass',detail:'pass'}],artifacts:[]}].entries()){
  const e=await verifyCandidate(c,candidate,join(dir,'check-'+i),[{id:'fixture',version:'1',covers:()=>true,check:async()=>report as any}]);assert.notEqual(e.acceptance.status,'accepted');
 }
 const genuine=await verifyCandidate(c,candidate,join(dir,'genuine'),builtinVerifiers);assert.equal(await currentEvidence(genuine,c),true);assert.equal(await currentEvidence(JSON.parse(JSON.stringify(genuine)),c),false);
 const changed=structuredClone(c);changed.dependencies.dep='new';assert.equal(await currentEvidence(genuine,changed),false);changed.dependencies={};changed.acceptance=['weakened'];assert.equal(await currentEvidence(genuine,changed),false);
 await writeFile(join(candidate.snapshot,'aggregate.json'),'{"sum":0}');assert.equal(await currentEvidence(genuine,c),false);
});
test('skills and paths fail closed before execution',async()=>{
 assert.throws(()=>rolePrompt('worker',{},['invented-skill']),/unavailable/);assert.throws(()=>rolePrompt('admin' as any,{}),/Unknown role/);
 const contract=aggregationContract(demoGoal)!;assert.throws(()=>freezeContract('x',{...contract,outputs:['../outside']},demoGoal,Date.now()+1000));
 const dir=await temp(),outside=await temp();await writeFile(join(outside,'aggregate.json'),'{}');await symlink(outside,join(dir,'link'),'junction');const c=freezeContract('x',{...contract,outputs:['link/aggregate.json']},demoGoal,Date.now()+1000);await assert.rejects(captureCandidate(c,dir,join(dir,'snapshot'),'1'),/links/);
});
test('cancelled verification and mutation during a hashless checker never pass',async()=>{
 const dir=await temp(),c=freezeContract('x',aggregationContract(demoGoal)!,demoGoal,Date.now()+60000);await writeFile(join(dir,'aggregate.json'),'{"sum":6,"sorted":[1,2,3]}');const candidate=await captureCandidate(c,dir,join(dir,'snapshot'),'1');
 const abort=new AbortController();abort.abort();await assert.rejects(verifyCandidate(c,candidate,join(dir,'cancel'),builtinVerifiers,abort.signal));
 await assert.rejects(verifyCandidate(c,candidate,join(dir,'change'),[{id:'mutation',version:'1',covers:()=>true,check:async()=>{await writeFile(join(candidate.snapshot,'aggregate.json'),'{}');return {checks:c.requirements.map(r=>({id:r.id,status:'pass',detail:'Claim'})),artifacts:[]};}}]),/Stale/);
});
test('model and verification budgets bound review and repair calls',async()=>{
 for(const limits of [{maxCalls:1},{maxVerifications:0}]){const r=await runAcceptanceDemo(await temp(),'delegate',limits);assert.notEqual(r.result.acceptance?.status,'accepted');assert.ok(r.state.tasks.length<=1);}
});
test('journal failure and late successful worker response cannot publish acceptance',async()=>{
 const dir=await temp();const r=await runAcceptanceDemo(dir,'delegate',{worker:async(_s,j)=>{await mkdir(j.workspace,{recursive:true});await writeFile(join(j.workspace,'aggregate.json'),'{"sum":6,"sorted":[1,2,3]}');await mkdir(join(dir,'turn','management.json.tmp'));return {status:'completed',text:'Success',usage:null,durationMs:1};}});assert.equal(r.result.status,'error');assert.equal(r.result.acceptance?.status,'blocked');
});
test('contract cannot be weakened after first implementation',async()=>{
 const r=await runAcceptanceDemo(await temp(),'delegate',{decide:async s=>s.round?{action:'finish',reason:'weaken',answer:'done',tasks:[],contract:{goal:demoGoal,outputs:[],acceptance:[]}}:{action:'delegate',reason:'implement',answer:'',tasks:[{id:'aggregate',backend:'codex',...aggregationContract(demoGoal)!}]}});assert.equal(r.result.status,'error');assert.match(r.result.detail??'',/Frozen/);
});
import {runInNewContext} from 'node:vm';
import {renderMessage} from '../src/message-links.js';
test('runtime verdict dominates worker prose and historical records are never labeled accepted',async()=>{
 const source=await readFile('desktop/app.js','utf8');const scope:any={renderMessage,esc:(s:unknown)=>String(s??'').replaceAll('<','&lt;')};runInNewContext(source.slice(source.indexOf('function managementView(state)')),scope);
 const html=scope.managementView({round:0,phase:'incomplete',decisions:[],tasks:[{id:'x',backend:'codex',status:'unverified',reply:'Perfect accepted',checks:[]}],acceptance:{status:'unverified',detail:'No functional verifier',uncovered:['sum']}});
 assert.match(html,/data-status="unverified"/);assert.match(html,/Worker 自述（未经认证）/);assert.match(html,/未覆盖：sum/);
 assert.match(scope.managementView({round:0,phase:'completed',decisions:[],tasks:[]}),/历史记录/);
});
test('read-only explanation stays conversational without implementation or challenge',async()=>{
 const root=await temp(),attemptDir=join(root,'turn');const r=await managedChatWorker(root,options,[],{decide:async()=>({action:'finish',reason:'Explanation',answer:'TypeScript adds static type checking.',tasks:[]}),worker:async()=>{throw Error('No implementation');}})({workspace:root,attemptDir,prompt:'解释 TypeScript',timeoutMs:1000});assert.equal(r.acceptance?.status,'not_applicable');assert.equal(r.status,'completed');
});
test('cancelled late model completion cannot create a candidate or acceptance',async()=>{
 const root=await temp(),c=new AbortController();const contract=aggregationContract(demoGoal)!;
 const r=await managedChatWorker(root,{...options,delegation:{mode:'auto',count:10}},[],{decide:async()=>({action:'work',contract,reason:'Implement',answer:'',tasks:[]}),worker:async()=>{c.abort();return {status:'completed',text:'late success',usage:null,durationMs:1};}})({workspace:root,attemptDir:join(root,'turn'),prompt:demoGoal,timeoutMs:10000,signal:c.signal});assert.equal(r.status,'cancelled');assert.equal(r.acceptance?.status,'blocked');
});
test('unverified dependency blocks downstream execution through the existing DAG',async()=>{
 let calls=0;const contract=aggregationContract(demoGoal)!;
 const r=await runAcceptanceDemo(await temp(),'delegate',{registry:[],decide:async s=>s.round?{action:'finish',reason:'Stop',answer:'Done',tasks:[]}:{action:'delegate',reason:'Dependencies',contract,answer:'',tasks:[{id:'source',backend:'codex',...contract},{id:'dependent',backend:'codex',goal:'Use source',outputs:['other.json'],acceptance:['uses accepted source'],dependsOn:['source']}]},worker:async(_s,j)=>{calls++;await mkdir(j.workspace,{recursive:true});await writeFile(join(j.workspace,'aggregate.json'),'{"sum":6,"sorted":[1,2,3]}');return {status:'completed',text:'claim',durationMs:1,usage:null};}});assert.equal(calls,1);assert.equal(r.state.tasks[1].status,'blocked');assert.notEqual(r.result.acceptance?.status,'accepted');
});
test('wrong independent opinion becomes a bounded dispute, not an infinite repair loop',async()=>{
 let calls=0;const r=await runAcceptanceDemo(await temp(),'delegate',{worker:async(_s,j)=>{calls++;await mkdir(j.workspace,{recursive:true});await writeFile(join(j.workspace,'aggregate.json'),'{"sum":6,"sorted":[1,2,3]}');return {status:'completed',text:'Correct',durationMs:1,usage:null};},challenge:async c=>({checks:c.acceptance.map(criterion=>({criterion,source:`import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';const d=JSON.parse(readFileSync('aggregate.json','utf8'));assert.equal(d.sum,999);`})),limitations:[]})});assert.equal(calls,1);assert.equal(r.result.acceptance?.status,'unverified');assert.match(r.state.tasks[0].acceptance.detail,/disputed/);
});
test('required unavailable skill fails before any worker is dispatched',async()=>{
 let calls=0;const r=await runAcceptanceDemo(await temp(),'delegate',{decide:async()=>({action:'delegate',reason:'Skill request',answer:'',tasks:[{id:'aggregate',backend:'codex',...aggregationContract(demoGoal)!,skills:['unknown']}]}),worker:async()=>{calls++;throw Error('Must not run');}});assert.equal(calls,0);assert.equal(r.result.acceptance?.status,'blocked');assert.match(r.result.detail??'',/skill unavailable/);
});
test('existing or interrupted attempt cannot be dispatched a second time',async()=>{
 const root=await temp(),attemptDir=join(root,'turn');let calls=0;const worker=managedChatWorker(root,options,[],{decide:async()=>{calls++;return {action:'finish',reason:'Greeting',answer:'hello',tasks:[]};}});const req={workspace:root,attemptDir,prompt:'hi',timeoutMs:5000};await worker(req);const before=await readFile(join(attemptDir,'management.json'),'utf8');const second=await worker(req);assert.equal(calls,1);assert.equal(second.acceptance?.status,'blocked');assert.equal(await readFile(join(attemptDir,'management.json'),'utf8'),before);
});
test('persisted functional evidence tampering invalidates a previously accepted result',async()=>{
 const dir=await temp(),c=freezeContract('x',aggregationContract(demoGoal)!,demoGoal,Date.now()+60000);await writeFile(join(dir,'aggregate.json'),'{"sum":6,"sorted":[1,2,3]}');const candidate=await captureCandidate(c,dir,join(dir,'snapshot'),'1');const e=await verifyCandidate(c,candidate,join(dir,'check'),builtinVerifiers);assert.equal(await currentEvidence(e,c),true);await writeFile(e.acceptance.evidence!,'{"status":"accepted","forged":true}');assert.equal(await currentEvidence(e,c),false);
});

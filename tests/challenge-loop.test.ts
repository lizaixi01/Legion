import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {managedChatWorker} from '../src/managed-chat.js';
import {verifySnapshot,validateChallenge,type AcceptanceContract} from '../src/challenge.js';
import type {ChatOptions} from '../src/chat-options.js';
const options:ChatOptions={model:'gpt-6-sol',effort:'medium',permission:'workspace-write',agents:0,delegation:{mode:'auto',count:10}};
const contract:AcceptanceContract={goal:'Return the maximum of two numbers',outputs:['max.mjs'],acceptance:['Returns the larger number, including negative numbers and equality']};
const source=`import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';import {join} from 'node:path';const {max}=await import(pathToFileURL(join(process.cwd(),'max.mjs')).href);assert.equal(max(2,8),8);assert.equal(max(-2,-8),-2);assert.equal(max(3,3),3);`;
const challenge={checks:[{criterion:contract.acceptance[0]!,source}],limitations:[]};
async function fixture(){const root=await mkdtemp(join(tmpdir(),'challenge-loop-'));const request={workspace:join(root,'project'),attemptDir:join(root,'turn'),prompt:contract.goal,timeoutMs:30000};await mkdir(request.workspace);await mkdir(request.attemptDir);return {root,request};}
const delegate={contract,action:'delegate',reason:'Implement independently',answer:'',tasks:[{id:'max',backend:'codex',...contract}]};
const finish={action:'finish',reason:'Worker says done',answer:'Perfect, everything passed',tasks:[]};

test('semantic failure triggers repair and reruns the SAME independent tests against a new version',async()=>{
 const {root,request}=await fixture();let builds=0,challenges=0;const phases:string[]=[];
 const r=await managedChatWorker(root,options,[],{registry:[{id:'host-max-fixture',version:'1',covers:c=>c.goal===contract.goal,check:async(candidate,c,dir,signal)=>{const r=await verifySnapshot(contract,challenge,candidate.snapshot,join(dir,'host-check'),1,signal);return {checks:r.checks.map((x,i)=>({id:'r'+(i+1),status:x.status==='pass'?'pass' as const:'fail' as const,detail:x.detail})),artifacts:[]};}}],decide:async s=>{phases.push(...s.tasks.map(t=>t.status));return s.round===0?delegate:finish;},challenge:async c=>{challenges++;assert.deepEqual(c,contract);return challenge;},worker:async(_spec,job)=>{builds++;await mkdir(job.workspace,{recursive:true});if(builds===2)assert.match(job.prompt,/AssertionError/);await writeFile(join(job.workspace,'max.mjs'),builds===1?'export const max=(a,b)=>Math.min(a,b);':'export const max=(a,b)=>Math.max(a,b);');return {status:'completed',text:'All correct!',usage:null,durationMs:1};}})(request);
 assert.equal(r.status,'completed');assert.equal(builds,2);assert.equal(challenges,1);assert.deepEqual(phases,['accepted']);
 const state=JSON.parse(await readFile(join(request.attemptDir,'management.json'),'utf8'));const versions=state.tasks[0].validation.attempts;assert.deepEqual(versions.map((v:any)=>v.status),['needs_repair','accepted']);assert.equal(versions[0].verifierHash,versions[1].verifierHash);assert.equal(versions[0].contractHash,versions[1].contractHash);assert.notEqual(versions[0].artifactHash,versions[1].artifactHash);assert.match(await readFile(join(versions[0].snapshot,'max.mjs'),'utf8'),/Math.min/);
});

test('exhausted repair budget blocks a Manager success claim',async()=>{
 const {root,request}=await fixture();let builds=0;const r=await managedChatWorker(root,options,[],{registry:[{id:'host-max-fixture',version:'1',covers:c=>c.goal===contract.goal,check:async(candidate,c,dir,signal)=>{const r=await verifySnapshot(contract,challenge,candidate.snapshot,join(dir,'host-check'),1,signal);return {checks:r.checks.map((x,i)=>({id:'r'+(i+1),status:x.status==='pass'?'pass' as const:'fail' as const,detail:x.detail})),artifacts:[]};}}],decide:async s=>s.round===0?delegate:finish,challenge:async()=>challenge,worker:async(_s,j)=>{builds++;await mkdir(j.workspace,{recursive:true});await writeFile(join(j.workspace,'max.mjs'),'export const max=()=>0;');return {status:'completed',text:'Trust me',usage:null,durationMs:1};}})(request);assert.notEqual(r.acceptance?.status,'accepted');assert.equal(builds,3);const reply=await readFile(join(request.attemptDir,'stdout.jsonl'),'utf8');assert.doesNotMatch(reply,/Perfect/);assert.match(reply,/尚未完成验收/);
});

test('changing an accepted artifact before finish invalidates acceptance',async()=>{
 const {root,request}=await fixture();const r=await managedChatWorker(root,options,[],{registry:[{id:'host-max-fixture',version:'1',covers:c=>c.goal===contract.goal,check:async(candidate,c,dir,signal)=>{const r=await verifySnapshot(contract,challenge,candidate.snapshot,join(dir,'host-check'),1,signal);return {checks:r.checks.map((x,i)=>({id:'r'+(i+1),status:x.status==='pass'?'pass' as const:'fail' as const,detail:x.detail})),artifacts:[]};}}],decide:async s=>{if(!s.round)return delegate;await writeFile(join(s.tasks[0]!.workspace,'max.mjs'),'export const max=()=>0;');return finish;},challenge:async()=>challenge,worker:async(_s,j)=>{await mkdir(j.workspace,{recursive:true});await writeFile(join(j.workspace,'max.mjs'),'export const max=Math.max;');return {status:'completed',text:'done',usage:null,durationMs:1};}})(request);assert.notEqual(r.acceptance?.status,'accepted');
});

test('uncovered criteria, vacuous checks and unsupported verification cannot pass',async()=>{
 assert.throws(()=>validateChallenge({checks:[],limitations:[]},contract),/every/);
 const {request}=await fixture();await writeFile(join(request.workspace,'max.mjs'),'export const max=Math.max;');
 const vacuous=await verifySnapshot(contract,{checks:[{criterion:contract.acceptance[0]!,source:'console.log("fine")'}],limitations:[]},request.workspace,join(request.attemptDir,'vacuous'),1);assert.equal(vacuous.status,'unverified');
 const partial=await verifySnapshot(contract,{...challenge,limitations:['Does not check infinities']},request.workspace,join(request.attemptDir,'partial'),1);assert.equal(partial.status,'unverified');
});

test('validator cannot write candidate files or spawn external programs',async()=>{
 const {request}=await fixture();await writeFile(join(request.workspace,'max.mjs'),'export const max=Math.max;');
 for(const [i,attack] of [`import {writeFileSync} from 'node:fs';writeFileSync('max.mjs','changed');`,`import {execSync} from 'node:child_process';execSync('echo escaped');`].entries()){
 const r=await verifySnapshot(contract,{checks:[{criterion:contract.acceptance[0]!,source:attack}],limitations:[]},request.workspace,join(request.attemptDir,'denied-'+i),1);assert.notEqual(r.status,'accepted');assert.match(r.checks[0]!.detail,/ERR_ACCESS_DENIED|LEGION_CHECK_CAPABILITY_DENIED/);
 }
});

test('cancellation of validation never becomes accepted',async()=>{const {request}=await fixture();await writeFile(join(request.workspace,'max.mjs'),'export const max=Math.max;');const c=new AbortController();c.abort();await assert.rejects(verifySnapshot(contract,challenge,request.workspace,join(request.attemptDir,'cancel'),1,c.signal));});

test('invalid challenger code is unverified instead of blaming the implementation',async()=>{const {request}=await fixture();await writeFile(join(request.workspace,'max.mjs'),'export const max=Math.max;');const r=await verifySnapshot(contract,{checks:[{criterion:contract.acceptance[0]!,source:'const = broken;'}],limitations:[]},request.workspace,join(request.attemptDir,'invalid-check'),1);assert.equal(r.status,'unverified');});
test('review programs cannot access network through normal fetch or builtin module APIs',async()=>{
 const {request}=await fixture();await writeFile(join(request.workspace,'max.mjs'),'export const max=Math.max;');
 for(const [i,source] of ["await fetch('http://127.0.0.1:1')", "process.getBuiltinModule('http').get('http://127.0.0.1:1')", "await import('node:net')"].entries()){
  const r=await verifySnapshot(contract,{checks:[{criterion:contract.acceptance[0]!,source}],limitations:[]},request.workspace,join(request.attemptDir,'network-'+i),1);assert.equal(r.status,'unverified');assert.match(r.checks[0]!.detail,/LEGION_CHECK_CAPABILITY_DENIED/);
 }
});

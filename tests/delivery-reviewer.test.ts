import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPrimaryDelivery} from '../src/primary-delivery.js';
import {digest} from '../src/challenge.js';
import type {VerifierRegistry} from '../src/acceptance.js';
import type {Result,WorkerSpec} from '../src/worker-pool.js';

const contract={goal:'Review offline external evidence fixture',outputs:['result.json'],acceptance:['all fixture cases pass']};
const challenger:WorkerSpec={backend:'codex',command:'fixture',prefix:[],model:'fixture',effort:'medium'};
const proposal={checks:[{criterion:contract.acceptance[0],source:`import fs from 'node:fs';import assert from 'node:assert/strict';const result=JSON.parse(fs.readFileSync('result.json','utf8'));assert.equal(result.passed_cases,15);assert.equal(result.id,'lower');assert.equal(result.ID,'upper');`}],limitations:[]};
// Synthetic host adapter and data. These are never benchmark results or platform credentials.
for(const scenario of ['completed','timeout','exit-one','missing-terminal','invalid-json','launch-error','candidate-failed','unsupported'] as const){
 test(`delivery keeps evidence separate from reviewer: ${scenario}`,async t=>{
  const root=await mkdtemp(join(tmpdir(),'delivery-reviewer-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const evidence={submission_id:'offline-fixture-only',passed_cases:scenario==='candidate-failed'?14:15,official_total_score:12.34,raw_times:Array(15).fill(1),raw_evidence:'fixture://raw-platform-response',id:'lower',ID:'upper'};
  const bytes=JSON.stringify(evidence);await writeFile(join(root,'result.json'),bytes);
  const registry:VerifierRegistry=scenario==='unsupported'?[]:[{id:'offline-external-fixture',version:'1',covers:()=>true,check:async candidate=>{
   const data=JSON.parse(await readFile(join(candidate.snapshot,'result.json'),'utf8'));
   return {checks:[{id:'r1',status:data.passed_cases===15?'pass':'fail',detail:'synthetic fixture check'}],artifacts:[{path:join(candidate.snapshot,'result.json'),sha256:digest(bytes)}]};
  }}];
  const result:Result={status:scenario==='completed'||scenario==='invalid-json'?'completed':scenario==='exit-one'||scenario==='missing-terminal'?'error':'timeout',durationMs:180001,text:'partial review',usage:null,sessionId:'review-session-fixture',detail:scenario==='exit-one'?'Exit 1; signal null':scenario==='missing-terminal'?'No successful terminal event':'No successful terminal event; Exit 1; signal null'};
  let calls=0;
  const directory=join(root,'delivery');
  const service=createPrimaryDelivery(root,directory,contract.goal,Date.now()+60000,true,{challenger,registry,run:async(spec,job)=>{
   calls++;
   // Host verification must already be durable when review starts or stalls.
   const saved=JSON.parse(await readFile(join(directory,'delivery.json'),'utf8'));
   assert.ok(saved.versions.at(-1).functional);
   assert.equal(spec.permission,'read-only');assert.ok(job.timeoutMs<=180000);
   assert.match(job.prompt,/JSON.parse/);assert.match(job.prompt,/GENERATED SCRIPTS/);
   if(scenario==='launch-error')throw Error('spawn ENOENT fixture');
   if(result.status==='completed')await writeFile(spec.outputPath!,scenario==='invalid-json'?'invalid':JSON.stringify(proposal));
   return result;
  }});
  await service.call({action:'prepare',contract});
  const checked=await service.call({action:'check'}),attempt=checked.versions[0]!;
  assert.equal(calls,1);
  assert.equal(checked.acceptance.status,scenario==='completed'?'accepted':scenario==='candidate-failed'?'rejected':'unverified');
  assert.equal(checked.acceptance.evidenceStatus,scenario==='candidate-failed'?'rejected':scenario==='unsupported'?'unverified':'accepted');
  assert.equal(checked.acceptance.reviewStatus,scenario==='completed'?'accepted':'infrastructure_failure');
  assert.equal(attempt.functional?.report.artifacts.length,scenario==='unsupported'?0:1);
  assert.equal(await readFile(join(root,'result.json'),'utf8'),bytes);
  assert.equal(await readFile(join(attempt.functional!.candidate.snapshot,'result.json'),'utf8'),bytes);
  assert.equal((await service.finalize()).status,checked.acceptance.status);
  const recorded=JSON.parse(await readFile(join(directory,'version-1/challenger/attempt.json'),'utf8'));
  if(scenario!=='completed'){
   assert.equal(checked.acceptance.failureClass,'reviewer_infrastructure_failure');
   assert.ok(checked.acceptance.limitations?.length);
   assert.ok(recorded.error);assert.equal(recorded.status,'infrastructure_failure');
  }
  if(scenario!=='launch-error')assert.deepEqual(recorded.result,result);
  if(scenario==='timeout'){
   const second=await service.call({action:'check'});
   assert.equal(second.versions.length,2);assert.deepEqual(second.versions[0],attempt);
   const reopened=createPrimaryDelivery(root,join(root,'next'),contract.goal,Date.now()+60000,true,{challenger,registry,run:async()=>result},undefined,join(directory,'delivery.json'));
   const history=await reopened.call({action:'read'});
   assert.equal(history.previous?.acceptance.evidenceStatus,'accepted');
   assert.equal(history.previous?.acceptance.reviewStatus,'infrastructure_failure');
   assert.equal((await reopened.call({action:'resume'})).acceptance.status,'pending');
   await writeFile(join(root,'result.json'),'changed');
   assert.equal((await service.finalize()).evidenceStatus,'blocked');
   assert.equal(attempt.functional!.acceptance.status,'accepted');
  }
 });
}

test('reviewer recovery requires a fresh successful review; cancellation retains host evidence',async t=>{
 const root=await mkdtemp(join(tmpdir(),'delivery-reviewer-recovery-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await writeFile(join(root,'result.json'),JSON.stringify({passed_cases:15,id:'lower',ID:'upper'}));
 const registry:VerifierRegistry=[{id:'fixture',version:'1',covers:()=>true,check:async()=>({checks:[{id:'r1',status:'pass',detail:'offline fixture'}],artifacts:[]})}];
 let calls=0;
 const service=createPrimaryDelivery(root,join(root,'delivery'),contract.goal,Date.now()+60000,true,{challenger,registry,run:async spec=>{
  if(++calls===1)return {status:'timeout',durationMs:180000,text:'',usage:null,detail:'original timeout'};
  await writeFile(spec.outputPath!,JSON.stringify(proposal));return {status:'completed',durationMs:1,text:'',usage:null};
 }});
 await service.call({action:'prepare',contract});
 const failed=await service.call({action:'check'});assert.equal(failed.acceptance.status,'unverified');
 const recovered=await service.call({action:'check'});assert.equal(recovered.acceptance.status,'accepted');
 assert.equal(recovered.versions[0]!.reviewer!.error,'Error: Independent reviewer timeout: original timeout');
 assert.deepEqual(recovered.versions[0],failed.versions[0]);assert.equal(calls,2);
 const controller=new AbortController();
 const cancelled=createPrimaryDelivery(root,join(root,'cancelled'),contract.goal,Date.now()+60000,true,{challenger,registry,run:async()=>{
  controller.abort();return {status:'cancelled',durationMs:1,text:'',usage:null,detail:'cancelled by fixture'};
 }},controller.signal);
 await cancelled.call({action:'prepare',contract});
 const stopped=await cancelled.call({action:'check'});
 assert.equal(stopped.acceptance.status,'blocked');assert.equal(stopped.versions[0]!.functional!.acceptance.status,'accepted');
 const final=await cancelled.finalize();assert.equal(final.status,'blocked');assert.equal(final.evidenceStatus,'accepted');assert.ok(final.evidence);
 assert.equal(stopped.versions[0]!.reviewer!.result!.detail,'cancelled by fixture');
});

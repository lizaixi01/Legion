import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createFixedHweDeps,compareFixedHweRuns} from '../src/benchmarks/hwe-queue-replay.js';
import {runResearch,type ResearchConfig} from '../src/research-loop.js';
import {verifyHwe,HweCallError,type hweCall} from '../src/hwe-runtime.js';
import {hash} from '../src/provenance.js';
import {passingHwe,archivedHwe} from './fixtures/hwe-evidence.js';
import {linuxPath} from '../src/wsl-path.js';

const order=['baseline','radix-four-divmod','four-phase-divider','source-aware-load-interlock','decoded-source-tags'];
const config:ResearchConfig={goal:'Fixed candidates; no models',maxRounds:2,maxWorkers:5,concurrency:4,verificationConcurrency:2,totalMs:60000,manager:{model:'unused',effort:'high'},worker:{model:'unused',effort:'high'}};
async function fixture(){
 const temp=await mkdtemp(join(tmpdir(),'hwe-replay-')),source=join(temp,'historical'),root=join(temp,'new-run');await mkdir(source);
 const candidates=[];for(const id of order){await writeFile(join(source,id),id);candidates.push({id,archive:id,sha256:hash(id)});}
 const readiness=join(source,'ready.json'),environment={fixture:'same pinned environment'};await writeFile(readiness,JSON.stringify({sha256:hash('baseline'),environment,evidence:passingHwe()}));
 const manifest={source:{readiness},order,candidates};await writeFile(join(source,'candidates.json'),JSON.stringify(manifest));
 await writeFile(join(source,'tasks.json'),JSON.stringify({tasks:order.map(id=>{const evidence=id.includes('interlock')||id.includes('tags')?archivedHwe():passingHwe();return {stage:'S1',candidate:id,evidenceStatus:evidence.status,checks:evidence.checks,metrics:evidence.metrics};})}));
 return {source,root,environment,manifest};
}

test('fixed replay exercises the real loop and HWE result classifier for the same five snapshots without models',async()=>{
 for(const concurrency of [1,2] as const){
  const f=await fixture(),cfg={...config,verificationConcurrency:concurrency},manifestBefore=await readFile(join(f.source,'candidates.json'),'utf8'),seen:string[]=[],dirs=new Set<string>(),inputs=new Map<string,string>();let stopped=0;
  const call:typeof hweCall=async(action,dir,owner,payload,timeout,signal)=>{
   assert.equal(action,'verify');assert.equal(owner,'offline-replay-owner');assert.equal(timeout,4300000);assert.ok(signal&&!signal.aborted);assert.equal(payload.evidence,linuxPath(dir));
   // Source identity comes from this invocation's actual archive, never completion order.
   dirs.add(dir);const candidate=inputs.get(dir)!;await writeFile(join(dir,'result.json'),JSON.stringify(candidate.includes('interlock')||candidate.includes('tags')?archivedHwe():passingHwe()));
   return {logs:dir,result:{status:'completed',exitCode:0,durationMs:1}};
  };
  const deps=await createFixedHweDeps(f.root,cfg,f.source,{fingerprint:async()=>f.environment,host:{verify:async(snapshot,dir,signal)=>{const id=await readFile(snapshot.path,'utf8');seen.push(id);inputs.set(dir,id);return verifyHwe(snapshot.path,dir,'offline-replay-owner',signal,call);},stop:async()=>{stopped++;}}});
  const state=await runResearch(f.root,cfg,deps,new AbortController().signal);assert.equal(state.status,'budget');assert.equal(stopped,1);assert.deepEqual([...seen].sort(),[...order].sort());assert.equal(dirs.size,5);assert.equal(state.candidates.length,5);assert.deepEqual(state.candidates.map(c=>c.snapshot!.sha256),f.manifest.candidates.map(c=>c.sha256));assert.deepEqual(state.verificationBatches!.map(b=>b.started),[4,1]);
  assert.equal(state.candidates.every(c=>c.worker?.status==='replay'),true);assert.equal(state.candidates.filter(c=>c.status==='verified').length,3);assert.equal(state.candidates.filter(c=>c.status==='rejected').length,2);
  assert.equal(await readFile(join(f.source,'candidates.json'),'utf8'),manifestBefore);for(const c of f.manifest.candidates)assert.equal(hash(await readFile(join(f.source,c.archive))),c.sha256);
  const trace=JSON.parse(await readFile(join(f.root,'replay-inputs.json'),'utf8'));assert.equal(trace.modelsCalled,false);assert.equal(trace.inputs[0].replayId,'replay-baseline');
 }
});

test('fixed replay blocks changed hashes, changed environments and output inside historical evidence',async()=>{
 const f=await fixture();let verifications=0;
 const testing={fingerprint:async()=>({fixture:'changed'}),host:{verify:async()=>{verifications++;return passingHwe();},stop:async()=>{}}};
 await assert.rejects(createFixedHweDeps(join(f.source,'output'),config,f.source,testing),/read-only/);
 const deps=await createFixedHweDeps(f.root,config,f.source,testing),state=await runResearch(f.root,config,deps,new AbortController().signal);assert.equal(state.status,'error');assert.match(state.error!,/environment differs/);assert.equal(verifications,0);
 await writeFile(join(f.source,'baseline'),'tampered fixture');await assert.rejects(createFixedHweDeps(f.root,config,f.source,testing),/snapshot changed/);
});

test('HWE adapter retains a host timeout as timeout and other execution failures as error',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hwe-timeout-'));
 for(const status of ['timeout','error'] as const){
  const call:typeof hweCall=async()=>{throw new HweCallError('verify',status,'raw-logs','injected host outcome');};
  const evidence=await verifyHwe('unused',join(root,status),'fixture',new AbortController().signal,call);assert.equal(evidence.status,status);assert.match(evidence.detail!,/injected host outcome/);
 }
});

test('replay comparison checks all gates, metrics, seeds and hashes; elapsed check seconds do not count as disagreements',async()=>{
 const f=await fixture(),roots=[f.root+'-serial',f.root+'-parallel'];
 for(const [index,root] of roots.entries()){
  const cfg={...config,verificationConcurrency:(index===0?1:2) as 1|2};
  const deps=await createFixedHweDeps(root,cfg,f.source,{fingerprint:async()=>f.environment,host:{verify:async snapshot=>{const id=await readFile(snapshot.path,'utf8');const evidence=id.includes('interlock')||id.includes('tags')?archivedHwe():passingHwe();(evidence.checks.lint as {seconds:number}).seconds=index+7;return evidence;},stop:async()=>{}}});
  await runResearch(root,cfg,deps,new AbortController().signal);
 }
 const report=await compareFixedHweRuns(roots[0]!,roots[1]!);assert.equal(report.complete,true);assert.equal(report.consistent,true);assert.equal(report.candidates.length,5);assert.ok(report.verificationSpeedup!>0);
 const saved=JSON.parse(await readFile(join(roots[1]!,'state.json'),'utf8'));saved.candidates[0].evidence.checks.formal.checks_passed--;
 saved.candidates[0].evidence.checks.fpga.seeds[0]++;saved.candidates[0].evidence.metrics.cycles++;await writeFile(join(roots[1]!,'state.json'),JSON.stringify(saved));
 const changed=await compareFixedHweRuns(roots[0]!,roots[1]!);assert.equal(changed.consistent,false);assert.equal(changed.verificationSpeedup,null);assert.ok(changed.candidates[0]!.differences.includes('checks.formal.checks_passed'));assert.ok(changed.candidates[0]!.differences.includes('checks.fpga.seeds.0'));assert.ok(changed.candidates[0]!.differences.includes('metrics.cycles'));
 await writeFile(saved.candidates[0].snapshot.path,'changed after verification');assert.equal((await compareFixedHweRuns(roots[0]!,roots[1]!)).candidates[0]!.snapshotMatches,false);
});

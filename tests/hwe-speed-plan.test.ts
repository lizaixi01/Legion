import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {makeSpeedPlan,createSpeedPlanDeps} from '../src/benchmarks/hwe-speed-plan.js';
import {hweWorkerPrompt} from '../src/hwe.js';
import {runResearch,type ResearchConfig,type ResearchDeps,type Candidate} from '../src/research-loop.js';
import {activity,resourceSummary} from '../src/benchmarks/hwe-speed-analysis.js';
import {runSpeedExperiment,speedExperimentTier} from '../src/benchmarks/hwe-speed-cli.js';
import {hash} from '../src/provenance.js';
const config:ResearchConfig={goal:'Fixed experiment',maxWorkers:12,maxRounds:3,allocationsPerRound:4,concurrency:2,verificationConcurrency:2,verificationScheduling:'worker-ready',totalMs:60000,manager:{model:'gpt-6.1-sol',effort:'xhigh'},worker:{model:'gpt-6.1-sol',effort:'xhigh'}};
const evidence={status:'pass' as const,checks:{},metrics:{fitness:1,fmax_mhz:1,lut4:1,cycles:1},limitations:[]};
const baseline:Candidate={id:'baseline',round:0,hypothesis:{id:'baseline',parent:'',claim:'Pinned',experiment:'Pinned',expected:'Pinned',workerSeconds:30},status:'verified',snapshot:{path:'fixture',sha256:hash('baseline')},evidence};
test('formal tier preserves explicit Standard and previously frozen Fast requests',()=>{
 assert.equal(speedExperimentTier({serviceTier:'default'}),'default');
 assert.equal(speedExperimentTier({serviceTier:'priority'}),'priority');
 assert.equal(speedExperimentTier({serviceTier:'fast'}),'fast');
 assert.equal(speedExperimentTier({}),'priority');
 assert.throws(()=>speedExperimentTier({serviceTier:'unknown'}));
});
test('A/B share all 12 fixed parent identities and exact complete prompts',()=>{
 const a=makeSpeedPlan(config,baseline),b=makeSpeedPlan({...config,concurrency:4},baseline);assert.deepEqual(a,b);assert.deepEqual(a.tasks.map(t=>t.batch),[1,1,1,1,2,2,2,2,3,3,3,3]);assert.equal(new Set(a.tasks.map(t=>t.hypothesis.id)).size,12);
 assert.ok(a.tasks.every(t=>t.parentSha256===baseline.snapshot!.sha256&&t.hypothesis.parent==='baseline'&&t.prompt.includes('300s')&&hash(t.prompt)===t.promptSha256));
 assert.throws(()=>createSpeedPlanDeps('fixture',{...config,allocationsPerRound:2},a));const changed=structuredClone(a);changed.tasks[0]!.prompt+='changed';assert.throws(()=>createSpeedPlanDeps('fixture',config,changed),/prompt/);
});
test('fixed adapter runs 3 x 4 without Manager or best-parent reselection even with no improvement',async()=>{
 const root=join(await mkdtemp(join(tmpdir(),'speed-plan-')),'run');let workers=0,checks=0;
 const host:ResearchDeps={baseline:async dir=>{await mkdir(dir);const path=join(dir,'rtl');await writeFile(path,'baseline');return {...baseline,snapshot:{path,sha256:hash('baseline')}};},decide:async()=>{throw Error('Manager must not run');},work:async(h,parent,dir)=>{workers++;assert.equal(parent.id,'baseline');await writeFile(join(dir,'prompt.txt'),hweWorkerPrompt(h,parent,config));const path=join(dir,'rtl');await writeFile(path,h.id);return {snapshot:{path,sha256:hash(h.id)},worker:{status:'completed',usage:[],durationMs:1}};},verify:async()=>{checks++;return evidence;},stop:async()=>{}};
 const plan=makeSpeedPlan(config,baseline),state=await runResearch(root,config,createSpeedPlanDeps(root,config,plan,host),new AbortController().signal);assert.equal(state.status,'budget');assert.equal(state.round,3);assert.equal(workers,12);assert.equal(checks,12);assert.equal(state.best,'baseline');assert.deepEqual(state.candidates.map(c=>c.id),plan.tasks.map(t=>t.hypothesis.id));assert.deepEqual(JSON.parse(await readFile(join(root,'fixed-plan.json'),'utf8')),plan);
});
test('activity uses interval unions for overlap and first-dispatch-to-last-verification wall time',()=>{
 const t=(a:number,b:number)=>({queuedAt:new Date(0).toISOString(),startedAt:new Date(a).toISOString(),endedAt:new Date(b).toISOString()});
 const state={candidates:[{workerTiming:t(0,10),verification:t(10,30)},{workerTiming:t(0,20),verification:t(20,40)}]} as Parameters<typeof activity>[0];
 const result=activity(state);assert.equal(result.dispatchToLastVerificationMs,40);assert.equal(result.workerBusyMs,20);assert.equal(result.verificationBusyMs,30);assert.equal(result.overlapMs,10);assert.equal(result.maxWorkers,2);assert.equal(result.maxVerification,2);
});
test('resource summaries preserve sample errors and convert observed units without inferring unobserved peaks',()=>{
 const r=resourceSummary([{activeWorkers:2,activeVerifiers:2,stats:[{CPUPerc:'125.0%',MemUsage:'2GiB / 10GiB'},{CPUPerc:'50%',MemUsage:'512MiB / 3GiB'}],hostMemoryKiB:{SwapTotal:'100',SwapFree:'90',MemAvailable:'200'},containers:[{state:{OOMKilled:false}}]},{error:'Docker sampling failed'}]);assert.equal(r.samples,2);assert.equal(r.errors,1);assert.equal(r.peakAggregateContainerMemoryBytes,2.5*1024**3);assert.equal(r.peakAggregateContainerCpuPercent,175);assert.equal(r.peakHostSwapUsedBytes,10*1024);assert.equal(r.workerVerificationOverlapSamples,1);assert.equal(r.oomSamples,0);
});
test('formal run refuses workspace execution before preflight or dispatch',async()=>{
 const root=await mkdtemp(join(tmpdir(),'speed-launch-'));await assert.rejects(runSpeedExperiment(root,'A1'),/inside the frozen/);await assert.rejects(runSpeedExperiment(root,'invalid'),/Run label/);
});

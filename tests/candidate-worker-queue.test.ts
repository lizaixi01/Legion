import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,basename,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {runResearch,type ResearchConfig,type ResearchDeps,type Evidence} from '../src/research-loop.js';
import {normalizeResearchConfig} from '../src/management/candidate-types.js';
import {activity} from '../src/benchmarks/hwe-speed-analysis.js';
import {hash} from '../src/provenance.js';
function gate<T=void>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve};}
const ids=['one','two','three','four'],h=(id:string)=>({id,parent:'baseline',claim:'Fixture',experiment:'Fixture',expected:'Fixture',workerSeconds:30});
const pass:Evidence={status:'pass',checks:{},metrics:{fitness:2,fmax_mhz:1,lut4:1,cycles:1},limitations:[]};
const config:ResearchConfig={goal:'Fixture',maxRounds:2,maxWorkers:8,allocationsPerRound:4,concurrency:2,verificationConcurrency:2,verificationScheduling:'worker-ready',totalMs:60000,manager:{model:'fixture',effort:'high'},worker:{model:'fixture',effort:'high'}};
async function fixture(){
 const root=join(await mkdtemp(join(tmpdir(),'worker-queue-')),'run'),started=ids.map(()=>gate()),release=ids.map(()=>gate()),vstarted=ids.map(()=>gate()),vrelease=ids.map(()=>gate<Evidence>());let workers=0,verifiers=0,workerPeak=0,verifierPeak=0,decisions=0,stops=0;
 const deps:ResearchDeps={baseline:async dir=>{await mkdir(dir);const path=join(dir,'rtl');await writeFile(path,'baseline');return {id:'baseline',round:0,hypothesis:h('baseline'),status:'verified',snapshot:{path,sha256:hash('baseline')},evidence:{...pass,metrics:{...pass.metrics!,fitness:1}}};},decide:async()=>{decisions++;assert.equal(workers,0);assert.equal(verifiers,0);return decisions===1?{action:'experiment',reason:'Fixture',hypotheses:ids.map(h),discard:[]}:{action:'finish',reason:'Done',hypotheses:[],discard:[]};},work:async(h,_p,dir)=>{const i=ids.indexOf(h.id);workers++;workerPeak=Math.max(workers,workerPeak);started[i]!.resolve();await release[i]!.promise;workers--;const path=join(dir,'rtl');await writeFile(path,h.id);return {snapshot:{path,sha256:hash(h.id)},worker:{status:'completed',usage:[],durationMs:1}};},verify:async s=>{const i=ids.indexOf(basename(dirname(s.path)));verifiers++;verifierPeak=Math.max(verifiers,verifierPeak);vstarted[i]!.resolve();const e=await vrelease[i]!.promise;verifiers--;return e;},stop:async()=>{assert.equal(workers,0);assert.equal(verifiers,0);stops++;}};
 return {root,deps,started,release,vstarted,vrelease,counts:()=>({workers,verifiers,workerPeak,verifierPeak,decisions,stops})};
}
for(const concurrency of [2,4])test(`four fixed allocations, Worker bound ${concurrency}, immediate verification and round drain`,{timeout:10000},async()=>{
 const f=await fixture(),run=runResearch(f.root,{...config,concurrency},f.deps,new AbortController().signal);
 await Promise.all(f.started.slice(0,concurrency).map(g=>g.promise));assert.equal(f.counts().workers,concurrency);
 f.release[0]!.resolve();await f.vstarted[0]!.promise;assert.ok(f.counts().workers>0);assert.equal(f.counts().decisions,1);
 f.release[1]!.resolve();await f.vstarted[1]!.promise;assert.equal(f.counts().verifiers,2);
 await f.started[2]!.promise;f.release[2]!.resolve();f.vrelease[1]!.resolve(pass);await f.vstarted[2]!.promise;
 await f.started[3]!.promise;f.release[3]!.resolve();f.vrelease[2]!.resolve(pass);await f.vstarted[3]!.promise;f.vrelease[3]!.resolve(pass);assert.equal(f.counts().decisions,1);f.vrelease[0]!.resolve(pass);
 const state=await run;assert.equal(state.status,'completed');assert.equal(state.candidates.length,4);assert.equal(state.best,'one');assert.equal(f.counts().workerPeak,concurrency);assert.equal(f.counts().verifierPeak,2);assert.equal(f.counts().stops,1);assert.deepEqual(state.candidates.map(c=>c.id),ids);
 const a=activity(state);assert.equal(a.maxWorkers,concurrency);assert.equal(a.maxVerification,2);assert.ok(a.overlapMs>0);
});
test('verification infrastructure failure stops queued Workers while started work drains and snapshots remain', {timeout:10000},async()=>{
 const f=await fixture(),fault=gate();const verify=f.deps.verify;
 f.deps.verify=async(...args)=>{await verify(...args);fault.resolve();return {status:'error',checks:{engine:'lost'},limitations:[]};};
 const run=runResearch(f.root,{...config,concurrency:1},f.deps,new AbortController().signal);await f.started[0]!.promise;f.release[0]!.resolve();await f.vstarted[0]!.promise;await f.started[1]!.promise;f.vrelease[0]!.resolve(pass);await fault.promise;
 // Wait for the persisted fault before releasing the still-running sibling.
 while(!(await readFile(join(f.root,'events.jsonl'),'utf8')).includes('"type":"verified"'))await new Promise(r=>setImmediate(r));
 f.release[1]!.resolve();const state=await run;assert.equal(state.status,'error');assert.equal(state.candidates.length,4);assert.ok(state.candidates[1]!.snapshot);assert.equal(state.candidates[2]!.workerTiming?.startedAt,undefined);assert.equal(state.candidates[3]!.workerTiming?.startedAt,undefined);assert.equal(f.counts().stops,1);
});
for(const mode of ['cancel','budget'] as const)test(`${mode} stops dispatch, consumes all allocations and drains before cleanup`,{timeout:10000},async t=>{
 if(mode==='budget')t.mock.timers.enable({apis:['setTimeout']});const f=await fixture(),controller=new AbortController();
 const run=runResearch(f.root,{...config,totalMs:1000},f.deps,controller.signal);await Promise.all(f.started.slice(0,2).map(g=>g.promise));if(mode==='cancel')controller.abort();else t.mock.timers.tick(1000);f.release[0]!.resolve();f.release[1]!.resolve();const state=await run;
 assert.equal(state.status,mode==='cancel'?'cancelled':'budget');assert.equal(state.candidates.length,4);assert.equal(state.candidates[2]!.workerTiming?.startedAt,undefined);assert.equal(f.counts().stops,1);assert.equal(state.best,'baseline');
});
test('legacy normalization is explicit and effective scheduling changes cannot resume',async()=>{
 const legacy={...config};delete legacy.allocationsPerRound;delete legacy.verificationScheduling;delete legacy.verificationConcurrency;
 assert.deepEqual(normalizeResearchConfig(legacy),normalizeResearchConfig({...legacy,allocationsPerRound:2,verificationScheduling:'round-barrier',verificationConcurrency:1}));
 const f=await fixture();f.deps.work=async()=>{throw Error('stop fixture');};const state=await runResearch(f.root,config,f.deps,new AbortController().signal);assert.equal(state.status,'error');const before=await readFile(join(f.root,'state.json'),'utf8'),stops=f.counts().stops;
 for(const changed of [{...config,allocationsPerRound:2},{...config,verificationScheduling:'round-barrier' as const},{...config,concurrency:4}])await assert.rejects(runResearch(f.root,changed,f.deps,new AbortController().signal,true),/configuration changed/);
 assert.equal(await readFile(join(f.root,'state.json'),'utf8'),before);assert.equal(f.counts().stops,stops);
 f.deps.decide=async ctx=>{assert.equal(ctx.round,2);assert.equal(ctx.remainingWorkers,4);return {action:'finish',reason:'No replay',hypotheses:[],discard:[]};};const resumed=await runResearch(f.root,config,f.deps,new AbortController().signal,true);assert.equal(resumed.resumed,true);assert.equal(resumed.candidates.length,4);
});
test('parent mutation after Worker export stops dispatch and retains the exported ungraded artifact',async()=>{
 const f=await fixture();let verifies=0;f.deps.work=async(h,parent,dir)=>{const path=join(dir,'rtl');await writeFile(path,h.id);await writeFile(parent.snapshot!.path,'tampered parent');return {snapshot:{path,sha256:hash(h.id)},worker:{status:'completed',usage:[],durationMs:1}};};f.deps.verify=async()=>{verifies++;return pass;};
 const state=await runResearch(f.root,{...config,concurrency:1},f.deps,new AbortController().signal);assert.equal(state.status,'error');assert.equal(verifies,0);assert.ok(state.candidates[0]!.snapshot);assert.equal(state.candidates[1]!.workerTiming?.startedAt,undefined);assert.match(state.candidates[0]!.evidence!.detail!,/Parent snapshot changed after Worker/);
});

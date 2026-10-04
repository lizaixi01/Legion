import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rmdir,unlink} from 'node:fs/promises';
import {watch} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,basename} from 'node:path';
import {hash} from '../src/provenance.js';
import {runFixture as runResearch,eligible,ResearchConfigSchema,type ResearchConfig,type ResearchDeps,type Evidence,type ResearchState} from './fixtures/candidate-policy.js';
import {researchSummary} from '../src/research-summary.js';
import {runCandidateLoop} from '../src/management/candidate-loop.js';
import {scorePolicy} from './fixtures/candidate-policy.js';

function gate<T=void>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve};}
const h=(id:string)=>({id,parent:'baseline',claim:'Offline fixture',experiment:'Controlled independent verifier',expected:'Measured result',workerSeconds:30});
const pass=(fitness=110):Evidence=>({status:'pass',checks:{fixture:true},metrics:{score:fitness},limitations:['Offline fixture only']});
const config:ResearchConfig={goal:'Queue behavior without models or containers',maxRounds:2,maxWorkers:8,concurrency:4,totalMs:60000,manager:{model:'fixture',effort:'high'},worker:{model:'fixture',effort:'high'}};
const ids=['one','two','three','four'];
async function fixture(){
 const root=join(await mkdtemp(join(tmpdir(),'verification-queue-')),'run');
 const entered=Object.fromEntries(ids.map(id=>[id,gate()])),results=Object.fromEntries(ids.map(id=>[id,gate<Evidence>()]));
 const calls:string[]=[],signals:AbortSignal[]=[],dirs:string[]=[],manager=gate();let active=0,peak=0,stops=0,decisions=0,workers=0;
 const deps:ResearchDeps={
  baseline:async dir=>{await mkdir(dir);const path=join(dir,'artifact');await writeFile(path,'baseline');return {id:'baseline',round:0,hypothesis:h('baseline'),status:'verified',snapshot:{path,sha256:hash('baseline')},evidence:pass(100)};},
  decide:async ctx=>{decisions++;if(decisions===1)return {action:'experiment',reason:'Controlled batch',hypotheses:ids.map(h),discard:[]};manager.resolve();assert.equal(active,0);assert.deepEqual(ctx.records.map(c=>c.id),['baseline',...ids]);return {action:'finish',reason:'All evidence collected',hypotheses:[],discard:[]};},
  work:async(hyp,_parent,dir)=>{workers++;const path=join(dir,'artifact');await writeFile(path,hyp.id);return {snapshot:{path,sha256:hash(hyp.id)},worker:{status:'completed',durationMs:1,usage:[],report:'Unverified claim: score 999999'}};},
  verify:async(snapshot,dir,signal)=>{const id=basename(dirname(snapshot.path));assert.equal(await readFile(snapshot.path,'utf8'),id);assert.equal(snapshot.sha256,hash(id));assert.equal(dir,join(root,id,'verification'));calls.push(id);signals.push(signal);dirs.push(dir);active++;peak=Math.max(peak,active);entered[id]!.resolve();try{return await results[id]!.promise;}finally{active--;};},
  stop:async()=>{assert.equal(active,0,'cleanup must follow the drain barrier');stops++;},
 };
 return {root,deps,entered,results,calls,signals,dirs,manager,counts:()=>({active,peak,stops,decisions,workers})};
}
async function events(root:string){return (await readFile(join(root,'events.jsonl'),'utf8')).trim().split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});}
// Observe a persisted milestone, without sleeps or assumptions about verifier latency.
async function milestone(root:string,type:string,id?:string){
 return new Promise<void>((resolve,reject)=>{
  const watcher=watch(root,()=>{void inspect();});let done=false;
  async function inspect(){try{if((await events(root)).some(e=>e.type===type&&(id===undefined||e.data.id===id))&&!done){done=true;watcher.close();resolve();}}catch(error){if(!done){done=true;watcher.close();reject(error);}}}
  void inspect();
 });
}
async function savedEquals(root:string,state:ResearchState){assert.deepEqual(JSON.parse(await readFile(join(root,'state.json'),'utf8')),JSON.parse(JSON.stringify(state)));}

test('resume preserves both verification concurrency and the configured Manager timeout',async()=>{
 const f=await fixture(),custom={...config,verificationConcurrency:2 as const,manager:{...config.manager,timeoutSeconds:600}};
 f.deps.decide=async()=>{throw Error('Fixture decision failed before allocation');};
 const initial=await runResearch(f.root,custom,f.deps,new AbortController().signal);assert.equal(initial.status,'error');assert.equal(f.counts().workers,0);
 const saved=await readFile(join(f.root,'state.json'),'utf8'),stops=f.counts().stops;
 await assert.rejects(runResearch(f.root,{...custom,manager:{...custom.manager,timeoutSeconds:900}},f.deps,new AbortController().signal,true),/Resume configuration changed/);
 assert.equal(await readFile(join(f.root,'state.json'),'utf8'),saved);assert.equal(f.counts().stops,stops);
 f.deps.decide=async()=>({action:'finish',reason:'Resume under original frozen configuration',hypotheses:[],discard:[]});
 const resumed=await runResearch(f.root,custom,f.deps,new AbortController().signal,true);
 assert.equal(resumed.status,'completed');assert.equal(resumed.config.verificationConcurrency,2);assert.equal(resumed.config.manager.timeoutSeconds,600);assert.equal(resumed.candidates.length,0);
 const log=await events(f.root),attempts=log.filter(e=>e.type==='decision_started');assert.equal(attempts.length,2);assert.notEqual(attempts[0].data.directory,attempts[1].data.directory);
});

for(const concurrency of [undefined,1,2] as const)test(`verification concurrency ${concurrency??'legacy default'} enforces its limit and refills a free slot`,{timeout:10000},async()=>{
 const f=await fixture(),run=runResearch(f.root,{...config,...(concurrency?{verificationConcurrency:concurrency}:{})},f.deps,new AbortController().signal);
 await f.entered.one!.promise;
 if(concurrency===2){await f.entered.two!.promise;assert.deepEqual([...f.calls].sort(),['one','two']);f.results.two!.resolve(pass());await f.entered.three!.promise;assert.equal(f.calls.length,3);assert.equal(f.calls[2],'three');f.results.three!.resolve(pass());await f.entered.four!.promise;f.results.four!.resolve(pass());await milestone(f.root,'verified','four');assert.equal(f.counts().decisions,1);f.results.one!.resolve(pass());}
 else {assert.deepEqual(f.calls,['one']);for(let i=0;i<ids.length;i++){await f.entered[ids[i]!]!.promise;assert.equal(f.calls.length,i+1);f.results[ids[i]!]!.resolve(pass());}}
 const state=await run;assert.equal(state.status,'completed');assert.equal(state.best,'one');assert.equal(f.counts().peak,concurrency??1);assert.equal(f.counts().stops,1);assert.equal(new Set(f.dirs).size,4);assert.equal(state.candidates.filter(eligible).length,4);await savedEquals(f.root,state);
 const log=await events(f.root);assert.equal(log.filter(e=>e.type==='worker_returned').length,4);const firstStart=log.findIndex(e=>e.type==='verification_started');assert.ok(log.slice(0,firstStart).filter(e=>e.type==='worker_returned').length===4);for(const e of log.filter(e=>e.type==='verification_started')){assert.equal(e.data.verification.endedAt,undefined);assert.ok(e.data.active<=(concurrency??1));}
 for(const c of state.candidates){const t=c.verification!;assert.ok(t.queuedAt&&t.startedAt&&t.endedAt);assert.equal(t.queueMs,Date.parse(t.startedAt!)-Date.parse(t.queuedAt));assert.equal(t.durationMs,Date.parse(t.endedAt!)-Date.parse(t.startedAt!));}
 assert.equal(state.verificationBatches![0]!.maxActive,concurrency??1);assert.equal(state.verificationBatches![0]!.executionMsSum,state.candidates.reduce((s,c)=>s+c.verification!.durationMs!,0));
 const summary=await researchSummary(f.root);assert.equal(summary.verification.concurrency,concurrency??1);assert.equal(summary.verification.batchWallMsSum,state.verificationBatches![0]!.wallMs);assert.equal(summary.wallMs,state.spentMs);
});

test('workers settle before verification; reverse completion preserves ties and Manager record order', {timeout:10000},async()=>{
 const f=await fixture(),work=f.deps.work,lastWorker=gate(),allWorkers=gate();let arrivals=0;
 f.deps.work=async(...args)=>{if(++arrivals===4)allWorkers.resolve();if(args[0].id==='four')await lastWorker.promise;return work(...args);};
 const run=runResearch(f.root,{...config,verificationConcurrency:2},f.deps,new AbortController().signal);await allWorkers.promise;assert.equal(f.calls.length,0);lastWorker.resolve();
 await Promise.all([f.entered.one!.promise,f.entered.two!.promise]);f.results.two!.resolve(pass());await f.entered.three!.promise;f.results.three!.resolve(pass());await f.entered.four!.promise;f.results.four!.resolve(pass());await milestone(f.root,'verified','four');assert.equal(f.counts().decisions,1);f.results.one!.resolve(pass());
 const state=await run;assert.equal(state.best,'one');assert.deepEqual((await events(f.root)).filter(e=>e.type==='verified').map(e=>e.data.id),['two','three','four','one']);
 const memory=JSON.parse(await readFile(join(f.root,'round-2-1','memory.json'),'utf8'));assert.equal(memory.best,'one');assert.deepEqual(memory.records.map((c:{id:string})=>c.id),['baseline',...ids]);
});

test('baseline retains an equal score under strict comparison',async()=>{
 const f=await fixture();f.deps.verify=async()=>pass(100);const state=await runResearch(f.root,{...config,verificationConcurrency:2},f.deps,new AbortController().signal);assert.equal(state.best,'baseline');
});

test('normal rejection refills the queue; a mixed infrastructure fault drains a valid sibling without further dispatch', {timeout:10000},async()=>{
 const f=await fixture(),run=runResearch(f.root,{...config,verificationConcurrency:2},f.deps,new AbortController().signal);
 await Promise.all([f.entered.one!.promise,f.entered.two!.promise]);f.results.one!.resolve({status:'fail',checks:{assertion:false},limitations:[]});await f.entered.three!.promise;
 const mixed:Evidence={status:'fail',checks:{assertion:false,engine:{status:'error',detail:'verifier unavailable'}},infrastructureError:true,limitations:[]};f.results.three!.resolve(mixed);await milestone(f.root,'verified','three');assert.deepEqual([...f.calls].sort(),['one','three','two']);assert.equal(f.signals[1]!.aborted,false);assert.equal(f.counts().stops,0);f.results.two!.resolve(pass(120));
 const state=await run;assert.equal(state.status,'error');assert.equal(state.best,'two');assert.equal(state.candidates[0]!.status,'rejected');assert.equal(state.candidates[2]!.status,'rejected');assert.deepEqual(state.candidates[2]!.evidence,mixed);assert.equal(state.candidates[3]!.status,'interrupted');assert.equal(state.candidates[3]!.verification?.startedAt,undefined);assert.equal(f.counts().decisions,1);await savedEquals(f.root,state);
});

for(const kind of ['throw','timeout','invalid','incomplete','tamper-before','tamper-after'] as const)test(`${kind} blocks delivery and stops new verification`,{timeout:10000},async()=>{
 const f=await fixture();const work=f.deps.work;let calls=0;
 f.deps.work=async(...args)=>{const result=await work(...args);if(kind==='tamper-before'&&args[0].id==='one')await writeFile(result.snapshot!.path,'changed');return result;};
 f.deps.verify=async snapshot=>{calls++;if(kind==='throw')throw Error('lost verifier');if(kind==='tamper-after')await writeFile(snapshot.path,'changed');return kind==='timeout'?{status:'timeout',checks:{tool:'timeout'},limitations:[]}:kind==='invalid'?pass(NaN):kind==='incomplete'?{status:'pass',checks:{fixture:true},limitations:[]}:pass();};
 const state=await runResearch(f.root,{...config,verificationConcurrency:1},f.deps,new AbortController().signal);assert.equal(state.status,'error');assert.equal(state.best,'baseline');assert.equal(state.candidates.some(eligible),false);assert.equal(calls,kind==='tamper-before'?0:1);assert.equal(state.candidates[1]!.verification?.startedAt,undefined);if(kind==='tamper-after')assert.deepEqual(state.candidates[0]!.evidence,pass());
});

for(const reason of ['cancel','deadline'] as const)test(`${reason} cancels active checks, stops queued checks and waits before cleanup`,{timeout:10000},async t=>{
 const f=await fixture(),external=new AbortController(),aborted=gate(),drain=gate();let aborts=0;
 if(reason==='deadline')t.mock.timers.enable({apis:['setTimeout']});
 const verify=f.deps.verify;
 f.deps.verify=async(...args)=>{const result=verify(...args);args[2].addEventListener('abort',()=>{if(++aborts===2)aborted.resolve();},{once:true});await drain.promise;return result;};
 const run=runResearch(f.root,{...config,totalMs:1000,verificationConcurrency:2},f.deps,external.signal);await Promise.all([f.entered.one!.promise,f.entered.two!.promise]);
 if(reason==='cancel')external.abort();else t.mock.timers.tick(1000);
 await aborted.promise;assert.equal(f.counts().stops,0);assert.deepEqual([...f.calls].sort(),['one','two']);f.results.one!.resolve(pass(1000));f.results.two!.resolve(pass(2000));drain.resolve();
 const state=await run;assert.equal(state.status,reason==='cancel'?'cancelled':'budget');assert.equal(state.best,'baseline');assert.equal(state.candidates.every(c=>c.status==='interrupted'),true);assert.equal(state.candidates[2]!.verification?.startedAt,undefined);assert.equal(f.counts().stops,1);assert.equal(state.cleanup?.status,'completed');await savedEquals(f.root,state);
});

test('checkpoint failure drains both slots, records the failure and recovers the final save', {timeout:10000},async()=>{
 const f=await fixture(),stop=f.deps.stop;
 f.deps.stop=async()=>{await stop();await rmdir(join(f.root,'state.tmp'));};
 const run=runResearch(f.root,{...config,verificationConcurrency:2},f.deps,new AbortController().signal);await Promise.all([f.entered.one!.promise,f.entered.two!.promise]);
 await mkdir(join(f.root,'state.tmp'));f.results.one!.resolve(pass(110));await milestone(f.root,'verified','one');f.results.two!.resolve(pass(120));
 const state=await run;assert.equal(state.status,'error');assert.equal(state.best,'two');assert.deepEqual([...f.calls].sort(),['one','two']);assert.ok(state.persistenceErrors?.some(e=>e.includes('verified')));assert.equal(state.cleanup?.status,'completed');await savedEquals(f.root,state);
});

test('cleanup failure is visible beside the original infrastructure evidence and valid sibling', {timeout:10000},async()=>{
 const f=await fixture(),stop=f.deps.stop;f.deps.stop=async()=>{await stop();throw Error('owner cleanup failed');};
 const run=runResearch(f.root,{...config,verificationConcurrency:2},f.deps,new AbortController().signal);await Promise.all([f.entered.one!.promise,f.entered.two!.promise]);f.results.one!.resolve({status:'error',checks:{engine:'failed'},limitations:[]});f.results.two!.resolve(pass(120));
 const state=await run;assert.equal(state.status,'error');assert.equal(state.best,'two');assert.match(state.error!,/Infrastructure error/);assert.match(state.error!,/Cleanup failed/);assert.equal(state.cleanup?.status,'error');assert.deepEqual(state.candidates[0]!.evidence?.checks,{engine:'failed'});await savedEquals(f.root,state);
 const summary=await researchSummary(f.root);assert.equal(summary.cleanup?.status,'error');assert.equal(summary.error,state.error);
});

test('a final checkpoint failure is returned even when the storage remains unavailable',async()=>{
 const f=await fixture();f.deps.decide=async()=>({action:'finish',reason:'Done',hypotheses:[],discard:[]});f.deps.stop=async()=>{await mkdir(join(f.root,'state.tmp'));};
 const state=await runResearch(f.root,config,f.deps,new AbortController().signal);assert.equal(state.status,'error');assert.ok(state.persistenceErrors?.some(e=>e.includes('(ended)')));assert.match(state.error!,/State persistence failed/);
 const summary=await researchSummary(f.root,state);assert.equal(summary.status,'error');assert.deepEqual(summary.persistenceErrors,state.persistenceErrors);
});

test('legacy resume normalizes missing concurrency and key order, charges interrupted allocations and never replays them',async()=>{
 const f=await fixture();f.deps.verify=async()=>({status:'error',checks:{},limitations:[]});const first=await runResearch(f.root,config,f.deps,new AbortController().signal);assert.equal(first.candidates.length,4);
 const saved=JSON.parse(await readFile(join(f.root,'state.json'),'utf8')) as ResearchState;delete saved.verificationBatches;for(const c of saved.candidates)delete c.verification;saved.candidates[1]!.status='working';saved.candidates[2]!.status='verifying';await writeFile(join(f.root,'state.json'),JSON.stringify(saved));await unlink(join(f.root,'quality-policy.json'));const legacySummary=await researchSummary(f.root);assert.equal(legacySummary.verification.batchWallMsSum,null);assert.equal(legacySummary.verification.candidates[0]!.verification,null);
 f.deps.decide=async ctx=>{assert.equal(ctx.remainingWorkers,4);assert.equal(ctx.round,2);assert.equal(ctx.records[2]!.status,'interrupted');assert.equal(ctx.records[3]!.status,'interrupted');return {action:'finish',reason:'Inspect only',hypotheses:[],discard:[]};};
 f.deps.work=async()=>{throw Error('must not replay spent workers');};f.deps.verify=async()=>{throw Error('must not replay old verification');};
 const resumed=await runCandidateLoop(f.root,{verificationConcurrency:1,...config},f.deps,scorePolicy,new AbortController().signal,true,scorePolicy.id);assert.equal(resumed.status,'completed');assert.equal(resumed.version,1);assert.equal(resumed.config.verificationConcurrency,undefined);assert.equal(resumed.candidates.length,4);assert.equal(resumed.spentMs>=first.spentMs,true);await savedEquals(f.root,resumed);
});

test('resume rejects every change in effective verification concurrency before cleanup or writes',async()=>{
 for(const stored of [undefined,1,2] as const){
  const f=await fixture(),cfg={...config,...(stored?{verificationConcurrency:stored}:{})};f.deps.verify=async()=>({status:'error',checks:{},limitations:[]});await runResearch(f.root,cfg,f.deps,new AbortController().signal);const before=await readFile(join(f.root,'state.json'),'utf8'),stops=f.counts().stops;
  const changed=stored===2?config:{...config,verificationConcurrency:2 as const};await assert.rejects(runResearch(f.root,changed,f.deps,new AbortController().signal,true),/configuration changed/);assert.equal(f.counts().stops,stops);assert.equal(await readFile(join(f.root,'state.json'),'utf8'),before);
 }
 assert.equal(ResearchConfigSchema.safeParse({...config,verificationConcurrency:3}).success,false);
});

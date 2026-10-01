import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {hash} from '../src/provenance.js';
import {runResearch,eligible,researchContext,type ResearchConfig,type ResearchDeps,type Evidence,type Candidate} from '../src/research-loop.js';
import {classifyHweEvidence} from '../src/hwe.js';
import {archivedHwe,engineErrorHwe} from './fixtures/hwe-evidence.js';
const config:ResearchConfig={goal:'Improve measured quality',maxRounds:3,maxWorkers:4,concurrency:2,totalMs:10000,manager:{model:'test',effort:'high'},worker:{model:'test',effort:'medium'}};
const h=(id:string,parent='baseline')=>({id,parent,claim:'A falsifiable claim '+id,experiment:'Run the same verifier',expected:'Higher fitness',workerSeconds:30});
const evidence=(fitness:number):Evidence=>({status:'pass',checks:{formal:true},metrics:{fitness,fmax_mhz:100,lut4:1000,cycles:100},limitations:['bounded']});
async function fixture(){const temp=await mkdtemp(join(tmpdir(),'research-')),root=join(temp,'run');let stops=0;const deps:ResearchDeps={baseline:async dir=>{await mkdir(dir);const path=join(dir,'rtl');await writeFile(path,'baseline');return {id:'baseline',round:0,hypothesis:h('baseline',''),status:'verified',snapshot:{path,sha256:hash('baseline')},evidence:evidence(100)};},decide:async()=>({action:'finish',reason:'Done',hypotheses:[],discard:[]}),work:async(h,_p,dir)=>{const path=join(dir,'rtl');await writeFile(path,h.id);return {snapshot:{path,sha256:hash(h.id)},worker:{status:'completed',usage:[],durationMs:1,report:'I claim 10000 fitness'}};},verify:async()=>evidence(110),stop:async()=>{stops++;}};return {root,deps,stops:()=>stops};}
test('research uses external quality, carries evidence to next round, and manager allocates repairs',async()=>{
 const f=await fixture();let round=0;f.deps.decide=async ctx=>{round++;if(round===1)return {action:'experiment',reason:'Compare alternatives',hypotheses:[h('fast'),h('broken')],discard:[]};if(round===2){assert.equal(ctx.best,'fast');assert.equal(ctx.records.find(c=>c.id==='broken')?.evidence?.status,'fail');return {action:'experiment',reason:'Repair counterexample',hypotheses:[h('repair','broken')],discard:[]};}return {action:'finish',reason:'No further gain justified',hypotheses:[],discard:['broken']};};
 f.deps.verify=async snapshot=>(await readFile(snapshot.path,'utf8'))==='broken'?{status:'fail',checks:{counterexample:'bad retirement'},limitations:[]}:evidence((await readFile(snapshot.path,'utf8'))==='repair'?120:110);
 const s=await runResearch(f.root,config,f.deps,new AbortController().signal);assert.equal(s.status,'completed');assert.equal(s.best,'repair');assert.equal(s.candidates.length,3);assert.equal(f.stops(),1);assert.equal(s.candidates[1]!.discarded,true);assert.equal(JSON.parse(await readFile(join(f.root,'state.json'),'utf8')).spentMs,s.spentMs);
});
test('research rejects forged/nonfinite metrics and retains baseline',async()=>{const f=await fixture();f.deps.decide=async()=>({action:'experiment',reason:'Try',hypotheses:[h('bad')],discard:[]});f.deps.verify=async()=>evidence(NaN);const s=await runResearch(f.root,config,f.deps,new AbortController().signal);assert.equal(s.status,'error');assert.equal(s.best,'baseline');assert.equal(eligible(s.candidates[0]!),false);});
test('research checks parent digest before dispatch and cleans after failure',async()=>{const f=await fixture();let calls=0;f.deps.decide=async ctx=>{await writeFile(ctx.records[0]!.snapshot!.path,'tampered');return {action:'experiment',reason:'Try',hypotheses:[h('child')],discard:[]};};f.deps.work=async()=>{calls++;return {};};const s=await runResearch(f.root,config,f.deps,new AbortController().signal);assert.equal(calls,0);assert.equal(s.status,'error');assert.equal(f.stops(),1);});
test('research rejects over-allocation and duplicate IDs before any work',async()=>{const f=await fixture();f.deps.decide=async()=>({action:'experiment',reason:'Try',hypotheses:[h('x'),h('x')],discard:[]});const s=await runResearch(f.root,config,f.deps,new AbortController().signal);assert.equal(s.status,'error');assert.equal(s.candidates.length,0);});
test('hypotheses cannot overwrite scheduler or provenance directories',async()=>{
 for(const id of ['cleanup','implementation','round-one']){
  const f=await fixture();let calls=0;
  f.deps.decide=async()=>({action:'experiment',reason:'Try',hypotheses:[h(id)],discard:[]});
  f.deps.work=async()=>{calls++;return {};};
  const s=await runResearch(f.root,config,f.deps,new AbortController().signal);
  assert.equal(calls,0);assert.equal(s.candidates.length,0);assert.match(s.error!,/Reserved/);
 }
});
test('research cancellation never selects unfinished work',async()=>{const f=await fixture(),c=new AbortController();f.deps.decide=async()=>({action:'experiment',reason:'Try',hypotheses:[h('x')],discard:[]});f.deps.work=async()=>{c.abort();return {};};const s=await runResearch(f.root,config,f.deps,c.signal);assert.equal(s.status,'cancelled');assert.equal(s.best,'baseline');assert.equal(f.stops(),1);});
test('research resume keeps completed evidence and charges interrupted allocations',async()=>{const f=await fixture();f.deps.decide=async()=>({action:'experiment',reason:'Try',hypotheses:[h('x')],discard:[]});f.deps.verify=async()=>{throw Error('simulator unavailable');};const first=await runResearch(f.root,config,f.deps,new AbortController().signal);assert.equal(first.status,'error');f.deps.decide=async ctx=>{assert.equal(ctx.remainingWorkers,3);assert.equal(ctx.round,2);assert.equal(ctx.records.length,2);return {action:'finish',reason:'Stop after recorded infrastructure failure',hypotheses:[],discard:[]};};const second=await runResearch(f.root,config,f.deps,new AbortController().signal,true);assert.equal(second.status,'completed');assert.equal(second.history.length,2);});

test('independent workers overlap but external verification is serialized',async()=>{
 const f=await fixture();let entered=0,activeChecks=0;let release!:()=>void;
 const barrier=new Promise<void>(r=>release=r),work=f.deps.work;
 f.deps.decide=async()=>({action:'experiment',reason:'Independent hypotheses',hypotheses:[h('one'),h('two')],discard:[]});
 f.deps.work=async(...args)=>{if(++entered===2)release();await barrier;return work(...args);};
 f.deps.verify=async()=>{assert.equal(++activeChecks,1);await new Promise(r=>setTimeout(r,5));activeChecks--;return evidence(110);};
 const s=await runResearch(f.root,{...config,maxRounds:1},f.deps,new AbortController().signal);
 assert.equal(s.candidates.filter(eligible).length,2);assert.equal(s.status,'budget');
});
test('a verifier cannot change the accepted snapshot',async()=>{
 const f=await fixture();f.deps.decide=async()=>({action:'experiment',reason:'Try',hypotheses:[h('changed')],discard:[]});
 f.deps.verify=async snapshot=>{await writeFile(snapshot.path,'other design');return evidence(1000);};
 const s=await runResearch(f.root,config,f.deps,new AbortController().signal);
 assert.equal(s.status,'error');assert.equal(s.best,'baseline');assert.match(s.candidates[0]!.evidence!.detail!,/snapshot changed/);
});
test('resuming an unclean running checkpoint does not replenish elapsed budget',async()=>{
 const f=await fixture();await runResearch(f.root,config,f.deps,new AbortController().signal);
 const saved=JSON.parse(await readFile(join(f.root,'state.json'),'utf8'));saved.status='running';saved.checkpointAt=new Date(Date.now()-20000).toISOString();delete saved.endedAt;
 await writeFile(join(f.root,'state.json'),JSON.stringify(saved));
 f.deps.decide=async()=>{throw Error('must not start another manager call');};
 const resumed=await runResearch(f.root,config,f.deps,new AbortController().signal,true);
 assert.equal(resumed.status,'budget');assert.ok(resumed.spentMs>=20000);assert.equal(resumed.history.length,1);
});
test('worker infrastructure failures retain the provider reason instead of a task outcome',async()=>{
 const f=await fixture();
 f.deps.decide=async()=>({action:'experiment',reason:'Try',hypotheses:[h('x')],discard:[]});
 f.deps.work=async(hyp,_p,dir)=>{const path=join(dir,'rtl');await writeFile(path,hyp.id);return {snapshot:{path,sha256:hash(hyp.id)},worker:{status:'error',usage:[],durationMs:1,detail:'usage-limit: hit usage limit'}};};
 const s=await runResearch(f.root,config,f.deps,new AbortController().signal);
 assert.equal(s.status,'error');
 assert.match(s.candidates[0]!.evidence!.detail!,/usage-limit/);
 assert.equal(s.best,'baseline');
});

test('formal engine faults stop dispatch, retain a valid sibling, and reach Manager as undetermined on explicit resume',async()=>{
 const f=await fixture();let decisions=0,verifications=0,workers=0;const work=f.deps.work;
 f.deps.decide=async()=>{decisions++;return {action:'experiment',reason:'Compare',hypotheses:[h('valid'),h('engine-error')],discard:[]};};
 f.deps.work=async(...args)=>{workers++;return work(...args);};
 const fault=classifyHweEvidence(engineErrorHwe());
 f.deps.verify=async snapshot=>{verifications++;return (await readFile(snapshot.path,'utf8'))==='valid'?evidence(110):fault;};
 const s=await runResearch(f.root,config,f.deps,new AbortController().signal);
 assert.equal(s.status,'error');assert.equal(decisions,1);assert.equal(workers,2);assert.equal(verifications,2);
 assert.equal(s.best,'valid');assert.equal(eligible(s.candidates[0]!),true);
 const candidate=s.candidates[1]!;assert.equal(candidate.status,'error');assert.equal(candidate.evidence?.status,'error');assert.equal(eligible(candidate),false);
 assert.equal(candidate.discarded,undefined);assert.match(candidate.evidence!.detail!,/undetermined/);
 f.deps.decide=async ctx=>{decisions++;const failed=ctx.records.find(c=>c.id==='engine-error')!;assert.equal(failed.status,'error');assert.deepEqual(failed.evidence,fault);assert.equal(ctx.best,'valid');assert.equal(ctx.remainingWorkers,2);return {action:'finish',reason:'Environment failure acknowledged',hypotheses:[],discard:[]};};
 const resumed=await runResearch(f.root,config,f.deps,new AbortController().signal,true);
 assert.equal(resumed.status,'completed');assert.equal(decisions,2);assert.equal(workers,2);assert.equal(verifications,2);
});

test('mixed confirmed FAIL and engine ERROR retain both and stop as infrastructure without another allocation',async()=>{
 const f=await fixture();let calls=0;
 const raw=archivedHwe();raw.checks.formal={...(raw.checks.formal as object),classification:{status:'fail',outcomes:[
  {name:'reg_ch0',status:'fail',tool_statuses:['FAIL'],preunsat:false},
  {name:'other',status:'error',tool_statuses:['ERROR'],preunsat:false}],diagnostics:[],infrastructure_error:true}};
 const mixed=classifyHweEvidence(raw);
 f.deps.decide=async()=>{calls++;return {action:'experiment',reason:'Try',hypotheses:[h('mixed')],discard:[]};};f.deps.verify=async()=>mixed;
 const s=await runResearch(f.root,config,f.deps,new AbortController().signal);
 assert.equal(s.status,'error');assert.equal(calls,1);assert.equal(s.best,'baseline');
 assert.equal(s.candidates[0]!.status,'rejected');assert.equal(s.candidates[0]!.evidence!.status,'fail');
 assert.deepEqual(researchContext(s,100).records[1]!.evidence,mixed);
});
test('formal timeout remains undetermined and stops without spending another allocation',async()=>{
 const f=await fixture();let calls=0;const raw=engineErrorHwe();raw.checks.formal={passed:false,failed_check:'timeout',detail:'run_all.sh exceeded 2700s wall-clock'};
 f.deps.decide=async()=>{calls++;return {action:'experiment',reason:'Try',hypotheses:[h('timeout')],discard:[]};};f.deps.verify=async()=>classifyHweEvidence(raw);
 const s=await runResearch(f.root,config,f.deps,new AbortController().signal);
 assert.equal(s.status,'error');assert.equal(calls,1);assert.equal(s.candidates[0]!.status,'error');assert.equal(s.candidates[0]!.evidence!.status,'timeout');assert.equal(s.best,'baseline');
});

test('resume cannot silently change a frozen Manager decision limit',async()=>{
 const f=await fixture(),frozen={...config,manager:{...config.manager,timeoutSeconds:600}};
 f.deps.decide=async(_ctx,dir)=>{await writeFile(join(dir,'attempt-marker.txt'),'First failed decision');throw Error('Fixture interrupted before allocation');};
 const state=await runResearch(f.root,frozen,f.deps,new AbortController().signal);assert.equal(state.status,'error');assert.equal(state.config.manager.timeoutSeconds,600);
 let calls=0;f.deps.decide=async(ctx,dir)=>{calls++;assert.notEqual(dir,join(f.root,'round-1-0'));assert.ok(ctx.remainingMs<=config.totalMs-state.spentMs);assert.equal(ctx.remainingWorkers,config.maxWorkers);return {action:'finish',reason:'Fixture',hypotheses:[],discard:[]};};
 await assert.rejects(runResearch(f.root,{...frozen,manager:{...frozen.manager,timeoutSeconds:900}},f.deps,new AbortController().signal,true),/Resume configuration changed/);assert.equal(calls,0);
 const resumed=await runResearch(f.root,frozen,f.deps,new AbortController().signal,true);assert.equal(resumed.status,'completed',resumed.error??'');assert.equal(calls,1);assert.equal(resumed.config.manager.timeoutSeconds,600);
 assert.equal(await readFile(join(f.root,'round-1-0','attempt-marker.txt'),'utf8'),'First failed decision');
 const events=(await readFile(join(f.root,'events.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));const attempts=events.filter(event=>event.type==='decision_started');assert.equal(attempts.length,2);assert.notEqual(attempts[0].data.directory,attempts[1].data.directory);
});

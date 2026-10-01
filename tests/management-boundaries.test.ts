import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,relative} from 'node:path';
import {build as inspectImportGraph} from 'esbuild';
import {runCandidateLoop,eligible} from '../src/management/candidate-loop.js';
import type {Metrics,QualityPolicy,ResearchConfig,ResearchDeps,Evidence} from '../src/management/candidate-types.js';
import {hweQualityPolicy,type HweMetrics} from '../src/hwe-quality.js';
import {createPrimaryAgentWorker} from '../src/primary-runtime.js';
import type {PrimaryCapability} from '../src/primary-capability.js';
import {defaultChatOptions} from '../src/chat-options.js';
import {hash} from '../src/provenance.js';
import {runResearch} from '../src/research-loop.js';
import {hweSettings} from '../src/hwe-runtime.js';

const config:ResearchConfig={goal:'Optimize the declared objective',maxRounds:2,maxWorkers:4,concurrency:2,totalMs:60000,manager:{model:'fixture',effort:'high'},worker:{model:'fixture',effort:'high'}};
const hypothesis=(id:string)=>({id,parent:'baseline',claim:'Measured local change',experiment:'Independent check',expected:'Improved declared metric',workerSeconds:30});
async function fixture<M extends Metrics>(baseline:M,results:Record<string,Evidence<M>>){
 const root=join(await mkdtemp(join(tmpdir(),'domain-loop-')),'run');let decisions=0,workCalls=0,stops=0;
 const deps:ResearchDeps<M>={
  baseline:async dir=>{await mkdir(dir,{recursive:true});const path=join(dir,'artifact');await writeFile(path,'baseline');return {id:'baseline',round:0,hypothesis:hypothesis('baseline'),status:'verified',snapshot:{path,sha256:hash('baseline')},evidence:{status:'pass',checks:{},metrics:baseline,limitations:['fixture']}};},
  decide:async()=>{decisions++;return decisions===1?{action:'experiment',reason:'Compare measured outcomes',hypotheses:Object.keys(results).map(hypothesis),discard:[]}:{action:'finish',reason:'Enough evidence',hypotheses:[],discard:[]};},
  work:async(h,_parent,dir)=>{workCalls++;const path=join(dir,'artifact');await writeFile(path,h.id);return {snapshot:{path,sha256:hash(h.id)},worker:{status:'completed',durationMs:1,usage:[],report:'I claim the best possible score'}};},
  verify:async snapshot=>results[await readFile(snapshot.path,'utf8')]!,stop:async()=>{stops++;},
 };
 return {root,deps,counts:()=>({decisions,workCalls,stops})};
}
const hwe=(fitness:number):HweMetrics=>({fitness,fmax_mhz:20,lut4:100,cycles:1000});
test('the shared loop retains HWE validity and maximum-fitness selection',async()=>{
 const f=await fixture(hwe(10),{fast:{status:'pass',checks:{},metrics:hwe(12),limitations:[]},invalid:{status:'pass',checks:{},metrics:{...hwe(100),cycles:0},limitations:[]}});
 const state=await runCandidateLoop(f.root,config,f.deps,hweQualityPolicy,new AbortController().signal);
 assert.equal(state.status,'error');assert.equal(state.best,'fast');assert.equal(state.candidates[1]!.status,'error');
 assert.deepEqual(f.counts(),{decisions:1,workCalls:2,stops:1});
});
type DefectMetrics={defects:number};
const defectPolicy:QualityPolicy<DefectMetrics>={id:'defects-min-v1',validMetrics:m=>!!m&&Number.isInteger(m.defects)&&m.defects>=0,better:(a,b)=>a.defects<b.defects};
test('the SAME loop handles a different metric, minimization and a valid zero without HWE',async()=>{
 const f=await fixture({defects:5},{clean:{status:'pass',checks:{functional:{passed:true}},metrics:{defects:0},limitations:[]},worse:{status:'pass',checks:{},metrics:{defects:9},limitations:[]}});
 const state=await runCandidateLoop(f.root,config,f.deps,defectPolicy,new AbortController().signal);
 assert.equal(state.status,'completed');assert.equal(state.best,'clean');assert.equal(eligible(state.candidates[0]!,defectPolicy),true);
 const saved=JSON.parse(await readFile(join(f.root,'state.json'),'utf8'));assert.deepEqual(saved.candidates[0].evidence.metrics,{defects:0});assert.deepEqual(saved.config,config);
 assert.equal(state.candidates.length,2);assert.deepEqual(f.counts(),{decisions:2,workCalls:2,stops:1});
});
test('generic evidence retains simultaneous rejection and infrastructure fault and stops further allocation',async()=>{
 const f=await fixture({defects:5},{good:{status:'pass',checks:{},metrics:{defects:1},limitations:[]},broken:{status:'fail',checks:{failure:{detail:'assertion'}},infrastructureError:true,limitations:[]}});
 const state=await runCandidateLoop(f.root,config,f.deps,defectPolicy,new AbortController().signal);
 assert.equal(state.status,'error');assert.equal(state.best,'good');assert.equal(state.candidates[1]!.status,'rejected');assert.equal(state.candidates[1]!.evidence!.infrastructureError,true);
 assert.equal(f.counts().decisions,1);assert.equal(state.candidates.length,2);
});
test('a contradictory PASS with an infrastructure fault cannot enter ranking and retains its diagnostics',async()=>{
 const evidence:Evidence<DefectMetrics>={status:'pass',checks:{engine:{diagnostic:'lost result'}},infrastructureError:true,metrics:{defects:0},limitations:[]};
 const f=await fixture({defects:5},{broken:evidence});
 const state=await runCandidateLoop(f.root,config,f.deps,defectPolicy,new AbortController().signal);
 assert.equal(state.status,'error');assert.equal(state.best,'baseline');assert.equal(state.candidates[0]!.status,'error');assert.deepEqual(state.candidates[0]!.evidence,evidence);
 assert.equal(eligible({...state.candidates[0]!,status:'verified'},defectPolicy),false);assert.equal(f.counts().decisions,1);
});
test('resume refuses a different quality policy before cleanup or dispatch',async()=>{
 const f=await fixture({defects:5},{broken:{status:'error',checks:{},limitations:[]}});
 await runCandidateLoop(f.root,config,f.deps,defectPolicy,new AbortController().signal);
 const before=await readFile(join(f.root,'state.json'),'utf8'),counts=f.counts();
 await assert.rejects(runCandidateLoop(f.root,config,f.deps,{...defectPolicy,id:'defects-max-v1',better:(a,b)=>a.defects>b.defects},new AbortController().signal,true),/policy changed/);
 assert.deepEqual(f.counts(),counts);assert.equal(await readFile(join(f.root,'state.json'),'utf8'),before);
});
test('the HWE compatibility entry resumes old state without rewriting its persisted format or replenishing calls',async()=>{
 const f=await fixture(hwe(10),{broken:{status:'error',checks:{},limitations:[]}});
 await runResearch(f.root,config,f.deps,new AbortController().signal);await unlink(join(f.root,'quality-policy.json'));
 f.deps.decide=async ctx=>{assert.equal(ctx.remainingWorkers,3);return {action:'finish',reason:'Legacy evidence inspected',hypotheses:[],discard:[]};};
 const state=await runResearch(f.root,config,f.deps,new AbortController().signal,true);
 assert.equal(state.status,'completed');assert.equal(state.version,1);assert.equal(state.candidates.length,1);assert.deepEqual(state.config,config);
 await assert.rejects(readFile(join(f.root,'quality-policy.json')),/ENOENT/);
});

async function primaryFixture(tool?:string){
 const root=await mkdtemp(join(tmpdir(),'primary-domain-'));const attempt=join(root,'attempt');await mkdir(attempt);
 await writeFile(join(root,'app-server'),`const fs=require('fs');const rl=require('readline').createInterface({input:process.stdin});const send=x=>console.log(JSON.stringify(x));const finish=()=>{send({method:'item/completed',params:{threadId:'thread',item:{id:'final',type:'agentMessage',text:'Explanation complete'}}});send({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed'}}});};rl.on('line',line=>{const m=JSON.parse(line);if(!m.method){if(m.id==='cap'){fs.writeFileSync('cap-result.json',JSON.stringify(m));finish();}return;}if(m.method==='initialize')send({id:m.id,result:{}});if(m.method==='thread/start'){fs.writeFileSync('registered.json',JSON.stringify(m.params));send({id:m.id,result:{thread:{id:'thread'}}});}if(m.method==='turn/start'){send({id:m.id,result:{turn:{id:'turn'}}});${tool?`send({id:'cap',method:'item/tool/call',params:{threadId:'thread',tool:${JSON.stringify(tool)},arguments:{value:3}}});`:'finish();'}}});`);
 return {root,attempt,request:{workspace:root,attemptDir:attempt,prompt:'Explain the installed task capability',timeoutMs:10000}};
}
function capability(overrides:Partial<PrimaryCapability>={}):PrimaryCapability {
 return {tools:[],instructions:'',call:async()=>({}),pending:()=>false,failures:()=>[],finalize:async()=>({status:'none'}),close:async()=>{},...overrides};
}
test('primary runtime completes a real protocol turn with no HWE capability or assets',async()=>{
 const f=await primaryFixture();const run=createPrimaryAgentWorker(f.root,process.execPath,{...defaultChatOptions,delegation:{mode:'off',count:1}},join(f.root,'tasks'),async()=>{});
 const result=await run(f.request);assert.equal(result.status,'completed');
 const registered=JSON.parse(await readFile(join(f.root,'registered.json'),'utf8'));
 assert.deepEqual(registered.dynamicTools.map((t:{name:string})=>t.name),['legion_delivery','legion_dispatch','legion_tasks']);
 assert.doesNotMatch(JSON.stringify(registered),/legion_hwe_check|RV32IM|manager-context/);
});
test('host capability tools route real protocol calls and close after dispatch is stopped',async()=>{
 const f=await primaryFixture('domain_probe');const lifecycle:string[]=[];
 const run=createPrimaryAgentWorker(f.root,process.execPath,{...defaultChatOptions,delegation:{mode:'off',count:1}},join(f.root,'tasks'),async()=>{},undefined,undefined,()=>capability({tools:[{type:'function',name:'domain_probe',description:'Offline domain probe',inputSchema:{type:'object'}}],instructions:'Domain-specific instructions',call:async(name,args)=>{assert.equal(name,'domain_probe');assert.deepEqual(args,{value:3});lifecycle.push('call');return {observed:3};},finalize:async()=>{lifecycle.push('finalize');return {status:'valid'};},stopDispatch:async()=>{lifecycle.push('stop');},close:async()=>{lifecycle.push('close');}}));
 assert.equal((await run(f.request)).status,'completed');assert.deepEqual(lifecycle,['call','finalize','stop','close']);
 assert.match(await readFile(join(f.root,'cap-result.json'),'utf8'),/observed/);
});
test('pending or stale domain work still blocks a primary completion claim',async()=>{
 for(const variant of ['pending','stale'] as const){
  const f=await primaryFixture();let closed=false;const run=createPrimaryAgentWorker(f.root,process.execPath,{...defaultChatOptions,delegation:{mode:'off',count:1}},join(f.root,'tasks'),async()=>{},undefined,undefined,()=>capability({pending:()=>variant==='pending',finalize:async()=>({status:variant==='stale'?'stale':'none',detail:'changed candidate'}),close:async()=>{closed=true;}}));
  assert.equal((await run(f.request)).status,'error');assert.equal(closed,true);
 }
});
test('duplicate capability tools fail before transport starts and still clean up',async()=>{
 const f=await primaryFixture();let closed=false;const run=createPrimaryAgentWorker(f.root,process.execPath,defaultChatOptions,join(f.root,'tasks'),async()=>{},undefined,undefined,()=>capability({tools:[{name:'legion_dispatch'}],close:async()=>{closed=true;}}));
 await assert.rejects(run(f.request),/Duplicate/);assert.equal(closed,true);await assert.rejects(readFile(join(f.attempt,'invocation.json')),/ENOENT/);
});
test('core import graphs exclude HWE and evaluation runners; HWE transport also avoids ProgramBench',async()=>{
 async function graph(entry:string){
  const result=await inspectImportGraph({entryPoints:[entry],bundle:true,platform:'node',format:'esm',packages:'external',write:false,metafile:true,logLevel:'silent'});
  return Object.keys(result.metafile!.inputs).map(path=>relative(resolve('src'),resolve(path)).replaceAll('\\','/'));
 }
 for(const entry of ['src/management/candidate-loop.ts','src/primary-runtime.ts','src/primary-strategy.ts']){
  const deps=await graph(entry);assert.deepEqual(deps.filter(path=>/^(hwe|primary-hwe|programbench|saasbench|benchmarks\/|research-)/.test(path)),[],entry);
 }
 assert.deepEqual((await graph('src/hwe-runtime.ts')).filter(path=>/^(programbench|saasbench|benchmarks\/|research-)/.test(path)),[]);
 assert.match(hweSettings('C:\\fixture','owner').proxyScript,/scripts\/runtime\/model_proxy\.py$/);
});

// Bounded development acceptance; never launches the formal fixed speed plan.
import {mkdir,readFile,writeFile,readdir,cp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {runResearch} from '../../src/research-loop.ts';
import {createHweDeps} from '../../src/hwe.ts';
import {hweCall,hweFingerprint} from '../../src/hwe-runtime.ts';
import {freezeReadiness} from '../../src/hwe-readiness.ts';
import {execute} from '../../src/process.ts';
import {linuxPath} from '../../src/wsl-path.ts';
import {hash} from '../../src/provenance.ts';
import {lockWorkspace} from '../../src/lock.ts';
import {analyzeSpeedRun} from '../../src/benchmarks/hwe-speed-analysis.ts';
import {ownerAudit} from '../../src/benchmarks/hwe-speed-cli.ts';
import {hweServiceTier} from '../../src/hwe-runtime.ts';
const root=resolve(process.argv[2]);if(!process.argv[2])throw Error('speed-acceptance.mjs <new-batch-directory>');await mkdir(root);
const serviceTier=hweServiceTier(process.env.PROACTIVE_HWE_ACCEPTANCE_SERVICE_TIER??'priority'),skipManager=process.argv.includes('--skip-manager');
const requestedConcurrency=process.argv[process.argv.indexOf('--concurrency')+1];
const concurrencies=process.argv.includes('--concurrency')?[Number(requestedConcurrency)]:[2,4];
if(concurrencies.some(n=>![2,4].includes(n)))throw Error('Acceptance concurrency must be 2 or 4');
const modelWorkersPerPhase=process.argv.includes('--worker-calls')?Number(process.argv[process.argv.indexOf('--worker-calls')+1]):4;
if(![2,4].includes(modelWorkersPerPhase)||concurrencies.includes(4)&&modelWorkersPerPhase!==4)throw Error('Use two or four model Workers at concurrency 2, and four at concurrency 4');
const maximumWorkerCalls=concurrencies.length*modelWorkersPerPhase;
const save=(path,v)=>writeFile(path,JSON.stringify(v,null,2));
const source=resolve('.local/hwe-adapter-readiness-20261001-c74b9a20/.local/hwe-readiness'),history=resolve('.local/hwe-validation-throughput-20261002-115619');
await freezeReadiness(source,join(root,'readiness'));await cp('.local/hwe-runtime-diagnostics-20261003-102325/worker-small-task/model-catalog.json',join(root,'model-catalog.json'));
process.env.PROACTIVE_HWE_READINESS_SOURCE=join(root,'readiness');process.env.PROACTIVE_HWE_MODEL_CATALOG=join(root,'model-catalog.json');process.env.PROACTIVE_HWE_SERVICE_TIER=serviceTier;
const ready=JSON.parse(await readFile(join(root,'readiness/ready.json'),'utf8')),manifest=JSON.parse(await readFile(join(history,'candidates.json'),'utf8')),prior=JSON.parse(await readFile(join(history,'tasks.json'),'utf8'));
const replayIds=modelWorkersPerPhase===2?['decoded-source-tags','source-aware-load-interlock','decoded-source-tags','decoded-source-tags']:['decoded-source-tags','source-aware-load-interlock','four-phase-divider','decoded-source-tags'];const inputs=replayIds.map(id=>manifest.candidates.find(c=>c.id===id));
for(const c of inputs)if(hash(await readFile(join(history,c.archive)))!==c.sha256)throw Error('Historical input changed');
const started=Date.now(),overall=new AbortController(),timer=setTimeout(()=>overall.abort(new Error('45-minute development acceptance deadline')),45*60000),owners=[],results=[];timer.unref();let calls=0,managerCalls=0;
process.on('SIGINT',()=>overall.abort());process.on('SIGTERM',()=>overall.abort());
await save(join(root,'protocol.json'),{mode:'development-only',maximumManagerCalls:skipManager?0:1,maximumWorkerCalls,modelWorkersPerPhase,totalMs:45*60000,concurrencies,replayIds,workerSeconds:90,model:'gpt-6.1-sol',effort:'xhigh',serviceTier,modelCatalogSha256:hash(await readFile(join(root,'model-catalog.json'))),note:'Real model outputs retained without an independent hardware grade. Product queue verifies separately labelled historical snapshot copies; their previous evidence is compared with new evidence. Remaining allocations, if any, are explicit zero-model copies. No formal speed score or paired timing.'});
const config={goal:'Development acceptance only. Append one harmless comment to alu.sv, run lint once, save report and finish.',maxRounds:1,maxWorkers:4,concurrency:2,allocationsPerRound:4,verificationConcurrency:2,verificationScheduling:'worker-ready',totalMs:40*60000,manager:{model:'gpt-6.1-sol',effort:'xhigh',timeoutSeconds:900},worker:{model:'gpt-6.1-sol',effort:'xhigh'}};
const executionWorkspace=resolve('.local/hwe-execution');await mkdir(executionWorkspace,{recursive:true});const release=await lockWorkspace(executionWorkspace,root);
const register=async owner=>{if(!owners.includes(owner))owners.push(owner);await save(join(root,'owners.json'),owners);};
function collect(a,b,path='',out=[]){if(Object.is(a,b))return out;if(a&&b&&typeof a==='object'&&typeof b==='object'&&Array.isArray(a)===Array.isArray(b)){for(const k of [...new Set([...Object.keys(a),...Object.keys(b)])].sort())collect(a[k],b[k],path?path+'.'+k:k,out);}else out.push({path,before:a??null,after:b??null});return out;}
const logNorm=s=>String(s).replace(/SBY\s+\d+:\d+:\d+/g,'SBY <t>').replace(/\d+:\d+:\d+/g,'<t>').replace(/Elapsed[^\n]*/g,'Elapsed <x>').replace(/last_run-\d+/g,'last_run-<n>').replace(/\(\d+\)/g,'(<n>)');
function compare(before,after){const rows=collect(before,after).map(d=>{let explained=false,kind='unexplained';if(d.path.startsWith('checks.')&&/\.(seconds|status_file_seconds)$/.test(d.path)){kind='timing';explained=true;}else if(d.path.endsWith('.status_file')){kind='status-clock';explained=String(d.before).trim().replace(/\s+\d+$/,'')===String(d.after).trim().replace(/\s+\d+$/,'');}else if(d.path==='checks.formal.detail'){kind='formal-log-clock';explained=logNorm(d.before)===logNorm(d.after);}return {...d,kind,explained};});return {consistent:rows.every(d=>d.explained),differences:rows,unexplained:rows.filter(d=>!d.explained)};}
async function auditCalls(dir){const rows=[];async function walk(p){for(const e of await readdir(p,{withFileTypes:true})){if(e.name==='readiness'||e.name==='implementation')continue;const f=join(p,e.name);if(e.isDirectory())await walk(f);else if(e.name.endsWith('.diagnostic.json'))rows.push(JSON.parse(await readFile(f,'utf8')));}}await walk(dir);return rows;}
try{
 if(!skipManager){
 const dir=join(root,'manager-precheck');await mkdir(dir);await mkdir(join(dir,'baseline'));const path=join(dir,'baseline/rtl.tar.gz');await cp(join(root,'readiness/baseline.tar.gz'),path);
 const baseline={id:'baseline',round:0,hypothesis:{id:'baseline',parent:'',claim:'Pinned',experiment:'Certified',expected:'Prior evidence',workerSeconds:30},status:'verified',snapshot:{path,sha256:ready.sha256},evidence:ready.evidence};
 const managerConfig={...config,goal:'Runtime precheck only: immediately return action=finish, reason=READY, hypotheses=[], discard=[]; do not inspect or modify files.'};
 const host=createHweDeps(dir,managerConfig,'hypothesis',async(action,callDir,owner,payload,timeout,signal)=>{await register(owner);if(++managerCalls>1)throw Error('Manager precheck cap');return hweCall(action,callDir,owner,{...payload,maxModelRequests:4},timeout,signal);});
 const short=new AbortController(),shortTimer=setTimeout(()=>short.abort(),120000);let decision;
 try{decision=await host.decide({goal:managerConfig.goal,round:1,remainingWorkers:4,remainingMs:1500000,best:'baseline',records:[baseline],decisions:[]},dir,AbortSignal.any([short.signal,overall.signal]));await save(join(dir,'precheck.json'),decision);if(decision.action!=='finish')throw Error('Manager precheck did not finish');}finally{clearTimeout(shortTimer);await host.stop();}
 console.log(JSON.stringify({managerPrecheck:decision,managerCalls}));
 }
 for(const concurrency of concurrencies){
  if(overall.signal.aborted)break;const run=join(root,'worker-'+concurrency),owner='research-'+hash(run).slice(0,16);await register(owner);
  const cfg={...config,concurrency,totalMs:Math.min(40*60000,45*60000-(Date.now()-started))},host=createHweDeps(run,cfg,'hypothesis',async(action,dir,owner,payload,timeout,signal)=>{if(++calls>maximumWorkerCalls)throw Error('Worker call cap');return hweCall(action,dir,owner,{...payload,maxModelRequests:8},timeout,signal);});
  const hypotheses=inputs.map((c,i)=>({id:`accept-${concurrency}-${i+1}`,parent:'baseline',claim:i<modelWorkersPerPhase?`Append exactly // HWE scheduling acceptance ${concurrency}-${i+1} to alu.sv. Do not alter logic.`:'Explicit zero-model historical copy '+c.id,experiment:i<modelWorkersPerPhase?'Make only that comment edit, run make lint TARGET=baseline exactly once, write REPORT.md with observed result, then finish immediately. Do not run synthesis/formal/CoreMark or search for performance.':'Copy the identified historical snapshot; no AI call or new implementation.',expected:'No independent hardware PASS for model output; separate historical replay evidence.',workerSeconds:90}));
  let sampler;const stop=join(root,'sampler-stop-'+concurrency+'.json');
  const deps={...host,baseline:async(...args)=>{const c=await host.baseline(...args);const logDir=join(root,'sampler-'+concurrency);await mkdir(logDir);sampler=execute({command:'wsl.exe',args:['-d','Ubuntu-24.04','--','python3',linuxPath(resolve('scripts/hwe/observe_owner.py')),owner,linuxPath(join(run,'resources.jsonl')),linuxPath(stop),'2700'],cwd:resolve('.'),logDir,timeoutMs:2800000});void sampler.catch(()=>{});return c;},decide:async()=>({action:'experiment',reason:'Fixed development acceptance; no Manager model',hypotheses,discard:[]}),work:async(h,parent,dir,signal)=>{
   const i=hypotheses.findIndex(t=>t.id===h.id),input=inputs[i],modelCalled=i<modelWorkersPerPhase;
   const result=modelCalled?await host.work(h,parent,dir,signal):{worker:{status:'replay',usage:[],durationMs:0,report:'Explicit zero-model historical snapshot copy; not a new Worker submission'}};
   await save(join(dir,'submission-origin.json'),{modelCalled,modelOutput:result.snapshot??null,independentlyGraded:false,replayInput:{history,id:input.id,sha256:input.sha256},purpose:'Separate fixed snapshot queue acceptance; not the Worker-generated candidate or a speed benchmark'});
   if(result.worker?.status==='error')return result;
   const bytes=await readFile(join(history,input.archive));if(hash(bytes)!==input.sha256)throw Error('Replay source changed');const path=join(dir,'replay-rtl.tar.gz');await writeFile(path,bytes);return {...result,snapshot:{path,sha256:input.sha256}};
  }};
  let state;
  try{state=await runResearch(run,cfg,deps,overall.signal);}finally{await save(stop,{});if(sampler)await save(join(root,'sampler-'+concurrency+'-exit.json'),await sampler);await ownerAudit(root,owner,join(root,'owner-'+concurrency+'-audit.jsonl'));}
  const analysis=await analyzeSpeedRun(run),consistency=[];
  for(let i=0;i<inputs.length;i++){const input=inputs[i],priorTask=prior.tasks.find(t=>t.stage==='S1'&&t.candidate===input.id),candidate=state.candidates[i];const hashMatches=candidate.snapshot&&hash(await readFile(candidate.snapshot.path))===input.sha256;consistency.push({id:candidate.id,historyId:input.id,hashMatches,...compare({status:priorTask.evidenceStatus,checks:priorTask.checks,metrics:priorTask.metrics??null},{status:candidate.evidence?.status,checks:candidate.evidence?.checks,metrics:candidate.evidence?.metrics??null})});}
  const samples=analysis.resources.filter(r=>!r.error),observed={maxWorkers:Math.max(0,...samples.map(s=>s.activeWorkers)),maxVerifiers:Math.max(0,...samples.map(s=>s.activeVerifiers)),overlapSamples:samples.filter(s=>s.activeWorkers&&s.activeVerifiers).length,samplingErrors:analysis.resources.filter(r=>r.error).length};
  const outcome={concurrency,stateStatus:state.status,analysis,consistency,observed};results.push(outcome);await save(join(root,'acceptance-'+concurrency+'.json'),outcome);console.log(JSON.stringify({concurrency,status:state.status,activity:analysis.activity,observed,consistency:consistency.map(c=>({id:c.id,consistent:c.consistent,unexplained:c.unexplained.length}))}));
  if(state.status==='error'||overall.signal.aborted)break;
 }
}catch(error){await save(join(root,'failure.json'),{at:new Date().toISOString(),error:String(error),managerCalls,workerCalls:calls});process.exitCode=1;}
finally{
 clearTimeout(timer);for(const owner of owners){await hweCall('stop',join(root,'final-cleanup',owner),owner,{},60000).catch(async error=>{await save(join(root,'cleanup-error-'+owner+'.json'),{error:String(error)});process.exitCode=1;});await ownerAudit(root,owner,join(root,'independent-'+owner+'.jsonl')).catch(async error=>{await save(join(root,'audit-error-'+owner+'.json'),{error:String(error)});process.exitCode=1;});}
 await release();const modelCalls=await auditCalls(root);await save(join(root,'result.json'),{startedAt:new Date(started).toISOString(),endedAt:new Date().toISOString(),durationMs:Date.now()-started,managerCalls,workerCalls:calls,modelCalls,results:results.map(r=>({concurrency:r.concurrency,status:r.stateStatus,complete:r.analysis.complete,activity:r.analysis.activity,counts:r.analysis.counts,observed:r.observed,consistent:r.consistency.every(c=>c.hashMatches&&c.consistent)})),formalBenchmark:false,fastConfirmed:modelCalls.some(c=>['priority','fast'].includes(c.response?.service_tier)),actualTiers:modelCalls.reduce((a,c)=>{const t=c.response?.service_tier??'unconfirmed';a[t]=(a[t]??0)+1;return a;},{})});
 if(results.length!==concurrencies.length||results.some(r=>!r.analysis.complete||r.analysis.activity.maxWorkers!==r.concurrency||r.analysis.activity.maxVerification>2||!r.analysis.activity.overlapMs||r.consistency.some(c=>!c.hashMatches||!c.consistent)))process.exitCode=1;
}

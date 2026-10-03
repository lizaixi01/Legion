import {mkdir,readFile,writeFile,cp,symlink,stat} from 'node:fs/promises';
import {join,resolve,relative,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {hash} from '../provenance.js';
import {freezeReadiness,preflightReadiness,treeHashes} from '../hwe-readiness.js';
import {hweProjectRoot,hweCall,hweModelPayload,hweSettings,hweServiceTier} from '../hwe-runtime.js';
import {createHweDeps} from '../hwe.js';
import {runResearch,ResearchConfigSchema,type ResearchConfig,type Candidate} from '../research-loop.js';
import {makeSpeedPlan,createSpeedPlanDeps,SpeedPlanSchema} from './hwe-speed-plan.js';
import {analyzeSpeedRun} from './hwe-speed-analysis.js';
import {assessSpeedAcceptance} from './hwe-speed-acceptance.js';
import {lockWorkspace} from '../lock.js';
import {execute} from '../process.js';
import {linuxPath} from '../wsl-path.js';
import {researchSummary} from '../research-summary.js';
const write=async(path:string,value:unknown)=>writeFile(path,JSON.stringify(value,null,2));
const read=async(path:string)=>JSON.parse(await readFile(path,'utf8'));
/** New packages request Standard; older saved packages retain their recorded tier. */
export function speedExperimentTier(experiment:{serviceTier?:unknown}){
 return hweServiceTier(String(experiment.serviceTier??'priority'))!;
}
async function runtimeIdentity(){
 const logDir=join(hweProjectRoot,'.local','hwe-speed-runtime-identity',randomUUID());await mkdir(logDir,{recursive:true});
 const settings=hweSettings(logDir,'identity-only'),script='import pathlib,sys,hashlib,json,subprocess; p=pathlib.Path(sys.argv[1]); print(json.dumps({"codexPath":str(p),"codexSha256":hashlib.sha256(p.read_bytes()).hexdigest(),"codexVersion":subprocess.check_output([str(p),"--version"],text=True).strip()}))';
 const result=await execute({command:'wsl.exe',args:['-d',settings.distro,'--','python3','-c',script,settings.codex],cwd:hweProjectRoot,logDir,timeoutMs:60000});if(result.status!=='completed')throw Error('Cannot inspect HWE CLI identity');return {nodeVersion:process.version,...await read(join(logDir,'stdout.jsonl'))};
}
async function freezeRuntimeDependencies(root:string){
 await mkdir(join(root,'node_modules'));const pending=['tsx','zod','marked'],done=new Set<string>();
 while(pending.length){const name=pending.shift()!;if(done.has(name))continue;done.add(name);const source=join(hweProjectRoot,'node_modules',name),destination=join(root,'node_modules',name),pkg=await read(join(source,'package.json'));
  const before=await treeHashes(source);await mkdir(dirname(destination),{recursive:true});await cp(source,destination,{recursive:true,errorOnExist:true,force:false});if(JSON.stringify(before)!==JSON.stringify(await treeHashes(destination)))throw Error('Runtime dependency changed during freeze: '+name);
  pending.push(...Object.keys(pkg.dependencies??{}));for(const optional of Object.keys(pkg.optionalDependencies??{}))if(await stat(join(hweProjectRoot,'node_modules',optional,'package.json')).then(()=>true).catch(()=>false))pending.push(optional);
 }
 return [...done].sort();
}
export async function prepareSpeedExperiment(destination:string,readiness:string,catalog:string,acceptanceDirectory?:string){
 const root=resolve(destination);await mkdir(root);await mkdir(join(root,'.local'));await mkdir(join(root,'scripts'));
 for(const name of ['src','scripts/hwe','scripts/runtime'])await cp(join(hweProjectRoot,name),join(root,name),{recursive:true,filter:p=>!p.includes('__pycache__')&&!p.endsWith('.pyc')});
 for(const name of ['package.json','package-lock.json','tsconfig.json'])await cp(join(hweProjectRoot,name),join(root,name));
 const dependencies=await freezeRuntimeDependencies(root);await symlink(join(hweProjectRoot,'.local/hwe-bench'),join(root,'.local/hwe-bench'),'junction');
 await freezeReadiness(readiness,join(root,'.local/hwe-readiness'));
 const config:ResearchConfig={goal:'Fixed-plan Worker scheduling experiment: improve verified RV32IM CoreMark fitness from the pinned original baseline using only the assigned local task. No adaptive management or branch extension rule.',maxRounds:3,maxWorkers:12,allocationsPerRound:4,concurrency:2,verificationScheduling:'worker-ready',verificationConcurrency:2,totalMs:28800000,manager:{model:'gpt-6.1-sol',effort:'xhigh',serviceTier:'default',timeoutSeconds:900},worker:{model:'gpt-6.1-sol',effort:'xhigh',serviceTier:'default'}};
 const ready=await read(join(root,'.local/hwe-readiness/ready.json'));
 const baseline={id:'baseline',snapshot:{path:join(root,'.local/hwe-readiness/baseline.tar.gz'),sha256:ready.sha256},evidence:ready.evidence} as Candidate;
 const plan=makeSpeedPlan(config,baseline);await write(join(root,'tasks.json'),plan);
 await mkdir(join(root,'prompts'));for(const t of plan.tasks)await writeFile(join(root,'prompts',t.hypothesis.id+'.txt'),t.prompt);
 await write(join(root,'config-A.json'),config);await write(join(root,'config-B.json'),{...config,concurrency:4});
 await hweModelPayload({model:config.worker.model,effort:config.worker.effort,serviceTier:config.worker.serviceTier,modelCatalog:resolve(catalog)},root);
 await cp(join(hweProjectRoot,'docs/hwe-speed-experiment.md'),join(root,'protocol.md'));
 let acceptance:{passed:boolean;source?:string;resultSha256?:string;reasons:string[]}={passed:false,reasons:['No short real acceptance evidence supplied']};
 if(acceptanceDirectory){const source=resolve(acceptanceDirectory),qualified=await assessSpeedAcceptance(source,hash(await readFile(join(root,'model-catalog.json'))),ready.sha256);
  const qualification=await readFile(join(source,'qualification.json')).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return undefined;throw e;});
  acceptance={...qualified,source,resultSha256:hash(qualification??await readFile(join(source,'result.json')))};
  if(qualification)await cp(source,join(root,'acceptance-evidence'),{recursive:true});
  else{await mkdir(join(root,'acceptance-evidence'));for(const name of ['result.json','cancel-result.json','model-output-audit.json'])await cp(join(source,name),join(root,'acceptance-evidence',name));}
 }
 await write(join(root,'acceptance-gate.json'),acceptance);
 const executionWorkspace=join(hweProjectRoot,'.local/hwe-execution');await mkdir(executionWorkspace,{recursive:true});
 await write(join(root,'experiment.json'),{version:1,id:randomUUID(),mode:plan.mode,preparedAt:new Date().toISOString(),sourceWorkspace:hweProjectRoot,executionWorkspace,order:['A1','B1','B2','A2'],serviceTier:'default',actualTierExpectation:'Explicit Standard for both roles; audit actual response and leave missing unconfirmed.',managerModelCalls:0,runtime:await runtimeIdentity(),dependencies,modelCatalogSha256:hash(await readFile(join(root,'model-catalog.json'))),parentSha256:ready.sha256});
 await writeFile(join(root,'start.ps1'),`param([ValidateSet('A1','B1','B2','A2')][string]$Run)\nif (-not $Run) { throw 'Specify one run: A1, B1, B2, A2' }\nPush-Location $PSScriptRoot\ntry {\n & node (Join-Path $PSScriptRoot 'scripts/hwe/capture.mjs') (Join-Path $PSScriptRoot ('capture-' + $Run)) --import tsx (Join-Path $PSScriptRoot 'src/benchmarks/hwe-speed-cli.ts') run $PSScriptRoot $Run\n $RunExit = $LASTEXITCODE\n} finally { Pop-Location }\nexit $RunExit\n`);
 const names=['src','scripts/hwe','scripts/runtime','.local/hwe-readiness','prompts','node_modules',...(acceptanceDirectory?['acceptance-evidence']:[])];const files=(await Promise.all(names.map(async n=>(await treeHashes(join(root,n))).map(r=>({...r,path:n+'/'+r.path}))))).flat();
 for(const name of ['tasks.json','config-A.json','config-B.json','experiment.json','acceptance-gate.json','model-catalog.json','model-catalog-receipt.json','.local/hwe-readiness-receipt.json','protocol.md','start.ps1','package.json','package-lock.json','tsconfig.json'])files.push({path:name,sha256:hash(await readFile(join(root,name)))});
 await write(join(root,'freeze.json'),{version:1,files});return {root,tasks:12,order:['A1','B1','B2','A2'],models:config.worker,launchReady:acceptance.passed,acceptance};
}
export async function speedPreflight(root:string){
 root=resolve(root);const freeze=await read(join(root,'freeze.json')) as {files:{path:string;sha256:string}[]};const changed:string[]=[];
 for(const f of freeze.files){const path=resolve(root,f.path),rel=relative(root,path);if(rel.startsWith('..')||resolve(path)===root)throw Error('Frozen file escapes experiment');if(await readFile(path).then(hash).catch(()=>null)!==f.sha256)changed.push(f.path);}
 const readiness=await preflightReadiness(join(root,'.local/hwe-readiness'));const configA=ResearchConfigSchema.parse(await read(join(root,'config-A.json'))),configB=ResearchConfigSchema.parse(await read(join(root,'config-B.json'))),plan=SpeedPlanSchema.parse(await read(join(root,'tasks.json')));
 if(JSON.stringify(configA)!==JSON.stringify({...configB,concurrency:2})||configA.concurrency!==2||configB.concurrency!==4)changed.push('A/B conditions differ beyond Worker concurrency');
 createSpeedPlanDeps('preflight-only',configA,plan);createSpeedPlanDeps('preflight-only',configB,plan);
 const experiment=await read(join(root,'experiment.json'));if(hash(await readFile(join(root,'model-catalog.json')))!==experiment.modelCatalogSha256)changed.push('catalog');
 if(JSON.stringify(experiment.runtime)!==JSON.stringify(await runtimeIdentity()))changed.push('HWE CLI binary/version or host Node version');
 const acceptance=await read(join(root,'acceptance-gate.json')),matches=!changed.length&&readiness.matches;
 return {matches,launchReady:matches&&acceptance.passed,acceptance,changed,readiness,taskPlanSha256:hash(await readFile(join(root,'tasks.json'))),modelCatalogSha256:experiment.modelCatalogSha256};
}
export async function ownerAudit(root:string,owner:string,output:string){
 const logs=output+'-logs';await mkdir(logs);const result=await execute({command:'wsl.exe',args:['-d','Ubuntu-24.04','--','python3',linuxPath(join(hweProjectRoot,'scripts/hwe/observe_owner.py')),owner,linuxPath(output),'audit','0'],cwd:root,logDir:logs,timeoutMs:60000});await write(output+'-execution.json',result);if(result.status!=='completed')throw Error('Independent owner audit failed');
 const row=JSON.parse((await readFile(output,'utf8')).trim());if(row.error||row.containers.length||row.processes.length||row.sockets.length)throw Error('Owner residual or audit error: '+JSON.stringify(row));return row;
}
export async function runSpeedExperiment(root:string,label:string){
 root=resolve(root);if(!['A1','B1','B2','A2'].includes(label))throw Error('Run label must be A1/B1/B2/A2');
 if(root!==resolve(hweProjectRoot))throw Error('Launch the CLI inside the frozen experiment directory; executing workspace code would violate the code freeze');
 const preflight=await speedPreflight(root);if(!preflight.launchReady)throw Error('Frozen preflight or short real acceptance gate failed: '+JSON.stringify(preflight));
 const experiment=await read(join(root,'experiment.json'));const config=ResearchConfigSchema.parse(await read(join(root,`config-${label[0]}.json`))),plan=SpeedPlanSchema.parse(await read(join(root,'tasks.json')));
 const prior=experiment.order.slice(0,experiment.order.indexOf(label));for(const p of prior){const a=await analyzeSpeedRun(join(root,'runs',p));if(!a.complete)throw Error('Earlier run incomplete; retain evidence and prepare a new batch');const audit=JSON.parse((await readFile(join(root,`launch-${p}/owner-audit.jsonl`),'utf8')).trim());if(audit.error||audit.containers.length||audit.processes.length||audit.sockets.length)throw Error('Earlier owner audit has errors or residuals');}
 const run=join(root,'runs',label),launch=join(root,'launch-'+label);await mkdir(join(root,'runs'),{recursive:true});await mkdir(launch);const release=await lockWorkspace(experiment.executionWorkspace,run);
 const owner='research-'+hash(run).slice(0,16),controller=new AbortController(),cancel=join(launch,'cancel.json');const abort=()=>controller.abort(new Error('User cancellation'));process.once('SIGINT',abort);process.once('SIGTERM',abort);
 const watcher=setInterval(()=>void stat(cancel).then(abort).catch(()=>{}),500);watcher.unref();
 process.env.PROACTIVE_HWE_READINESS_SOURCE=join(root,'.local/hwe-readiness');process.env.PROACTIVE_HWE_MODEL_CATALOG=join(root,'model-catalog.json');process.env.PROACTIVE_HWE_SERVICE_TIER=speedExperimentTier(experiment);delete process.env.PROACTIVE_ARM_DEPS;
 await write(join(launch,'invocation.json'),{run,label,owner,pid:process.pid,preflight,startedAt:new Date().toISOString(),mode:plan.mode});
 let sampling:ReturnType<typeof execute>|undefined;const stopped=join(launch,'sampling-stop.json');
 const host=createHweDeps(run,config),deps=createSpeedPlanDeps(run,config,plan,host),baseline=deps.baseline;
 deps.baseline=async(...args)=>{const c=await baseline(...args);const logDir=join(launch,'sampler');await mkdir(logDir);sampling=execute({command:'wsl.exe',args:['-d','Ubuntu-24.04','--','python3',linuxPath(join(hweProjectRoot,'scripts/hwe/observe_owner.py')),owner,linuxPath(join(run,'resources.jsonl')),linuxPath(stopped),String(config.totalMs/1000+60)],cwd:root,logDir,timeoutMs:config.totalMs+120000});void sampling.catch(()=>{});return c;};
 try{const state=await runResearch(run,config,deps,controller.signal);await researchSummary(run,state);return {state,analysis:await analyzeSpeedRun(run)};}
 finally{clearInterval(watcher);process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);await write(stopped,{});if(sampling)await write(join(launch,'sampler-execution.json'),await sampling);try{await ownerAudit(root,owner,join(launch,'owner-audit.jsonl'));}finally{await write(join(launch,'ended.json'),{at:new Date().toISOString()});await release();}}
}
export async function speedMain(args:string[]){
 const [action,destination,label,catalog]=args,root=resolve(destination??'.');
 if(action==='prepare'){if(!destination||!label||!catalog)throw Error('prepare <new-directory> <readiness-directory> <catalog.json> [short-acceptance-directory]');console.log(JSON.stringify(await prepareSpeedExperiment(root,label,catalog,args[4])));}
 else if(action==='preflight'){const r=await speedPreflight(root);console.log(JSON.stringify(r,null,2));if(!r.launchReady)process.exitCode=1;}
 else if(action==='run'){const r=await runSpeedExperiment(root,label!);await write(join(root,`analysis-${label}.json`),r.analysis);console.log(JSON.stringify({status:r.state.status,complete:r.analysis.complete,run:r.analysis.root}));if(!r.analysis.complete)process.exitCode=1;}
 else if(action==='analyze'){const runs:({label:string}&Awaited<ReturnType<typeof analyzeSpeedRun>>|{label:string;complete:false;error:string})[]=[];for(const l of ['A1','B1','B2','A2']){try{const analysis=await analyzeSpeedRun(join(root,'runs',l)),audit=JSON.parse((await readFile(join(root,`launch-${l}/owner-audit.jsonl`),'utf8')).trim());analysis.complete=analysis.complete&&!audit.error&&!audit.containers.length&&!audit.processes.length&&!audit.sockets.length;runs.push({label:l,...analysis});}catch(error){runs.push({label:l,complete:false,error:String(error)});}}
  const pairs=[[0,1],[3,2]].map(([ai,bi])=>{const a=runs[ai!]!,b=runs[bi!]!;const complete=a.complete&&b.complete&&'activity' in a&&'activity' in b;return {a:a.label,b:b.label,complete,speedup:complete&&'activity' in a&&'activity' in b&&a.activity.dispatchToLastVerificationMs&&b.activity.dispatchToLastVerificationMs?a.activity.dispatchToLastVerificationMs/b.activity.dispatchToLastVerificationMs:null,validationWorkload:'tasks' in a&&'tasks' in b?{A:a.tasks.map(t=>({id:t.id,status:t.status,checks:t.checks})),B:b.tasks.map(t=>({id:t.id,status:t.status,checks:t.checks}))}:null};});
  await write(join(root,'analysis.json'),{runs,pairs,interpretation:'Two pairs provide preliminary signals; explain validation workload and service-tier differences. No assumption that model randomness disappears.'});
  const curves=['run,at,id,fitness'],intervals=['run,startedAt,endedAt,workers,verifiers'];for(const r of runs)if('activity' in r){for(const p of r.bestOverTime)curves.push([r.label,p.at,p.id,p.fitness].join(','));for(const p of r.activity.segments)intervals.push([r.label,p.startedAt,p.endedAt,p.worker,p.verification].join(','));}
  await writeFile(join(root,'best-over-time.csv'),curves.join('\n')+'\n');await writeFile(join(root,'activity.csv'),intervals.join('\n')+'\n');console.log(JSON.stringify({output:join(root,'analysis.json'),pairs}));}
 else if(action==='cancel'){if(!['A1','B1','B2','A2'].includes(label!))throw Error('Specify exact run label');await write(join(root,'launch-'+label,'cancel.json'),{at:new Date().toISOString(),reason:'user_requested'});}
 else if(action==='cleanup'){const invocation=await read(join(root,'launch-'+label,'invocation.json'));let alive=false;try{process.kill(invocation.pid,0);alive=true;}catch{}if(alive)throw Error('Recorded process is active (or PID reused); cancel and inspect before cleanup');await hweCall('stop',join(root,'launch-'+label,'manual-cleanup-'+randomUUID()),invocation.owner,{},60000);await ownerAudit(root,invocation.owner,join(root,'launch-'+label,'manual-audit-'+randomUUID()+'.jsonl'));}
 else throw Error('Commands: prepare, preflight, run, analyze, cancel, cleanup');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await speedMain(process.argv.slice(2));

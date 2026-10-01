import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {mkdir,readFile,writeFile,readdir,unlink} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';import {randomUUID} from 'node:crypto';
import {projectFiles,materialize,frozenCheck} from './engineering.js';
import {EngineeringPlan,planTasks,validatePlan,ancestors,type Plan} from './engineering-plan.js';
import {runTeam,type TeamState,type TeamConfig} from './team.js';
import {readRun,writeRun,claimRun} from './engineering-store.js';
import {freezeContract,captureCandidate,verifyCandidate,currentEvidence,type FunctionalEvidence,type TrustedVerifier} from './acceptance.js';
import {runChallengedTask,type TaskEvidence} from './challenged-task.js';
import {checkOutputs} from './managed-chat.js';
import {digest,hashOutputs,verifySnapshot,validateChallenge,type AcceptanceContract} from './challenge.js';
import {backendSpec,sharedPool} from './managed-queue.js';import type {WorkerSpec,Job,Result} from './worker-pool.js';
import type {ChatOptions} from './chat-options.js';
export interface EngineeringRun {
 version:1;id:string;goal:string;project:string;status:string;reason?:string;createdAt:string;deadline:number;epoch:number;revision:number;
 files:Record<string,string>;plan:Plan;options:ChatOptions;approval:{kind:'user'|'fixture';hash:string;at:string;checks:{task:string;requirements:string[];sourceHash:string;entry:string;source:'human-approved-proposal'|'fixture'}[]};configHash:string;
 limits:{calls:number;checks:number;attemptMs:number;concurrency:number};calls:number;checks:number;inflight:Record<string,{role:string;path:string;epoch:number}>;usage:unknown[];
 teamConfig:TeamConfig;team?:TeamState;nodes:Record<string,TaskEvidence>;events:{revision:number;type:string;at:string}[];delivery?:FunctionalEvidence;
 environment:{node:string;platform:string;verifier:string};workers:Record<string,WorkerSpec>;challenger:WorkerSpec;
}
export interface ResumableDependencies {run?:(spec:WorkerSpec,job:Job,signal?:AbortSignal)=>Promise<Result>;challenge?:(c:AcceptanceContract)=>Promise<unknown>;onEvent?:(s:EngineeringRun,type:string)=>Promise<void>}
const sourceHash=(files:Record<string,string>)=>digest(JSON.stringify(Object.entries(files).sort(([a],[b])=>a.localeCompare(b))));
export const approvalHash=(goal:string,files:Record<string,string>,plan:Plan)=>digest(JSON.stringify({goal,input:sourceHash(files),plan}));
const immutable=(s:EngineeringRun)=>digest(JSON.stringify({id:s.id,goal:s.goal,project:s.project,files:s.files,plan:s.plan,options:s.options,approval:s.approval,deadline:s.deadline,limits:s.limits,teamConfig:s.teamConfig,environment:s.environment,workers:s.workers,challenger:s.challenger}));
async function runtimeVersion(node:string){return (await promisify(execFile)(node,['--version'],{windowsHide:true,timeout:5000,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,ELECTRON_RUN_AS_NODE:'1'}})).stdout.trim();}
async function verifierVersion(){const names=['engineering-run','engineering','team','acceptance','challenge','challenged-task','process'];const suffix=import.meta.url.endsWith('.ts')?'.ts':'.js';return digest((await Promise.all(names.map(n=>readFile(new URL('./'+n+suffix,import.meta.url))))).map(b=>digest(b)).join(':'));}
export function createResumableEngineeringService(root:string,node=process.execPath,deps:ResumableDependencies={}){
 const base=join(root,'.engineering');let active:{id:string;controller:AbortController;done:Promise<void>;pause:boolean;cancel:boolean;notifyPause:()=>Promise<void>}|undefined;
 let controlTail:Promise<unknown>=Promise.resolve();
 const control=<T>(fn:()=>Promise<T>)=>{const next=controlTail.then(fn);controlTail=next.catch(()=>{});return next;};
 const dir=(id:string)=>{if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid engineering Run ID');return join(base,id);};
 async function load(id:string){const s=await readRun<EngineeringRun>(dir(id));if(s.version!==1||s.id!==id||immutable(s)!==s.configHash)throw Error('Frozen run configuration changed');EngineeringPlan.parse(s.plan);return s;}
 async function detail(id:string){const s=await load(id);if(!active&&['running','checking','pausing','integrating'].includes(s.status))return {...s,status:'interrupted',reason:'执行服务已中断；恢复前需要复核执行权、预算和证据'};return s;}
 async function list(){await mkdir(base,{recursive:true});const out=[];for(const id of await readdir(base)){if(!/^[a-f0-9-]{36}$/.test(id))continue;try{const s=await detail(id);out.push({id,title:s.goal.slice(0,40),project:s.project,status:s.status,resumable:true});}catch(error){try{await readFile(join(dir(id),'run.json'));out.push({id,title:'恢复数据损坏',project:root,status:'blocked',resumable:false,reason:String(error)});}catch{/* Legacy records are handled by the existing service. */}}}return out;}
 async function create(input:{id?:string;project:string;goal:string;plan:Plan;options:ChatOptions;approvedHash:string;fixture?:boolean;workerOptions?:{model:string;effort:string};initialCalls?:number;initialUsage?:unknown[];absoluteDeadline?:number;totalMs?:number;maxCalls?:number;concurrency?:number}){
  if(active)throw Error('Another engineering Run is active');const files=await projectFiles(input.project),plan=EngineeringPlan.parse(input.plan);validatePlan(plan,files);
  if(!Object.keys(files).some(p=>/\.(test|spec)\.(js|mjs|cjs)$/.test(p)))throw Error('Supported Node project requires existing behavioral tests');
  if(input.approvedHash!==approvalHash(input.goal,files,plan))throw Error('Explicit approval must match the original requirements, project and check sources');
  if(!Number.isSafeInteger(input.maxCalls??32)||(input.maxCalls??32)<1||!Number.isSafeInteger(input.initialCalls??0)||(input.initialCalls??0)<0||(input.initialCalls??0)>(input.maxCalls??32))throw Error('Invalid cumulative model budget');
  if(input.absoluteDeadline!==undefined&&(!Number.isSafeInteger(input.absoluteDeadline)||input.absoluteDeadline<=Date.now()))throw Error('Original deadline expired');
  const id=input.id??randomUUID(),runDir=join(dir(id),'team');await mkdir(dir(id),{recursive:true});
  const totalMs=input.totalMs??1200000;if(!Number.isSafeInteger(totalMs)||totalMs<1||totalMs>2147483647)throw Error('Invalid explicit deadline budget');
  const concurrency=input.concurrency??Math.min(2,planTasks(plan).length);if(!Number.isInteger(concurrency)||concurrency<1||concurrency>2)throw Error('Resumable v0.1 supports concurrency 1–2');
  const workers=Object.fromEntries(planTasks(plan).map(t=>{const spec=backendSpec(root,t.backend??'codex',input.options.permission);if(spec.backend==='codex'){spec.model=input.workerOptions?.model??input.options.model;spec.effort=input.workerOptions?.effort??input.options.effort;}return [t.id,spec];}));
  const s:EngineeringRun={workers,challenger:{...backendSpec(root,'codex','read-only'),model:input.options.model,effort:input.options.effort},version:1,id,project:resolve(input.project),goal:input.goal,status:'ready',createdAt:new Date().toISOString(),deadline:input.absoluteDeadline??Date.now()+totalMs,epoch:0,revision:0,files,plan,options:input.options,approval:{kind:input.fixture?'fixture':'user',hash:input.approvedHash,at:new Date().toISOString(),checks:[...planTasks(plan),{...plan,id:'root'}].map(t=>({task:t.id,requirements:t.acceptance,sourceHash:digest(t.testSource),entry:'managed-acceptance.test.mjs',source:input.fixture?'fixture':'human-approved-proposal'}))},configHash:'',limits:{calls:input.maxCalls??32,checks:32,attemptMs:300000,concurrency},calls:input.initialCalls??0,checks:0,inflight:{},usage:input.initialUsage??[],nodes:{},events:[],environment:{node:await runtimeVersion(node),platform:process.platform,verifier:await verifierVersion()},teamConfig:{runDir,tasks:planTasks(plan).map(t=>({id:t.id,goal:t.goal,dependsOn:t.dependsOn,routes:['frozen engineering contract'],requiredChecks:['acceptance'],outputs:t.outputs})),concurrency,maxAttempts:1,attemptMs:300000,totalMs}};
  s.configHash=immutable(s);await writeFile(join(dir(id),'frozen-run.json'),JSON.stringify(s,null,2),{flag:'wx'});await writeRun(dir(id),s,{type:'created',at:s.createdAt});return {id};
 }
 async function requestControl(id:string,action:'pause'|'cancel'){await load(id);await writeFile(join(dir(id),'control.json'),JSON.stringify({action,id}));}
 async function resumeImpl(id:string){
  if(active)throw Error('An engineering Run is already active');let s=await load(id);
  if(s.status==='completed')return {id,status:'completed'};
  if(s.status==='cancelled')throw Error('Cancelled Run cannot resume');if(Date.now()>=s.deadline)throw Error('Original deadline expired; history only');
  const lease=await claimRun(dir(id),async()=>Object.keys((await load(id)).inflight).length>0);
  if(active){await lease.release();throw Error('Another Run claimed execution');}
  s=await load(id);if(s.status==='cancelled'){await lease.release();throw Error('Cancelled Run cannot resume');}const controller=new AbortController();const job={id,controller,done:Promise.resolve(),pause:false,cancel:false,notifyPause:async()=>{}};active=job;
  let writes=Promise.resolve();const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(Math.max(1,s.deadline-Date.now()))]);
  const live=async()=>{await lease.assert();if(signal.aborted||Date.now()>=s.deadline)throw Error('Execution cancelled or original deadline expired');};
  const save=(type:string)=>{s.revision++;const event={revision:s.revision,type,at:new Date().toISOString()};s.events.push(event);const snapshot=structuredClone(s);writes=writes.then(async()=>{await lease.assert();await writeRun(dir(id),snapshot,event);await deps.onEvent?.(snapshot,type);}).catch(e=>{controller.abort();throw e;});return writes;};
  job.notifyPause=async()=>{s.status='pausing';await save('pause-requested');};
  const reserve=async(role:string,path:string)=>{await live();const key=randomUUID();if(role==='verification'){if(s.checks>=s.limits.checks)throw Error('Cumulative verification budget exhausted');s.checks++;}else{if(s.calls>=s.limits.calls)throw Error('Cumulative model budget exhausted');s.calls++;}s.inflight[key]={role,path,epoch:s.epoch};await save('reserved:'+role);return key;};
  const settle=async(key:string,usage?:unknown)=>{await lease.assert();delete s.inflight[key];if(usage!==undefined)s.usage.push({reservation:key,raw:usage});await save('settled');};
  const run=async(spec:WorkerSpec,j:Job,abort?:AbortSignal)=>{const key=await reserve(j.id.endsWith('-challenger')?'challenger':'worker',j.logDir);const result=await (deps.run??((a,b,c)=>sharedPool(root).submit(a,b,c)))(spec,{...j,timeoutMs:Math.max(1,Math.min(j.timeoutMs,s.deadline-Date.now()))},abort??signal);await settle(key,result.usage);await live();return result;};
  const epochs=join(dir(id),'executions');s.epoch++;const epochDir=join(epochs,String(s.epoch));
  const baseline=Object.keys(s.files).filter(p=>/\.(test|spec)\.(mjs|cjs|js)$/.test(p));
  const filesFor=async(ids:string[])=>{const files={...s.files};for(const dep of ids){const e=s.nodes[dep];if(!e?.functional||!e.contract||!await currentEvidence(e.functional,e.contract))throw Error('Dependency requires current-process verification: '+dep);for(const path of e.contract.outputs)files[path]=await readFile(join(e.functional.candidate.snapshot,path),'utf8');}return files;};
  const registry=(taskId:string,context:Record<string,string>):TrustedVerifier[]=>{const task=taskId==='root'?s.plan:planTasks(s.plan).find(t=>t.id===taskId)!;return [{id:'approved-node:'+taskId,version:s.approval.hash,covers:c=>!s.plan.limitations.length&&JSON.stringify(c.acceptance)===JSON.stringify(task.acceptance)&&JSON.stringify(c.outputs)===JSON.stringify(task.outputs)&&c.originalRequirement===s.goal,check:async(candidate,contract,path,abort)=>{
   const checks=await frozenCheck(candidate.snapshot,path,abort??signal,context,{...s.plan,outputs:task.outputs,testSource:task.testSource},baseline,node,true);
   const result=checks.checks.find(c=>c.id==='node-tests')!;return {checks:contract.requirements.map(r=>({id:r.id,status:result.status,detail:'Human-approved check mapping: '+r.text+'\n'+result.detail})),artifacts:checks.artifacts};
  }}];};
  const revalidate=async(taskId:string)=>{
   const e=s.nodes[taskId];if(!e?.contract||!e.functional||!e.validation?.attempts.length)throw Error('Missing resumable candidate evidence: '+taskId);
   const old=e.functional,c=e.contract;const planned=planTasks(s.plan).find(t=>t.id===taskId)!;if(JSON.stringify(c.acceptance)!==JSON.stringify(planned.acceptance)||JSON.stringify(c.outputs)!==JSON.stringify(planned.outputs)||c.originalRequirement!==s.goal||c.budget.deadline!==s.deadline)throw Error('Contract differs from frozen plan');const expectedDependencies=Object.fromEntries(ancestors(planned,planTasks(s.plan)).map(id=>[id,s.nodes[id]!.functional!.candidate.artifactHash]));if(JSON.stringify(c.dependencies)!==JSON.stringify(expectedDependencies))throw Error('Dependency version changed');const dependencyFiles=await filesFor(ancestors(planTasks(s.plan).find(t=>t.id===taskId)!,planTasks(s.plan)));
   const within=(p:string)=>{const rel=relative(dir(id),resolve(p));if(isAbsolute(rel)||rel.startsWith('..'))throw Error('Evidence path outside Run');};within(old.candidate.snapshot);within(old.candidate.manifestPath);within(old.acceptance.evidence!);
   if(digest(JSON.stringify(old))!==digest(JSON.stringify(JSON.parse(await readFile(old.acceptance.evidence!,'utf8')))))throw Error('Historical report changed');
   if(!e.manifestHash||digest(await readFile(old.candidate.manifestPath))!==e.manifestHash)throw Error('Candidate manifest changed');const manifest=JSON.parse(await readFile(old.candidate.manifestPath,'utf8'));if(manifest.candidateId!==old.candidate.candidateId||manifest.artifactHash!==old.candidate.artifactHash||old.candidate.contractHash!==digest(JSON.stringify(c)))throw Error('Historical manifest/contract changed');
   if(await hashOutputs(old.candidate.snapshot,c.outputs)!==old.candidate.artifactHash||await hashOutputs(join(s.teamConfig.runDir,'accepted',taskId),c.outputs)!==old.candidate.artifactHash)throw Error('Candidate or dependency snapshot changed');
   const challengePath=join(dir(id),'tasks',taskId,'challenger','frozen-challenge.json');const challenge=validateChallenge(JSON.parse(await readFile(challengePath,'utf8')),e.validation.contract);if(digest(JSON.stringify(challenge))!==e.validation.verifierHash)throw Error('Frozen independent challenge changed');
   const path=join(epochDir,'revalidation',taskId),key=await reserve('verification',path);await mkdir(path,{recursive:true});
   const review=await verifySnapshot(e.validation.contract,challenge,old.candidate.snapshot,join(path,'challenge'),s.epoch,signal,dependencyFiles,node);
   const fresh=await verifyCandidate(c,old.candidate,join(path,'functional'),registry(taskId,dependencyFiles),signal);await settle(key);await live();
   e.functional=fresh;e.acceptance=fresh.acceptance;if(review.status!=='accepted'&&!['rejected','blocked'].includes(e.acceptance.status))e.acceptance={...e.acceptance,status:'unverified',detail:'Frozen independent challenge did not pass on resume'};e.status=e.acceptance.status;await save('revalidated:'+taskId);return e.acceptance.status==='accepted'&&await currentEvidence(fresh,c);
  };
  let polling=false;const poll=setInterval(()=>{if(polling)return;polling=true;void (async()=>{try{const c=JSON.parse(await readFile(join(dir(id),'control.json'),'utf8'));await unlink(join(dir(id),'control.json'));if(c.id===id){if(c.action==='pause')requestPause();else if(c.action==='cancel'){job.cancel=true;controller.abort();}}}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')controller.abort();}finally{polling=false;}})();},100);
  job.done=(async()=>{try{
   await mkdir(epochDir,{recursive:true});const original=JSON.parse(await readFile(join(dir(id),'frozen-run.json'),'utf8')) as EngineeringRun;
   if(immutable(original)!==s.configHash||sourceHash(await projectFiles(s.project))!==sourceHash(s.files))throw Error('Source project or frozen tests/config changed; create a new Run instead of mixing versions');
   if(s.environment.node!==await runtimeVersion(node)||s.environment.platform!==process.platform||s.environment.verifier!==await verifierVersion())throw Error('Verifier environment changed');
   s.status='running';await save('execution-started');
   const team=await runTeam(s.teamConfig,{signal,pauseRequested:()=>job.pause,checkpoint:async team=>{s.team=team;await save('team-checkpoint');},...(s.team?{resume:{state:s.team,deadline:s.deadline,revalidate:async t=>revalidate(t.id)}}:{}),worker:async(request,t)=>{
    const planned=planTasks(s.plan).find(p=>p.id===t.id)!;const context=await filesFor(ancestors(planned,planTasks(s.plan)));await materialize(request.workspace,context);
    const dependencies=Object.fromEntries(ancestors(planned,planTasks(s.plan)).map(id=>[id,s.nodes[id]!.functional!.candidate.artifactHash]));
    const e:TaskEvidence={id:t.id,backend:planned.backend??'codex',status:'queued',reply:'',workspace:request.workspace,checks:[],contract:freezeContract(t.id,{goal:planned.goal,outputs:planned.outputs,acceptance:planned.acceptance},s.goal,s.deadline,dependencies)};s.nodes[t.id]=e;
    const selected=s.workers[t.id]!;
    await runChallengedTask(e,{goal:planned.goal,outputs:planned.outputs,acceptance:planned.acceptance},selected,s.challenger,{id:t.id,prompt:planned.goal,workspace:request.workspace,logDir:join(dir(id),'tasks',t.id),timeoutMs:Math.min(s.limits.attemptMs,s.deadline-Date.now())},{run,challenge:deps.challenge,context,verifierNode:node,structural:checkOutputs,save:()=>save('node:'+t.id),usage:()=>{/* Reservation settlement owns usage; do not count it twice. */},registry:registry(t.id,context),originalRequirement:s.goal,deadline:s.deadline,verification:async()=>{const key=await reserve('verification',request.workspace);return ()=>settle(key);}},signal);
    return {status:signal.aborted?'cancelled':e.status==='error'?'error':'completed',sessionId:e.sessionId??'node-'+t.id,durationMs:0,usage:[]};
   },check:async(_w,path,_signal,t)=>{const e=s.nodes[t.id]!;const key=await reserve('verification',path);const ok=e.contract&&e.functional&&e.acceptance?.status==='accepted'&&await currentEvidence(e.functional,e.contract,e.workspace);await settle(key);return {checks:[{id:'acceptance',status:ok?'pass':'not_checked',detail:e.acceptance?.detail??'No functional evidence'}],artifacts:[]};}});
   s.team=team;await live();if(team.status==='paused'){s.status='paused';await save('paused');return;}if(team.status!=='completed'){s.status='blocked';s.reason='One or more required nodes did not pass';await save('blocked');return;}
   s.status='integrating';await save('integrating');const context=await filesFor(planTasks(s.plan).map(t=>t.id));const path=join(epochDir,'integration'),workspace=join(path,'workspace');await materialize(workspace,context);
   const contract=freezeContract('root',{goal:s.goal,outputs:s.plan.outputs,acceptance:s.plan.acceptance},s.goal,s.deadline,Object.fromEntries(Object.entries(s.nodes).map(([id,e])=>[id,e.functional!.candidate.artifactHash])));
   const key=await reserve('verification',path),candidate=await captureCandidate(contract,workspace,join(path,'snapshot'),'integration-'+s.epoch);s.delivery=await verifyCandidate(contract,candidate,join(path,'functional'),registry('root',context),signal);await settle(key);await live();
   s.status=s.delivery.acceptance.status==='accepted'?'completed':s.delivery.acceptance.status==='rejected'?'rejected':'blocked';s.reason=s.delivery.acceptance.detail;await save('delivery');await live();
  }catch(error){s.status=job.cancel?'cancelled':signal.aborted?'interrupted':'blocked';s.reason=String(error);try{await save(s.status);}catch{/* Last committed checkpoint remains authoritative. */}}
  finally{clearInterval(poll);try{await lease.release();}finally{active=undefined;}}})();void job.done.catch(()=>{});return {id,status:'running'};
 }
 function requestPause(){if(active&&!active.pause){const job=active;job.pause=true;void job.notifyPause().catch(()=>job.controller.abort());const timer=setTimeout(()=>job.controller.abort(),30000);timer.unref();void job.done.finally(()=>clearTimeout(timer)).catch(()=>{});}}
 async function pause(){if(!active)return;const job=active;requestPause();const timer=setTimeout(()=>job.controller.abort(),30000);try{await job.done;}finally{clearTimeout(timer);}}
 async function cancelImpl(id:string){if(active?.id===id){active.cancel=true;active.controller.abort();await active.done;return;}if((await load(id)).status==='completed')return;const lease=await claimRun(dir(id),async()=>false);try{const s=await load(id);if(s.status==='completed')return;s.status='cancelled';await writeRun(dir(id),s,{type:'cancelled',at:new Date().toISOString()});}finally{await lease.release();}}
 const resume=(id:string)=>control(()=>resumeImpl(id));
 const cancel=(id:string)=>{if(active?.id===id){active.cancel=true;active.controller.abort();}return control(()=>cancelImpl(id));};
 return {create,resume,pause,requestPause,requestControl,cancel,detail,list,isActive:()=>!!active,wait:async()=>{await active?.done;}};
}

import {contactDomain,contactVerifier,type ContactDomain} from './contact-verifier.js';
import {mkdir,readFile,writeFile,readdir,realpath,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {claimRun,readRun,writeRun} from './engineering-store.js';
import {Assignment,checkOutputs} from './managed-chat.js';
import {runChallengedTask,acceptedTask,type TaskEvidence} from './challenged-task.js';
import {freezeContract,aggregationContract,verifyCandidate,captureCandidate,builtinVerifiers,currentEvidence,type FrozenContract,type FunctionalEvidence,type VerifierRegistry} from './acceptance.js';
import {digest,snapshotOutputs,type AcceptanceContract} from './challenge.js';
import {runTeam} from './team.js';
import {backendSpec,sharedPool} from './managed-queue.js';
import {validateChatOptions,managerSelection,type ChatOptions} from './chat-options.js';
import {rolePrompt} from './agent-roles.js';
import type {WorkerSpec,Job,Result} from './worker-pool.js';

const Decision=z.object({action:z.enum(['dispatch','finish','stop']),reason:z.string().min(1).max(4000),tasks:z.array(Assignment).max(64),concurrency:z.number().int().min(1).max(64),selected:z.array(z.string()).max(64),contract:z.object({goal:z.string(),outputs:z.array(z.string()),acceptance:z.array(z.string())}).optional()}).strict();
type GoalDecision=z.infer<typeof Decision>;
export interface PersistentGoal {
 domain?:ContactDomain;version:1;id:string;goal:string;project:string;options:ChatOptions;createdAt:string;deadline:number;
 limits:{rounds:number;calls:number;checks:number;concurrency:number;attemptMs:number};configHash:string;
 status:'ready'|'running'|'pausing'|'paused'|'interrupted'|'completed'|'incomplete'|'blocked'|'cancelled';reason?:string;
 rounds:{decision:GoalDecision;at:string}[];tasks:TaskEvidence[];contract?:FrozenContract;delivery?:FunctionalEvidence;
 calls:number;checks:number;epoch:number;revision:number;safe:boolean;inflight:Record<string,{id:string;path:string}>;usage:unknown[];
 events:{type:string;at:string;revision:number}[];
}
export interface GoalDependencies {
 decide?:(state:PersistentGoal)=>Promise<unknown>;
 worker?:(spec:WorkerSpec,job:Job,signal?:AbortSignal)=>Promise<Result>;
 challenge?:(c:AcceptanceContract)=>Promise<unknown>;
 registry?:VerifierRegistry;
 onCheckpoint?:(state:PersistentGoal)=>Promise<void>;
}
const immutable=(s:PersistentGoal)=>digest(JSON.stringify({domain:s.domain,version:s.version,id:s.id,goal:s.goal,project:s.project,options:s.options,createdAt:s.createdAt,deadline:s.deadline,limits:s.limits}));
export function createGoalService(root:string,deps:GoalDependencies={}){
 const base=join(root,'.goals');let active:{id:string;pause:boolean;cancel:boolean;controller:AbortController;done:Promise<void>;notifyPause:()=>Promise<void>}|undefined;
 let controlTail:Promise<unknown>=Promise.resolve();
 const control=<T>(fn:()=>Promise<T>)=>{const next=controlTail.then(fn);controlTail=next.catch(()=>{});return next;};
 const dir=(id:string)=>{if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid goal ID');return join(base,id);};
 const load=async(id:string)=>{const s=await readRun<PersistentGoal>(dir(id));if(s.version!==1||s.id!==id||immutable(s)!==s.configHash)throw Error('Goal configuration changed');return s;};
 async function has(id:string){try{await stat(join(dir(id),'run.json'));return true;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e;}}
 async function detail(id:string){const s=await load(id);if(active?.id!==id&&['running','pausing'].includes(s.status))s.status=s.safe?'interrupted':'blocked';return {...s,persistentGoal:true as const};}
 async function list(){await mkdir(base,{recursive:true});const rows=[];for(const id of await readdir(base)){if(!/^[a-f0-9-]{36}$/.test(id))continue;try{const s=await detail(id);rows.push({id,title:s.goal.slice(0,40),project:s.project,status:s.status,persistentGoal:true});}catch(error){rows.push({id,title:'目标记录需要检查',project:root,status:'blocked',persistentGoal:true,reason:String(error)});}}return rows;}
 async function create(input:{goal:string;project:string;options:ChatOptions;totalMs?:number;maxRounds?:number;maxCalls?:number;concurrency?:number}){
  if(active)throw Error('已有持续目标正在运行');if(!input.goal.trim()||input.goal.length>100000)throw Error('请输入有效目标');
  const project=await realpath(input.project);if(!(await stat(project)).isDirectory())throw Error('项目目录不可用');const options=await validateChatOptions(input.options);options.delegation??={mode:'off',count:10};
  const limits={rounds:input.maxRounds??8,calls:input.maxCalls??64,checks:64,concurrency:input.concurrency??(options.delegation?.mode==='fixed'?options.delegation.count:options.delegation?.mode==='off'?1:64),attemptMs:1800000};
  const totalMs=input.totalMs??86400000;for(const n of [totalMs,limits.rounds,limits.calls,limits.concurrency])if(!Number.isSafeInteger(n)||n<1)throw Error('Invalid goal budget');
  if(totalMs>2147483647||limits.rounds>100||limits.calls>10000||limits.concurrency>64)throw Error('Goal budget exceeds supported bounds');
  const domain=await contactDomain(input.goal,project);
  const s:PersistentGoal={domain,version:1,id:randomUUID(),goal:input.goal,project,options,createdAt:new Date().toISOString(),deadline:Date.now()+totalMs,limits,configHash:'',status:'ready',rounds:[],tasks:[],calls:0,checks:0,epoch:0,revision:0,safe:true,inflight:{},usage:[],events:[]};s.configHash=immutable(s);await mkdir(dir(s.id),{recursive:true});await writeFile(join(dir(s.id),'original.json'),JSON.stringify(s),{flag:'wx'});await writeRun(dir(s.id),s,{type:'created'});return {id:s.id};
 }
 async function resumeImpl(id:string){
  if(active)throw Error('已有持续目标正在运行');let s=await load(id);if(s.status==='completed')return {id};if(s.status==='cancelled')throw Error('目标已取消');if(Date.now()>=s.deadline||s.calls>=s.limits.calls||s.rounds.length>=s.limits.rounds)throw Error('Original goal budget exhausted');
  const lease=await claimRun(dir(id),async()=>{const current=await load(id);return !current.safe||Object.keys(current.inflight).length>0;});
  if(active){await lease.release();throw Error('已有持续目标正在运行');}
  const job={id,pause:false,cancel:false,controller:new AbortController(),done:Promise.resolve(),notifyPause:async()=>{}};active=job;
  job.done=(async()=>{
   let writes=Promise.resolve();const registry=deps.registry??[...(s.domain?[contactVerifier(s.domain)]:[]),...builtinVerifiers];
   const signal=AbortSignal.any([job.controller.signal,AbortSignal.timeout(Math.max(1,s.deadline-Date.now()))]);
   const live=async()=>{await lease.assert();if(signal.aborted||Date.now()>=s.deadline)throw Error('Goal cancelled or original deadline exceeded');};
   const save=(type:string)=>{s.revision++;const event={type,at:new Date().toISOString(),revision:s.revision};s.events.push(event);const copy=structuredClone(s);writes=writes.then(async()=>{await lease.assert();await writeRun(dir(id),copy,event);await deps.onCheckpoint?.(copy);});return writes;};
   job.notifyPause=async()=>{s.status='pausing';await save('pause-requested');};
   const reserve=async(kind:'call'|'check',name:string,path:string)=>{await live();if(kind==='call'){if(s.calls>=s.limits.calls)throw Error('Cumulative model budget exhausted');s.calls++;}else{if(s.checks>=s.limits.checks)throw Error('Cumulative verification budget exhausted');s.checks++;}const key=randomUUID();s.inflight[key]={id:name,path};await save('reserved:'+name);return key;};
   const settled=async(key:string)=>{delete s.inflight[key];await save('settled');};
   const run=async(spec:WorkerSpec,j:Job,abort?:AbortSignal)=>{const key=await reserve('call',j.id,j.logDir);const result=await (deps.worker??((a,b,c)=>sharedPool(root).submit(a,b,c)))(spec,{...j,timeoutMs:Math.min(j.timeoutMs,s.deadline-Date.now())},abort??signal);s.usage.push({id:j.id,backend:spec.backend,model:spec.model,raw:result.usage});await settled(key);await live();return result;};
   const verify=async(e:TaskEvidence,path:string)=>{if(!e.functional||!e.contract)throw Error('Missing candidate evidence');const key=await reserve('check','revalidate:'+e.id,path);const previous=e.functional;const review=await readFile(previous.acceptance.evidence!);if(digest(review)!==digest(JSON.stringify(previous,null,2))||e.manifestHash!==digest(await readFile(previous.candidate.manifestPath)))throw Error('Stored evidence changed');e.functional=await verifyCandidate(e.contract,previous.candidate,path,registry,signal);if(!await currentEvidence(e.functional,e.contract,e.workspace))throw Error('Candidate no longer passes verification');e.acceptance=e.functional.acceptance;await settled(key);};
   try{
    s=await load(id);if(s.status==='cancelled')throw Error('目标已取消');s.epoch++;s.status='running';s.reason=undefined;await save('resumed');
    // Serialized PASS is not authority: issue fresh host evidence in this process.
    for(const e of s.tasks)if(e.acceptance?.status==='accepted')await verify(e,join(dir(id),'revalidate',String(s.epoch),e.id));
    while(s.rounds.length<s.limits.rounds){
     await live();if(job.pause){s.status='paused';s.safe=true;await save('paused');return;}
     const round=s.rounds.length,roundDir=join(dir(id),'rounds',String(round));await mkdir(roundDir,{recursive:true});s.safe=false;await save('manager-started');
     let raw:unknown;
     if(deps.decide){const key=await reserve('call','manager',roundDir);raw=await deps.decide(structuredClone(s));await settled(key);}
     else {const schema=join(roundDir,'schema.json'),output=join(roundDir,'decision.json');await writeFile(schema,JSON.stringify(z.toJSONSchema(Decision)));const role=rolePrompt('manager',{goal:s.goal,state:s,queue:sharedPool(root).snapshot(),instructions:'Return schema JSON. First decision includes immutable root contract: exact outputs and semantic acceptance. dispatch chooses task goals, backend, skills, dependencies, and concurrency from evidence. Use globally new task IDs for alternative routes; never erase failed evidence. Dependencies may name earlier accepted tasks. Finish selects only accepted tasks whose outputs exactly cover root outputs; host verifies integration. stop explains why work cannot continue. No model can certify completion. Keep tasks bounded; conserve user intervention, not necessarily tokens. Backend commandcode supports file edits, codex supports commands. Missing host verifier means unverified, not success. Off mode allows only one codex task per round. Never modify the source project; use isolated worker output.'});const result=await run({...backendSpec(root,'codex','read-only'),...managerSelection(s.options),schemaPath:schema,outputPath:output},{id:'manager-'+round,prompt:role.prompt,workspace:s.project,logDir:join(roundDir,'manager'),timeoutMs:300000},signal);if(result.status!=='completed')throw Error('Manager '+result.status+': '+result.detail);raw=JSON.parse(await readFile(output,'utf8'));}
     await live();const d=Decision.parse(raw);
     if(d.action==='dispatch'&&!d.tasks.length||d.action!=='dispatch'&&d.tasks.length)throw Error('Invalid dispatch');
     if(d.concurrency>s.limits.concurrency||s.options.delegation?.mode==='off'&&(d.tasks.length>1||d.tasks.some(t=>t.backend!=='codex'))||s.options.delegation?.mode==='fixed'&&d.tasks.length>s.options.delegation.count)throw Error('Decision exceeds delegation limits');
     if(!s.contract){const c=s.domain?.contract??aggregationContract(s.goal)??d.contract;if(!c||!c.outputs.length||!c.acceptance.length)throw Error('Persistent goal requires explicit deliverables and acceptance');s.contract=freezeContract('goal',c,s.goal,s.deadline);}
     else if(d.contract&&JSON.stringify(d.contract)!==JSON.stringify({goal:s.contract.goal,outputs:s.contract.outputs,acceptance:s.contract.acceptance}))throw Error('Root acceptance cannot change');
     s.rounds.push({decision:d,at:new Date().toISOString()});await save('decision');
     if(d.action==='stop'){s.status='incomplete';s.reason=d.reason;s.safe=true;await save('stopped');return;}
     if(d.action==='finish'){
      if(!d.selected.length||new Set(d.selected).size!==d.selected.length)throw Error('Select accepted deliverables');const selected=d.selected.map(id=>s.tasks.find(t=>t.id===id));const outputs=new Set<string>();
      for(const e of selected){if(!e||!await acceptedTask(e))throw Error('Selected task lacks accepted evidence');for(const path of e.contract!.outputs){if(outputs.has(path))throw Error('Conflicting selected outputs');outputs.add(path);}}
      if(JSON.stringify([...outputs].sort())!==JSON.stringify([...s.contract.outputs].sort()))throw Error('Selected outputs do not cover original goal');
      const workspace=join(roundDir,'delivery');for(const e of selected)await snapshotOutputs(e!.functional!.candidate.snapshot,e!.contract!.outputs,workspace);
      const key=await reserve('check','integration',roundDir),candidate=await captureCandidate(s.contract,workspace,join(roundDir,'snapshot'),'integration');s.delivery=await verifyCandidate(s.contract,candidate,join(roundDir,'verification'),registry,signal);await settled(key);
      const accepted=await currentEvidence(s.delivery,s.contract,workspace);await live();s.status=accepted?'completed':'incomplete';s.reason=s.delivery.acceptance.detail;s.safe=true;await save('delivery');await live();return;
     }
     const ids=new Set(d.tasks.map(t=>t.id));if(ids.size!==d.tasks.length||d.tasks.some(t=>s.tasks.some(e=>e.id===t.id)))throw Error('Task IDs must be unique across rounds');
     for(const t of d.tasks)for(const dep of t.dependsOn)if(!ids.has(dep)&&!await acceptedTask(s.tasks.find(e=>e.id===dep)??{} as TaskEvidence))throw Error('Dependency is not accepted: '+dep);
     const batch=d.tasks.map(t=>({id:t.id,backend:t.backend,status:'queued',reply:'',workspace:'',checks:[]} as TaskEvidence));s.tasks.push(...batch);await save('dispatch');
     await runTeam({runDir:join(roundDir,'team'),tasks:d.tasks.map(t=>({id:t.id,goal:t.goal,dependsOn:t.dependsOn.filter(id=>ids.has(id)),routes:['manager-assigned'],requiredChecks:['acceptance'],outputs:t.outputs})),concurrency:d.concurrency,maxAttempts:1,attemptMs:s.limits.attemptMs,totalMs:Math.max(1,s.deadline-Date.now())},{signal,worker:async(r,t)=>{
      const assignment=d.tasks.find(a=>a.id===t.id)!,e=batch.find(e=>e.id===t.id)!;e.workspace=r.workspace;if(s.domain){await mkdir(r.workspace,{recursive:true});await writeFile(join(r.workspace,s.domain.source),JSON.stringify(s.domain.input));}const dependencies:Record<string,string>={};
      for(const dep of assignment.dependsOn){const upstream=s.tasks.find(e=>e.id===dep)!;if(!await acceptedTask(upstream))throw Error('Dependency lost acceptance');dependencies[dep]=upstream.functional!.candidate.artifactHash;if(!ids.has(dep))await snapshotOutputs(upstream.functional!.candidate.snapshot,upstream.contract!.outputs,r.workspace);}
      e.contract=freezeContract(e.id,assignment,s.goal,s.deadline,dependencies);e.contract.skills=assignment.skills;
      const spec={...backendSpec(root,assignment.backend,s.options.permission),...(assignment.backend==='codex'?(s.options.delegation?.mode==='off'?managerSelection(s.options):s.options.worker??managerSelection(s.options)):{})};
      await runChallengedTask(e,assignment,spec,{...backendSpec(root,'codex','read-only'),...managerSelection(s.options)},{id:e.id,prompt:assignment.goal+'\nRead-only original project context: '+s.project,workspace:r.workspace,logDir:join(roundDir,'tasks',e.id),timeoutMs:Math.min(s.limits.attemptMs,s.deadline-Date.now())},{run,challenge:deps.challenge,structural:checkOutputs,registry,originalRequirement:s.goal,deadline:s.deadline,save:()=>save('task-evidence'),usage:()=>{},verification:async()=>{const key=await reserve('check','verify:'+e.id,roundDir);return ()=>settled(key);}},signal);
      return {status:signal.aborted?'cancelled':e.status==='error'?'error':'completed',sessionId:e.sessionId??'goal-task-'+t.id,durationMs:0,usage:[]};
     },check:async(_w,_p,_s,t)=>({checks:[{id:'acceptance',status:await acceptedTask(batch.find(e=>e.id===t.id)!)?'pass':'not_checked',detail:'Host candidate evidence'}],artifacts:[]})});
     if(Object.keys(s.inflight).length)throw Error('Unsettled work requires inspection');
     s.safe=true;await save('round-completed');
    }
    s.status='incomplete';s.reason='已达到累计轮数上限';await save('budget-exhausted');
   }catch(error){s.status=job.cancel?'cancelled':'blocked';s.reason=String(error);try{await save('blocked');}catch{/* never publish completion after persistence failure */}}
   finally{await writes.catch(()=>{});await lease.release();if(active===job)active=undefined;}
  })();void job.done.catch(()=>{});return {id};
 }
 async function pause(){if(active){const job=active;job.pause=true;await job.notifyPause();await job.done;}}
 async function cancelImpl(id:string){if(active?.id===id){active.cancel=true;active.controller.abort();await active.done;return;}const lease=await claimRun(dir(id),async()=>false);try{const s=await load(id);if(s.status==='completed')throw Error('Completed goal is immutable');s.status='cancelled';await writeRun(dir(id),s,{type:'cancelled'});}finally{await lease.release();}}
 const resume=(id:string)=>control(()=>resumeImpl(id));
 const cancel=(id:string)=>{if(active?.id===id){active.cancel=true;active.controller.abort();}return control(()=>cancelImpl(id));};
 return {create,resume,pause,cancel,detail,list,has,isActive:()=>!!active,wait:async()=>{await active?.done;},folder:async(id:string)=>{const s=await load(id);if(s.status!=='completed'||!s.delivery)throw Error('尚无通过验收的交付');return s.delivery.candidate.snapshot;}};
}

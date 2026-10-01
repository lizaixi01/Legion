import {mkdir,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {HweDecisionEvidence} from './primary-hwe-check.js';
import {fingerprintMatches} from './hwe-fingerprint.js';
import {Dispatch} from './primary-task-contract.js';
import type {DispatchLink} from './primary-agent.js';

const Input=z.discriminatedUnion('action',[
 z.object({action:z.literal('read')}).strict(),
 z.object({action:z.enum(['execute','cancel']),decisionId:z.string().uuid()}).strict(),
 z.object({action:z.enum(['select','discard','continue']),reason:z.string().min(1).max(4000),evidenceIds:z.array(z.string().uuid()).min(1).max(3),selectedId:z.string().uuid().optional(),nextExperiment:z.string().min(1).max(4000).optional(),workers:z.array(Dispatch).min(1).max(64).optional()}).strict()
]);
export const strategyTool={type:'function',name:'legion_strategy',description:'Record HWE decisions grounded in host evidence. Read returns evidence, decisions, plans and available capacity. Continue may include a frozen workers allocation. Execute launches pending allocations within shared capacity; repeat after workers settle to drain the plan without duplicating dispatched workers. Cancel drops only unstarted allocations; use legion_tasks cancel for active workers. Every batch rechecks evidence. Plans cannot survive a restart as launch authority. Select requires verified unchanged evidence. Infrastructure errors are not failed solutions. Decisions do not accept the whole task.',inputSchema:z.toJSONSchema(Input)};
interface Issuer {ids:()=>string[];inspect:(id:string)=>Promise<HweDecisionEvidence>}
interface Executor {
 capacity:()=>{limit:number;active:number;remainingCalls:number;available:number;deadline:number};
 dispatch:(work:z.infer<typeof Dispatch>,link:DispatchLink)=>Promise<unknown>;
}
type Allocation={id:string;taskId:string;work:z.infer<typeof Dispatch>;status:'pending'|'launching'|'dispatched'|'blocked'|'cancelled';detail?:string};
type Plan={decisionId:string;evidenceIds:string[];workerSeconds:number;allocations:Allocation[]};
export function createPrimaryStrategy(directory:string,issuer:Issuer,executor?:Executor,history:()=>Promise<unknown[]>=async()=>[]){
 const decisions:Record<string,unknown>[]=[];let tail:Promise<unknown>=Promise.resolve();
 const plans=new Map<string,Plan>();let closed=false;
 let selected:{decisionId:string;evidenceId:string}|undefined;
 const save=async(plan:Plan)=>{const file=join(directory,plan.decisionId+'.execution.json');await mkdir(directory,{recursive:true});await writeFile(file+'.tmp',JSON.stringify(plan,null,2));await rename(file+'.tmp',file);};
 const execute=async(args:unknown)=>{
  const input=Input.parse(args);
  if(input.action==='read'){
   const evidence=[];for(const id of issuer.ids()){try{evidence.push(await issuer.inspect(id));}catch(error){evidence.push({id,status:'stale',detail:String(error)});}}
   return {history:await history(),evidence,selected:structuredClone(selected),decisions:structuredClone(decisions),plans:structuredClone([...plans.values()]),capacity:executor?.capacity(),scope:'Current turn evidence; historical records are not fresh acceptance.'};
  }
  if(closed)throw Error('Strategy turn has stopped');
  if('decisionId' in input){
   const plan=plans.get(input.decisionId);if(!plan||!executor)throw Error('Unknown current-turn allocation');
   if(input.action==='cancel'){for(const a of plan.allocations)if(a.status==='pending')a.status='cancelled';await save(plan);return structuredClone(plan);}
   // A launch intent is durable before calling the queue. Unknown outcomes are never retried.
   for(const allocation of plan.allocations){
    if(allocation.status!=='pending')continue;
    if(closed)break;
    const capacity=executor.capacity();
    if(!capacity.limit||capacity.remainingCalls<=0||Date.now()>=capacity.deadline){allocation.status='blocked';allocation.detail='Delegation disabled, call budget exhausted or parent deadline reached';await save(plan);continue;}
    if(capacity.available<=0)break;
    try{await Promise.all(plan.evidenceIds.map(id=>issuer.inspect(id)));}
    catch(error){allocation.status='blocked';allocation.detail=String(error);await save(plan);continue;}
    allocation.status='launching';
    // If this save fails, execution never starts; leave the in-memory intent non-replayable.
    await save(plan);
    try{await executor.dispatch(allocation.work,{decisionId:plan.decisionId,allocationId:allocation.id,taskId:allocation.taskId});allocation.status='dispatched';}
    catch(error){allocation.status='blocked';allocation.detail='Dispatch did not confirm success; inspect task '+allocation.taskId+' before making a new plan. '+String(error);}
    await save(plan);
   }
   return structuredClone(plan);
  }
  if(decisions.length>=64)throw Error('Decision record limit reached');
  if(new Set(input.evidenceIds).size!==input.evidenceIds.length)throw Error('Duplicate evidence IDs');
  const evidence=await Promise.all(input.evidenceIds.map(id=>issuer.inspect(id)));
  if(input.action==='select'){
   const selected=evidence.find(e=>e.id===input.selectedId);
   if(!selected||selected.status!=='verified')throw Error('Select requires a verified referenced candidate');
   const measured=evidence.filter(e=>e.status==='verified');
   if(measured.some(e=>!fingerprintMatches(e.environment,selected.environment)))throw Error('Cannot compare different verification environments');
  }else if(input.selectedId)throw Error('selectedId is only valid for select');
  if(input.action==='continue'&&!input.nextExperiment)throw Error('Continue requires the next experiment hypothesis');
  if(input.workers){
   if(input.action!=='continue'||!executor)throw Error('Worker allocation requires continue and a queue');
   const capacity=executor.capacity();
   if(!capacity.limit||input.workers.length>capacity.remainingCalls||Date.now()>=capacity.deadline)throw Error('Allocation exceeds current call budget or delegation is disabled');
  }
  const record={...input,id:randomUUID(),at:new Date().toISOString(),evidence,scope:'HWE public checks only; decision is not whole-task acceptance.'};
  await mkdir(directory,{recursive:true});await writeFile(join(directory,record.id+'.json'),JSON.stringify(record,null,2),{flag:'wx'});
  decisions.push(record);
  if(input.action==='select')selected={decisionId:record.id,evidenceId:input.selectedId!};
  if(input.action==='discard'&&selected&&input.evidenceIds.includes(selected.evidenceId))selected=undefined;
  if(input.workers){const plan:Plan={decisionId:record.id,evidenceIds:input.evidenceIds,workerSeconds:input.workers.reduce((n,w)=>n+(w.timeoutSeconds??1800),0),allocations:input.workers.map(work=>({id:randomUUID(),taskId:randomUUID(),work,status:'pending'}))};await save(plan);plans.set(record.id,plan);}
  return structuredClone(record);
 };
 return {
  call:(args:unknown)=>{const next=tail.then(()=>execute(args));tail=next.catch(()=>{});return next;},
  pending:()=>[...plans.values()].some(p=>p.allocations.some(a=>a.status==='pending'||a.status==='launching')),
  finalize:async()=>{
   await tail;
   if(!selected)return {status:'none' as const};
   let status:'valid'|'stale'='valid',detail='Selected candidate still matches its public-check evidence. This is not whole-task acceptance.';
   try{const evidence=await issuer.inspect(selected.evidenceId);if(evidence.status!=='verified')throw Error('Selection no longer verified');}catch(error){status='stale';detail=String(error);}
   const result={...selected,status,detail,checkedAt:new Date().toISOString()};
   await mkdir(directory,{recursive:true});const file=join(directory,'selection.json');await writeFile(file+'.tmp',JSON.stringify(result,null,2));await rename(file+'.tmp',file);return result;
  },
  close:async()=>{closed=true;await tail;for(const plan of plans.values()){let changed=false;for(const a of plan.allocations)if(a.status==='pending'){a.status='cancelled';a.detail='Parent turn ended before dispatch';changed=true;}if(changed)await save(plan);}}
 };
}

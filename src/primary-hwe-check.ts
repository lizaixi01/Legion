import type {GoalBudget} from './primary-goal-budget.js';
import {mkdir,readFile,writeFile,realpath,stat,copyFile} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {digest} from './challenge.js';
import {hweFingerprint,verifyHwe,hweCall,fingerprintMatches,fingerprintDifferences} from './hwe.js';
import {inspectRtlArchive} from './hwe-archive.js';
import type {Evidence} from './research-loop.js';
const Input=z.object({archive:z.string().min(1).max(2000)}).strict();
export const hweCheckTool={type:'function',name:'legion_hwe_check',description:'Run the installed, frozen local HWE verifier on a project-relative RTL .tar.gz submission. Requires existing readiness and matching toolchain fingerprint; does not launch a model or change tests. Returns version-bound public-check evidence and quality metrics, not universal correctness or whole-task acceptance. Up to 3 checks per turn, one at a time. May take about 70 minutes; use only for an HWE task authorized by the user. The archive must contain the *.sv files at its top level: run tar from inside the RTL directory (tar -czf out.tar.gz *.sv), never archive the directory itself.',inputSchema:z.toJSONSchema(Input)};
interface Dependencies {fingerprint:()=>Promise<unknown>;verify:(archive:string,dir:string,owner:string,signal:AbortSignal)=>Promise<Evidence>;stop:(dir:string,owner:string)=>Promise<unknown>}
const defaults:Dependencies={fingerprint:hweFingerprint,verify:verifyHwe,stop:(dir,owner)=>hweCall('stop',dir,owner,{},60000)};
export interface HweDecisionEvidence {id:string;status:string;archive?:string;sha256?:string;environment?:unknown;evidence?:Evidence;detail?:string}
export function createHweCheck(root:string,workspace:string,directory:string,deadline:number,signal?:AbortSignal,deps:Dependencies=defaults,budget?:GoalBudget){
 const controller=new AbortController();signal=AbortSignal.any([controller.signal,...(signal?[signal]:[])]);
 const issued=new Map<string,{value:HweDecisionEvidence;reportHash:string}>();
 const inspect=async(id:string)=>{
  const record=issued.get(id);if(!record)throw Error('Unknown evidence: only host-issued checks from this turn are admissible');
  const dir=join(directory,id);
  if(digest(await readFile(join(dir,'result.json')))!==record.reportHash)throw Error('Evidence report changed');
  const value=record.value;
  if(value.status==='verified'&&(!value.archive||digest(await readFile(value.archive))!==value.sha256||digest(await readFile(join(dir,'rtl.tar.gz')))!==value.sha256))throw Error('Verified candidate changed; recheck required');
  return structuredClone(value);
 };
 const inflight=new Set<Promise<unknown>>();let busy=false,calls=0,lastFailure:string|undefined;
 const run=async(args:unknown)=>{
  const input=Input.parse(args);if(busy||calls>=3||budget?.remaining('check')===0)throw Error('HWE verification capacity exhausted');
  if(signal?.aborted||Date.now()>=deadline)throw Error('HWE check cancelled or deadline exceeded');
  if(isAbsolute(input.archive)||!input.archive.endsWith('.tar.gz'))throw Error('Expected project-relative .tar.gz archive');
  busy=true;calls++;const id=randomUUID(),dir=join(directory,id),owner='legion-check-'+id;
  const result:{id:string;status:string;archive?:string;sha256?:string;environment?:unknown;evidence?:Evidence;detail?:string;startedAt:string;durationMs?:number}={id,status:'error',startedAt:new Date().toISOString()};
  const started=Date.now();let launched=false,settle:(()=>Promise<void>)|undefined;
  try{
   await mkdir(dir,{recursive:true});const project=await realpath(workspace),source=await realpath(resolve(project,input.archive)),rel=relative(project,source);
   if(!rel||rel.startsWith('..')||isAbsolute(rel))throw Error('Candidate must be inside the selected project');
   const info=await stat(source);if(!info.isFile()||info.size>20*1024*1024)throw Error('Candidate must be a file under 20 MiB');
   const packed=await readFile(source);const layout=inspectRtlArchive(packed);if(!layout.ok)throw Error('RTL archive rejected: '+layout.detail);
   const ready=JSON.parse(await readFile(join(root,'.local/hwe-readiness/ready.json'),'utf8'));
   const baseline=await readFile(join(root,'.local/hwe-readiness/baseline.tar.gz'));
   if(!ready.environment||digest(baseline)!==ready.sha256)throw Error('HWE readiness baseline is missing or changed');
   const fingerprint=await deps.fingerprint();if(!fingerprintMatches(ready.environment,fingerprint))throw Error('HWE environment differs from readiness: '+fingerprintDifferences(ready.environment,fingerprint).join(', '));
   result.environment=fingerprint;result.archive=source;result.sha256=digest(packed);const frozen=join(dir,'rtl.tar.gz');await copyFile(source,frozen);
   if(digest(await readFile(frozen))!==result.sha256)throw Error('Candidate changed while capturing');
   const remaining=deadline-Date.now();if(remaining<=0||signal?.aborted)throw Error('HWE check cancelled or deadline exceeded');
   await writeFile(join(dir,'submission.json'),JSON.stringify(result,null,2),{flag:'wx'});
   const bounded=AbortSignal.any([AbortSignal.timeout(Math.min(4300000,remaining)),...(signal?[signal]:[])]);
   settle=await budget?.reserve('check',dir);launched=true;result.evidence=await deps.verify(frozen,join(dir,'verification'),owner,bounded);
   if(bounded.aborted)throw Error('HWE verification interrupted; no accepted result');
   if(!fingerprintMatches(fingerprint,await deps.fingerprint()))throw Error('HWE environment changed during verification');
   if(digest(await readFile(frozen))!==result.sha256||digest(await readFile(source))!==result.sha256)throw Error('Candidate changed during verification');
   const evidence=result.evidence,metrics=evidence.metrics;
   if(evidence.status==='pass'&&(!metrics||![metrics.fitness,metrics.fmax_mhz,metrics.lut4,metrics.cycles].every(n=>Number.isFinite(n)&&n>0)))throw Error('HWE pass lacks valid quality metrics');
   result.status=evidence.status==='pass'?'verified':evidence.status==='fail'?'rejected':'error';
  }catch(error){result.status='error';result.detail=String(error);}
  finally{
   try{if(launched)await deps.stop(join(dir,'cleanup'),owner);await settle?.();}catch(error){result.status='error';result.detail=[result.detail,'Cleanup failed: '+String(error)].filter(Boolean).join('; ');}
   result.durationMs=Date.now()-started;
   try{await mkdir(dir,{recursive:true});await writeFile(join(dir,'result.json'),JSON.stringify(result,null,2),{flag:'wx'});}finally{busy=false;}
  }
  lastFailure=result.status==='verified'?undefined:`HWE ${result.status}: ${result.detail??'候选未通过外部检查'} (${join(dir,'result.json')})`;
  issued.set(id,{value:structuredClone(result),reportHash:digest(await readFile(join(dir,'result.json')))});
  return {...result,report:join(dir,'result.json'),scope:'Frozen local HWE public checks only. Independent measurements, not general task acceptance.'};
 };
 return Object.assign((args:unknown)=>{const task=run(args);inflight.add(task);void task.finally(()=>inflight.delete(task)).catch(()=>{});return task;},{inspect,failures:()=>lastFailure?[lastFailure]:[],ids:()=>[...issued.keys()],pending:()=>busy,close:async()=>{controller.abort();await Promise.allSettled([...inflight]);}});
}

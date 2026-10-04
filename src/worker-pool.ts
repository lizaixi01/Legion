import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execute,type ProcessResult} from './process.js';
import {tierConfig,type ServiceTier} from './service-tier.js';
export type Backend='codex'|'commandcode';
export type Outcome='completed'|'rate-limited'|'quota'|'auth'|'transport'|'error'|'timeout'|'cancelled';
export interface WorkerSpec{backend:Backend;model:string;effort:string;serviceTier?:ServiceTier;command:string;prefix:string[];modPath?:string;permission?:'read-only'|'workspace-write'|'danger-full-access';schemaPath?:string;outputPath?:string}
export interface Job{ id:string;prompt:string;workspace:string;logDir:string;timeoutMs:number;sessionId?:string;deadline?:number }
export interface Result{status:Outcome;durationMs:number;sessionId?:string;text:string;usage:unknown;detail?:string;execution?:ProcessResult;terminalEvent?:string}
export function failureKind(code:number|null,message:string):Outcome{
 if(/usage limit|insufficient credits|quota|credit balance/i.test(message)||code===10)return 'quota';
 if(code===5||/rate.?limit|too many requests|\b429\b/i.test(message))return 'rate-limited';
 if(code===3||/unauthori[sz]ed|not authenticated/i.test(message))return 'auth';
 if(code===6||code===7||/\b50[234]\b|connection|network|transport/i.test(message))return 'transport';
 return 'error';
}
export function workerArgs(spec:WorkerSpec,job:Job){
 if(spec.backend==='commandcode')return [...spec.prefix,'-p','--output-format','json','--model',spec.model,'--max-turns','32','--skip-onboarding','--no-auto-update','--no-skills','--trust',...(spec.permission&&spec.permission!=='read-only'&&spec.modPath?.endsWith('workspace-mod.mjs')?['--yolo']:[]),'--permission-mode',spec.permission&&spec.permission!=='read-only'?'accept-edits':'dont-ask',...(spec.modPath?['--mod',spec.modPath]:[]),...(job.sessionId?['--resume',job.sessionId]:[])];
 return [...spec.prefix,'exec','--ignore-user-config','--ignore-rules','--disable','multi_agent','--disable','multi_agent_v2','--sandbox',spec.permission??'read-only','-c','approval_policy="never"','-c','windows.sandbox="elevated"','-c',`model_reasoning_effort="${spec.effort}"`,...tierConfig(spec.serviceTier),...(job.sessionId?['resume',job.sessionId]:[]),'--model',spec.model,'--json','--skip-git-repo-check',...(spec.schemaPath?['--output-schema',spec.schemaPath]:[]),...(spec.outputPath?['--output-last-message',spec.outputPath]:[]),'-'];
}
export function parseOutput(backend:Backend,output:string,exitCode:number|null):Omit<Result,'durationMs'>{
 const events=output.split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
 if(backend==='commandcode'){
  const last=events.findLast(e=>e.type==='result');
  if(!last)return {status:'error',text:'',usage:null,detail:'Missing terminal result'};
  return {status:exitCode===0&&last.subtype==='success'?'completed':failureKind(exitCode,JSON.stringify(last.error??last.subtype)),terminalEvent:'result',text:last.finalText??'',usage:last.usage??null,sessionId:last.sessionId,detail:last.subtype==='success'?undefined:JSON.stringify(last.error??last.subtype)};
 }
 const terminal=events.findLast(e=>e.type==='turn.completed'||e.type==='turn.failed');
 const error=events.findLast(e=>e.type==='error'||e.type==='turn.failed');
 const message=String(error?.error?.message??error?.message??'No successful terminal event');
 return {status:exitCode===0&&terminal?.type==='turn.completed'?'completed':failureKind(null,message),terminalEvent:terminal?.type,text:events.filter(e=>e.type==='item.completed'&&e.item?.type==='agent_message').map(e=>e.item.text).join('\n'),usage:terminal?.usage??null,sessionId:events.find(e=>e.type==='thread.started')?.thread_id,detail:terminal?.type==='turn.completed'?undefined:message};
}
export async function runWorker(spec:WorkerSpec,job:Job,signal?:AbortSignal):Promise<Result>{
 if(spec.backend==='commandcode'){const config=JSON.parse(await readFile(join(process.env.USERPROFILE!,'.commandcode/config.json'),'utf8'));if(config.reasoningEffort?.[spec.model]!==spec.effort)throw Error('Command Code account effort differs from requested effort; configure it before launching the pool');}
 await mkdir(job.workspace,{recursive:true});await mkdir(job.logDir,{recursive:true});
 await writeFile(join(job.logDir,'invocation.json'),JSON.stringify({backend:spec.backend,command:spec.command,model:spec.model,effort:spec.effort,serviceTier:spec.serviceTier??null,actualServiceTier:null,actualTierStatus:'unconfirmed',args:workerArgs(spec,job),workspace:job.workspace},null,2));
 const execution=await execute({command:spec.command,args:workerArgs(spec,job),cwd:job.workspace,logDir:job.logDir,input:job.prompt,timeoutMs:job.timeoutMs,signal,env:{...process.env,NO_COLOR:'1'}});
 await writeFile(join(job.logDir,'execution.json'),JSON.stringify(execution,null,2));
 let result:Result;
 try{result={...parseOutput(spec.backend,await readFile(join(job.logDir,'stdout.jsonl'),'utf8'),execution.exitCode),durationMs:execution.durationMs};}
 catch{result={status:'error',text:'',usage:null,durationMs:execution.durationMs,detail:'Invalid or incomplete event stream; see local logs'};}
 result.execution=execution;
 if(result.status!=='completed'&&execution.detail)result.detail=[result.detail,execution.detail].filter(Boolean).join('; ');
 if(execution.status==='timeout'||execution.status==='cancelled')result.status=execution.status;
 await writeFile(join(job.logDir,'result.json'),JSON.stringify(result,null,2));return result;
}
interface Pending{spec:WorkerSpec;job:Job;signal?:AbortSignal;resolve:(r:Result)=>void}
export class WorkerPool{
 private pending:Pending[]=[];private active:Record<Backend,number>={codex:0,commandcode:0};private blocked=new Map<Backend,Outcome>();private cooldown:Partial<Record<Backend,number>>={};private timer?:ReturnType<typeof setTimeout>;
 constructor(private limits:Record<Backend,number>,private total:number,private runner=runWorker){if(!Number.isInteger(total)||total<1||Object.values(limits).some(x=>!Number.isInteger(x)||x<0))throw Error('Invalid concurrency limits');}
 snapshot(){return {active:{...this.active},queued:this.pending.length,limits:{...this.limits},total:this.total,blocked:[...this.blocked],cooldown:{...this.cooldown}};}
 submit(spec:WorkerSpec,job:Job,signal?:AbortSignal){if(this.limits[spec.backend]===0)return Promise.reject(Error('Backend disabled'));return new Promise<Result>(resolve=>{const cancel=()=>this.drain();const settle=(r:Result)=>{signal?.removeEventListener('abort',cancel);resolve(r);};this.pending.push({spec,job,signal,resolve:settle});signal?.addEventListener('abort',cancel,{once:true});this.drain();});}
 private drain(){
  for(let i=0;i<this.pending.length;){const p=this.pending[i]!,b=p.spec.backend;
   if(p.job.deadline!==undefined&&Date.now()>=p.job.deadline){this.pending.splice(i,1);p.resolve({status:'timeout',durationMs:0,text:'',usage:null,detail:'Queue deadline reached; not launched'});continue;}
   if(p.signal?.aborted||this.blocked.has(b)){this.pending.splice(i,1);p.resolve({status:p.signal?.aborted?'cancelled':this.blocked.get(b)!,durationMs:0,text:'',usage:null,detail:'Not launched'});continue;}
   if(this.active.codex+this.active.commandcode>=this.total||this.active[b]>=this.limits[b]||(this.cooldown[b]??0)>Date.now()){i++;continue;}
   this.pending.splice(i,1);this.active[b]++;
   const job=p.job.deadline===undefined?p.job:{...p.job,timeoutMs:Math.max(1,Math.min(p.job.timeoutMs,p.job.deadline-Date.now()))};
   void Promise.resolve().then(()=>this.runner(p.spec,job,p.signal)).catch((e:unknown):Result=>({status:'error',durationMs:0,text:'',usage:null,detail:String(e)})).then(r=>{
    if(r.status==='quota'||r.status==='auth')this.blocked.set(b,r.status);
    if(r.status==='rate-limited'){this.limits[b]=Math.max(1,Math.floor(this.limits[b]/2));this.cooldown[b]=Date.now()+30000;}
    this.active[b]--;p.resolve(r);this.drain();
   });
  }
  if(this.timer)clearTimeout(this.timer);
  const next=[...Object.values(this.cooldown),...this.pending.map(p=>p.job.deadline).filter((t):t is number=>t!==undefined)].filter(t=>t>Date.now());if(this.pending.length&&next.length)this.timer=setTimeout(()=>this.drain(),Math.min(...next)-Date.now()+1);
 }
}







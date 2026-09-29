import {mkdir,readdir,readFile,access} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {runResearch,type ResearchState} from './research-loop.js';
import {createHweDeps} from './hwe.js';
import {ModelSelectionSchema,validateModelSelection} from './model-selection.js';
import {lockWorkspace} from './lock.js';
import {researchSummary} from './research-summary.js';
const inputSchema=z.object({goal:z.string().min(1).max(6000),manager:ModelSelectionSchema,worker:ModelSelectionSchema,maxRounds:z.number().int().min(1).max(10).default(3),concurrency:z.number().int().min(1).max(2).default(2)}).strict();
export function createResearchService(root:string){
 let active:{id:string;controller:AbortController;done:Promise<unknown>}|undefined;
 function path(id:string){if(!/^research-[a-f0-9-]{36}$/.test(id))throw Error('无效的实验编号');return join(root,'.runs',id);}
 async function detail(id:string){
  const state=JSON.parse(await readFile(join(path(id),'state.json'),'utf8')) as ResearchState;
  const progress:Record<string,string>={};
  for(const c of state.candidates.filter(c=>c.status==='verifying')){
   try{
    const base=join(path(id),c.id,'verification');
    const logs=(await readdir(base)).filter(n=>n.startsWith('verify-'));
    for(const log of logs){
     const lines=(await readFile(join(base,log,'stdout.jsonl'),'utf8')).trim().split('\n');
     for(const line of lines){
      try{const event=JSON.parse(line);if(event.type==='verification.progress')progress[c.id]=event.stage;}
      catch{/* A streaming line may be incomplete. */}
     }
    }
   }catch{/* Verification has not written its first progress event yet. */}
  }
  return {id,state,progress,canStop:active?.id===id};
 }
 async function list(){await mkdir(join(root,'.runs'),{recursive:true});const ids=(await readdir(join(root,'.runs'))).filter(n=>/^research-[a-f0-9-]{36}$/.test(n));const all=await Promise.all(ids.map(async id=>{try{const {state}=await detail(id);return {id,status:state.status,startedAt:state.startedAt,best:state.best,round:state.round};}catch{return null;}}));return all.filter(v=>v!==null).sort((a,b)=>b.startedAt.localeCompare(a.startedAt));}
 async function start(raw:unknown){if(active)throw Error('已有微架构实验在运行');const input=inputSchema.parse(raw);await validateModelSelection(input.manager);await validateModelSelection(input.worker);if(active)throw Error('已有微架构实验在运行');
  try{await access(join(root,'.local/hwe-readiness/ready.json'));}catch{throw Error('HWE 基线尚未完成两次验证，请先完成环境检查。');}
  const id='research-'+randomUUID(),dir=path(id),config={...input,maxWorkers:input.maxRounds*input.concurrency,totalMs:21600000};const lockdir=join(root,'.local/hwe-execution');await mkdir(lockdir,{recursive:true});const release=await lockWorkspace(lockdir,dir);
  const controller=new AbortController();const job={id,controller,done:Promise.resolve() as Promise<unknown>};active=job;
  job.done=runResearch(dir,config,createHweDeps(dir,config),controller.signal).then(()=>researchSummary(dir)).finally(async()=>{await release();if(active===job)active=undefined;});void job.done.catch(()=>{});
  for(let i=0;i<50;i++){try{await access(join(dir,'state.json'));return {id};}catch{await new Promise(r=>setTimeout(r,20));}}
  controller.abort();await job.done;throw Error('实验状态未能写入，请检查运行目录。');
 }
 async function stop(){active?.controller.abort();await active?.done;}
 return {list,detail,start,stop,isActive:()=>Boolean(active),folder:path};
}

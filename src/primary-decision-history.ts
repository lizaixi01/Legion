import {readdir,readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import {Dispatch} from './primary-task-contract.js';

const Decision=z.object({id:z.string().uuid(),at:z.string().max(100),action:z.enum(['select','discard','continue']),reason:z.string().max(4000),evidenceIds:z.array(z.string().uuid()).max(3),selectedId:z.string().uuid().optional(),nextExperiment:z.string().max(4000).optional()});
const Execution=z.object({decisionId:z.string().uuid(),workerSeconds:z.number().nonnegative().max(115200),allocations:z.array(z.object({id:z.string().uuid(),taskId:z.string().uuid(),work:Dispatch,status:z.enum(['pending','launching','dispatched','blocked','cancelled','interrupted']),detail:z.string().max(8000).optional()})).max(64)});
async function json(file:string){if((await stat(file)).size>4*1024*1024)throw Error('History record too large');return JSON.parse(await readFile(file,'utf8')) as unknown;}

/** Host-chosen paths only. History is context, never a launch permit or current evidence. */
export async function readDecisionHistory(turnsDirectory:string,currentTurn?:string,previousOnly=false){
 const result=[];
 let turns:{name:string;time:number}[]=[];
 try{for(const entry of await readdir(turnsDirectory,{withFileTypes:true})){if(!entry.isDirectory()||!z.string().uuid().safeParse(entry.name).success||previousOnly&&entry.name===currentTurn)continue;turns.push({name:entry.name,time:(await stat(join(turnsDirectory,entry.name))).mtimeMs});}}catch{return [];}
 turns=turns.sort((a,b)=>b.time-a.time).slice(0,20);
 for(const turn of turns){
  const directory=join(turnsDirectory,turn.name);
  let files:string[];try{files=await readdir(join(directory,'decisions'));}catch{continue;}
  for(const file of files){
   if(!/^[a-f0-9-]{36}\.json$/.test(file))continue;
   try{
    const record=Decision.parse(await json(join(directory,'decisions',file)));
    if(file!==record.id+'.json')continue;
    const historyOnly=turn.name!==currentTurn;
    let selection;try{const value=z.object({decisionId:z.string().uuid(),evidenceId:z.string().uuid(),status:z.enum(['valid','stale']),detail:z.string().max(8000),checkedAt:z.string()}).parse(await json(join(directory,'decisions','selection.json')));if(value.decisionId===record.id)selection=value;}catch{}
    let execution;
    try{execution=Execution.parse(await json(join(directory,'decisions',record.id+'.execution.json')));if(execution.decisionId!==record.id)execution=undefined;}catch{/* Missing plan is a decision-only record. */}
    if(historyOnly&&execution)for(const a of execution.allocations)if(a.status==='pending'||a.status==='launching')a.status='interrupted';
    result.push({...record,turnId:turn.name,historyOnly,trust:'historical-context-only' as const,execution,selection});
   }catch{/* Corrupt records never grant authority. */}
  }
 }
 return result.sort((a,b)=>a.at.localeCompare(b.at)).slice(-80);
}

export async function decisionMemory(turnsDirectory:string,currentTurn:string){
 const rows=await readDecisionHistory(turnsDirectory,currentTurn,true);
 return rows.slice(-20).map(d=>({id:d.id,turnId:d.turnId,at:d.at,action:d.action,reason:d.reason.slice(0,1000),nextExperiment:d.nextExperiment?.slice(0,1000),evidenceIds:d.evidenceIds,selectedId:d.selectedId,trust:d.trust,allocations:d.execution?.allocations.map(a=>({taskId:a.taskId,backend:a.work.backend,status:a.status,detail:a.detail?.slice(0,500)}))}));
}

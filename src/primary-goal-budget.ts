import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {claimRun,readRun,writeRun} from './engineering-store.js';

const Config=z.object({id:z.string().uuid(),objective:z.string(),deadline:z.number().finite(),workers:z.number().int().min(1).max(64),checks:z.number().int().min(1).max(3)}).strict();
const State=z.object({config:Config,workersUsed:z.number().int().nonnegative(),checksUsed:z.number().int().nonnegative(),inflight:z.record(z.string(),z.object({kind:z.enum(['worker','check']),reference:z.string()}))}).strict();
type BudgetState=z.infer<typeof State>;
export interface GoalBudget {
 unsettled:()=>number;
 remaining:(kind:'worker'|'check')=>number;
 reserve:(kind:'worker'|'check',reference:string)=>Promise<()=>Promise<void>>;
 close:()=>Promise<void>;
}
export async function createGoalBudget(directory:string,config:z.infer<typeof Config>){
 const parsed=Config.parse(config);await mkdir(directory,{recursive:true});
 await writeFile(join(directory,'config.json'),JSON.stringify(parsed),{flag:'wx'});
 await writeRun(directory,{config:parsed,workersUsed:0,checksUsed:0,inflight:{}} satisfies BudgetState,{type:'created'});
}
export async function readGoalBudget(directory:string){
 const config=Config.parse(JSON.parse(await readFile(join(directory,'config.json'),'utf8'))),state=State.parse(await readRun(directory));
 if(JSON.stringify(state.config)!==JSON.stringify(config)||state.workersUsed>config.workers||state.checksUsed>config.checks)throw Error('Goal budget record changed or exceeds limits');
 return state;
}
export async function openGoalBudget(directory:string,expected:{id:string;objective:string;deadline:number}):Promise<GoalBudget>{
 let state=await readGoalBudget(directory);
 for(const key of ['id','objective','deadline'] as const)if(state.config[key]!==expected[key])throw Error('Goal budget does not match original goal');
 const lease=await claimRun(directory,async()=>Object.keys((await readGoalBudget(directory)).inflight).length>0);
 try{state=await readGoalBudget(directory);}catch(error){await lease.release();throw error;}let tail:Promise<unknown>=Promise.resolve(),closed=false,healthy=true;
 const serialize=<T>(run:()=>Promise<T>)=>{const next=tail.then(run);tail=next.catch(()=>{});return next;};
 const remaining=(kind:'worker'|'check')=>Math.max(0,kind==='worker'?state.config.workers-state.workersUsed:state.config.checks-state.checksUsed);
 const save=async(type:string)=>{await lease.assert();healthy=false;await writeRun(directory,state,{type,at:new Date().toISOString()});healthy=true;};
 return {
  remaining,unsettled:()=>Object.keys(state.inflight).length,
  reserve:(kind,reference)=>serialize(async()=>{
   if(closed||!healthy||Date.now()>=state.config.deadline||remaining(kind)<=0)throw Error('Original goal budget exhausted, interrupted or unavailable');
   const id=randomUUID();if(kind==='worker')state.workersUsed++;else state.checksUsed++;state.inflight[id]={kind,reference};await save('reserved:'+kind);
   let settled=false;return ()=>serialize(async()=>{if(settled)return;if(!healthy||closed)throw Error('Cannot settle unavailable goal budget');const pending=state.inflight[id]!;delete state.inflight[id];try{await save('settled:'+kind);settled=true;}catch(error){state.inflight[id]=pending;throw error;}});
  }),
  close:async()=>{closed=true;await tail;await lease.release();},
 };
}

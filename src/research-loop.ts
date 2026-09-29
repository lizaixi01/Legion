import {mkdir,readFile,writeFile,rename,appendFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {z} from 'zod';
import {hash} from './provenance.js';

const text=z.string().min(1).max(6000);
export const HypothesisSchema=z.object({id:z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),parent:z.string(),claim:text,experiment:text,expected:text,workerSeconds:z.number().int().min(30).max(1800)}).strict();
export const ResearchDecisionSchema=z.object({action:z.enum(['experiment','finish']),reason:text,hypotheses:z.array(HypothesisSchema).max(4),discard:z.array(z.string()).max(100)}).strict();
export type ResearchDecision=z.infer<typeof ResearchDecisionSchema>;
export type Hypothesis=z.infer<typeof HypothesisSchema>;
export interface Evidence {status:'pass'|'fail'|'error'|'timeout';checks:Record<string,unknown>;metrics?:{fitness:number;fmax_mhz:number;lut4:number;cycles:number};detail?:string;limitations:string[]}
export interface Candidate {id:string;round:number;hypothesis:Hypothesis;status:'working'|'verifying'|'verified'|'rejected'|'error'|'interrupted';snapshot?:{path:string;sha256:string};worker?:{status:string;usage:unknown;sessionId?:string;durationMs:number;report?:string;detail?:string};evidence?:Evidence;discarded?:boolean}
export interface ResearchConfig {goal:string;maxRounds:number;maxWorkers:number;concurrency:number;totalMs:number;manager:{model:string;effort:string};worker:{model:string;effort:string}}
const selection=z.object({model:z.string().min(1),effort:z.string().min(1)}).strict();
export const ResearchConfigSchema=z.object({goal:text,maxRounds:z.number().int().min(1).max(20),maxWorkers:z.number().int().min(1).max(40),concurrency:z.number().int().min(1).max(4),totalMs:z.number().int().min(1000).max(28800000),manager:selection,worker:selection}).strict();
export interface ResearchState {version:1;status:'running'|'completed'|'cancelled'|'interrupted'|'error'|'budget';config:ResearchConfig;startedAt:string;checkpointAt?:string;endedAt?:string;round:number;spentMs:number;best:string;baseline:Candidate;history:{round:number;decision:ResearchDecision}[];candidates:Candidate[];error?:string}
export interface ResearchContext {goal:string;round:number;remainingWorkers:number;remainingMs:number;best:string;records:Candidate[];decisions:ResearchState['history']}
export interface ResearchDeps {
 baseline:(dir:string,signal:AbortSignal)=>Promise<Candidate>;
 decide:(context:ResearchContext,dir:string,signal:AbortSignal)=>Promise<ResearchDecision>;
 work:(hypothesis:Hypothesis,parent:Candidate,dir:string,signal:AbortSignal)=>Promise<Pick<Candidate,'snapshot'|'worker'>>;
 verify:(snapshot:NonNullable<Candidate['snapshot']>,dir:string,signal:AbortSignal)=>Promise<Evidence>;
 stop:()=>Promise<void>;
}
export function eligible(c:Candidate):boolean {const m=c.evidence?.metrics;return c.status==='verified'&&c.evidence?.status==='pass'&&Boolean(c.snapshot)&&Boolean(m)&&[m?.fitness,m?.fmax_mhz,m?.lut4,m?.cycles].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>0);}
export function validateDecision(d:ResearchDecision,ctx:ResearchContext,concurrency:number){
 if(d.action==='finish'&&d.hypotheses.length||d.action==='experiment'&&(!d.hypotheses.length||d.hypotheses.length>concurrency||d.hypotheses.length>ctx.remainingWorkers))throw Error('Invalid allocation');
 const ids=new Set(ctx.records.map(c=>c.id));
 for(const h of d.hypotheses){if(ids.has(h.id))throw Error('Duplicate hypothesis');if(['cleanup','implementation'].includes(h.id)||h.id.startsWith('round-'))throw Error('Reserved hypothesis ID');ids.add(h.id);if(!ctx.records.some(c=>c.id===h.parent&&c.snapshot&&!c.discarded))throw Error('Unknown or discarded parent');}
 if(d.discard.some(id=>id==='baseline'||!ctx.records.some(c=>c.id===id)||d.hypotheses.some(h=>h.parent===id)))throw Error('Invalid discard');
}
/** Only verified measurements enter shared memory; worker statements remain labelled claims. */
export function researchContext(state:ResearchState,remainingMs:number):ResearchContext {
 return {goal:state.config.goal,round:state.round+1,remainingWorkers:state.config.maxWorkers-state.candidates.length,remainingMs,best:state.best,records:[state.baseline,...state.candidates].map(c=>({...c,worker:c.worker?{...c.worker,report:c.worker.report?.slice(0,5000)}:undefined})),decisions:state.history};
}
export async function runResearch(root:string,config:ResearchConfig,deps:ResearchDeps,external:AbortSignal,resume=false):Promise<ResearchState>{
 config=ResearchConfigSchema.parse(config);
 let state:ResearchState;
 if(resume){state=JSON.parse(await readFile(join(root,'state.json'),'utf8'));if(JSON.stringify(state.config)!==JSON.stringify(config))throw Error('Resume configuration changed');if(['completed','budget'].includes(state.status))throw Error('Run has ended');await deps.stop();if(state.status==='running'){const last=Date.parse(state.checkpointAt??state.startedAt);state.spentMs+=Math.max(0,Date.now()-last);}for(const c of state.candidates)if(['working','verifying'].includes(c.status))c.status='interrupted';state.status='running';delete state.error;delete state.endedAt;}
 else {await mkdir(dirname(root),{recursive:true});await mkdir(root);state={version:1,status:'running',config,startedAt:new Date().toISOString(),round:0,spentMs:0,best:'baseline',baseline:null as unknown as Candidate,history:[],candidates:[]};}
 const started=Date.now(),remaining=Math.max(1,config.totalMs-state.spentMs),signal=AbortSignal.any([external,AbortSignal.timeout(remaining)]);let writes=Promise.resolve();
 async function event(type:string,data:unknown){state.checkpointAt=new Date().toISOString();const snapshot=JSON.stringify({...state,spentMs:state.endedAt?state.spentMs:state.spentMs+Date.now()-started},null,2);writes=writes.then(async()=>{await appendFile(join(root,'events.jsonl'),JSON.stringify({at:new Date().toISOString(),type,data})+'\n');await writeFile(join(root,'state.tmp'),snapshot);for(let attempt=0;;attempt++){try{await rename(join(root,'state.tmp'),join(root,'state.json'));break;}catch(error){if(attempt>=7||!['EPERM','EACCES','EBUSY'].includes((error as NodeJS.ErrnoException).code??''))throw error;await new Promise(r=>setTimeout(r,25*(attempt+1)));}}});await writes;}
 try {
  await event(resume?'resumed':'started',config);
  if(!state.baseline){state.baseline=await deps.baseline(join(root,'baseline'),signal);await event('baseline',state.baseline);}
  if(!eligible(state.baseline))throw Error('Baseline did not pass complete verification');
  if(state.spentMs>=config.totalMs)state.status='budget';
  for(;state.status==='running'&&state.round<config.maxRounds&&state.candidates.length<config.maxWorkers;){
   signal.throwIfAborted();const ctx=researchContext(state,Math.max(0,remaining-(Date.now()-started)));const round=state.round+1,dir=join(root,`round-${round}-${state.history.length}`);await mkdir(dir);
   await writeFile(join(dir,'memory.json'),JSON.stringify(ctx,null,2));
   const decision=ResearchDecisionSchema.parse(await deps.decide(ctx,dir,signal));validateDecision(decision,ctx,config.concurrency);signal.throwIfAborted();
   state.history.push({round,decision});for(const id of decision.discard)state.candidates.find(c=>c.id===id)!.discarded=true;
   await event('decision',decision);
   if(decision.action==='finish'){state.status='completed';break;}
   // Reserve the round before dispatch so restart never repeats an already-spent allocation.
   state.round=round;const batch:Candidate[]=decision.hypotheses.map(h=>({id:h.id,round,hypothesis:h,status:'working'}));state.candidates.push(...batch);await event('allocated',batch);
   // Independent implementation contexts; external verification is serialized to cap RAM use.
   const workers=await Promise.allSettled(batch.map(async c=>{const workdir=join(root,c.id);await mkdir(workdir);try{const parent=ctx.records.find(p=>p.id===c.hypothesis.parent)!;if(hash(await readFile(parent.snapshot!.path))!==parent.snapshot!.sha256)throw Error('Parent snapshot changed');Object.assign(c,await deps.work(c.hypothesis,parent,workdir,signal));if(!c.snapshot||c.worker?.status==='error')throw Error('Worker infrastructure failure or missing snapshot'+(c.worker?.detail?`: ${c.worker.detail}`:''));c.status='verifying';}catch(e){c.status='error';c.evidence={status:'error',checks:{},detail:String(e),limitations:[]};}await event('worker_returned',c);}));
   const failedWrite=workers.find(r=>r.status==='rejected');if(failedWrite?.status==='rejected')throw failedWrite.reason;
   for(const c of batch){signal.throwIfAborted();if(c.status!=='verifying')continue;try{
    if(hash(await readFile(c.snapshot!.path))!==c.snapshot!.sha256)throw Error('Worker snapshot changed');
    c.evidence=await deps.verify(c.snapshot!,join(root,c.id,'verification'),signal);
    if(hash(await readFile(c.snapshot!.path))!==c.snapshot!.sha256)throw Error('Verified snapshot changed');
    c.status=c.evidence.status==='pass'?'verified':c.evidence.status==='fail'?'rejected':'error';
    if(c.evidence.status==='pass'&&!eligible(c))throw Error('Verifier returned incomplete or nonfinite metrics');
    const best=[state.baseline,...state.candidates].find(p=>p.id===state.best)!;
    if(eligible(c)&&c.evidence.metrics!.fitness>best.evidence!.metrics!.fitness)state.best=c.id;
   }catch(e){c.status='error';c.evidence={status:'error',checks:{},detail:String(e),limitations:[]};}await event('verified',c);}
   await event('round_completed',{round,best:state.best});
   if(batch.some(c=>c.evidence?.status==='error'))throw Error('Infrastructure error; evidence retained, repair environment before resuming');
  }
  if(state.status==='running')state.status='budget';
 }catch(e){state.status=signal.aborted?(external.aborted?'cancelled':'budget'):'error';state.error=String(e);}
 finally{try{await deps.stop();}catch(e){state.status='error';state.error='Cleanup failed: '+String(e);}for(const c of state.candidates)if(['working','verifying'].includes(c.status))c.status='interrupted';state.spentMs+=Date.now()-started;state.endedAt=new Date().toISOString();await event('ended',{status:state.status,best:state.best});}
 return state;
}

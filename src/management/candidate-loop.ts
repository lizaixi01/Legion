import {mkdir,mkdtemp,readFile,writeFile,rename,appendFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {hash} from '../provenance.js';
import {ResearchConfigSchema,normalizeResearchConfig,ResearchDecisionSchema,type Candidate,type Evidence,type Metrics,type QualityPolicy,type ResearchConfig,type ResearchContext,type ResearchDecision,type ResearchDeps,type ResearchState,type VerificationBatch} from './candidate-types.js';

export function eligible<M extends Metrics>(c:Candidate<M>,policy:QualityPolicy<M>):boolean {
 return c.status==='verified'&&c.evidence?.status==='pass'&&!verificationHasInfrastructureError(c.evidence,policy)&&Boolean(c.snapshot)&&policy.validMetrics(c.evidence?.metrics);
}
export function verificationHasInfrastructureError<M extends Metrics>(e:Evidence<M>|undefined,policy:QualityPolicy<M>):boolean {
 return e?.status==='error'||e?.status==='timeout'||e?.infrastructureError===true||policy.hasInfrastructureError?.(e)===true;
}
export function validateDecision<M extends Metrics>(d:ResearchDecision,ctx:ResearchContext<M>,concurrency:number){
 if(d.action==='finish'&&d.hypotheses.length||d.action==='experiment'&&(!d.hypotheses.length||d.hypotheses.length>concurrency||d.hypotheses.length>ctx.remainingWorkers))throw Error('Invalid allocation');
 const ids=new Set(ctx.records.map(c=>c.id));
 for(const h of d.hypotheses){if(ids.has(h.id))throw Error('Duplicate hypothesis');if(['cleanup','implementation'].includes(h.id)||h.id.startsWith('round-'))throw Error('Reserved hypothesis ID');ids.add(h.id);if(!ctx.records.some(c=>c.id===h.parent&&c.snapshot&&!c.discarded))throw Error('Unknown or discarded parent');}
 if(d.discard.some(id=>id==='baseline'||!ctx.records.some(c=>c.id===id)||d.hypotheses.some(h=>h.parent===id)))throw Error('Invalid discard');
}
/** Only verified measurements enter shared memory; worker statements remain labelled claims. */
export function researchContext<M extends Metrics>(state:ResearchState<M>,remainingMs:number):ResearchContext<M> {
 return {goal:state.config.goal,round:state.round+1,remainingWorkers:state.config.maxWorkers-state.candidates.length,remainingMs,best:state.best,records:[state.baseline,...state.candidates].map(c=>({...c,worker:c.worker?{...c.worker,report:c.worker.report?.slice(0,5000)}:undefined})),decisions:state.history};
}
export async function runCandidateLoop<M extends Metrics>(root:string,config:ResearchConfig,deps:ResearchDeps<M>,policy:QualityPolicy<M>,external:AbortSignal,resume=false,legacyPolicyId?:string):Promise<ResearchState<M>>{
 config=ResearchConfigSchema.parse(config);
 if(!/^[a-z][a-z0-9-]{0,127}$/.test(policy.id))throw Error('Invalid quality policy identity');
 const policyFile=join(root,'quality-policy.json');
 if(resume){
  let saved:unknown;
  try{saved=JSON.parse(await readFile(policyFile,'utf8'));}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT'||legacyPolicyId!==policy.id)throw error;}
  if(saved!==undefined&&(typeof saved!=='object'||saved===null||(saved as {id?:unknown}).id!==policy.id))throw Error('Resume quality policy changed');
 }
 let state:ResearchState<M>;
 if(resume){state=JSON.parse(await readFile(join(root,'state.json'),'utf8'));if(JSON.stringify(normalizeResearchConfig(state.config))!==JSON.stringify(normalizeResearchConfig(config)))throw Error('Resume configuration changed');if(['completed','budget'].includes(state.status))throw Error('Run has ended');if(state.status==='running'){const last=Date.parse(state.checkpointAt??state.startedAt);state.spentMs+=Math.max(0,Date.now()-last);}for(const c of state.candidates)if(['working','verifying'].includes(c.status)){c.status='interrupted';if(c.verification)c.verification.interruption='Unclean checkpoint; allocation remains consumed';}state.resumed=true;state.status='running';delete state.error;delete state.endedAt;}
 else {await mkdir(dirname(root),{recursive:true});await mkdir(root);state={version:1,status:'running',config,startedAt:new Date().toISOString(),round:0,spentMs:0,best:'baseline',baseline:null as unknown as Candidate<M>,history:[],candidates:[]};}
 if(!resume)await writeFile(policyFile,JSON.stringify({id:policy.id}),{flag:'wx'});
 const started=Date.now(),remaining=Math.max(1,config.totalMs-state.spentMs),deadline=new AbortController();
 const timer=setTimeout(()=>deadline.abort(new DOMException('Run time budget exhausted','TimeoutError')),remaining);timer.unref();
 const signal=AbortSignal.any([external,deadline.signal]);let writes=Promise.resolve(),persistenceFailed=false;
 function addError(message:string){state.error=[state.error,message].filter(Boolean).join('\n');}
 async function event(type:string,data:unknown){
  const at=new Date().toISOString();state.checkpointAt=at;
  // Capture both records now: later sibling mutations must not change an earlier event.
  const line=JSON.stringify({at,type,data})+'\n',snapshot=JSON.stringify({...state,spentMs:state.endedAt?state.spentMs:state.spentMs+Date.now()-started},null,2);
  const pending=writes.then(async()=>{await appendFile(join(root,'events.jsonl'),line);await writeFile(join(root,'state.tmp'),snapshot);for(let attempt=0;;attempt++){try{await rename(join(root,'state.tmp'),join(root,'state.json'));break;}catch(error){if(attempt>=7||!['EPERM','EACCES','EBUSY'].includes((error as NodeJS.ErrnoException).code??''))throw error;await new Promise(r=>setTimeout(r,25*(attempt+1)));}}});
  // A failed checkpoint stops dispatch, but must not poison the final save after drain/cleanup.
  writes=pending.catch(error=>{persistenceFailed=true;state.status='error';const message=`State persistence failed (${type}): ${String(error)}`;(state.persistenceErrors??=[]).push(message);addError(message);});
  await pending;
 }
 function selectBest(){
  if(!state.baseline||!eligible(state.baseline,policy))return;
  let best=state.baseline;
  // Strict comparison in allocation order preserves serial ties, including the baseline.
  for(const c of state.candidates)if(eligible(c,policy)&&policy.better(c.evidence!.metrics!,best.evidence!.metrics!))best=c;
  state.best=best.id;
 }
 async function verifyBatch(batch:Candidate<M>[],round:number,produce:(enqueue:(c:Candidate<M>)=>Promise<void>,halt:()=>void,stopped:()=>boolean)=>Promise<void>){
  const concurrency=config.verificationConcurrency??1,pipeline=config.verificationScheduling==='worker-ready';
  const queue:Candidate<M>[]=[];
  let active=0,maxActive=0,halted=batch.some(c=>verificationHasInfrastructureError(c.evidence,policy));
  let producerDone=false,producerError:unknown;const waiters=new Set<()=>void>();
  const wake=()=>{for(const resolve of waiters)resolve();waiters.clear();};
  const stopped=()=>halted||signal.aborted||persistenceFailed;
  const halt=()=>{halted=true;wake();};
  const aborted=()=>wake();signal.addEventListener('abort',aborted,{once:true});
  async function enqueue(c:Candidate<M>){
   c.verification={queuedAt:new Date().toISOString()};
   if(pipeline)await event('verification_queued',{round,concurrency,candidates:[c.id],queuedAt:c.verification.queuedAt});
   queue.push(c);queue.sort((a,b)=>batch.indexOf(a)-batch.indexOf(b));if(pipeline)wake();
  }
  async function slot(){
   while(!stopped()){
    if(!queue.length||!pipeline&&!producerDone){if(producerDone)break;await new Promise<void>(resolve=>waiters.add(resolve));continue;}
    const c=queue.shift()!,timing=c.verification!,snapshot=Object.freeze({...c.snapshot!});
    const began=Date.now();timing.startedAt=new Date(began).toISOString();timing.queueMs=began-Date.parse(timing.queuedAt);
    active++;maxActive=Math.max(maxActive,active);
    try{
     await event('verification_started',{id:c.id,round,snapshot,verification:timing,active,concurrency});
     signal.throwIfAborted();
     if(halted||persistenceFailed){c.status='interrupted';timing.interruption='Dispatch stopped before verifier invocation';continue;}
     if(hash(await readFile(snapshot.path))!==snapshot.sha256)throw Error('Worker snapshot changed');
     signal.throwIfAborted();
     if(halted||persistenceFailed){c.status='interrupted';timing.interruption='Dispatch stopped before verifier invocation';continue;}
     try{c.evidence=await deps.verify(snapshot,join(root,c.id,'verification'),signal);}
     catch(error){halt();timing.error=String(error);throw error;}
     finally{
      // Stop new dispatch as soon as a returned fault is known, before asynchronous hash checks.
      if(verificationHasInfrastructureError(c.evidence,policy)||c.evidence?.status==='pass'&&!policy.validMetrics(c.evidence.metrics))halt();
      if(hash(await readFile(snapshot.path))!==snapshot.sha256)throw Error('Verified snapshot changed');
     }
     signal.throwIfAborted();
     c.status=c.evidence.status==='pass'?'verified':c.evidence.status==='fail'?'rejected':'error';
     if(c.evidence.status==='pass'&&verificationHasInfrastructureError(c.evidence,policy))c.status='error';
     else if(c.evidence.status==='pass'&&!eligible(c,policy))throw Error('Verifier returned incomplete or nonfinite metrics');
    }catch(error){
     if(signal.aborted){c.status='interrupted';c.failureKind=external.aborted?'cancelled':'budget';timing.interruption=String(error);}
     else {halt();c.failureKind='infrastructure';c.status='error';timing.error=timing.error&&timing.error!==String(error)?`${timing.error}\n${String(error)}`:String(error);}
     // Preserve raw evidence (including simultaneous FAIL and infrastructure ERROR).
     c.evidence??={status:signal.aborted?'timeout':'error',checks:{},detail:String(error),limitations:[]};
    }finally{
     const ended=Date.now();timing.endedAt=new Date(ended).toISOString();timing.durationMs=ended-began;active--;selectBest();
     if(verificationHasInfrastructureError(c.evidence,policy)&&!c.failureKind)c.failureKind='infrastructure';
     try{await event('verified',c);}catch{halt();}
    }
   }
  }
  // Drain every started slot, even if a verifier, checkpoint or cancellation fails.
  const producer=produce(enqueue,halt,stopped).then(async()=>{if(!pipeline)await event('verification_queued',{round,concurrency,candidates:queue.map(c=>c.id)});}).catch(error=>{producerError=error;halt();}).finally(()=>{producerDone=true;wake();});
  const settled=await Promise.allSettled([producer,...Array.from({length:concurrency},()=>slot().catch(error=>{halt();throw error;}))]);
  signal.removeEventListener('abort',aborted);
  for(const c of batch)if(c.status==='verifying'){c.status='interrupted';c.failureKind=signal.aborted?(external.aborted?'cancelled':'budget'):'infrastructure';if(c.verification)c.verification.interruption=signal.aborted?'Run cancelled or time budget exhausted':'Dispatch stopped after infrastructure or persistence failure';}
  selectBest();
  const ended=Date.now(),firstQueued=batch.flatMap(c=>c.verification?[Date.parse(c.verification.queuedAt)]:[]),start=firstQueued.length?Math.min(...firstQueued):ended,summary:VerificationBatch={round,concurrency,queuedAt:new Date(start).toISOString(),endedAt:new Date(ended).toISOString(),wallMs:ended-start,executionMsSum:batch.reduce((sum,c)=>sum+(c.verification?.durationMs??0),0),maxActive,started:batch.filter(c=>c.verification?.startedAt).length,finished:batch.filter(c=>c.verification?.endedAt).length};
  (state.verificationBatches??=[]).push(summary);await event('verification_batch_completed',summary);
  const failed=settled.find(r=>r.status==='rejected');if(failed?.status==='rejected')throw failed.reason;
  if(producerError)throw producerError;
  signal.throwIfAborted();
  if(persistenceFailed)throw Error('State persistence failed; no further dispatch');
  if(halted)throw Error('Infrastructure error or verification timeout; evidence retained, repair environment before resuming');
 }
 try {
  if(resume)await deps.stop();
  await event(resume?'resumed':'started',state.config);
  if(!state.baseline){state.baseline=await deps.baseline(join(root,'baseline'),signal);await event('baseline',state.baseline);}
  if(!eligible(state.baseline,policy))throw Error('Baseline did not pass complete verification');
  if(state.spentMs>=config.totalMs)state.status='budget';
  for(;state.status==='running'&&state.round<config.maxRounds&&state.candidates.length<config.maxWorkers;){
   signal.throwIfAborted();const ctx=researchContext(state,Math.max(0,remaining-(Date.now()-started)));const round=state.round+1,base=join(root,`round-${round}-${state.history.length}`);let dir=base;
   try{await mkdir(dir);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;dir=await mkdtemp(base+'-retry-');}
   await writeFile(join(dir,'memory.json'),JSON.stringify(ctx,null,2));
   await event('decision_started',{round,directory:dir});
   const decision=ResearchDecisionSchema.parse(await deps.decide(ctx,dir,signal));validateDecision(decision,ctx,config.allocationsPerRound??config.concurrency);signal.throwIfAborted();
   state.history.push({round,decision});for(const id of decision.discard)state.candidates.find(c=>c.id===id)!.discarded=true;
   await event('decision',decision);
   if(decision.action==='finish'){state.status='completed';break;}
   // Reserve the round before dispatch so restart never repeats an already-spent allocation.
   state.round=round;const batch:Candidate<M>[]=decision.hypotheses.map(h=>({id:h.id,round,hypothesis:h,status:'working'}));state.candidates.push(...batch);await event('allocated',batch);
   await verifyBatch(batch,round,async(enqueue,halt,stopped)=>{
    const queuedAt=new Date().toISOString();for(const c of batch)c.workerTiming={queuedAt};
    await event('workers_queued',{round,candidates:batch.map(c=>c.id),concurrency:config.concurrency});
    let next=0,active=0;
    async function workerSlot(){
     while(!stopped()&&next<batch.length){
      const c=batch[next++]!,timing=c.workerTiming!,began=Date.now();timing.startedAt=new Date(began).toISOString();timing.queueMs=began-Date.parse(queuedAt);active++;
      try{
       await event('worker_started',{id:c.id,round,active,concurrency:config.concurrency});signal.throwIfAborted();
       if(stopped()){c.status='interrupted';timing.interruption='Dispatch stopped before Worker invocation';continue;}
       const workdir=join(root,c.id);await mkdir(workdir);const source=ctx.records.find(p=>p.id===c.hypothesis.parent)!,snapshot=Object.freeze({...source.snapshot!}),parent={...source,snapshot};
       if(hash(await readFile(snapshot.path))!==snapshot.sha256)throw Error('Parent snapshot changed');
       signal.throwIfAborted();if(stopped()){c.status='interrupted';timing.interruption='Dispatch stopped before Worker invocation';continue;}
       Object.assign(c,await deps.work(c.hypothesis,parent,workdir,signal));
       if(c.snapshot)c.snapshot=Object.freeze({...c.snapshot});
       if(hash(await readFile(snapshot.path))!==snapshot.sha256)throw Error('Parent snapshot changed after Worker');
       signal.throwIfAborted();
       if(!c.snapshot||c.worker?.status==='error'){c.failureKind=c.worker?.failureKind??(c.worker?.detail?'model':'infrastructure');throw Error('Worker infrastructure failure or missing snapshot'+(c.worker?.detail?`: ${c.worker.detail}`:''));}
       if(config.verificationScheduling==='worker-ready'&&hash(await readFile(c.snapshot.path))!==c.snapshot.sha256)throw Error('Worker snapshot changed');
       c.status='verifying';
      }catch(error){halt();c.status=signal.aborted?'interrupted':'error';c.failureKind=signal.aborted?(external.aborted?'cancelled':'budget'):c.failureKind??'infrastructure';timing.error=String(error);c.evidence={status:signal.aborted?'timeout':'error',checks:{},detail:String(error),limitations:[]};}
      finally{timing.endedAt=new Date().toISOString();timing.durationMs=Date.parse(timing.endedAt)-began;active--;await event('worker_returned',c);}
      if(c.status==='verifying'&&config.verificationScheduling==='worker-ready')await enqueue(c);
     }
    }
    const workers=await Promise.allSettled(Array.from({length:Math.min(config.concurrency,batch.length)},()=>workerSlot().catch(error=>{halt();throw error;})));
    for(const c of batch)if(c.status==='working'){c.status='interrupted';c.failureKind=signal.aborted?(external.aborted?'cancelled':'budget'):'infrastructure';c.workerTiming!.interruption='Allocation consumed; no further dispatch';}
    const failed=workers.find(r=>r.status==='rejected');if(failed?.status==='rejected')throw failed.reason;
    if(config.verificationScheduling!=='worker-ready')for(const c of batch)if(c.status==='verifying')await enqueue(c);
   });
   await event('round_completed',{round,best:state.best});
  }
  if(state.status==='running')state.status='budget';
 }catch(e){state.status=persistenceFailed?'error':signal.aborted?(external.aborted?'cancelled':'budget'):'error';addError(String(e));}
 finally{
  clearTimeout(timer);
  try{await deps.stop();state.cleanup={status:'completed',at:new Date().toISOString()};}catch(e){state.status='error';state.cleanup={status:'error',at:new Date().toISOString(),detail:String(e)};addError('Cleanup failed: '+String(e));}
  for(const c of state.candidates)if(['working','verifying'].includes(c.status))c.status='interrupted';
  selectBest();state.spentMs+=Date.now()-started;state.endedAt=new Date().toISOString();
  try{await event('ended',{status:state.status,best:state.best,cleanup:state.cleanup});}catch{/* The returned result exposes an unavailable final checkpoint. */}
  await writes;
 }
 return state;
}

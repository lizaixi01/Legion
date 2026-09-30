import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {runTeam,type TeamConfig,type TeamDependencies,type TeamState} from './team.js';
import {hash} from './provenance.js';

/** Environment-specific effects; final grading is deliberately outside the decision loop. */
export interface ExecutionAdapter {
  prepare(signal:AbortSignal):Promise<Record<string,unknown>>;
  worker:TeamDependencies['worker'];
  check:TeamDependencies['check'];
  collect(team:TeamState,signal:AbortSignal):Promise<{path:string;sha256:string}>;
  stop():Promise<void>;
  grade(selected:{path:string;sha256:string},signal:AbortSignal):Promise<unknown>;
}
export async function runAdapter(root:string,config:Omit<TeamConfig,'runDir'>,adapter:ExecutionAdapter,signal:AbortSignal,options:{gradeCompletedBaseline?:boolean;policy?:Pick<TeamDependencies,'decide'|'canVerify'>}={}){
  if(options.gradeCompletedBaseline&&(config.competition||config.tasks.length!==1||config.maxAttempts!==1))throw Error('Baseline requires exactly one task and one worker call');
  await mkdir(root);let state:Record<string,unknown>={status:'preparing',startedAt:new Date().toISOString()};
  const save=()=>writeFile(join(root,'execution.json'),JSON.stringify(state,null,2));await save();

  try {
    const provenance=await adapter.prepare(signal);await writeFile(join(root,'provenance.json'),JSON.stringify(provenance,null,2));
    signal.throwIfAborted();state.status='running';await save();
    const team=await runTeam({...config,runDir:join(root,'team')},{worker:adapter.worker,check:adapter.check,signal,...options.policy});
    const baselineFinished=options.gradeCompletedBaseline&&Object.values(team.tasks).every(t=>t.attempts.length===1&&((t.attempts[0]?.worker.status==='completed'&&t.status==='failed')||t.attempts[0]?.worker.status==='timeout'));
    if(team.status!=='completed'&&!baselineFinished){state.status=signal.aborted?'cancelled':'incomplete';return state;}
    signal.throwIfAborted();state.publicChecksPassed=team.status==='completed';state.workerTimedOut=Object.values(team.tasks).some(t=>t.attempts.some(a=>a.worker.status==='timeout'));
    const selected=await adapter.collect(team,signal);
    if(hash(await readFile(selected.path))!==selected.sha256)throw Error('Selected artifact hash mismatch');
    // Freeze the decision before any hidden score can exist. Never send grading back to agents.
    await writeFile(join(root,'selection.json'),JSON.stringify(selected,null,2),{flag:'wx'});
    await adapter.stop();signal.throwIfAborted();
    state.status='grading';await save();
    const grade=await adapter.grade(selected,signal);
    signal.throwIfAborted();
    if(hash(await readFile(selected.path))!==selected.sha256)throw Error('Submission changed during grading');
    await writeFile(join(root,'grade.json'),JSON.stringify(grade,null,2));state={...state,status:'evaluated',selected,grade};
  }catch(error){state={...state,status:signal.aborted?'cancelled':'error',error:String(error)};}
  finally {
    try{await adapter.stop();}catch(error){state={...state,status:'error',cleanupError:String(error)};}
    state.endedAt=new Date().toISOString();await save();
  }
  return state;
}

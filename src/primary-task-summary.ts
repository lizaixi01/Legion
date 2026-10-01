import type {Result} from './worker-pool.js';

interface Attempt {
 attempt:number;status:string;logs:string;result?:Result;
 submission?:{status:string;snapshot?:string;artifactHash?:string;detail?:string};
}
interface Task {
 id:string;status:string;backend:string;attempt:number;workspace:string;logs:string;
 decisionId?:string;allocationId?:string;ownerTurn?:string;result?:Result;history?:Attempt[];
 contract?:{goal:string;outputs:string[];acceptance:string[]};
}

/** Preserve both the opening context and the final failure/conclusion; raw records stay intact. */
function excerpt(value:string|undefined,limit:number){
 if(value===undefined)return undefined;
 if(value.length<=limit)return {text:value,truncated:false,originalLength:value.length};
 const half=Math.floor(limit/2);let head=value.slice(0,half),tail=value.slice(-half);
 if(/[\uD800-\uDBFF]$/.test(head))head=head.slice(0,-1);
 if(/^[\uDC00-\uDFFF]/.test(tail))tail=tail.slice(1);
 return {text:head+'\n[... omitted; read original record ...]\n'+tail,truncated:true,originalLength:value.length};
}

export function taskSummary(task:Task,record:string){
 const attempts=task.history??[],latest=attempts.at(-1),result=task.result??latest?.result;
 return {
  id:task.id,status:task.status,backend:task.backend,attempt:task.attempt,
  decisionId:task.decisionId,allocationId:task.allocationId,ownerTurn:task.ownerTurn,
  workspace:task.workspace,record,logs:task.logs,trust:'unverified' as const,
  claim:excerpt(result?.text,2000),detail:excerpt(result?.detail,1000),
  contract:task.contract?{goal:excerpt(task.contract.goal,500),outputs:task.contract.outputs.slice(0,8),omittedOutputs:Math.max(0,task.contract.outputs.length-8),criteria:task.contract.acceptance.slice(0,3).map(c=>excerpt(c,400)),omittedCriteria:Math.max(0,task.contract.acceptance.length-3)}:undefined,
  attemptCounts:attempts.reduce<Record<string,number>>((counts,a)=>{counts[a.status]=(counts[a.status]??0)+1;return counts;},Object.create(null) as Record<string,number>),
  recentAttempts:attempts.slice(-3).map(a=>({attempt:a.attempt,status:a.status,logs:a.logs,detail:excerpt(a.result?.detail,500),submission:a.submission?{status:a.submission.status,snapshot:a.submission.snapshot,artifactHash:a.submission.artifactHash,detail:excerpt(a.submission.detail,500)}:undefined})),
  omittedAttempts:Math.max(0,attempts.length-3),
  note:'Host-extracted excerpts, not verification. Counts include prior failures. Read the original contract and referenced evidence before integration; use read for full attempt history. No task is launched by summary.',
 };
}

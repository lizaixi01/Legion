import {readFile,readdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {ResearchState} from './management/candidate-types.js';

export function sumUsage(values:unknown[]) {
 let input=0,cached=0,output=0,records=0;
 for(const value of values){
  if(!value||typeof value!=='object')continue;
  const u=value as Record<string,unknown>;
  if(typeof u.input_tokens!=='number'||typeof u.output_tokens!=='number')continue;
  if(!Number.isFinite(u.input_tokens)||!Number.isFinite(u.output_tokens)||u.input_tokens<0||u.output_tokens<0)continue;
  input+=u.input_tokens;output+=u.output_tokens;
  cached+=typeof u.cached_input_tokens==='number'?u.cached_input_tokens:0;records++;
 }
 return {inputTokens:input,cachedInputTokens:cached,outputTokens:output,totalTokens:input+output,records};
}
export async function researchSummary(root:string,currentState?:ResearchState){
 const state=currentState??JSON.parse(await readFile(join(root,'state.json'),'utf8')) as ResearchState;
 const manager:unknown[]=[],attempts=(await readdir(root)).filter(name=>name.startsWith('round-'));let managerAttemptsWithUsage=0;
 for(const name of attempts){
  try{const log=JSON.parse(await readFile(join(root,name,'usage.json'),'utf8'));if(!Array.isArray(log.usage))continue;manager.push(...log.usage);if(sumUsage(log.usage).records)managerAttemptsWithUsage++;}catch{/* Failed manager calls may have no usage. */}
 }
 const workers=state.candidates.flatMap(c=>Array.isArray(c.worker?.usage)?c.worker.usage:[]);
 const best=[state.baseline,...state.candidates].find(c=>c?.id===state.best);
 const verification={concurrency:state.config.verificationConcurrency??1,batches:state.verificationBatches??null,batchWallMsSum:state.verificationBatches?.reduce((sum,b)=>sum+b.wallMs,0)??null,executionMsSum:state.verificationBatches?.reduce((sum,b)=>sum+b.executionMsSum,0)??null,candidates:state.candidates.map(c=>({id:c.id,status:c.status,snapshot:c.snapshot,verification:c.verification??null}))};
 const report={status:state.status,error:state.error,cleanup:state.cleanup??null,persistenceErrors:state.persistenceErrors??[],verification,best:state.best,baseline:state.baseline?.evidence,bestEvidence:best?.evidence,wallMs:state.spentMs,manager:sumUsage(manager),workers:sumUsage(workers),total:sumUsage([...manager,...workers]),usageCoverage:{managerDecisions:state.history.length,managerAttemptDirectories:attempts.length,managerAttemptsWithUsage,managerAttemptsWithoutUsage:attempts.length-managerAttemptsWithUsage,managerRecords:manager.length,workerCalls:state.candidates.length,workersWithUsage:state.candidates.filter(c=>Array.isArray(c.worker?.usage)&&c.worker.usage.length).length},config:state.config,limitations:['Token totals sum valid observed records only, include cached input once, and are not guaranteed complete cost.','Manager attempt directories include preparation and failed/retried decisions; they are not confirmed provider call counts.','Unavailable usage is unknown cost, not a free attempt.','This is one local task, not an estimate of general success rate.','Verification executionMsSum adds overlapping slot durations; only batchWallMsSum measures verification batches wall time. Missing legacy timings are null.']};
 await writeFile(join(root,'summary.json'),JSON.stringify(report,null,2));return report;
}

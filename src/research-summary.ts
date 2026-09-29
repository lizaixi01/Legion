import {readFile,readdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {ResearchState} from './research-loop.js';

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
export async function researchSummary(root:string){
 const state=JSON.parse(await readFile(join(root,'state.json'),'utf8')) as ResearchState;
 const manager:unknown[]=[];
 for(const name of await readdir(root))if(name.startsWith('round-')){
  try{const log=JSON.parse(await readFile(join(root,name,'usage.json'),'utf8'));manager.push(...log.usage);}catch{/* Failed manager calls may have no usage. */}
 }
 const workers=state.candidates.flatMap(c=>Array.isArray(c.worker?.usage)?c.worker.usage:[]);
 const best=[state.baseline,...state.candidates].find(c=>c?.id===state.best);
 const report={status:state.status,best:state.best,baseline:state.baseline?.evidence,bestEvidence:best?.evidence,wallMs:state.spentMs,manager:sumUsage(manager),workers:sumUsage(workers),total:sumUsage([...manager,...workers]),usageCoverage:{managerDecisions:state.history.length,managerRecords:manager.length,workerCalls:state.candidates.length,workersWithUsage:state.candidates.filter(c=>Array.isArray(c.worker?.usage)&&c.worker.usage.length).length},config:state.config,limitations:['Token totals include cached input; unavailable usage is not assumed zero cost.','This is one local task, not an estimate of general success rate.']};
 await writeFile(join(root,'summary.json'),JSON.stringify(report,null,2));return report;
}

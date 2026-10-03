import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export const experimentArms=['single','multi','multi_verified'] as const;
export type ExperimentArm=typeof experimentArms[number];
export interface ExperimentCost {
 inputTokens:number|null;cachedInputTokens:number|null;outputTokens:number|null;
 wallMs:number|null;moneyUsd:number|null;humanMinutes:number|null;
}
export interface ExperimentTask {
 id:string;baselineCommit:string|null;inputsSha256:string|null;evaluatorSha256:string|null;
}
export type FailureCategory='requirements'|'implementation'|'integration'|'budget_or_deadline'|'unknown';
export interface ExperimentRun {
 taskId:string;arm:ExperimentArm;state:'pending'|'graded'|'infrastructure_failure';
 termination:'completed'|'budget'|'deadline'|'error'|null;
 grade:'pass'|'fail'|'error'|'unverified'|null;evidence:string|null;
 failure:{category:FailureCategory;evidence:string}|null;costs:ExperimentCost;
 recoveryAttempts:{reason:string;evidence:string;costs:ExperimentCost}[];
}
export interface ExperimentStudy {
 schemaVersion:1;studyId:string;phase:'pilot'|'confirmatory';frozen:boolean;
 protocolSha256:string|null;taskSetSha256:string|null;tasks:ExperimentTask[];runs:ExperimentRun[];
}
const costFields=['inputTokens','cachedInputTokens','outputTokens','wallMs','moneyUsd','humanMinutes'] as const;
const failureCategories=['requirements','implementation','integration','budget_or_deadline','unknown'] as const;
const blankCost:ExperimentCost={inputTokens:null,cachedInputTokens:null,outputTokens:null,wallMs:null,moneyUsd:null,humanMinutes:null};
export interface CostQuantity {knownSum:number|null;knownRecords:number;unknownRecords:number}
export type ExperimentCostSummary=Record<keyof ExperimentCost,CostQuantity>&{totalTokens:CostQuantity;uncachedInputTokens:CostQuantity};
function object(value:unknown,path:string):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error(`${path}: expected object`);
 return value as Record<string,unknown>;
}
function keys(value:Record<string,unknown>,expected:readonly string[],path:string){
 if(Object.keys(value).some(k=>!expected.includes(k))||expected.some(k=>!Object.hasOwn(value,k)))throw Error(`${path}: unexpected or missing fields`);
}
function nonempty(value:unknown,path:string):asserts value is string{if(typeof value!=='string'||!value.trim())throw Error(`${path}: expected nonempty string`);}
function choice(value:unknown,values:readonly unknown[],path:string){if(!values.includes(value))throw Error(`${path}: invalid value`);}
function list(value:unknown,path:string):unknown[]{if(!Array.isArray(value))throw Error(`${path}: expected array`);return value;}
function sha(value:unknown,path:string,commit=false){
 if(value!==null&&(typeof value!=='string'||!(commit?/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/:/^[0-9a-f]{64}$/).test(value)))throw Error(`${path}: invalid hash`);
}
function cost(value:unknown,path:string){
 const c=object(value,path);keys(c,costFields,path);
 for(const field of costFields){const n=c[field];if(n!==null&&(typeof n!=='number'||!Number.isFinite(n)||n<0||(!['moneyUsd','humanMinutes'].includes(field)&&!Number.isSafeInteger(n))))throw Error(`${path}.${field}: expected nonnegative finite number or null`);}
 if(typeof c.inputTokens==='number'&&typeof c.cachedInputTokens==='number'&&c.cachedInputTokens>c.inputTokens)throw Error(`${path}: cached input exceeds input`);
}
/** Validates reporting inputs; this does not issue or authenticate acceptance evidence. */
export function validateExperimentStudy(input:unknown):ExperimentStudy {
 const s=object(input,'study');keys(s,['schemaVersion','studyId','phase','frozen','protocolSha256','taskSetSha256','tasks','runs'],'study');
 choice(s.schemaVersion,[1],'schemaVersion');nonempty(s.studyId,'studyId');choice(s.phase,['pilot','confirmatory'],'phase');choice(s.frozen,[true,false],'frozen');
 sha(s.protocolSha256,'protocolSha256');sha(s.taskSetSha256,'taskSetSha256');
 const tasks=list(s.tasks,'tasks'),ids=new Set<string>();if(!tasks.length)throw Error('tasks: at least one planned task is required');
 for(const [i,raw] of tasks.entries()){
  const p=`tasks[${i}]`,t=object(raw,p);keys(t,['id','baselineCommit','inputsSha256','evaluatorSha256'],p);nonempty(t.id,p+'.id');
  if(ids.has(t.id))throw Error('duplicate task '+t.id);ids.add(t.id);
  sha(t.baselineCommit,p+'.baselineCommit',true);sha(t.inputsSha256,p+'.inputsSha256');sha(t.evaluatorSha256,p+'.evaluatorSha256');
  if(s.frozen&&[t.baselineCommit,t.inputsSha256,t.evaluatorSha256].includes(null))throw Error(`${p}: frozen tasks need baseline, input and evaluator identities`);
 }
 if(s.frozen&&[s.protocolSha256,s.taskSetSha256].includes(null))throw Error('frozen studies need protocol and task-set hashes');
 const seen=new Set<string>();
 for(const [i,raw] of list(s.runs,'runs').entries()){
  const p=`runs[${i}]`,r=object(raw,p);keys(r,['taskId','arm','state','termination','grade','evidence','failure','costs','recoveryAttempts'],p);
  nonempty(r.taskId,p+'.taskId');if(!ids.has(r.taskId))throw Error(`${p}: unknown task`);choice(r.arm,experimentArms,p+'.arm');
  const id=JSON.stringify([r.taskId,r.arm]);if(seen.has(id))throw Error(`${p}: duplicate primary run; keep retries in recoveryAttempts`);seen.add(id);
  choice(r.state,['pending','graded','infrastructure_failure'],p+'.state');choice(r.grade,['pass','fail','error','unverified',null],p+'.grade');
  choice(r.termination,['completed','budget','deadline','error',null],p+'.termination');
  if(r.evidence!==null)nonempty(r.evidence,p+'.evidence');
  if(r.state==='graded'){if(r.grade===null||r.evidence===null)throw Error(`${p}: graded runs need an explicit final grade and evidence`);}
  else if(r.grade!==null)throw Error(`${p}: only a final graded run can have a grade`);
  if(r.state==='infrastructure_failure'&&r.evidence===null)throw Error(`${p}: infrastructure failures need evidence`);
  if(r.failure!==null){const f=object(r.failure,p+'.failure');keys(f,['category','evidence'],p+'.failure');choice(f.category,failureCategories,p+'.failure.category');nonempty(f.evidence,p+'.failure.evidence');if(r.grade!=='fail')throw Error(`${p}: solution failure attribution requires a final fail`);}
  cost(r.costs,p+'.costs');
  for(const [j,recovery] of list(r.recoveryAttempts,p+'.recoveryAttempts').entries()){
   const q=`${p}.recoveryAttempts[${j}]`,a=object(recovery,q);keys(a,['reason','evidence','costs'],q);nonempty(a.reason,q+'.reason');nonempty(a.evidence,q+'.evidence');cost(a.costs,q+'.costs');
  }
 }
 return input as ExperimentStudy;
}
function sum(values:(number|null)[]):CostQuantity{
 const known=values.filter((n):n is number=>n!==null);
 const knownSum=known.length?known.reduce((a,b)=>a+b,0):null;
 if(knownSum!==null&&!Number.isFinite(knownSum))throw Error('Cost total overflow');
 return {knownSum,knownRecords:known.length,unknownRecords:values.length-known.length};
}
function totalTokens(c:ExperimentCost){return c.inputTokens===null||c.outputTokens===null?null:c.inputTokens+c.outputTokens;}
function uncachedTokens(c:ExperimentCost){return c.inputTokens===null||c.cachedInputTokens===null?null:c.inputTokens-c.cachedInputTokens;}
export function reportExperiment(input:unknown){
 const s=validateExperimentStudy(input);
 const byArm=experimentArms.map(arm=>{
  const rows=s.tasks.map(t=>s.runs.find(r=>r.taskId===t.id&&r.arm===arm));
  const observed=rows.filter((r):r is ExperimentRun=>!!r),pending=rows.filter(r=>!r||r.state==='pending').length;
  const passes=observed.filter(r=>r.grade==='pass').length,solutionFailures=observed.filter(r=>r.grade==='fail').length;
  const infrastructureFailures=observed.filter(r=>r.state==='infrastructure_failure').length,evaluationErrors=observed.filter(r=>r.grade==='error').length,unverified=observed.filter(r=>r.grade==='unverified').length;
  const primary=rows.map(r=>r?.costs??blankCost),recoveries=observed.flatMap(r=>r.recoveryAttempts.map(a=>a.costs));
  const summarizeCosts=(costs:ExperimentCost[]):ExperimentCostSummary=>{
   const fields={} as Record<keyof ExperimentCost,CostQuantity>;
   for(const field of costFields)fields[field]=sum(costs.map(c=>c[field]));
   return {...fields,totalTokens:sum(costs.map(totalTokens)),uncachedInputTokens:sum(costs.map(uncachedTokens))};
  };
  const terminations=Object.fromEntries(['completed','budget','deadline','error','unknown'].map(status=>[status,observed.filter(r=>(r.termination??'unknown')===status).length]));
  const attribution:Record<string,number>=Object.fromEntries([...failureCategories,'infrastructure','evaluation_error','unverified'].map(k=>[k,0]));
  for(const r of observed){const category=r.state==='infrastructure_failure'?'infrastructure':r.grade==='error'?'evaluation_error':r.grade==='unverified'?'unverified':r.grade==='fail'?r.failure?.category??'unknown':null;if(category)attribution[category]!++;}
  return {arm,planned:s.tasks.length,observed:observed.length,pending,passes,solutionFailures,infrastructureFailures,evaluationErrors,unverified,terminations,
   endToEndPassAt1:s.frozen&&pending===0?passes/s.tasks.length:null,
   gradedSolutionPassRate:passes+solutionFailures?passes/(passes+solutionFailures):null,
   failureAttribution:attribution,recoveryAttempts:recoveries.length,
   costs:{primary:summarizeCosts(primary),recoveries:summarizeCosts(recoveries),allObserved:summarizeCosts([...primary,...recoveries])}};
 });
 const pairs=([['single','multi'],['multi','multi_verified'],['single','multi_verified']] as const).map(([first,second])=>{
  let bothPass=0,bothFail=0,onlyFirstPass=0,onlySecondPass=0;const excludedTasks:string[]=[];
  for(const task of s.tasks){
   const a=s.runs.find(r=>r.taskId===task.id&&r.arm===first),b=s.runs.find(r=>r.taskId===task.id&&r.arm===second);
   if(!a||!b||!['pass','fail'].includes(a.grade??'')||!['pass','fail'].includes(b.grade??'')){excludedTasks.push(task.id);continue;}
   if(a.grade==='pass'&&b.grade==='pass')bothPass++;else if(a.grade==='fail'&&b.grade==='fail')bothFail++;else if(a.grade==='pass')onlyFirstPass++;else onlySecondPass++;
  }
  return {first,second,pairedTasks:bothPass+bothFail+onlyFirstPass+onlySecondPass,bothPass,bothFail,onlyFirstPass,onlySecondPass,excludedTasks};
 });
 return {schemaVersion:1,studyId:s.studyId,phase:s.phase,frozen:s.frozen,protocolSha256:s.protocolSha256,taskSetSha256:s.taskSetSha256,
  interpretation:{evidenceAuthenticated:false,denominator:'All planned task-arm primary runs; infrastructure and evaluation failures are visible non-successes, not solution failures.',passAt1:'One primary full strategy run per task; internal workers are not independent pass@1 samples. No primary pass@1 until frozen and all task-arm primary runs in that arm have terminated.',costs:'Cached input is a subset of input. All-observed costs include primary runs and recorded recovery attempts. Missing values remain unknown. Money is recorded actual cost, never inferred from token counts.',scope:s.phase==='pilot'?'Development pilot; not a held-out estimate of generalization.':'Confirmatory label alone does not establish randomization, isolation or evaluator quality.'},arms:byArm,pairs};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const args=process.argv.slice(2);if(args.length!==1)throw Error('Usage: npm run --silent experiment:report -- <study.json>');console.log(JSON.stringify(reportExperiment(JSON.parse(await readFile(args[0]!,'utf8'))),null,2));}
 catch(error){console.error(String(error));process.exitCode=1;}
}

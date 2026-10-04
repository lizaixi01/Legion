import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {z} from 'zod';
import {ChallengeSchema,validateChallenge,verifySnapshot,hashOutputs,type Challenge,type ValidationAttempt} from './challenge.js';
import {freezeContract,captureCandidate,verifyCandidate,currentEvidence,builtinVerifiers,type Acceptance,type FrozenContract,type FunctionalEvidence,type VerifierRegistry,type Candidate} from './acceptance.js';
import type {WorkerSpec,Job,Result} from './worker-pool.js';
import {withinDeadline} from './deadline.js';

const Contract=z.object({goal:z.string().min(1).max(10000),outputs:z.array(z.string().min(1)).min(1).max(30),acceptance:z.array(z.string().min(1).max(2000)).min(1).max(20)}).strict();
const HistoricalAcceptance=z.object({status:z.enum(['pending','checking','accepted','rejected','unverified','blocked','not_applicable']),uncovered:z.array(z.string()),detail:z.string(),candidateId:z.string().optional(),evidence:z.string().optional(),evidenceStatus:z.enum(['pending','checking','accepted','rejected','unverified','blocked','not_applicable']).optional(),reviewStatus:z.enum(['accepted','needs_repair','unverified','infrastructure_failure','not_run']).optional(),failureClass:z.literal('reviewer_infrastructure_failure').optional(),limitations:z.array(z.string()).optional()});
const History=z.object({contract:Contract.extend({originalRequirement:z.string()}).strip(),acceptance:HistoricalAcceptance,versions:z.array(z.object({version:z.number().int().positive(),acceptance:HistoricalAcceptance})),challenge:ChallengeSchema.optional()});
const Input=z.discriminatedUnion('action',[
 z.object({action:z.literal('prepare'),contract:Contract}).strict(),
 z.object({action:z.literal('check')}).strict(),
 z.object({action:z.literal('read')}).strict(),
 z.object({action:z.literal('resume')}).strict(),
]);
export const deliveryTool={type:'function',name:'legion_delivery',description:'For file deliveries, prepare an immutable contract BEFORE implementation. After integrating worker artifacts into the project, check the root delivery. A fresh independent reviewer proposes checks, the host replays them against frozen files and applies installed functional verifiers. Repair failures and check again (max 3 checks). Read returns current and previous delivery evidence. For a user-requested repair in a later turn, resume the previous contract; this preserves requirements but requires fresh verification. New unrelated tasks use prepare. No arbitrary checker commands or model-declared PASS accepted.',inputSchema:z.toJSONSchema(Input)};
interface ReviewerAttempt {status:'running'|'completed'|'infrastructure_failure';phase:'proposal'|'replay';logDir:string;error?:string;result?:Result}
interface Version {version:number;acceptance:Acceptance;review?:ValidationAttempt;functional?:FunctionalEvidence;reviewer?:ReviewerAttempt}
export interface DeliveryState {inheritedFrom?:string;challenge?:Challenge;previous?:{source:string;goal:string;acceptance:Acceptance;versions:{version:number;acceptance:Acceptance}[]};contract?:FrozenContract;acceptance:Acceptance;versions:Version[]}
interface Dependencies {run:(spec:WorkerSpec,job:Job,signal?:AbortSignal)=>Promise<Result>;challenger:WorkerSpec;registry?:VerifierRegistry;challenge?:(contract:FrozenContract)=>Promise<unknown>}
function reviewerPrompt(contract:FrozenContract,candidate:Candidate){
 return `You are an independent reviewer. Do not delegate. Review only the original requirement and frozen candidate, without trusting implementation claims.
You have at most 180 seconds. Inspect the manifest first: ${candidate.manifestPath}. Outputs can be files or directories; manifest paths identify their contents. Missing references outside the frozen snapshot are limitations, not permission to search the original project or regenerate evidence.
You may use read-only terminal commands to inspect the snapshot. Prefer Node fs and JSON.parse for UTF-8 JSON: keys are case-sensitive (id and ID can coexist). Avoid PowerShell ConvertFrom-Json on raw platform evidence, complex shell quoting, and dumping entire directories or raw responses; inspect selected fields and bounded excerpts. Do not install packages, load unrelated workflows, modify files, access the network or resubmit benchmarks.
Return the requested JSON schema promptly: one Node ESM assertion script per exact acceptance criterion, using node:assert/strict and semantic expected/actual checks. The GENERATED SCRIPTS must use only fs, fs/promises, assert, assert/strict, path or url builtins, and must not write, use network, launch subprocesses or load third-party packages. Each script must fail if candidate files are absent. The host saves your final JSON; do not write the output file yourself.
Put unsupported requirements and incomplete evidence in limitations. A platform result is authoritative only through its trusted verifier; do not fabricate, replace, or treat self-reported scores as verified. Passing review checks is independent review evidence, not proof of full correctness.
${JSON.stringify({originalRequirement:contract.originalRequirement,contract,candidate})}`;
}
export function createPrimaryDelivery(workspace:string,directory:string,originalRequirement:string,deadline:number,enabled:boolean,deps:Dependencies,signal?:AbortSignal,previousFile?:string,continuity?:{file:string;objective:string}){
 if(continuity)previousFile=continuity.file;
 const state:DeliveryState={acceptance:{status:'unverified',uncovered:[],detail:'尚未登记交付要求，未进行独立验收'},versions:[]};
 let durable=true;let challenge:Challenge|undefined,tail:Promise<unknown>=Promise.resolve();
 let previous:z.infer<typeof History>|undefined;
 const ready=(async()=>{if(!previousFile)return;try{
  const raw=History.parse(JSON.parse(await readFile(previousFile,'utf8')));
  if(continuity&&raw.contract.originalRequirement!==continuity.objective)throw Error('Persistent delivery does not match original goal');
  previous=raw;state.previous={source:previousFile,goal:raw.contract.goal,acceptance:raw.acceptance,versions:raw.versions.map(v=>({version:v.version,acceptance:v.acceptance}))};
 }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')state.previous={source:previousFile,goal:'历史记录无法读取',acceptance:{status:'blocked',uncovered:[],detail:String(error)},versions:[]};}})();
 const live=()=>{if(signal?.aborted||Date.now()>=deadline)throw Error('Delivery cancelled or deadline exceeded');};
 const save=async()=>{durable=false;const data=JSON.stringify(state,null,2);for(const file of [join(directory,'delivery.json'),...(continuity?[continuity.file]:[])]){await mkdir(dirname(file),{recursive:true});await writeFile(file+'.tmp',data);await rename(file+'.tmp',file);}durable=true;};
 const serialize=<T>(fn:()=>Promise<T>)=>{const task=tail.then(fn);tail=task.catch(()=>{});return task;};
 const final=async():Promise<Acceptance>=>{
  if(!durable)return {...structuredClone(state.acceptance),status:'blocked',uncovered:state.contract?.acceptance??[],detail:'验收记录保存失败，不能确认交付'};
  if(state.contract&&(signal?.aborted||Date.now()>=deadline))return {...structuredClone(state.acceptance),status:'blocked',uncovered:state.contract.acceptance,detail:'验收已取消或超过截止时间'};
  const last=state.versions.at(-1);
  if((state.acceptance.status==='accepted'||state.acceptance.evidenceStatus==='accepted')&&(!state.contract||!last?.functional||!await currentEvidence(last.functional,state.contract,workspace))){state.acceptance={...state.acceptance,status:'blocked',evidenceStatus:'blocked',uncovered:state.contract?.acceptance??[],detail:'验收后产物发生变化或证据失效，请重新检查'};await save();}
  return structuredClone(state.acceptance);
 };
 return {
  call:(args:unknown)=>serialize(async()=>{
   await ready;live();const input=Input.parse(args);
   if(input.action==='read'){await final();return structuredClone(state);}
   if(input.action==='resume'){
    if(state.contract)throw Error('Delivery contract already registered');
    if(!previous?.contract)throw Error('No valid previous delivery to resume');
    const old=previous.contract;
    const restored=freezeContract('root',{goal:old.goal,outputs:old.outputs,acceptance:old.acceptance},old.originalRequirement,deadline);
    const restoredChallenge=previous.challenge?validateChallenge(previous.challenge,restored):undefined;
    state.contract=restored;challenge=restoredChallenge;
    state.challenge=challenge;state.inheritedFrom=previousFile;
    state.acceptance={status:'pending',uncovered:[...old.acceptance],detail:'已沿用原交付要求；历史结果仅供参考，当前文件必须重新检查'};
    await save();return structuredClone(state);
   }
   if(input.action==='prepare'){
    if(continuity&&state.previous)throw Error('Persistent goal must resume its original delivery contract');
    if(state.contract)throw Error('Delivery contract is frozen for this turn; repair the implementation without changing requirements');
    state.contract=freezeContract('root',input.contract,originalRequirement,deadline);
    state.acceptance={status:'pending',uncovered:[...input.contract.acceptance],detail:'交付要求已保存，等待候选与独立检查'};
    await save();return structuredClone(state);
   }
   if(!state.contract)throw Error('Prepare delivery requirements before checking');
   if(state.versions.length>=3)throw Error('Delivery check budget exhausted');
   const contract=state.contract,version=state.versions.length+1,dir=join(directory,'version-'+version);
   const entry:Version={version,acceptance:{status:'checking',uncovered:[...contract.acceptance],detail:'正在固定候选并检查'}};
   state.versions.push(entry);state.acceptance=entry.acceptance;await save();
   try{
    const candidate=await captureCandidate(contract,workspace,join(dir,'snapshot'),String(version));
    // Persist host evidence before a fallible model review. A reviewer cannot erase or certify it.
    entry.functional=await verifyCandidate(contract,candidate,join(dir,'functional'),deps.registry??builtinVerifiers,signal);
    await save();
    if(enabled){
     entry.reviewer={status:'running',phase:challenge?'replay':'proposal',logDir:join(dir,'challenger')};await save();
     try{
    if(enabled&&!challenge){
     const reviewDir=join(dir,'challenger');await mkdir(reviewDir,{recursive:true});
     const schema=join(reviewDir,'schema.json'),output=join(reviewDir,'challenge.json');await writeFile(schema,JSON.stringify(z.toJSONSchema(ChallengeSchema)));
     const raw=deps.challenge?await withinDeadline(deadline,signal,()=>deps.challenge!(contract)):await (async()=>{
      await writeFile(join(reviewDir,'prompt.txt'),reviewerPrompt(contract,candidate));
      const result=await deps.run({...deps.challenger,permission:'read-only',schemaPath:schema,outputPath:output},{id:'delivery-review',workspace:candidate.snapshot,logDir:join(reviewDir,'execution'),timeoutMs:Math.min(180000,deadline-Date.now()),prompt:reviewerPrompt(contract,candidate)},signal);
      entry.reviewer!.result=result;
      await writeFile(join(reviewDir,'usage.json'),JSON.stringify(result));live();if(result.status!=='completed')throw Error('Independent reviewer '+result.status+': '+(result.detail??''));return JSON.parse(await readFile(output,'utf8'));
     })();
     live();challenge=validateChallenge(raw,contract);state.challenge=challenge;await writeFile(join(reviewDir,'frozen-challenge.json'),JSON.stringify(challenge),{flag:'wx'});
    }
    if(challenge){entry.reviewer!.phase='replay';entry.review=await withinDeadline(deadline,signal,bounded=>verifySnapshot(contract,challenge!,candidate.snapshot,join(dir,'review'),version,bounded));}
    entry.reviewer!.status='completed';
    if(entry.review?.status==='error')throw Error('Independent review replay infrastructure failure; see '+join(dir,'review','verification.json'));
     }catch(error){entry.reviewer!.status='infrastructure_failure';entry.reviewer!.error=String(error);}
     await mkdir(entry.reviewer.logDir,{recursive:true});await writeFile(join(entry.reviewer.logDir,'attempt.json'),JSON.stringify(entry.reviewer,null,2));
    }
    live();if(await hashOutputs(workspace,contract.outputs)!==candidate.artifactHash)throw Error('Delivery changed during verification');
    entry.acceptance=structuredClone(entry.functional.acceptance);
    entry.acceptance.evidenceStatus=entry.functional.acceptance.status;
    entry.acceptance.reviewStatus=entry.reviewer?.status==='infrastructure_failure'?'infrastructure_failure':entry.review?.status==='error'?'infrastructure_failure':entry.review?.status??'not_run';
    entry.acceptance.limitations=[...(entry.functional.acceptance.status!=='accepted'?[entry.functional.acceptance.detail]:[]),...(challenge?.limitations??[]),...(entry.review?.checks.filter(check=>check.status!=='pass').map(check=>`${check.criterion}: ${check.detail}`)??[]),...(entry.reviewer?.error?[entry.reviewer.error]:[]),...(!enabled?['Independent review disabled']:[])];
    if(entry.reviewer?.status==='infrastructure_failure')entry.acceptance.failureClass='reviewer_infrastructure_failure';
    // Negative host evidence cannot be weakened by an absent or incomplete review.
    if(entry.acceptance.status==='rejected'||entry.acceptance.status==='blocked'){
     entry.acceptance.detail+='；保留外部检查的失败或阻塞结论，独立审查不能覆盖它';
    }
    else if(!enabled)entry.acceptance={...entry.acceptance,status:'unverified',detail:'子 Agent 已关闭，未执行独立审查；仅保留外部检查结果'};
    else if(entry.reviewer?.status==='infrastructure_failure')entry.acceptance={...entry.acceptance,status:'unverified',detail:`外部证据验收=${entry.functional.acceptance.status}；Legion 独立复核未完成（reviewer infrastructure failure），不能确认交付。${entry.reviewer.error}`};
    else if(entry.review?.status==='needs_repair')entry.acceptance={...entry.acceptance,status:entry.functional.acceptance.status==='accepted'?'blocked':'rejected',detail:entry.functional.acceptance.status==='accepted'?'独立挑战与外部检查发生冲突；保留双方证据，查明原因前不得交付':'独立挑战发现反例，修复后必须重新检查'};
    else if(entry.review?.status!=='accepted')entry.acceptance={...entry.acceptance,status:'unverified',detail:'独立检查覆盖不足，不能确认任务完成'};
   }catch(error){entry.acceptance={status:'blocked',candidateId:entry.functional?.candidate.candidateId,evidence:entry.functional?.acceptance.evidence,evidenceStatus:entry.functional?.acceptance.status,reviewStatus:entry.reviewer?.status==='infrastructure_failure'?'infrastructure_failure':undefined,failureClass:entry.reviewer?.status==='infrastructure_failure'?'reviewer_infrastructure_failure':undefined,limitations:entry.reviewer?.error?[entry.reviewer.error]:[],uncovered:[...contract.acceptance],detail:String(error)};}
   state.acceptance=entry.acceptance;await save();return structuredClone(state);
  }),
  finalize:()=>serialize(async()=>{await ready;return final();}),
 };
}


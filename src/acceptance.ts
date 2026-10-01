import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {digest,hashOutputs,snapshotOutputs,type AcceptanceContract} from './challenge.js';
import {ReportSchema,commandChecker} from './checker.js';
import {checkOutcome} from './run.js';
import {withinDeadline} from './deadline.js';
import type {CheckReport} from './types.js';

export interface Acceptance {status:'pending'|'checking'|'accepted'|'rejected'|'unverified'|'blocked'|'not_applicable';candidateId?:string;uncovered:string[];detail:string;evidence?:string}
export interface FrozenContract extends AcceptanceContract {
 taskId:string;version:1;kind:'delivery';originalRequirement:string;nonGoals:string[];assumptions:string[];
 dependencies:Record<string,string>;writableScope:string[];skills:string[];
 requirements:{id:string;text:string;source:string;category:'functional';required:true}[];
 budget:{attempts:number;calls:number;verificationRuns:number;concurrency:number;deadline:number};
}
const Path=z.string().regex(/^[a-zA-Z0-9_-][a-zA-Z0-9_./-]*$/).refine(p=>p.split('/').every(s=>!!s&&s!=='.'&&s!=='..'));
export function freezeContract(taskId:string,contract:AcceptanceContract,originalRequirement:string,deadline:number,dependencies:Record<string,string>={}):FrozenContract {
 z.array(Path).refine(a=>new Set(a).size===a.length).parse(contract.outputs);
 return structuredClone({...contract,taskId,version:1 as const,kind:'delivery' as const,originalRequirement,nonGoals:[],assumptions:[],dependencies,writableScope:contract.outputs,skills:['evidence-v1'],requirements:contract.acceptance.map((text,i)=>({id:`r${i+1}`,text,source:originalRequirement,category:'functional' as const,required:true as const})),budget:{attempts:3,calls:32,verificationRuns:12,concurrency:64,deadline}});
}
export interface Candidate {candidateId:string;taskId:string;attemptId:string;contractHash:string;artifactHash:string;dependencies:Record<string,string>;snapshot:string;environment:{node:string;platform:string};manifestPath:string}
export async function captureCandidate(contract:FrozenContract,workspace:string,dir:string,attemptId:string):Promise<Candidate>{
 const snapshot=join(dir,'candidate');const artifactHash=await snapshotOutputs(workspace,contract.outputs,snapshot);
 const c:Candidate={candidateId:randomUUID(),taskId:contract.taskId,attemptId,contractHash:digest(JSON.stringify(contract)),artifactHash,dependencies:structuredClone(contract.dependencies),snapshot,environment:{node:process.version,platform:process.platform},manifestPath:join(dir,'manifest.json')};
 await writeFile(c.manifestPath,JSON.stringify({...c,files:await Promise.all(contract.outputs.map(async path=>({path,sha256:digest(await readFile(join(snapshot,path)))})))},null,2),{flag:'wx'});return c;
}
/** Installed by the host, never taken from a model result or worker workspace. */
export interface TrustedVerifier {id:string;version:string;covers:(contract:FrozenContract)=>boolean;check:(candidate:Candidate,contract:FrozenContract,dir:string,signal?:AbortSignal)=>Promise<CheckReport>}
export type VerifierRegistry=readonly TrustedVerifier[];
export interface FunctionalEvidence {candidate:Candidate;contract:FrozenContract;verifier:{id:string;version:string}|null;report:CheckReport;acceptance:Acceptance}
const issued=new WeakMap<FunctionalEvidence,{hash:string;manifestHash:string;accepted:boolean}>();
export async function verifyCandidate(contract:FrozenContract,candidate:Candidate,dir:string,registry:VerifierRegistry,signal?:AbortSignal):Promise<FunctionalEvidence>{
 await mkdir(dir,{recursive:true});const verifier=registry.find(v=>v.covers(contract));
 const required=contract.requirements.map(r=>r.id);let report:CheckReport={checks:required.map(id=>({id,status:'not_checked',detail:'No installed functional verifier covers this requirement'})),artifacts:[]};
 const ensure=async()=>{if(signal?.aborted||Date.now()>=contract.budget.deadline)throw Error('Acceptance cancelled or deadline exceeded');if(candidate.contractHash!==digest(JSON.stringify(contract))||JSON.stringify(candidate.dependencies)!==JSON.stringify(contract.dependencies)||await hashOutputs(candidate.snapshot,contract.outputs)!==candidate.artifactHash)throw Error('Stale candidate/contract/dependency evidence');};
 await ensure();
 await writeFile(join(dir,'verification-plan.json'),JSON.stringify({candidateId:candidate.candidateId,contractHash:candidate.contractHash,artifactHash:candidate.artifactHash,dependencies:candidate.dependencies,environment:candidate.environment,verifier:verifier?{id:verifier.id,version:verifier.version,adapterHash:digest(verifier.check.toString())}:null},null,2),{flag:'wx'});
 if(verifier){try{report=ReportSchema.parse(await withinDeadline(contract.budget.deadline,signal,bounded=>verifier.check(candidate,contract,dir,bounded)));}catch(error){report={checks:[{id:required[0]??'verifier',status:'error',detail:String(error)}],artifacts:[]};}}
 await ensure();const outcome=checkOutcome(report,required);
 const status:Acceptance['status']=required.length&&verifier&&outcome==='pass'?'accepted':outcome==='fail'?'rejected':outcome==='error'?'blocked':'unverified';
 const evidence=join(dir,'functional.json');const result:FunctionalEvidence={candidate,contract:structuredClone(contract),verifier:verifier?{id:verifier.id,version:verifier.version}:null,report,acceptance:{status,candidateId:candidate.candidateId,uncovered:required.filter(id=>report.checks.find(c=>c.id===id)?.status!=='pass'),detail:verifier?'Host functional checks; coverage limited to frozen requirements':'No trusted functional verifier; review evidence alone cannot certify delivery',evidence}};
 const serialized=JSON.stringify(result,null,2);await writeFile(evidence,serialized,{flag:'wx'});issued.set(result,{hash:digest(serialized),manifestHash:digest(await readFile(candidate.manifestPath)),accepted:status==='accepted'});return result;
}
/** Runtime-issued evidence only. Serialized model reports cannot create authority. */
export async function currentEvidence(e:FunctionalEvidence,contract:FrozenContract,workspace?:string){
 const seal=issued.get(e);if(!seal?.accepted||seal.hash!==digest(JSON.stringify(e,null,2))||e.acceptance.status!=='accepted'||Date.now()>=contract.budget.deadline||e.candidate.contractHash!==digest(JSON.stringify(contract)))return false;
 try{if(digest(await readFile(e.acceptance.evidence!))!==seal.hash||digest(await readFile(e.candidate.manifestPath))!==seal.manifestHash)return false;return await hashOutputs(e.candidate.snapshot,contract.outputs)===e.candidate.artifactHash&&(!workspace||await hashOutputs(workspace,contract.outputs)===e.candidate.artifactHash);}catch{return false;}
}
// A deliberately narrow installed capability. Inputs are parsed from the ORIGINAL request,
// never inferred from a worker-generated output or Manager's proposed expected values.
export function aggregationContract(goal:string):AcceptanceContract|undefined {
 const m=/^Aggregate numbers (\[[\d\s.,+eE-]+\]): write aggregate\.json with sum and sorted\.$/.exec(goal);
 if(!m)return;try{const values=z.array(z.number().finite()).min(1).max(1000).parse(JSON.parse(m[1]!));if(!Number.isFinite(values.reduce((a,b)=>a+b,0)))return;return {goal,outputs:['aggregate.json'],acceptance:['sum equals the sum of the original numbers','sorted contains exactly the original numbers in ascending order']};}catch{return;}
}
export const builtinVerifiers:VerifierRegistry=[{id:'json-aggregation',version:'1',covers:c=>{const a=aggregationContract(c.originalRequirement);return !!a&&JSON.stringify(a.acceptance)===JSON.stringify(c.acceptance)&&JSON.stringify(a.outputs)===JSON.stringify(c.outputs);},check:async(candidate,contract,dir,signal)=>{
 const values=JSON.parse(/\[[\d\s.,+eE-]+\]/.exec(contract.originalRequirement)![0]) as number[];
 const script=join(dir,'aggregate-verifier.cjs');
 await writeFile(script,`const fs=require('node:fs');const path=require('node:path');let data;try{data=JSON.parse(fs.readFileSync(path.join(process.argv[2],'aggregate.json'),'utf8'));}catch{}const expected=${JSON.stringify(values)};const checks=[{id:'r1',status:data?.sum===expected.reduce((a,b)=>a+b,0)?'pass':'fail',detail:'Compare sum against original input'},{id:'r2',status:JSON.stringify(data?.sorted)===JSON.stringify([...expected].sort((a,b)=>a-b))?'pass':'fail',detail:'Compare ascending multiset against original input'}];console.log(JSON.stringify({checks,artifacts:[]}));`);
 await mkdir(join(dir,'execution'),{recursive:true});
 return commandChecker({command:'$node',args:[script,candidate.snapshot],timeoutMs:15000})(candidate.snapshot,join(dir,'execution'),signal);
}}];

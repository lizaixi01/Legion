import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import {ChallengeSchema,validateChallenge,verifySnapshot,hashOutputs,digest,type AcceptanceContract,type ChallengeEvidence} from './challenge.js';
import {freezeContract,captureCandidate,verifyCandidate,currentEvidence,builtinVerifiers,type FrozenContract,type FunctionalEvidence,type Acceptance,type VerifierRegistry} from './acceptance.js';
import {rolePrompt} from './agent-roles.js';
import type {Job,Result,WorkerSpec} from './worker-pool.js';
export interface TaskEvidence {id:string;backend:string;status:string;reply:string;workspace:string;checks:{path:string;status:string;sha256?:string;detail:string}[];validation?:ChallengeEvidence;acceptance?:Acceptance;contract?:FrozenContract;functional?:FunctionalEvidence;sessionId?:string}
export interface ChallengeDependencies {
 run:(spec:WorkerSpec,job:Job,signal?:AbortSignal)=>Promise<Result>;
 challenge?:(contract:AcceptanceContract)=>Promise<unknown>;
 structural:(workspace:string,outputs:string[],logDir:string,signal?:AbortSignal)=>Promise<TaskEvidence['checks']>;
 save:()=>Promise<void>;usage:(value:unknown)=>void;
 registry?:VerifierRegistry;originalRequirement?:string;deadline?:number;verification?:()=>void;
}
export async function runChallengedTask(e:TaskEvidence,contract:AcceptanceContract,spec:WorkerSpec,challenger:WorkerSpec,job:Job,deps:ChallengeDependencies,signal?:AbortSignal){
 const frozen=e.contract??freezeContract(e.id,contract,deps.originalRequirement??contract.goal,deps.deadline??Date.now()+job.timeoutMs);e.contract=frozen;
 const contractHash=digest(JSON.stringify(frozen));await mkdir(job.logDir,{recursive:true});await writeFile(join(job.logDir,'contract.json'),JSON.stringify({contract:frozen,contractHash},null,2),{flag:'wx'});
 const validation:ChallengeEvidence={contract:structuredClone(contract),contractHash:digest(JSON.stringify(contract)),limitations:[],attempts:[]};e.validation=validation;
 let challenge:ReturnType<typeof validateChallenge>|undefined;
 const live=()=>{if(signal?.aborted||Date.now()>=frozen.budget.deadline)throw Error('Task cancelled or deadline exceeded');};
 try {
  for(let version=1;version<=frozen.budget.attempts;version++){
   live();e.status=version===1?'running':'repairing';e.acceptance={status:'pending',uncovered:[...contract.acceptance],detail:'Execution does not imply acceptance'};await deps.save();
   const role=rolePrompt('worker',{contract:frozen,request:job.prompt,repair:version>1?{review:validation.attempts.at(-1)?.checks,functional:e.functional?.report}:undefined},frozen.skills);
   const workJob={...job,sessionId:e.sessionId,logDir:join(job.logDir,'implementation-'+version),prompt:role.prompt};await mkdir(workJob.logDir,{recursive:true});await writeFile(join(workJob.logDir,'roles.json'),JSON.stringify(role.audit));
   const result=await deps.run(spec,workJob,signal);deps.usage({role:'worker',attempt:version,raw:result.usage});live();e.sessionId=result.sessionId;e.reply=result.text.slice(-12000);
   if(result.status!=='completed'){e.status=result.status;e.acceptance={status:'blocked',uncovered:[...contract.acceptance],detail:'Worker execution '+result.status};await deps.save();return;}
   e.status='submitted';e.checks=await deps.structural(e.workspace,contract.outputs,workJob.logDir,signal);live();await deps.save();
   if(!contract.outputs.length||!contract.acceptance.length){e.status='unverified';validation.error='No explicit artifact acceptance contract';e.acceptance={status:'unverified',uncovered:[contract.goal],detail:validation.error};await deps.save();return;}
   if(e.checks.some(c=>c.status==='fail')){e.status='checks_failed';e.acceptance={status:'rejected',uncovered:[...contract.acceptance],detail:'Declared outputs failed structural checks'};await deps.save();return;}
   const candidate=await captureCandidate(frozen,e.workspace,join(job.logDir,'snapshot-'+version),String(version));
   if(!challenge){
    e.status='challenging';await deps.save();const dir=join(job.logDir,'challenger');await mkdir(dir,{recursive:true});
    const schema=join(dir,'schema.json'),output=join(dir,'challenge.json');await writeFile(schema,JSON.stringify(z.toJSONSchema(ChallengeSchema)));
    const role=rolePrompt('challenger',{originalRequirement:frozen.originalRequirement,contract:frozen,candidate,instructions:'Return schema JSON only. For every criterion return one standalone Node ESM assertion script as source. Preserve exact criterion text. Read only the candidate snapshot; no worker summaries. Scripts run with cwd a candidate copy. Use node:assert/strict and expected/actual assertions, semantic behavior and edge cases. The same script must fail with candidate absent. No writes, network, subprocesses, outside reads or third-party packages. List unsupported requirements in limitations. These are test proposals; only runtime replay supplies evidence.'},frozen.skills);
    await writeFile(join(dir,'roles.json'),JSON.stringify(role.audit));
    const raw=deps.challenge?await deps.challenge(structuredClone(contract)):await (async()=>{
     const result=await deps.run({...challenger,permission:'read-only',schemaPath:schema,outputPath:output},{id:job.id+'-challenger',workspace:candidate.snapshot,logDir:join(dir,'execution'),timeoutMs:Math.min(job.timeoutMs,180000),prompt:role.prompt},signal);
     deps.usage({role:'challenger',raw:result.usage});live();if(result.status!=='completed')throw Error('Challenger '+result.status+': '+result.detail);return JSON.parse(await readFile(output,'utf8'));
    })();
    live();challenge=validateChallenge(raw,contract);validation.verifierHash=digest(JSON.stringify(challenge));validation.limitations=challenge.limitations;
    await writeFile(join(dir,'frozen-challenge.json'),JSON.stringify(challenge,null,2),{flag:'wx'});
   }
   e.status='verifying';e.acceptance={status:'checking',candidateId:candidate.candidateId,uncovered:[...contract.acceptance],detail:'Independent replay and host functional checks'};await deps.save();deps.verification?.();
   const verdict=await verifySnapshot(contract,challenge,candidate.snapshot,join(job.logDir,'verification-'+version),version,signal);live();validation.attempts.push(verdict);
   const functional=await verifyCandidate(frozen,candidate,join(job.logDir,'functional-'+version),deps.registry??builtinVerifiers,signal);e.functional=functional;
   if(await hashOutputs(e.workspace,contract.outputs)!==candidate.artifactHash)throw Error('Implementation changed while checking candidate');
   // A second model cannot install an authoritative verifier. Conflicting evidence is disputed, not silently accepted.
   e.acceptance=structuredClone(functional.acceptance);
   if(verdict.status==='error')e.acceptance={...e.acceptance,status:'blocked',detail:'Independent review infrastructure failed'};
   else if(verdict.status!=='accepted'&&functional.acceptance.status==='accepted')e.acceptance={...e.acceptance,status:'unverified',detail:'Independent review incomplete or disputed; bounded review stopped'};
   else if(verdict.status==='unverified')e.acceptance={...e.acceptance,status:'unverified',detail:'Independent review lacks reproducible coverage'};
   await writeFile(join(job.logDir,'verification-'+version,'review-report.json'),JSON.stringify({candidateId:candidate.candidateId,contractHash,requirements:contract.acceptance,replayed:verdict.checks,uncovered:challenge.limitations,decision:e.acceptance.status},null,2),{flag:'wx'});
   e.status=e.acceptance.status==='accepted'?'accepted':e.acceptance.status==='rejected'||(!functional.verifier&&verdict.status==='needs_repair')?'needs_repair':e.acceptance.status;
   await deps.save();if(e.status!=='needs_repair')return;
  }
 } catch(error){e.status=signal?.aborted?'cancelled':'error';validation.error=String(error);e.acceptance={status:'blocked',uncovered:[...contract.acceptance],detail:String(error)};await deps.save();}
}
/** Old attempts are audit history. Only runtime-issued evidence for the current candidate counts. */
export async function acceptedTask(e:TaskEvidence){return !!(e.acceptance?.status==='accepted'&&e.contract&&e.functional&&await currentEvidence(e.functional,e.contract,e.workspace));}

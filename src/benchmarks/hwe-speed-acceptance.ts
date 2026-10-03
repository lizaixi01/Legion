import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import {hash} from '../provenance.js';
import {reviewReplayConsistency} from './hwe-replay-review.js';
const read=async(p:string)=>JSON.parse(await readFile(p,'utf8')) as unknown;
const auditSchema=z.object({error:z.unknown().optional(),containers:z.array(z.unknown()),processes:z.array(z.unknown()),sockets:z.array(z.unknown())});
const phaseSchema=z.object({concurrency:z.number(),complete:z.boolean(),consistent:z.boolean(),activity:z.object({maxWorkers:z.number(),maxVerification:z.number(),overlapMs:z.number()})});
const resultSchema=z.object({managerCalls:z.number().int().nonnegative(),workerCalls:z.number().int().nonnegative(),formalBenchmark:z.literal(false),results:z.array(phaseSchema)});
const artifactSchema=z.object({workers:z.array(z.object({id:z.string(),modelCalled:z.boolean().optional(),tinyExactCommentOnly:z.boolean().optional(),modelArchiveHashMatches:z.boolean().optional(),catalogSha256:z.string().optional(),lintExecutions:z.array(z.object({exitCode:z.number().nullable()})).optional(),session:z.object({status:z.string(),exitCode:z.number().nullable(),turnCompleted:z.boolean()}).optional()}))});
const cancelSchema=z.object({status:z.string(),verificationStarted:z.number(),queuedNotStarted:z.number(),audit:auditSchema});
function clean(a:z.infer<typeof auditSchema>){return !a.error&&!a.containers.length&&!a.processes.length&&!a.sockets.length;}
function checkPhase(result:z.infer<typeof resultSchema>,artifacts:z.infer<typeof artifactSchema>,concurrency:number,catalogSha256?:string,modelWorkers=4){
 const reasons:string[]=[],phase=result.results.find(p=>p.concurrency===concurrency);
 if(!phase?.complete||!phase.consistent||phase.activity.maxWorkers!==concurrency||phase.activity.maxVerification!==2||phase.activity.overlapMs<=0)reasons.push(`Worker ${concurrency} short real acceptance incomplete`);
 const rows=artifacts.workers.filter(w=>w.id.startsWith(`accept-${concurrency}-`)&&w.modelCalled!==false);
 if(rows.length!==modelWorkers||rows.some(w=>!w.tinyExactCommentOnly||!w.modelArchiveHashMatches||w.lintExecutions?.length!==1||w.lintExecutions[0]!.exitCode!==0||w.session?.status!=='completed'||w.session.exitCode!==0||!w.session.turnCompleted)||new Set(rows.map(w=>w.catalogSha256)).size!==1||catalogSha256&&rows.some(w=>w.catalogSha256!==catalogSha256))reasons.push(`Worker ${concurrency} artifact/exit/catalog audit incomplete`);
 return reasons;
}
/** Qualification may reuse separately successful development phases, never their paired timing. */
export async function assessSpeedAcceptance(root:string,catalogSha256:string,parentSha256:string){
 const qualification=await read(join(root,'qualification.json')).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return undefined;throw e;});
 const reasons:string[]=[];
 if(qualification===undefined){
  const result=resultSchema.parse(await read(join(root,'result.json'))),artifacts=artifactSchema.parse(await read(join(root,'model-output-audit.json')));
  if(result.managerCalls>1||result.workerCalls!==8)reasons.push('Short call budget or coverage mismatch');
  for(const concurrency of [2,4])reasons.push(...checkPhase(result,artifacts,concurrency,catalogSha256));
 }else{
  const q=z.object({version:z.literal(1),mode:z.literal('development-qualification'),pairedTiming:z.literal(false),sources:z.array(z.object({concurrency:z.union([z.literal(2),z.literal(4)]),directory:z.enum(['source-2','source-4']),sourceBatch:z.string()})).length(2)}).parse(qualification);
  if(new Set(q.sources.map(s=>s.concurrency)).size!==2)reasons.push('Both concurrency levels must be independently qualified');
  const implementations:Record<string,string>[]=[];
  for(const source of q.sources){
   if(source.directory!==`source-${source.concurrency}`)throw Error('Qualification source identity mismatch');
   const dir=join(root,source.directory),result=resultSchema.parse(await read(join(dir,'result.json'))),artifacts=artifactSchema.parse(await read(join(dir,'model-output-audit.json')));
   const modelWorkers=source.concurrency===2?2:4;
   if(result.managerCalls>1||result.workerCalls>8||result.workerCalls<modelWorkers)reasons.push('Source development batch exceeded its call bound or lacked real Workers');
   const rawConsistency=await read(join(dir,'consistency.json')).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return undefined;throw e;});
   const review=rawConsistency===undefined?undefined:reviewReplayConsistency(rawConsistency);
   const phase=result.results.find(p=>p.concurrency===source.concurrency);
   const reviewedResult=review?.consistent&&review.rows.length===4&&phase?{...result,results:result.results.map(p=>p===phase?{...p,consistent:true}:p)}:result;
   reasons.push(...checkPhase(reviewedResult,artifacts,source.concurrency,catalogSha256,source.concurrency===2&&result.workerCalls===2?2:4));
   const state=z.object({status:z.literal('budget'),resumed:z.literal(false).optional(),config:z.object({maxWorkers:z.literal(4),concurrency:z.number(),allocationsPerRound:z.literal(4),verificationConcurrency:z.literal(2),verificationScheduling:z.literal('worker-ready')}),candidates:z.array(z.object({status:z.enum(['verified','rejected'])})).length(4),cleanup:z.object({status:z.literal('completed')}),persistenceErrors:z.array(z.unknown()).optional()}).safeParse(await read(join(dir,'state.json')));
   if(!state.success||state.data.config.concurrency!==source.concurrency||state.data.persistenceErrors?.length)reasons.push('Source state incomplete, resumed, or failed');
   if(!clean(auditSchema.parse(await read(join(dir,'owner-audit.jsonl')))))reasons.push('Source owner audit failed');
   const ready=z.object({sha256:z.string()}).parse(await read(join(dir,'ready.json')));
   if(ready.sha256!==parentSha256||hash(await readFile(join(dir,'model-catalog.json')))!==catalogSha256)reasons.push('Source parent or model catalog differs from the experiment');
   implementations.push(z.record(z.string(),z.string()).parse(await read(join(dir,'implementation-hashes.json'))));
  }
  for(const name of ['candidate-loop.ts','candidate-types.ts','hwe.ts','hwe-runtime.ts','bridge.py','session_runner.py','evaluate.py','formal_result.py'])if(!implementations[0]?.[name]||implementations[0][name]!==implementations[1]?.[name])reasons.push('Qualification execution implementation differs: '+name);
 }
 const cancel=cancelSchema.parse(await read(join(root,'cancel-result.json')));
 if(cancel.status!=='cancelled'||cancel.verificationStarted!==2||cancel.queuedNotStarted!==2||!clean(cancel.audit))reasons.push('Controlled cancellation or owner audit incomplete');
 return {passed:!reasons.length,reasons,mode:qualification===undefined?'single-development-batch':'separate-development-phases',pairedTiming:false};
}

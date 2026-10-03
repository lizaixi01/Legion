/** Fixed-input integration check. Reuses the product loop and HWE verifier, with no model calls. */
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {z} from 'zod';
import {createHweDeps,recordHweImplementation} from '../hwe.js';
import {hweFingerprint,hweProjectRoot} from '../hwe-runtime.js';
import {fingerprintMatches} from '../hwe-fingerprint.js';
import {hash} from '../provenance.js';
import {classifyHweEvidence} from '../hwe-evidence.js';
import {eligible,type ResearchConfig,type ResearchDeps,type Candidate,type Evidence,type ResearchState} from '../research-loop.js';

const order=['baseline','radix-four-divmod','four-phase-divider','source-aware-load-interlock','decoded-source-tags'];
const manifestSchema=z.object({source:z.object({readiness:z.string()}),order:z.array(z.string()),candidates:z.array(z.object({id:z.string(),archive:z.string(),sha256:z.string().regex(/^[a-f0-9]{64}$/)}))});
const hypothesis=(id:string)=>({id,parent:'baseline',claim:'Replay the fixed historical snapshot',experiment:'Full external verification through the candidate queue',expected:'Compare against historical and paired evidence',workerSeconds:30});
function inside(root:string,path:string){const rel=relative(root,path);return !isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..\\')&&!rel.startsWith('../');}

export async function createFixedHweDeps(root:string,config:ResearchConfig,source:string,testing?:{host:Pick<ResearchDeps,'verify'|'stop'>;fingerprint:typeof hweFingerprint}):Promise<ResearchDeps>{
 source=resolve(source);root=resolve(root);
 if(inside(source,root)||inside(root,source))throw Error('Replay output must be separate from the read-only source batch');
 if(config.concurrency!==4||config.maxWorkers!==5||config.maxRounds!==2)throw Error('Fixed replay requires four copy allocations then one, with five total candidates in two rounds');
 const manifestBytes=await readFile(join(source,'candidates.json')),manifest=manifestSchema.parse(JSON.parse(manifestBytes.toString('utf8')));
 if(JSON.stringify(manifest.order)!==JSON.stringify(order)||manifest.candidates.length!==5||new Set(manifest.candidates.map(c=>c.id)).size!==5)throw Error('Expected the original five fixed candidates in their declared order');
 const inputs=order.map(id=>{const c=manifest.candidates.find(c=>c.id===id);if(!c)throw Error(`Missing fixed candidate: ${id}`);const path=resolve(source,c.archive);if(!inside(source,path))throw Error('Candidate archive escapes source batch');return {...c,path,replayId:id==='baseline'?'replay-baseline':id};});
 // Check every historical input before any real verification is allowed to start.
 for(const c of inputs)if(hash(await readFile(c.path))!==c.sha256)throw Error(`Frozen snapshot changed: ${c.id}`);
 const readiness=resolve(hweProjectRoot,manifest.source.readiness),ready=JSON.parse(await readFile(readiness,'utf8')) as {sha256:string;environment:unknown;evidence:Evidence};
 if(ready.sha256!==inputs[0]!.sha256)throw Error('Historical readiness and fixed baseline differ');
 const fingerprint=testing?.fingerprint??hweFingerprint,host=testing?.host??createHweDeps(root,config);
 return {
  baseline:async(dir,signal)=>{
   signal.throwIfAborted();if(!fingerprintMatches(ready.environment,await fingerprint()))throw Error('HWE environment differs from historical readiness; no verification dispatched');
   signal.throwIfAborted();await mkdir(dir,{recursive:true});const path=join(dir,'rtl.tar.gz'),bytes=await readFile(inputs[0]!.path);if(hash(bytes)!==ready.sha256)throw Error('Fixed baseline changed');await writeFile(path,bytes);
   const baseline:Candidate={id:'baseline',round:0,hypothesis:hypothesis('baseline'),status:'verified',snapshot:{path,sha256:ready.sha256},evidence:classifyHweEvidence(ready.evidence)};
   if(!eligible(baseline))throw Error('Historical baseline lacks complete evidence');
   await writeFile(join(root,'environment.json'),JSON.stringify(ready,null,2));await recordHweImplementation(root);
   await writeFile(join(root,'replay-inputs.json'),JSON.stringify({mode:'fixed-candidate-verification',source,manifestSha256:hash(manifestBytes),readiness,inputs,modelsCalled:false,roundSizes:[4,1]},null,2));return baseline;
  },
  decide:async ctx=>({action:'experiment',reason:'Deterministic fixed-input replay; no Manager model',hypotheses:inputs.slice(ctx.round===1?0:4,ctx.round===1?4:5).map(c=>hypothesis(c.replayId)),discard:[]}),
  work:async(h,_parent,dir,signal)=>{
   signal.throwIfAborted();const c=inputs.find(c=>c.replayId===h.id);if(!c)throw Error('Unknown replay allocation');const bytes=await readFile(c.path);if(hash(bytes)!==c.sha256)throw Error(`Frozen snapshot changed: ${c.id}`);
   const path=join(dir,'rtl.tar.gz');await writeFile(path,bytes);return {snapshot:{path,sha256:c.sha256},worker:{status:'replay',usage:[],durationMs:0,report:'Copied a fixed snapshot; no Worker model or source optimization.'}};
  },
  verify:host.verify,
  stop:host.stop,
 };
}

/** Full structured comparison; only the evaluator's elapsed seconds are excluded. Raw logs stay intact. */
function differences(before:unknown,after:unknown,path:string):string[]{
 if(Object.is(before,after))return [];
 if(before&&after&&typeof before==='object'&&typeof after==='object'&&Array.isArray(before)===Array.isArray(after)){
  const a=before as Record<string,unknown>,b=after as Record<string,unknown>;
  return [...new Set([...Object.keys(a),...Object.keys(b)])].sort().filter(key=>!(path.startsWith('checks.')&&key==='seconds')).flatMap(key=>differences(a[key],b[key],`${path}.${key}`));
 }
 return [path];
}
function evidenceDifferences(a:Pick<Evidence,'status'|'checks'|'metrics'>|undefined,b:Pick<Evidence,'status'|'checks'|'metrics'>|undefined){
 return [...differences(a?.status,b?.status,'status'),...differences(a?.metrics??null,b?.metrics??null,'metrics'),...differences(a?.checks,b?.checks,'checks')];
}
export async function compareFixedHweRuns(serialRoot:string,parallelRoot:string){
 const read=async(root:string,file:string)=>JSON.parse(await readFile(join(root,file),'utf8'));
 const states=await Promise.all([read(serialRoot,'state.json'),read(parallelRoot,'state.json')]) as ResearchState[];
 const inputs=await Promise.all([read(serialRoot,'replay-inputs.json'),read(parallelRoot,'replay-inputs.json')]) as {source:string;manifestSha256:string;inputs:{id:string;replayId:string;sha256:string;path:string}[]}[];
 if(states[0]!.config.verificationConcurrency!==1||states[1]!.config.verificationConcurrency!==2)throw Error('Expected serial then concurrency-2 replay roots');
 if(inputs[0]!.source!==inputs[1]!.source||inputs[0]!.manifestSha256!==inputs[1]!.manifestSha256)throw Error('Replay source batches differ');
 const historical=await read(inputs[0]!.source,'tasks.json') as {tasks:{stage:string;candidate:string;evidenceStatus:Evidence['status'];checks:Evidence['checks'];metrics:Evidence['metrics']}[]};
 const candidates=await Promise.all(inputs[0]!.inputs.map(async input=>{
  const records=states.map(s=>s.candidates.find(c=>c.id===input.replayId)),prior=historical.tasks.find(t=>t.stage==='S1'&&t.candidate===input.id);
  if(!prior)throw Error(`Missing historical full checks: ${input.id}`);
  const expected={status:prior.evidenceStatus,checks:prior.checks,metrics:prior.metrics};
  const snapshotHashes=await Promise.all(records.map(async c=>c?.snapshot?readFile(c.snapshot.path).then(hash).catch(()=>null):null));
  const sourceHash=await readFile(input.path).then(hash).catch(()=>null);
  return {id:input.id,snapshotMatches:sourceHash===input.sha256&&records.every((c,i)=>c?.snapshot?.sha256===input.sha256&&snapshotHashes[i]===input.sha256),snapshotHashes,sourceHash,differences:evidenceDifferences(records[0]?.evidence,records[1]?.evidence),historicalDifferences:records.map(c=>evidenceDifferences(expected,c?.evidence)),timings:records.map(c=>c?.verification??null)};
 }));
 const complete=states.every(s=>s.status==='budget'&&s.cleanup?.status==='completed'&&!s.persistenceErrors?.length&&s.candidates.length===5&&s.candidates.every(c=>['verified','rejected'].includes(c.status)));
 const consistent=candidates.length===5&&candidates.every(c=>c.snapshotMatches&&!c.differences.length&&c.historicalDifferences.every(d=>!d.length));
 const timing=states.map(s=>({runWallMs:s.spentMs,verificationWallMs:s.verificationBatches?.reduce((sum,b)=>sum+b.wallMs,0)??null,executionMsSum:s.verificationBatches?.reduce((sum,b)=>sum+b.executionMsSum,0)??null,cleanup:s.cleanup,maxActive:s.verificationBatches?Math.max(...s.verificationBatches.map(b=>b.maxActive)):null}));
 return {complete,consistent,candidates,timing,verificationSpeedup:complete&&consistent&&timing[0]!.verificationWallMs&&timing[1]!.verificationWallMs?timing[0]!.verificationWallMs/timing[1]!.verificationWallMs:null,notes:['Product path uses two rounds (4 + 1 fixed copies); no model calls.','Full structured checks, including formal task outcomes and all seeds, are compared. Only check seconds fields are excluded; log/detail differences remain visible for review.','executionMsSum includes overlap and is not batch wall time. Resource sampling and an independent owner-container audit are separate acceptance steps.']};
}

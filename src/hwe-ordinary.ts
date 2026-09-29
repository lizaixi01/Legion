import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHweDeps} from './hwe.js';
import {eligible,ResearchConfigSchema,type ResearchConfig,type Candidate,type ResearchDeps} from './research-loop.js';
import {sumUsage} from './research-summary.js';
import {hash} from './provenance.js';

/** One complete Codex session. No manager, candidate selection, or prior trial feedback. */
export async function runOrdinaryHwe(root:string,config:ResearchConfig,seconds:number,signal:AbortSignal,injected?:ResearchDeps){
 config=ResearchConfigSchema.parse(config);
 await mkdir(root);const deps=injected??createHweDeps(root,config,'task'),started=Date.now();
 let baseline:Candidate|undefined,candidate:Candidate|undefined,error:string|undefined;
 try{
  baseline=await deps.baseline(join(root,'baseline'),signal);
  const dir=join(root,'ordinary');await mkdir(dir);
  const hypothesis={id:'ordinary',parent:'baseline',claim:config.goal,experiment:'Independently inspect the baseline, choose and implement your own best optimization approach. You control the entire task in this single session; there is no prescribed local hypothesis. You may run all available public checks, including /usr/bin/python3 /harness/evaluate.py with the configured PATH. Retain the baseline if you cannot justify a better implementation.',expected:'A correct core with improved measured fitness',workerSeconds:seconds};
  candidate={id:'ordinary',round:1,hypothesis,status:'working',...await deps.work(hypothesis,baseline,dir,signal)};
  if(candidate.snapshot&&candidate.worker?.status!=='error'){
   if(hash(await readFile(candidate.snapshot.path))!==candidate.snapshot.sha256)throw Error('Ordinary submission changed');
   candidate.evidence=await deps.verify(candidate.snapshot,join(dir,'verification'),signal);
   if(hash(await readFile(candidate.snapshot.path))!==candidate.snapshot.sha256)throw Error('Ordinary verified submission changed');
   candidate.status=candidate.evidence.status==='pass'?'verified':candidate.evidence.status==='fail'?'rejected':'error';
  }else candidate.status='error';
 }catch(e){error=String(e);}
 finally{await deps.stop();}
 const infrastructureFailure=Boolean(error)||!candidate||candidate.status==='error'||candidate.status==='working';
 const report={kind:'ordinary-codex',status:infrastructureFailure?'error':'completed',config,seconds,baseline,candidate,eligible:candidate?eligible(candidate):false,error,wallMs:Date.now()-started,tokens:sumUsage(Array.isArray(candidate?.worker?.usage)?candidate.worker.usage:[]),interventions:[]};
 await writeFile(join(root,'summary.json'),JSON.stringify(report,null,2));return report;
}

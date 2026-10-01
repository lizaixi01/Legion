import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {runResearch,type ResearchConfig,type ResearchDeps} from '../research-loop.js';
import {createHweDeps,hweCall,verifyHwe,hweFingerprint,fingerprintMatches,fingerprintDifferences} from '../hwe.js';
import {hash} from '../provenance.js';
import {linuxPath} from '../wsl-path.js';
import {lockWorkspace} from '../lock.js';
import {researchSummary} from '../research-summary.js';
import {runOrdinaryHwe} from '../hwe-ordinary.js';
import {runNativeHwe} from '../hwe-native.js';
import {applyRunDeadline} from '../run-deadline.js';
const [action,arg]=process.argv.slice(2);const controller=new AbortController();process.on('SIGINT',()=>controller.abort());process.on('SIGTERM',()=>controller.abort());
applyRunDeadline(controller,process.env.PROACTIVE_RUN_DEADLINE);
export const defaultResearchConfig:ResearchConfig={goal:'Improve the frozen RV32IM baseline CoreMark fitness while preserving all correctness gates. Explore distinct focused microarchitectural hypotheses; report LUT4 area and frequency tradeoffs.',maxRounds:3,maxWorkers:6,concurrency:2,totalMs:21600000,manager:{model:'gpt-6-sol',effort:'high'},worker:{model:'gpt-6-sol',effort:'medium'}};
/** Maintenance/test seam: when set, arms resolve dependencies from the given ESM module. */
async function injectedDeps(root:string,config:ResearchConfig):Promise<ResearchDeps|undefined>{
 const module=process.env.PROACTIVE_ARM_DEPS;if(!module)return undefined;
 const imported=await import(pathToFileURL(resolve(module)).href);
 if(typeof imported.createDeps!=='function')throw Error('PROACTIVE_ARM_DEPS must export createDeps(root, config)');
 return imported.createDeps(root,config) as ResearchDeps;
}
if(action==='preflight'){
 // Read-only readiness gate: no model, baseline rerun or scoring call.
 const readiness=resolve('.local/hwe-readiness'),ready=JSON.parse(await readFile(join(readiness,'ready.json'),'utf8'));
 const baselineMatches=hash(await readFile(join(readiness,'baseline.tar.gz')))===ready.sha256;
 const environment=await hweFingerprint(),differences=fingerprintDifferences(ready.environment,environment);
 const matches=baselineMatches&&differences.length===0;
 console.log(JSON.stringify({matches,baselineMatches,differences,environment,scope:'Readiness compatibility only; no candidate has been scored'},null,2));
 if(!matches)process.exitCode=1;
}else if(action==='readiness'){
 const root=resolve('.local/hwe-readiness');await mkdir(root,{recursive:true});const owner='hwe-readiness';const release=await lockWorkspace(root,root);
 try{
  const archive=join(root,'baseline.tar.gz');await hweCall('baseline',root,owner,{archive:linuxPath(archive)},60000,controller.signal);
  const environment=await hweFingerprint(),baselineHash=hash(await readFile(archive)),reports=[];
  for(let i=0;i<2;i++){const dir=join(root,'check-'+randomUUID());console.log('Baseline verification: '+dir);const report=await verifyHwe(archive,dir,owner,controller.signal);reports.push({dir,report});console.log(JSON.stringify(report));if(report.status!=='pass')throw Error('Baseline gate failed; inspect '+dir);}
  if(JSON.stringify(reports[0]!.report.metrics)!==JSON.stringify(reports[1]!.report.metrics)||JSON.stringify((reports[0]!.report.checks.fpga as {seeds:unknown}).seeds)!==JSON.stringify((reports[1]!.report.checks.fpga as {seeds:unknown}).seeds))throw Error('Baseline verification is not reproducible');
  if(!fingerprintMatches(environment,await hweFingerprint())||hash(await readFile(archive))!==baselineHash)throw Error('Environment or baseline changed during readiness');
  await writeFile(join(root,'ready.json'),JSON.stringify({at:new Date().toISOString(),environment,sha256:hash(await readFile(archive)),evidence:reports[1]!.report,repeats:reports},null,2));console.log('HWE readiness passed twice');
 }finally{await hweCall('stop',join(root,'cleanup'),owner,{},60000);await release();}
}else if(action==='summary'){
 console.log(JSON.stringify(await researchSummary(resolve(arg!)),null,2));
}else if(action==='ordinary'||action==='native'){
 const root=resolve('.runs',action+'-'+randomUUID());const config=arg?JSON.parse(await readFile(resolve(arg),'utf8')):defaultResearchConfig;
 await mkdir(resolve('.local/hwe-execution'),{recursive:true});const release=await lockWorkspace(resolve('.local/hwe-execution'),root);
 try{console.log(root);const result=action==='ordinary'?await runOrdinaryHwe(root,config,1800,controller.signal,await injectedDeps(root,config)):await runNativeHwe(root,config,controller.signal);console.log(JSON.stringify({status:result.status,error:result.error,wallMs:result.wallMs,tokens:result.tokens}));if(result.status==='error')process.exitCode=1;}finally{await release();}
}else if(action==='run'||action==='resume'){
 const root=action==='resume'?resolve(arg!):resolve('.runs','research-'+randomUUID());const config=action==='resume'?JSON.parse(await readFile(join(root,'state.json'),'utf8')).config:arg?JSON.parse(await readFile(resolve(arg),'utf8')):defaultResearchConfig;
 await mkdir(resolve('.local/hwe-execution'),{recursive:true});const release=await lockWorkspace(resolve('.local/hwe-execution'),root);
 try{console.log(root);const state=await runResearch(root,config,createHweDeps(root,config),controller.signal,action==='resume');console.log(JSON.stringify({status:state.status,best:state.best,error:state.error}));await researchSummary(root);if(state.status==='error')process.exitCode=1;}finally{await release();}
}else if(action==='comparison'){
 // Runs the ordinary arm then the management arm in order; any infrastructure failure stops the queue.
 const config=arg?JSON.parse(await readFile(resolve(arg),'utf8')):defaultResearchConfig;
 await mkdir(resolve('.local/hwe-execution'),{recursive:true});
 const deadline=process.env.PROACTIVE_RUN_DEADLINE?Date.parse(process.env.PROACTIVE_RUN_DEADLINE):undefined;
 const order=['ordinary','run'],runs:{action:string;exitCode:number;status:string;directory:string}[]=[];let phase='completed';
 try{
  for(const step of order){
   if(deadline!==undefined&&Date.now()>=deadline)throw Error('remaining-time-insufficient');
   const root=resolve('.runs',step+'-'+randomUUID());const release=await lockWorkspace(resolve('.local/hwe-execution'),root);let exitCode=1,status='error';
   try{
    const deps=await injectedDeps(root,config);
    if(step==='ordinary'){const result=await runOrdinaryHwe(root,config,1800,controller.signal,deps);status=result.status;exitCode=status==='error'?1:0;}
    else{const state=await runResearch(root,config,deps??createHweDeps(root,config),controller.signal,false);await researchSummary(root);status=state.status;exitCode=status==='error'?1:0;}
   }finally{await release();}
   runs.push({action:step,exitCode,status,directory:root});
   if(exitCode!==0||status==='error')throw Error(step+' infrastructure error; queue stopped');
  }
 }catch(e){phase=e instanceof Error&&e.message==='remaining-time-insufficient'?'remaining-time-insufficient':'needs-investigation';}
 console.log(JSON.stringify({phase,order,runs},null,2));
 if(phase!=='completed')process.exitCode=1;
}else throw Error('Usage: research-cli.ts readiness | run [config.json] | ordinary [config.json] | native [config.json] | comparison [config.json] | resume <run-directory> | summary <run-directory>');

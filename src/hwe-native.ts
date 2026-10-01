import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHweDeps,hweCall} from './hwe.js';
import {linuxPath} from './wsl-path.js';
import {execute} from './process.js';
import {sumUsage} from './research-summary.js';
import {hash} from './provenance.js';
import {ResearchConfigSchema,verificationHasInfrastructureError,type ResearchConfig,type Evidence} from './research-loop.js';

/** A usage/quota or verifier interruption is an infrastructure failure, not a task outcome. */
export function nativeArmStatus(error:string|undefined,evidence:Evidence|undefined):'completed'|'error'{
 return error||verificationHasInfrastructureError(evidence)?'error':'completed';
}
export async function runNativeHwe(root:string,config:ResearchConfig,signal:AbortSignal){
 config=ResearchConfigSchema.parse(config);
 await mkdir(root);const deps=createHweDeps(root,config),owner='hwe-native-'+hash(root).slice(0,12),started=Date.now();
 const output=join(root,'rtl.tar.gz'),trace=join(root,'sessions.tar');
 let evidence:Evidence|undefined,error:string|undefined,ended:unknown,sessions:{session:string;usage:unknown}[]=[];
 try{
  const baseline=await deps.baseline(join(root,'baseline'),signal);
  const {logs}=await hweCall('native',root,owner,{archive:linuxPath(baseline.snapshot!.path),output:linuxPath(output),evidence:linuxPath(join(root,'official-evidence')),trace:linuxPath(trace),model:config.worker.model,effort:config.worker.effort,rounds:config.maxRounds,concurrency:config.concurrency,seconds:10800},10920000,signal);
  const events=(await readFile(join(logs,'stdout.jsonl'),'utf8')).split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
  ended=events.findLast(e=>e.type==='native.ended');
  if(!ended||(ended as {exitCode:number}).exitCode!==0)error='Official scheduler did not complete successfully';
  const digest=hash(await readFile(output));
  evidence=await deps.verify({path:output,sha256:digest},join(root,'verification'),signal);
  if(hash(await readFile(output))!==digest)throw Error('Native submitted snapshot changed');
 }catch(e){error=String(e);}
 finally{await hweCall('stop',join(root,'cleanup'),owner,{},60000);await deps.stop();}
 const usageDir=join(root,'usage');await mkdir(usageDir);
 const parsed=await execute({command:'wsl.exe',args:['-d','Ubuntu-24.04','--','python3',linuxPath(resolve('scripts/hwe/session-usage.py')),linuxPath(trace)],cwd:process.cwd(),logDir:usageDir,timeoutMs:60000});
 if(parsed.status==='completed')sessions=JSON.parse(await readFile(join(usageDir,'stdout.jsonl'),'utf8'));
 const report={kind:'official-hwe-reference',status:nativeArmStatus(error,evidence),config,ended,evidence,error,wallMs:Date.now()-started,tokens:sumUsage(sessions.map(s=>s.usage)),sessions,limitations:['Upstream tournament and memory strategy, with local model transport and an isolated Linux environment.','Native group shares 8 CPU/10 GiB across its scheduler and slots; its public documentation and call schedule differ from the main comparison.','Final independent replay uses the same frozen baseline interface; core.yaml changes are not exported.']};
 await writeFile(join(root,'summary.json'),JSON.stringify(report,null,2));return report;
}

import {mkdir,writeFile,readFile,copyFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {execute} from './process.js';
import {parseCodexLog} from './codex.js';
import {ReportSchema} from './checker.js';
import {hash} from './provenance.js';
import {runAdapter,type ExecutionAdapter} from './execution-adapter.js';

export const ProgramBenchConfig=z.object({
  instance:z.literal('tomnomnom__gron.88a6234'),
  distro:z.string().default('Ubuntu-24.04'),
  egressProxy:z.string().url().optional(),
  codex:z.string(),auth:z.string(),python:z.string(),repository:z.string(),
  model:z.string().default('gpt-6-sol'),effort:z.enum(['low','medium','high']).default('medium'),
  candidates:z.union([z.literal(1),z.literal(2)]).default(2),
  attemptMs:z.number().int().min(1000).max(1200000).default(480000),
  totalMs:z.number().int().min(1000).max(7200000).default(1800000),
}).strict();
export function linuxPath(path:string){const match=/^([A-Za-z]):[\\/](.*)$/.exec(path);return match?'/mnt/'+match[1]!.toLowerCase()+'/'+match[2]!.replaceAll('\\','/'):path;}
export async function runProgramBench(input:unknown,signal:AbortSignal){
 const config=ProgramBenchConfig.parse(input),root=resolve('.runs','programbench-'+randomUUID());
 const bridge=linuxPath(join(root,'adapter','bridge.py'));
 // Host-only config and scoring files are never mounted in candidate containers.
 const settings={...config,root:linuxPath(root),scripts:linuxPath(join(root,'adapter')),auth:linuxPath(config.auth),repository:linuxPath(resolve(config.repository))};
 let sequence=0;
 const command=async(action:string,payload:unknown,timeoutMs:number,abort?:AbortSignal)=>{
  const logs=join(root,'host',`${++sequence}-${action}`);await mkdir(logs,{recursive:true});
  const request=join(logs,'request.json');await writeFile(request,JSON.stringify({settings,payload}));
  const result=await execute({command:'wsl.exe',args:['-d',config.distro,'--',config.python,bridge,action,linuxPath(request)],cwd:process.cwd(),logDir:logs,timeoutMs,signal:abort});
  if(result.status!=='completed')throw Error(`${action}: ${result.status}; ${await readFile(join(logs,'stderr.log'),'utf8')}`);
  return {logs,result};
 };
 const adapter:ExecutionAdapter={
  prepare:async abort=>{await mkdir(join(root,'adapter'));for(const file of ['bridge.py','model_proxy.py','relay.py'])await copyFile(resolve('scripts/programbench',file),join(root,'adapter',file));const {logs}=await command('prepare',{},300000,abort);return JSON.parse(await readFile(join(logs,'stdout.jsonl'),'utf8'));},
  worker:async(request)=>{
   const start=Date.now();
   try{
    const {logs}=await command('worker',{...request,signal:undefined,workspace:linuxPath(request.workspace),attemptDir:linuxPath(request.attemptDir)},request.timeoutMs+60000,request.signal);
    await copyFile(join(logs,'stdout.jsonl'),join(request.attemptDir,'stdout.jsonl'));await copyFile(join(logs,'stderr.log'),join(request.attemptDir,'stderr.log'));
    const parsed=await parseCodexLog(join(request.attemptDir,'stdout.jsonl'));
    const snapshot=(await readFile(join(logs,'stdout.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line)).findLast(event=>event.type==='worker.snapshot');
    if(snapshot?.timedOut)return {status:'timeout',sessionId:parsed.sessionId,usage:snapshot.usage?[snapshot.usage]:parsed.usage,durationMs:Date.now()-start,detail:'Time limit reached; frozen source and session trace preserved'};
    return {status:parsed.completed&&!parsed.failed?'completed':'error',sessionId:parsed.sessionId,usage:parsed.usage,durationMs:Date.now()-start};
   }catch(error){return {status:request.signal?.aborted?'cancelled':'error',detail:String(error),durationMs:Date.now()-start,usage:[]};}
  },
  check:async(workspace,evidence,abort)=>{const {logs}=await command('check',{workspace:linuxPath(workspace),evidence:linuxPath(evidence)},180000,abort);return ReportSchema.parse(JSON.parse(await readFile(join(logs,'stdout.jsonl'),'utf8')));},
  collect:async(team)=>{const unit=team.tasks.rebuild!;const file=config.candidates===1&&unit.status!=='accepted'?join(unit.workspace!,'submission.tar.gz'):join(root,'team','accepted','rebuild','submission.tar.gz');const target=join(root,'scoring',config.instance,'submission.tar.gz');await mkdir(join(root,'scoring',config.instance),{recursive:true});await copyFile(file,target);return {path:target,sha256:hash(await readFile(target))};},
  stop:async()=>{await command('stop',{},60000);},
  grade:async(selected,abort)=>{const {logs}=await command('grade',{submission:linuxPath(selected.path)},1800000,abort);return JSON.parse(await readFile(join(logs,'stdout.jsonl'),'utf8'));},
 };
 console.log('Evidence: '+root);
 const result=await runAdapter(root,{...(config.candidates===2?{competition:2 as const}:{}),concurrency:1,maxAttempts:config.candidates===1?1:4,attemptMs:config.attemptMs,totalMs:config.totalMs,tasks:[{id:'rebuild',goal:'Rebuild the supplied CLI from its documentation and reference behavior. Produce source and compile.sh; reproduce behavior without source lookup, decompilation or internet. Only public checks are available during inference.',dependsOn:[],routes:config.candidates===1?['Implement from the documented options and small reference probes.']:['Implement from the documented options and small reference probes.','Explore boundary cases first, then derive an implementation from the observed behavior.'],requiredChecks:['public-behavior'],outputs:['submission.tar.gz']}]},adapter,signal,{gradeCompletedBaseline:config.candidates===1});
 console.log(JSON.stringify(result,null,2));return result;
}

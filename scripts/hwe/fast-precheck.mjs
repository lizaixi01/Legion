// One real HWE Manager call and at most one upstream request; no benchmark.
import {mkdir,readFile,writeFile,cp,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHweDeps} from '../../src/hwe.ts';
import {hweCall} from '../../src/hwe-runtime.ts';
import {freezeReadiness} from '../../src/hwe-readiness.ts';
import {ownerAudit} from '../../src/benchmarks/hwe-speed-cli.ts';
import {lockWorkspace} from '../../src/lock.ts';
import {hash} from '../../src/provenance.ts';
const root=resolve(process.argv[2]??'');if(!process.argv[2])throw Error('fast-precheck.mjs <new-directory>');await mkdir(root);
const save=(p,v)=>writeFile(p,JSON.stringify(v,null,2));
await freezeReadiness(resolve('.local/hwe-adapter-readiness-20261001-c74b9a20/.local/hwe-readiness'),join(root,'readiness'));
await cp('.local/hwe-runtime-diagnostics-20261003-102325/worker-small-task/model-catalog.json',join(root,'model-catalog.json'));
process.env.PROACTIVE_HWE_READINESS_SOURCE=join(root,'readiness');process.env.PROACTIVE_HWE_MODEL_CATALOG=join(root,'model-catalog.json');process.env.PROACTIVE_HWE_SERVICE_TIER='fast';
const cfg={goal:'Internal service-tier precheck only: immediately return action=finish, reason=READY, hypotheses=[], discard=[]. Do not call tools, inspect files, or modify files.',maxRounds:1,maxWorkers:1,concurrency:1,totalMs:120000,manager:{model:'gpt-6.1-sol',effort:'xhigh',serviceTier:'fast',timeoutSeconds:900},worker:{model:'gpt-6.1-sol',effort:'xhigh',serviceTier:'default'}};
const startedAt=new Date().toISOString(),owner='research-'+hash(root).slice(0,16),abort=new AbortController(),timer=setTimeout(()=>abort.abort(),120000);let calls=0;
await save(join(root,'protocol.json'),{mode:'development-only',maximumManagerCalls:1,maximumUpstreamRequests:1,workerCalls:0,serviceTier:'fast',model:'gpt-6.1-sol',effort:'xhigh',startedAt,owner});
const release=await lockWorkspace(resolve('.local/hwe-execution'),root),deps=createHweDeps(root,cfg,'hypothesis',(action,dir,owner,payload,timeout,signal)=>{if(++calls>1)throw Error('Precheck call cap');return hweCall(action,dir,owner,{...payload,maxModelRequests:1},timeout,signal);});
let decision,error,audit;
try{const baseline=await deps.baseline(join(root,'baseline'),abort.signal);await mkdir(join(root,'manager-precheck'));decision=await deps.decide({goal:cfg.goal,round:1,remainingWorkers:1,remainingMs:1500000,best:'baseline',records:[baseline],decisions:[]},join(root,'manager-precheck'),abort.signal);}
catch(e){error=String(e);process.exitCode=1;}
finally{clearTimeout(timer);await deps.stop().catch(e=>{error=String(e);process.exitCode=1;});audit=await ownerAudit(root,owner,join(root,'owner-audit.jsonl')).catch(e=>{error=String(e);process.exitCode=1;});await release();}
const modelCalls=[];async function walk(p){for(const e of await readdir(p,{withFileTypes:true})){if(['readiness','implementation'].includes(e.name))continue;const f=join(p,e.name);if(e.isDirectory())await walk(f);else if(e.name.endsWith('.diagnostic.json'))modelCalls.push(JSON.parse(await readFile(f,'utf8')));}}await walk(root);
const result={startedAt,endedAt:new Date().toISOString(),managerCalls:calls,workerCalls:0,decision,error,audit,modelCalls,fastConfirmed:modelCalls.length>0&&modelCalls.every(c=>c.responseCompleted&&['fast','priority'].includes(c.response?.service_tier)),formalBenchmark:false};await save(join(root,'result.json'),result);console.log(JSON.stringify(result));

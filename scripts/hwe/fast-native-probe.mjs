// One isolated Worker precheck. Same auth, Unix proxy, HTTP/SSE, model and catalog.
// Only a copied CLI provider configuration differs; never modifies live bridge.
import {mkdir,cp,readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {hweCall} from '../../src/hwe-runtime.ts';
import {execute} from '../../src/process.ts';
import {linuxPath} from '../../src/wsl-path.ts';
import {freezeReadiness} from '../../src/hwe-readiness.ts';
import {ownerAudit} from '../../src/benchmarks/hwe-speed-cli.ts';
import {lockWorkspace} from '../../src/lock.ts';
import {hash} from '../../src/provenance.ts';
const root=resolve(process.argv[2]??'');if(!process.argv[2])throw Error('fast-native-probe.mjs <new-directory>');await mkdir(root);
const isolated=process.argv.includes('--isolated');
const save=(p,v)=>writeFile(p,JSON.stringify(v,null,2));
await freezeReadiness(resolve('.local/hwe-adapter-readiness-20261001-c74b9a20/.local/hwe-readiness'),join(root,'readiness'));
await cp('scripts/hwe',join(root,'harness'),{recursive:true});
const bridge=join(root,'harness/bridge.py');let source=await readFile(bridge,'utf8');
const before='\'model_provider="local"\',\'-c\',\'model_providers.local.name="Model-only proxy"\',\'-c\',\'model_providers.local.base_url="http://127.0.0.1:8091/backend-api/codex"\',\'-c\',\'model_providers.local.env_key="PB_MODEL_TOKEN"\',\'-c\',\'model_providers.local.wire_api="responses"\'';
const after='\'model_provider="openai"\',\'-c\',\'openai_base_url="http://127.0.0.1:8091/backend-api/codex"\'';
if(source.split(before).length!==2)throw Error('Unexpected provider launch source');if(!isolated)source=source.replace(before,after).replace("  args[-1:-1]=['-c','model_providers.local.request_max_retries=0','-c','model_providers.local.stream_max_retries=0']",'  # Built-in provider cannot be overridden; host proxy caps upstream requests to one.');await writeFile(bridge,source);
await cp('.local/hwe-runtime-diagnostics-20261003-102325/worker-small-task/model-catalog.json',join(root,'model-catalog.json'));
const parent=join(root,'readiness/baseline.tar.gz'),parentBefore=hash(await readFile(parent)),owner='research-'+hash(root).slice(0,16),release=await lockWorkspace(resolve('.local/hwe-execution'),root);
const signal=new AbortController(),timer=setTimeout(()=>signal.abort(),120000);let audit,error,execution;
await save(join(root,'protocol.json'),{managerCalls:0,maximumWorkerCalls:1,maximumUpstreamRequests:1,cliRetries:isolated?0:'built-in default; additional attempts blocked locally',seconds:60,hostLimitMs:120000,model:'gpt-6.1-sol',effort:'xhigh',serviceTier:'fast',owner,parentBefore,providerOnly:!isolated,formalBenchmark:false});
try{execution=await hweCall('worker',join(root,'worker'),owner,{archive:linuxPath(parent),output:linuxPath(join(root,'worker/rtl.tar.gz')),report:linuxPath(join(root,'worker/REPORT.md')),trace:linuxPath(join(root,'worker/session-trace.tar')),model:'gpt-6.1-sol',effort:'xhigh',serviceTier:'fast',modelCatalog:join(root,'model-catalog.json'),maxModelRequests:1,seconds:60,prompt:'Internal Fast precheck only. Immediately reply READY. Do not use tools, inspect files, modify files or delegate.'},660000,signal.signal,async options=>{const request=JSON.parse(await readFile(options.args.at(-1).replace('/mnt/d/','D:/'),'utf8'));request.settings.scripts=linuxPath(join(root,'harness'));const requestPath=options.args.at(-1).replace('/mnt/d/','D:/');await save(requestPath,request);return execute({...options,args:[...options.args.slice(0,-3),linuxPath(bridge),...options.args.slice(-2)]});});}
catch(e){error=String(e);process.exitCode=1;}
finally{clearTimeout(timer);await hweCall('stop',join(root,'cleanup'),owner,{},60000).catch(e=>{error=String(e);process.exitCode=1;});audit=await ownerAudit(root,owner,join(root,'owner-audit.jsonl')).catch(e=>{error=String(e);process.exitCode=1;});await release();}
const modelCalls=[];async function walk(p){for(const e of await readdir(p,{withFileTypes:true})){if(['readiness','harness'].includes(e.name))continue;const f=join(p,e.name);if(e.isDirectory())await walk(f);else if(e.name.endsWith('.diagnostic.json'))modelCalls.push(JSON.parse(await readFile(f,'utf8')));}}await walk(root);
const session=JSON.parse(await readFile(join(root,'worker/worker-session-result.json'),'utf8').catch(()=>'{"status":"missing"}'));
if(session.status!=='completed'){process.exitCode=1;error??='Worker '+session.status;}
const result={managerCalls:0,workerCalls:1,execution,error,session,audit,modelCalls,parentBefore,parentAfter:hash(await readFile(parent)),fastConfirmed:modelCalls.length===1&&modelCalls[0].responseCompleted&&['fast','priority'].includes(modelCalls[0].response?.service_tier),formalBenchmark:false};await save(join(root,'result.json'),result);console.log(JSON.stringify(result));

import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {homedir} from 'node:os';
import {hash} from './provenance.js';
import {execute,type ProcessResult} from './process.js';
import {linuxPath} from './wsl-path.js';
import {classifyHweEvidence} from './hwe-evidence.js';
import type {HweEvidence as Evidence} from './hwe-quality.js';
import {advertisesFast,type ServiceTier} from './service-tier.js';
export {fingerprintMatches,fingerprintDifferences} from './hwe-fingerprint.js';
const moduleBase=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const hweProjectRoot=existsSync(join(moduleBase,'package.json'))?moduleBase:resolve(moduleBase,'..');
const projectRoot=hweProjectRoot;
export class HweCallError extends Error {
 constructor(action:string,readonly status:ProcessResult['status'],readonly logs:string,detail:string){super(`${action}: ${status}; ${detail}`);}
}
/** Opt-in launch setting; omitted preserves the existing backend default. */
export function hweServiceTier(value=process.env.PROACTIVE_HWE_SERVICE_TIER):ServiceTier|undefined {
 if(value===undefined)return undefined;
 if(value==='default'||value==='fast'||value==='priority')return value;
 throw Error('PROACTIVE_HWE_SERVICE_TIER must be default, fast or priority');
}
/** Freeze official metadata for isolated CLI homes when speed is explicitly requested. */
export async function hweModelPayload(payload:Record<string,unknown>,dir:string,env:NodeJS.ProcessEnv=process.env):Promise<Record<string,unknown>> {
 const rawTier=payload.serviceTier??env.PROACTIVE_HWE_SERVICE_TIER,serviceTier=rawTier===undefined?undefined:hweServiceTier(String(rawTier));
 const catalogSource=payload.modelCatalog??env.PROACTIVE_HWE_MODEL_CATALOG??(serviceTier?join(homedir(),'.codex','models_cache.json'):undefined);
 if(catalogSource===undefined)return {...payload,...(serviceTier?{serviceTier}:{})};
 // Paths supplied by Windows callers remain Windows paths until the bridge boundary.
 const source=String(catalogSource),bytes=await readFile(source),catalog=JSON.parse(bytes.toString('utf8')) as {models?:{slug:string;supported_reasoning_levels?:{effort:string}[];service_tiers?:{id:string}[];additional_speed_tiers?:string[]}[]};
 const model=catalog.models?.find(m=>m.slug===payload.model);
 if(!model)throw Error('HWE model catalog does not contain the requested model');
 if(!model.supported_reasoning_levels?.some(e=>e.effort===payload.effort))throw Error('HWE model catalog does not support the requested effort');
 if(serviceTier&&serviceTier!=='default'&&!advertisesFast(model))throw Error('HWE model catalog does not advertise Fast for the requested model');
 await mkdir(dir,{recursive:true});const frozen=join(dir,'model-catalog.json');await writeFile(frozen,bytes);
 await writeFile(join(dir,'model-catalog-receipt.json'),JSON.stringify({source,sha256:hash(bytes),model:payload.model,effort:payload.effort,serviceTier:serviceTier??null},null,2));
 return {...payload,...(serviceTier?{serviceTier}:{}),modelCatalog:linuxPath(frozen)};
}
export function hweSettings(root:string,owner:string){return {root:linuxPath(root),owner,distro:'Ubuntu-24.04',repository:linuxPath(resolve(projectRoot,'.local/hwe-bench')),scripts:linuxPath(resolve(projectRoot,'scripts/hwe')),image:'proactive-hwe:local',oss:'/home/zaixi/.cache/proactive-hwe-tools/20260716/oss-cad-suite',xpack:'/home/zaixi/.cache/proactive-hwe-tools/xpack-riscv-none-elf-gcc-15.2.0-1',codex:'/home/zaixi/.cache/proactive-pb-tools/package/vendor/x86_64-unknown-linux-musl/bin/codex',proxyScript:linuxPath(resolve(projectRoot,'scripts/runtime/model_proxy.py')),auth:'/mnt/c/Users/HUAWEI/.codex/auth.json',egressProxy:'http://172.21.112.1:7897'};}
export async function hweCall(action:string,dir:string,owner:string,payload:Record<string,unknown>,timeoutMs:number,signal?:AbortSignal,executeCall:typeof execute=execute){
 if(action==='worker')payload=await hweModelPayload(payload,dir);
 await mkdir(dir,{recursive:true});const settings=hweSettings(dir,owner),request=join(dir,`request-${action}-${randomUUID()}.json`),logs=join(dir,`${action}-${randomUUID()}`);await mkdir(logs);
 const cancelFile=join(dir,`cancel-${randomUUID()}.json`),fallback=new AbortController();let cancellation:Promise<void>|undefined,killTimer:ReturnType<typeof setTimeout>|undefined;
 const cancel=()=>{cancellation=writeFile(cancelFile,JSON.stringify({reason:'host_cancelled',at:new Date().toISOString()}));void cancellation.catch(()=>fallback.abort());killTimer=setTimeout(()=>fallback.abort(),30000);};
 if(action==='worker')payload={...payload,cancelFile:linuxPath(cancelFile),callId:randomUUID()};
 await writeFile(request,JSON.stringify({settings,payload}));
 if(action==='worker'){signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();}
 let result:ProcessResult;
 try{result=await executeCall({command:'wsl.exe',args:['-d',settings.distro,'--','python3',settings.scripts+'/bridge.py',action,linuxPath(request)],cwd:projectRoot,logDir:logs,timeoutMs,signal:action==='worker'?fallback.signal:signal});}
 finally{if(killTimer)clearTimeout(killTimer);signal?.removeEventListener('abort',cancel);await cancellation;}
 // Graceful bridge export completes before returning cancellation to the loop.
 if(action==='worker'&&signal?.aborted)result={...result,status:'cancelled'};
 await writeFile(join(logs,'execution.json'),JSON.stringify(result,null,2));
 if(action==='worker'&&result.status==='cancelled'&&existsSync(join(dir,'worker-session-result.json')))return {logs,result};
 if(result.status!=='completed')throw new HweCallError(action,result.status,logs,(await readFile(join(logs,'stderr.log'),'utf8').catch(()=>result.detail??'')).slice(-4000));
 return {logs,result};
}
export async function verifyHwe(archive:string,dir:string,owner:string,signal:AbortSignal,call:typeof hweCall=hweCall):Promise<Evidence>{
 await mkdir(dir,{recursive:true});try{await call('verify',dir,owner,{archive:linuxPath(archive),evidence:linuxPath(dir)},4300000,signal);const result=classifyHweEvidence(JSON.parse(await readFile(join(dir,'result.json'),'utf8')) as Evidence);await writeFile(join(dir,'classified-result.json'),JSON.stringify(result,null,2));return result;}catch(e){return {status:signal.aborted||e instanceof HweCallError&&e.status==='timeout'?'timeout':'error',checks:{},detail:String(e),limitations:[]};}
}
export async function hweFingerprint(){
 const dir=resolve(projectRoot,'.local/hwe-fingerprint',randomUUID());await mkdir(dir,{recursive:true});
 const settings=hweSettings(dir,'fingerprint');const result=await execute({command:'wsl.exe',args:['-d',settings.distro,'--','python3',settings.scripts+'/fingerprint.py',settings.repository,settings.image,settings.oss,settings.xpack],cwd:projectRoot,logDir:dir,timeoutMs:60000});if(result.status!=='completed')throw Error('HWE toolchain fingerprint failed');return JSON.parse(await readFile(join(dir,'stdout.jsonl'),'utf8'));
}

import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {execute} from './process.js';
import {linuxPath} from './wsl-path.js';
import {classifyHweEvidence} from './hwe-evidence.js';
import type {HweEvidence as Evidence} from './hwe-quality.js';
export {fingerprintMatches,fingerprintDifferences} from './hwe-fingerprint.js';
const moduleBase=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const hweProjectRoot=existsSync(join(moduleBase,'package.json'))?moduleBase:resolve(moduleBase,'..');
const projectRoot=hweProjectRoot;
export function hweSettings(root:string,owner:string){return {root:linuxPath(root),owner,distro:'Ubuntu-24.04',repository:linuxPath(resolve(projectRoot,'.local/hwe-bench')),scripts:linuxPath(resolve(projectRoot,'scripts/hwe')),image:'proactive-hwe:local',oss:'/home/zaixi/.cache/proactive-hwe-tools/20260716/oss-cad-suite',xpack:'/home/zaixi/.cache/proactive-hwe-tools/xpack-riscv-none-elf-gcc-15.2.0-1',codex:'/home/zaixi/.cache/proactive-pb-tools/package/vendor/x86_64-unknown-linux-musl/bin/codex',proxyScript:linuxPath(resolve(projectRoot,'scripts/runtime/model_proxy.py')),auth:'/mnt/c/Users/HUAWEI/.codex/auth.json',egressProxy:'http://172.21.112.1:7897'};}
export async function hweCall(action:string,dir:string,owner:string,payload:Record<string,unknown>,timeoutMs:number,signal?:AbortSignal){
 await mkdir(dir,{recursive:true});const settings=hweSettings(dir,owner),request=join(dir,`request-${action}-${randomUUID()}.json`),logs=join(dir,`${action}-${randomUUID()}`);await mkdir(logs);
 await writeFile(request,JSON.stringify({settings,payload}));
 const result=await execute({command:'wsl.exe',args:['-d',settings.distro,'--','python3',settings.scripts+'/bridge.py',action,linuxPath(request)],cwd:projectRoot,logDir:logs,timeoutMs,signal});
 await writeFile(join(logs,'execution.json'),JSON.stringify(result,null,2));
 if(result.status!=='completed')throw Error(`${action}: ${result.status}; ${(await readFile(join(logs,'stderr.log'),'utf8')).slice(-4000)}`);
 return {logs,result};
}
export async function verifyHwe(archive:string,dir:string,owner:string,signal:AbortSignal):Promise<Evidence>{
 await mkdir(dir,{recursive:true});try{await hweCall('verify',dir,owner,{archive:linuxPath(archive),evidence:linuxPath(dir)},4300000,signal);const result=classifyHweEvidence(JSON.parse(await readFile(join(dir,'result.json'),'utf8')) as Evidence);await writeFile(join(dir,'classified-result.json'),JSON.stringify(result,null,2));return result;}catch(e){return {status:signal.aborted?'timeout':'error',checks:{},detail:String(e),limitations:[]};}
}
export async function hweFingerprint(){
 const dir=resolve(projectRoot,'.local/hwe-fingerprint',randomUUID());await mkdir(dir,{recursive:true});
 const settings=hweSettings(dir,'fingerprint');const result=await execute({command:'wsl.exe',args:['-d',settings.distro,'--','python3',settings.scripts+'/fingerprint.py',settings.repository,settings.image,settings.oss,settings.xpack],cwd:projectRoot,logDir:dir,timeoutMs:60000});if(result.status!=='completed')throw Error('HWE toolchain fingerprint failed');return JSON.parse(await readFile(join(dir,'stdout.jsonl'),'utf8'));
}

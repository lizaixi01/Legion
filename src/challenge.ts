import {mkdir,readFile,writeFile,lstat} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {execute} from './process.js';

export const ChallengeSchema=z.object({
  checks:z.array(z.object({criterion:z.string().min(1),source:z.string().min(1).max(30000)}).strict()).max(20),
  limitations:z.array(z.string()).max(20)
}).strict();
export type Challenge=z.infer<typeof ChallengeSchema>;
export interface AcceptanceContract {goal:string;outputs:string[];acceptance:string[]}
export interface ValidationAttempt {version:number;status:'accepted'|'needs_repair'|'unverified'|'error';contractHash:string;verifierHash:string;artifactHash:string;snapshot:string;checks:{criterion:string;status:string;detail:string;logDir:string}[]}
export interface ChallengeEvidence {contract:AcceptanceContract;contractHash:string;verifierHash?:string;limitations:string[];attempts:ValidationAttempt[];error?:string}
export const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export function validateChallenge(raw:unknown,contract:AcceptanceContract){
 const challenge=ChallengeSchema.parse(raw);
 if(challenge.checks.length!==contract.acceptance.length||contract.acceptance.some(c=>challenge.checks.filter(t=>t.criterion===c).length!==1))throw Error('Independent checks must cover every acceptance criterion exactly once');
 return challenge;
}
// Copy only declared regular files; never traverse links or import a whole project.
export async function snapshotOutputs(workspace:string,outputs:string[],target:string){
 const files:Record<string,string>={};await mkdir(target,{recursive:true});
 for(const file of outputs){if(!/^[a-zA-Z0-9_-][a-zA-Z0-9_./-]*$/.test(file)||file.split('/').some(s=>!s||s==='.'||s==='..'))throw Error('Unsafe output path');
  let source=workspace;for(const part of ['',...file.split('/')]){source=join(source,part);if((await lstat(source)).isSymbolicLink())throw Error('Output links are not allowed');}
  const info=await lstat(source);if(!info.isFile()||info.size>4*1024*1024)throw Error('Output missing or too large');const bytes=await readFile(source);files[file]=digest(bytes);await mkdir(dirname(join(target,file)),{recursive:true});await writeFile(join(target,file),bytes);
 }
 return digest(JSON.stringify(Object.entries(files).sort(([a],[b])=>a.localeCompare(b))));
}
export async function hashOutputs(workspace:string,outputs:string[]){const files:Record<string,string>={};for(const file of outputs){if(!/^[a-zA-Z0-9_-][a-zA-Z0-9_./-]*$/.test(file)||file.split('/').some(s=>!s||s==='.'||s==='..'))throw Error('Unsafe output path');let path=workspace;for(const part of ['',...file.split('/')]){path=join(path,part);if((await lstat(path)).isSymbolicLink())throw Error('Output links are not allowed');}files[file]=digest(await readFile(path));}return digest(JSON.stringify(Object.entries(files).sort(([a],[b])=>a.localeCompare(b))));}

/** Checks run under Node's permission model: snapshot reads only, no writes or subprocesses. This is not an OS security sandbox. */
export async function verifySnapshot(contract:AcceptanceContract,challenge:Challenge,workspace:string,dir:string,version:number,signal?:AbortSignal):Promise<ValidationAttempt>{
 await mkdir(dir,{recursive:true});const snapshot=join(dir,'candidate');const artifactHash=await snapshotOutputs(workspace,contract.outputs,snapshot);
 const result:ValidationAttempt={version,status:'unverified',contractHash:digest(JSON.stringify(contract)),verifierHash:digest(JSON.stringify(challenge)),artifactHash,snapshot,checks:[]};
 const empty=join(dir,'empty');await mkdir(empty);
 for(const [i,check] of challenge.checks.entries()){
  const script=join(dir,`criterion-${i}.mjs`);await writeFile(script,check.source);
  // Restrict normal module/network APIs in addition to Node filesystem permissions.
  // This remains process-level hardening, not protection from a malicious same-user process.
  const guard=join(dir,`guard-${i}.cjs`);await writeFile(guard,`
const {registerHooks}=require('node:module');const {fileURLToPath}=require('node:url');const {relative,isAbsolute}=require('node:path');
const allowed=new Set(['fs','fs/promises','assert','assert/strict','path','url']);
const deny=()=>{throw new Error('LEGION_CHECK_CAPABILITY_DENIED')};
for(const key of ['fetch','WebSocket'])Object.defineProperty(globalThis,key,{value:deny,writable:false,configurable:false});
const get=process.getBuiltinModule.bind(process);Object.defineProperty(process,'getBuiltinModule',{value:id=>allowed.has(id.replace(/^node:/,''))?get(id):deny(),writable:false,configurable:false});
Object.defineProperty(process,'binding',{value:deny,writable:false,configurable:false});
registerHooks({resolve(spec,ctx,next){const r=next(spec,ctx);if(r.url.startsWith('node:')){if(!allowed.has(r.url.slice(5)))deny();}else{if(!r.url.startsWith('file:'))deny();const path=fileURLToPath(r.url),rel=relative(process.cwd(),path);if(path!==process.argv[1]&&(rel.startsWith('..')||isAbsolute(rel)))deny();}return r;}});
`);
  const syntaxDir=join(dir,`${i}-syntax`);await mkdir(syntaxDir);
  const syntax=await execute({command:process.env.PROACTIVE_NODE??process.execPath,args:['--check',script],cwd:dir,logDir:syntaxDir,timeoutMs:15000,signal});
  if(syntax.status!=='completed'){result.checks.push({criterion:check.criterion,status:'unverified',detail:'Invalid or interrupted independent check: '+(await readFile(join(syntaxDir,'stderr.log'),'utf8')).slice(-3000),logDir:syntaxDir});continue;}
  // A check that succeeds with no candidate is not evidence of implemented behavior.
  for(const control of [true,false]){
   const cwd=control?empty:snapshot,logDir=join(dir,`${i}-${control?'control':'candidate'}`);await mkdir(logDir);
   const execution=await execute({command:process.env.PROACTIVE_NODE??process.execPath,args:['--permission',`--allow-fs-read=${script}`,`--allow-fs-read=${guard}`,`--allow-fs-read=${cwd}`,'--require',guard,script],cwd,logDir,timeoutMs:15000,signal,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP}});
   const detail=((await readFile(join(logDir,'stdout.jsonl'),'utf8'))+'\n'+(await readFile(join(logDir,'stderr.log'),'utf8'))).slice(-6000);
   if(execution.status==='timeout'||execution.status==='cancelled'||execution.exitCode===null){result.checks.push({criterion:check.criterion,status:'error',detail:execution.status+': '+detail,logDir});break;}
   if(control){if(execution.exitCode===0){result.checks.push({criterion:check.criterion,status:'unverified',detail:'Check also passed without a candidate; rejected as insufficient evidence',logDir});break;}}
   else result.checks.push({criterion:check.criterion,status:execution.status==='completed'?'pass':/ERR_ASSERTION/.test(detail)?'fail':'unverified',detail,logDir});
  }
 }
 if(await hashOutputs(snapshot,contract.outputs)!==artifactHash)throw Error('Candidate snapshot changed during verification');
 result.status=result.checks.some(c=>c.status==='error')?'error':result.checks.some(c=>c.status==='unverified')?'unverified':result.checks.some(c=>c.status==='fail')?'needs_repair':result.checks.length===contract.acceptance.length&&result.checks.length>0&&challenge.limitations.length===0?'accepted':'unverified';
 await writeFile(join(dir,'verification.json'),JSON.stringify(result,null,2));return result;
}

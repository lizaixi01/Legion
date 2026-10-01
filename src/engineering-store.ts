import {mkdir,readFile,writeFile,rename,appendFile,unlink,rmdir,open} from 'node:fs/promises';
import {join} from 'node:path';import {randomUUID} from 'node:crypto';import {digest} from './challenge.js';
export const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch(error){return (error as NodeJS.ErrnoException).code!=='ESRCH';}};
/** The checksummed state envelope is the only recovery authority; JSONL is a derived audit view. */
export async function readRun<T>(dir:string):Promise<T>{const e=JSON.parse(await readFile(join(dir,'run.json'),'utf8'));if(e.version!==1||digest(JSON.stringify(e.payload))!==e.sha256)throw Error('Run checkpoint is damaged; refusing recovery');return e.payload as T;}
export async function writeRun<T>(dir:string,state:T,event:unknown){
 await mkdir(dir,{recursive:true});const payload=structuredClone(state);await writeFile(join(dir,'run.tmp'),JSON.stringify({version:1,payload,sha256:digest(JSON.stringify(payload))},null,2));
 let separator='';try{const log=await open(join(dir,'run-events.jsonl'),'r');try{const size=(await log.stat()).size;if(size){const byte=Buffer.alloc(1);await log.read(byte,0,1,size-1);if(byte[0]!==10)separator='\n';}}finally{await log.close();}}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 await appendFile(join(dir,'run-events.jsonl'),separator+JSON.stringify(event)+'\n');await rename(join(dir,'run.tmp'),join(dir,'run.json'));
}
export async function claimRun(dir:string,unsettled:()=>Promise<boolean>){
 const gate=join(dir,'claim-gate');await mkdir(gate);const path=join(dir,'owner.json'),token=randomUUID();
 try{let owner:{pid:number;token:string}|undefined;try{owner=JSON.parse(await readFile(path,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  if(owner&&alive(owner.pid))throw Error('Previous execution owner is still alive; no duplicate dispatch');
  if(await unsettled())throw Error('Previous executor/checker outcome is unknown; inspect recorded process evidence before recovery');
  if(owner)await unlink(path);await writeFile(path,JSON.stringify({pid:process.pid,token,claimedAt:new Date().toISOString()}),{flag:'wx'});
 }finally{await rmdir(gate);}
 const assert=async()=>{const owner=JSON.parse(await readFile(path,'utf8'));if(owner.token!==token||owner.pid!==process.pid)throw Error('Execution ownership changed; late callback refused');};
 return {token,assert,release:async()=>{await assert();await unlink(path);}};
}

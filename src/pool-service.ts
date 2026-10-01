import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {WorkerPool,type Backend,type Result} from './worker-pool.js';
import {workerSpecsFor} from './account-capacity.js';
export function createPoolService(root:string){
 let active: {id:string;pool:WorkerPool;controller:AbortController;results:Record<string,Result>;done:Promise<void>}|undefined;
 return {
  snapshot:()=>active?{id:active.id,...active.pool.snapshot(),results:active.results}:null,
  stop:async()=>{active?.controller.abort();await active?.done;},
  isActive:()=>!!active&&(active.pool.snapshot().queued>0||Object.values(active.pool.snapshot().active).some(n=>n>0)),
  async start(input:{jobs:{backend:Backend;prompt:string}[];concurrency:number}){
   if(active&&(active.pool.snapshot().queued||Object.values(active.pool.snapshot().active).some(n=>n)))throw Error('队列正在运行');
   if(!Number.isInteger(input.concurrency)||input.concurrency<1||input.concurrency>64||!Array.isArray(input.jobs)||!input.jobs.length||input.jobs.length>1000||input.jobs.some(j=>!['codex','commandcode'].includes(j.backend)||typeof j.prompt!=='string'||!j.prompt.trim()||j.prompt.length>50000))throw Error('无效队列配置');
   const id=randomUUID(),dir=join(root,'.pool',id);await mkdir(dir,{recursive:true});await writeFile(join(dir,'input.json'),JSON.stringify(input,null,2));
   const state={id,pool:new WorkerPool({codex:input.concurrency,commandcode:input.concurrency},input.concurrency),controller:new AbortController(),results:{} as Record<string,Result>,done:Promise.resolve()};active=state;
   state.done=Promise.all(input.jobs.map(async(j,i)=>{const key=String(i);state.results[key]=await state.pool.submit({...workerSpecsFor(root)[j.backend],modPath:j.backend==='commandcode'?join(root,'scripts/capacity/read-only-mod.mjs'):undefined},{id:key,prompt:j.prompt,workspace:join(dir,key,'workspace'),logDir:join(dir,key,'logs'),timeoutMs:1800000},state.controller.signal);await mkdir(join(dir,key),{recursive:true});await writeFile(join(dir,key,'result.json'),JSON.stringify(state.results[key],null,2));})).then(async()=>{await writeFile(join(dir,'results.json'),JSON.stringify(state.results,null,2));});
   void state.done.catch(()=>{});return {id};
  }
 };
}


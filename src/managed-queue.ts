import {WorkerPool,runWorker,type Backend,type WorkerSpec,type Result} from './worker-pool.js';
import {workerSpecs} from './account-capacity.js';
import {join} from 'node:path';
import type {WorkerRequest,WorkerResult} from './types.js';
const pools=new Map<string,WorkerPool>();
export function sharedPool(root:string){let pool=pools.get(root);if(!pool){pool=new WorkerPool({codex:64,commandcode:32},64);pools.set(root,pool);}return pool;}
export function backendSpec(root:string,backend:Backend,permission:WorkerSpec['permission']='workspace-write'):WorkerSpec{return {...workerSpecs[backend],permission,modPath:backend==='commandcode'?join(root,'scripts/capacity',permission==='read-only'?'read-only-mod.mjs':'workspace-mod.mjs'):undefined};}
export function queuedWorker(root:string,spec:WorkerSpec){return async(request:WorkerRequest):Promise<WorkerResult>=>{const r=await sharedPool(root).submit(spec,{id:request.attemptDir,prompt:request.prompt,workspace:request.workspace,logDir:request.attemptDir,timeoutMs:request.timeoutMs,sessionId:request.sessionId},request.signal);return workerResult(r);};}
export function workerResult(r:Result):WorkerResult{return {status:['completed','timeout','cancelled'].includes(r.status)?r.status as WorkerResult['status']:'error',durationMs:r.durationMs,sessionId:r.sessionId,usage:r.usage?[r.usage]:[],detail:r.detail??(r.status==='completed'?undefined:r.status)};}

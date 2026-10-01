import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WorkerPool,parseOutput,type Result,type WorkerSpec} from '../src/worker-pool.js';
const spec:WorkerSpec={backend:'codex',model:'test',effort:'medium',command:'none',prefix:[]};
const job={id:'test',workspace:'.',logDir:'.',prompt:'test',timeoutMs:1};
const ok:Result={status:'completed',durationMs:1,text:'ok',usage:null};
test('queued cancellation settles without waiting for active work',async()=>{let release!:()=>void;const gate=new Promise<void>(r=>release=r);const pool=new WorkerPool({codex:1,commandcode:0},1,async()=>{await gate;return ok;});const first=pool.submit(spec,job);const c=new AbortController();const second=pool.submit(spec,job,c.signal);c.abort();assert.equal((await second).status,'cancelled');release();await first;});
test('authentication failure remains distinct from quota',async()=>{const pool=new WorkerPool({codex:1,commandcode:0},1,async()=>({...ok,status:'auth'}));const results=await Promise.all([pool.submit(spec,job),pool.submit(spec,job)]);assert.deepEqual(results.map(r=>r.status),['auth','auth']);});
test('pool enforces shared and backend limits',async()=>{let active=0,peak=0;const pool=new WorkerPool({codex:2,commandcode:2},3,async()=>{peak=Math.max(peak,++active);await new Promise(r=>setTimeout(r,5));active--;return ok;});await Promise.all(Array.from({length:10},(_,i)=>pool.submit({...spec,backend:i%2?'codex':'commandcode'},job)));assert.equal(peak,3);assert.equal(pool.snapshot().queued,0);});
test('exhausted account prevents queued launches',async()=>{let calls=0;const pool=new WorkerPool({codex:1,commandcode:1},1,async()=>{calls++;return {...ok,status:'quota'};});const results=await Promise.all([pool.submit(spec,job),pool.submit(spec,job)]);assert.equal(calls,1);assert.ok(results.every(r=>r.status==='quota'));});
test('recoverable Codex errors do not override completion',()=>{const r=parseOutput('codex','{"type":"error","message":"Reconnecting 502"}\n{"type":"turn.completed","usage":{}}',0);assert.equal(r.status,'completed');});
test('Command Code requires terminal success',()=>{assert.equal(parseOutput('commandcode','{"type":"result","subtype":"success","finalText":"ok"}',0).status,'completed');assert.equal(parseOutput('commandcode','{"type":"event"}',0).status,'error');});

test('a queued deadline expires without launching or waiting for the active job',async()=>{
 let release!:()=>void,calls=0;const gate=new Promise<void>(r=>release=r);
 const pool=new WorkerPool({codex:1,commandcode:0},1,async()=>{calls++;await gate;return ok;});
 const first=pool.submit(spec,job);const second=pool.submit(spec,{...job,deadline:Date.now()+30});
 assert.equal((await second).status,'timeout');assert.equal(calls,1);release();await first;
});

test('queue wait consumes deadline and synchronous runner failures release the slot',async()=>{
 const timeouts:number[]=[];let calls=0;
 const pool=new WorkerPool({codex:1,commandcode:0},1,(_spec,next)=>{timeouts.push(next.timeoutMs);if(++calls===1)throw Error('synchronous failure');return Promise.resolve(ok);});
 const results=await Promise.all([pool.submit(spec,{...job,timeoutMs:1800000,deadline:Date.now()+1000}),pool.submit(spec,job)]);
 assert.equal(results[0]!.status,'error');assert.equal(results[1]!.status,'completed');assert.ok(timeouts[0]!<=1000);assert.equal(pool.snapshot().active.codex,0);
});

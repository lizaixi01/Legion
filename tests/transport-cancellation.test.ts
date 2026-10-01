import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {codexAppServerWorker} from '../src/codex-app-server.js';

test('pre-cancelled primary transport creates no process or launch records',async()=>{
 const root=await mkdtemp(join(tmpdir(),'transport-pre-cancel-')),controller=new AbortController();controller.abort();
 const result=await codexAppServerWorker('not-a-command','fixture',{workspace:root,attemptDir:root,prompt:'work',timeoutMs:1000,signal:controller.signal});
 assert.equal(result.status,'cancelled');assert.deepEqual(await readdir(root),[]);
});

test('cancellation while saving the session prevents sending the first model turn',async()=>{
 const root=await mkdtemp(join(tmpdir(),'transport-setup-cancel-')),controller=new AbortController();
 await writeFile(join(root,'app-server'),`const fs=require('fs'),rl=require('readline').createInterface({input:process.stdin});rl.on('line',line=>{fs.appendFileSync('wire.jsonl',line+'\\n');const m=JSON.parse(line);if(m.method==='initialize')console.log(JSON.stringify({id:m.id,result:{}}));if(m.method==='thread/start')console.log(JSON.stringify({id:m.id,result:{thread:{id:'thread'}}}));});`);
 let saved=false;
 const result=await codexAppServerWorker(process.execPath,'fixture',{workspace:root,attemptDir:root,prompt:'work',timeoutMs:10000,signal:controller.signal},{effort:'low',permission:'read-only',instructions:'fixture',onSession:async()=>{saved=true;controller.abort();}});
 assert.equal(saved,true);assert.equal(result.status,'cancelled');const wire=await readFile(join(root,'wire.jsonl'),'utf8');assert.match(wire,/thread\/start/);assert.doesNotMatch(wire,/turn\/start|"status":"active"/);
});

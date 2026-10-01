import {mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {codexAppServerWorker} from '../../src/codex-app-server.js';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
const [root,mode]=process.argv.slice(2) as [string,string];
// Inject the OS stream error into a real spawned child's stdin. Strict mode must survive it.
if(mode==='pipe'){
  const spawn=childProcess.spawn;
  childProcess.spawn=((...args:Parameters<typeof spawn>)=>{const child=spawn(...args);if(args[0]===process.execPath)child.once('spawn',()=>setImmediate(()=>child.stdin?.emit('error',Object.assign(Error('write EPIPE'),{code:'EPIPE'}))));return child;}) as typeof spawn;
  syncBuiltinESMExports();
}
await writeFile(join(root,'app-server'),mode==='pipe'?`
const fs=require('fs'),rl=require('readline').createInterface({input:process.stdin});
rl.once('line',line=>{const m=JSON.parse(line);console.log(JSON.stringify({id:m.id,result:{}}));rl.close();process.stdin.destroy();try{fs.closeSync(0);}catch{};});setTimeout(()=>{},20000);
`:`
const rl=require('readline').createInterface({input:process.stdin});const send=x=>console.log(JSON.stringify(x));
${mode==='cleanup'?"process.stdin.on('end',()=>console.error('late stderr during cleanup'));":""}
rl.on('line',line=>{const m=JSON.parse(line);if(m.method==='initialize')send({id:m.id,result:{}});
if(m.method==='thread/start')send({id:m.id,result:{thread:{id:'thread'}}});
if(m.method==='turn/start'){send({id:m.id,result:{turn:{id:'turn'}}});${mode==='stderr'?"console.error('fixture stderr');":"send({method:'item/completed',params:{threadId:'thread',item:{id:'answer',type:'agentMessage',text:'done'}}});"}setTimeout(()=>send({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed'}}}),20);}});
`);
const result=await codexAppServerWorker(process.execPath,'fixture',{workspace:root,attemptDir:root,prompt:'test',timeoutMs:4000},{effort:'low',permission:'read-only',instructions:mode==='pipe'?'x'.repeat(2_000_000):'fixture',onSession:async()=>{
  if(mode==='pipe')return;const log=join(root,mode==='stderr'||mode==='cleanup'?'stderr.log':'stdout.jsonl');await rm(log);await mkdir(log);
}});
console.log(JSON.stringify(result));

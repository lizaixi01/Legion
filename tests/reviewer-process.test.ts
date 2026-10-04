import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runWorker} from '../src/worker-pool.js';

for(const mode of ['completed','timeout','exit-one','missing-terminal','not-started'] as const){
 test(`reviewer process diagnostics: ${mode}`,async t=>{
  const root=await mkdtemp(join(tmpdir(),'reviewer-process-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const script=join(root,'fixture.cjs');
  await writeFile(script,`console.log(JSON.stringify({type:'thread.started',thread_id:'fixture'}));
   ${mode==='completed'||mode==='exit-one'?"console.log(JSON.stringify({type:'turn.completed',usage:{}}));":''}
   ${mode==='timeout'?'setInterval(()=>{},1000);':`process.exit(${mode==='exit-one'?1:0});`}`);
  const result=await runWorker({backend:'codex',command:mode==='not-started'?join(root,'missing-command'):process.execPath,prefix:[script],model:'fixture',effort:'medium'},
   {id:'review',workspace:root,logDir:join(root,'logs'),prompt:'fixture',timeoutMs:mode==='timeout'?1000:10000});
  assert.equal(result.status,mode==='completed'?'completed':mode==='timeout'?'timeout':'error');
  assert.equal(result.execution?.started,mode!=='not-started');
  assert.equal(result.terminalEvent,mode==='completed'||mode==='exit-one'?'turn.completed':undefined);
  if(mode==='exit-one')assert.equal(result.execution?.exitCode,1);
  if(mode==='missing-terminal')assert.match(result.detail!,/No successful terminal event/);
  assert.deepEqual(JSON.parse(await readFile(join(root,'logs/result.json'),'utf8')),JSON.parse(JSON.stringify(result)));
  assert.ok(await readFile(join(root,'logs/invocation.json'),'utf8'));
 });
}

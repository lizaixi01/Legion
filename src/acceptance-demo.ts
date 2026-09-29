import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {managedChatWorker,type ManagedDependencies} from './managed-chat.js';
import {aggregationContract} from './acceptance.js';
import type {ChatOptions} from './chat-options.js';
export const demoGoal='Aggregate numbers [3,1,2]: write aggregate.json with sum and sorted.';
export async function runAcceptanceDemo(dir:string,mode:'work'|'delegate'='delegate',override:Partial<ManagedDependencies>={}){
 const options:ChatOptions={model:'gpt-6-sol',effort:'medium',permission:'workspace-write',agents:0,delegation:{mode:mode==='work'?'off':'auto',count:10}};
 const contract=aggregationContract(demoGoal)!;let attempts=0;
 await mkdir(dir,{recursive:true});await writeFile(join(dir,'fixture.json'),JSON.stringify({orchestration:'OFFLINE FIXTURE; no model calls',verification:'Real Node subprocess assertions and installed functional verifier'}));
 const deps:ManagedDependencies={
  decide:async state=>state.round?{action:'finish',reason:'Request runtime delivery',answer:'Aggregation implemented',tasks:[]}:{action:mode,contract,reason:'Frozen sum and sort requirements',answer:'',tasks:mode==='delegate'?[{id:'aggregate',backend:'codex',...contract}]:[]},
  challenge:async c=>({checks:c.acceptance.map((criterion,i)=>({criterion,source:`import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';const value=JSON.parse(readFileSync('aggregate.json','utf8'));${i===0?'assert.equal(value.sum,6);':'assert.deepEqual(value.sorted,[1,2,3]);'}`})),limitations:[]}),
  worker:async(_spec,job)=>{attempts++;await mkdir(job.workspace,{recursive:true});await writeFile(join(job.workspace,'aggregate.json'),JSON.stringify({sum:attempts===1?0:6,sorted:[1,2,3]}));return {status:'completed',sessionId:'fixture-implementation',text:'Worker claim: everything passed',durationMs:1,usage:{fixture:true}};},...override};
 const result=await managedChatWorker(process.cwd(),options,[],deps)({workspace:join(dir,'project-context'),attemptDir:join(dir,'turn'),prompt:demoGoal,timeoutMs:60000});
 const state=JSON.parse(await readFile(join(dir,'turn','management.json'),'utf8'));await writeFile(join(dir,'result.json'),JSON.stringify({fixture:true,result,state},null,2));return {result,state,dir,attempts};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const dir=resolve(process.argv[2]??join('.local','acceptance-demo-'+Date.now()));const r=await runAcceptanceDemo(dir);console.log(JSON.stringify({path:dir,execution:r.result.status,acceptance:r.result.acceptance,attempts:r.attempts},null,2));if(r.result.acceptance?.status!=='accepted')process.exitCode=1;}

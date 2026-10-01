import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createPrimaryDelivery} from '../src/primary-delivery.js';
import {aggregationContract} from '../src/acceptance.js';
import type {WorkerSpec} from '../src/worker-pool.js';
const goal='Aggregate numbers [3,1,2]: write aggregate.json with sum and sorted.';
const contract=aggregationContract(goal)!;
const challenger:WorkerSpec={backend:'codex',command:'unused',prefix:[],model:'test',effort:'medium'};
const proposal={checks:contract.acceptance.map((criterion,i)=>({criterion,source:`import fs from 'node:fs';import assert from 'node:assert/strict';const value=JSON.parse(fs.readFileSync('aggregate.json','utf8'));${i===0?'assert.equal(value.sum,6);':'assert.deepEqual(value.sorted,[1,2,3]);'}`})),limitations:[]};
const runner=async()=>{throw Error('Unexpected model call');};

test('primary delivery freezes requirements, discovers failure, repairs against same review and invalidates changed output',async()=>{
 const root=await mkdtemp(join(tmpdir(),'delivery-'));let challenges=0;
 const service=createPrimaryDelivery(root,join(root,'evidence'),goal,Date.now()+60000,true,{challenger,run:runner,challenge:async()=>{challenges++;return proposal;}});
 await service.call({action:'prepare',contract});
 await assert.rejects(service.call({action:'prepare',contract}),/frozen/);
 await writeFile(join(root,'aggregate.json'),JSON.stringify({sum:5,sorted:[1,2,3]}));
 const first=await service.call({action:'check'});assert.equal(first.acceptance.status,'rejected');
 await writeFile(join(root,'aggregate.json'),JSON.stringify({sum:6,sorted:[1,2,3]}));
 const second=await service.call({action:'check'});assert.equal(second.acceptance.status,'accepted');assert.equal(challenges,1);
 assert.equal(second.versions[0]!.acceptance.status,'rejected');assert.equal(second.versions[0]!.review!.verifierHash,second.versions[1]!.review!.verifierHash);
 assert.equal((await service.finalize()).status,'accepted');
 const saved=JSON.parse(await readFile(join(root,'evidence','delivery.json'),'utf8'));assert.equal(saved.versions.length,2);
 await writeFile(join(root,'aggregate.json'),'{}');assert.equal((await service.finalize()).status,'blocked');
});

test('review passes cannot certify unsupported tasks and disabled subagents never start reviewer',async()=>{
 for(const enabled of [false,true]){
  const root=await mkdtemp(join(tmpdir(),'delivery-coverage-'));let reviews=0;
  const service=createPrimaryDelivery(root,join(root,'evidence'),'Make a general data file',Date.now()+60000,enabled,{challenger,run:runner,challenge:async()=>{reviews++;return proposal;}});
  await service.call({action:'prepare',contract});await writeFile(join(root,'aggregate.json'),JSON.stringify({sum:6,sorted:[1,2,3]}));
  const result=await service.call({action:'check'});assert.equal(result.acceptance.status,'unverified');assert.equal(reviews,enabled?1:0);
 }
});

test('contradictory reviewer evidence blocks a functional PASS and preserves both reports',async()=>{
 const root=await mkdtemp(join(tmpdir(),'delivery-conflict-'));
 const wrongReview={checks:proposal.checks.map((check,i)=>i===0?{...check,source:check.source.replace('value.sum,6','value.sum,7')}:check),limitations:[]};
 const service=createPrimaryDelivery(root,join(root,'evidence'),goal,Date.now()+60000,true,{challenger,run:runner,challenge:async()=>wrongReview});
 await service.call({action:'prepare',contract});await writeFile(join(root,'aggregate.json'),JSON.stringify({sum:6,sorted:[1,2,3]}));
 const result=await service.call({action:'check'});
 assert.equal(result.versions[0]!.functional!.acceptance.status,'accepted');assert.equal(result.versions[0]!.review!.status,'needs_repair');
 assert.equal(result.acceptance.status,'blocked');assert.equal((await service.finalize()).status,'blocked');
 assert.match(result.acceptance.detail,/冲突/);await assert.rejects(service.call({action:'prepare',contract}),/frozen/);
});

test('insufficient reviewer coverage cannot erase an external rejection',async()=>{
 const root=await mkdtemp(join(tmpdir(),'delivery-rejection-'));
 const emptyReview={checks:contract.acceptance.map(criterion=>({criterion,source:'// no behavioral assertion'})),limitations:['unsupported']};
 const service=createPrimaryDelivery(root,join(root,'evidence'),goal,Date.now()+60000,true,{challenger,run:runner,challenge:async()=>emptyReview});
 await service.call({action:'prepare',contract});await writeFile(join(root,'aggregate.json'),JSON.stringify({sum:5,sorted:[1,2,3]}));
 const result=await service.call({action:'check'});assert.equal(result.versions[0]!.review!.status,'unverified');assert.equal(result.versions[0]!.functional!.acceptance.status,'rejected');
 assert.equal(result.acceptance.status,'rejected');assert.equal((await service.finalize()).status,'rejected');
});

test('missing outputs, check budget, cancellation and model supplied checker fields fail closed',async()=>{
 const root=await mkdtemp(join(tmpdir(),'delivery-bounds-'));const controller=new AbortController();
 const service=createPrimaryDelivery(root,join(root,'evidence'),goal,Date.now()+60000,true,{challenger,run:runner},controller.signal);
 await assert.rejects(service.call({action:'check'}),/Prepare/);
 await assert.rejects(service.call({action:'prepare',contract:{...contract,command:'echo PASS'}}));
 await assert.rejects(service.call({action:'prepare',contract:{...contract,outputs:['../outside']}}));
 await service.call({action:'prepare',contract});
 for(let i=0;i<3;i++)assert.equal((await service.call({action:'check'})).acceptance.status,'blocked');
 await assert.rejects(service.call({action:'check'}),/budget/);
 controller.abort();await assert.rejects(service.call({action:'read'}),/cancelled/);
});

test('primary turn cannot declare completion while a registered delivery is unchecked',async()=>{
 const {primaryAgentWorker}=await import('../src/primary-agent.js');
 const {defaultChatOptions}=await import('../src/chat-options.js');
 const {mkdir}=await import('node:fs/promises');
 const root=await mkdtemp(join(tmpdir(),'delivery-gate-'));const attempt=join(root,'turn');await mkdir(attempt);
 await writeFile(join(root,'app-server'),`const rl=require('readline').createInterface({input:process.stdin});const send=x=>console.log(JSON.stringify(x));rl.on('line',line=>{const m=JSON.parse(line);if(!m.method){if(m.id==='prepare'){send({method:'item/completed',params:{threadId:'thread',item:{id:'final',type:'agentMessage',text:'Everything is done'}}});send({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed'}}});}return;}if(m.method==='initialize')send({id:m.id,result:{}});if(m.method==='thread/start')send({id:m.id,result:{thread:{id:'thread'}}});if(m.method==='turn/start'){send({id:m.id,result:{turn:{id:'turn'}}});send({id:'prepare',method:'item/tool/call',params:{threadId:'thread',tool:'legion_delivery',arguments:${JSON.stringify({action:'prepare',contract})}}});}});`);
 const run=primaryAgentWorker(root,process.execPath,{...defaultChatOptions,delegation:{mode:'off',count:10}},join(root,'tasks'),async()=>{});
 const result=await run({workspace:root,attemptDir:attempt,prompt:goal,timeoutMs:10000});
 assert.equal(result.status,'error');assert.equal(result.acceptance?.status,'pending');assert.match(result.detail!,/验收/);
});

test('later turn resumes original requirements and frozen review but must recheck files',async()=>{
 const root=await mkdtemp(join(tmpdir(),'delivery-resume-'));let calls=0;
 const deps={challenger,run:runner,challenge:async()=>{calls++;return proposal;}};
 const first=createPrimaryDelivery(root,join(root,'first'),goal,Date.now()+60000,true,deps);
 await first.call({action:'prepare',contract});await writeFile(join(root,'aggregate.json'),JSON.stringify({sum:5,sorted:[1,2,3]}));
 assert.equal((await first.call({action:'check'})).acceptance.status,'rejected');
 const second=createPrimaryDelivery(root,join(root,'second'),'继续修复',Date.now()+60000,true,deps,undefined,join(root,'first','delivery.json'));
 const before=await second.call({action:'read'});assert.equal(before.previous?.acceptance.status,'rejected');assert.equal(before.acceptance.status,'unverified');
 const resumed=await second.call({action:'resume'});assert.equal(resumed.contract?.originalRequirement,goal);assert.equal(resumed.acceptance.status,'pending');
 await writeFile(join(root,'aggregate.json'),JSON.stringify({sum:6,sorted:[1,2,3]}));
 const repaired=await second.call({action:'check'});assert.equal(repaired.acceptance.status,'accepted');assert.equal(calls,1);
 const third=createPrimaryDelivery(root,join(root,'third'),'再检查',Date.now()+60000,true,deps,undefined,join(root,'second','delivery.json'));
 assert.equal((await third.call({action:'read'})).previous?.acceptance.status,'accepted');
 assert.equal((await third.finalize()).status,'unverified');await third.call({action:'resume'});assert.equal((await third.finalize()).status,'pending');
 await writeFile(join(root,'aggregate.json'),'{}');assert.equal((await third.call({action:'check'})).acceptance.status,'rejected');
});

test('persistent delivery keeps its canonical contract even without a chat turn pointer',async()=>{
 const root=await mkdtemp(join(tmpdir(),'delivery-goal-')),continuity={file:join(root,'goal','delivery.json'),objective:goal};let calls=0;
 const deps={challenger,run:runner,challenge:async()=>{calls++;return proposal;}};
 const first=createPrimaryDelivery(root,join(root,'first'),goal,Date.now()+60000,true,deps,undefined,undefined,continuity);
 await first.call({action:'prepare',contract});await writeFile(join(root,'aggregate.json'),JSON.stringify({sum:5,sorted:[1,2,3]}));await first.call({action:'check'});
 const second=createPrimaryDelivery(root,join(root,'second'),goal,Date.now()+60000,true,deps,undefined,undefined,continuity);
 await assert.rejects(second.call({action:'prepare',contract:{...contract,acceptance:['file exists']}}),/original/);
 const resumed=await second.call({action:'resume'});assert.deepEqual(resumed.contract?.acceptance,contract.acceptance);assert.equal(resumed.acceptance.status,'pending');
 await writeFile(join(root,'aggregate.json'),JSON.stringify({sum:6,sorted:[1,2,3]}));assert.equal((await second.call({action:'check'})).acceptance.status,'accepted');assert.equal(calls,1);
 const changed=createPrimaryDelivery(root,join(root,'wrong'),'different objective',Date.now()+60000,true,deps,undefined,undefined,{...continuity,objective:'different objective'});
 await assert.rejects(changed.call({action:'resume'}),/valid previous/);await assert.rejects(changed.call({action:'prepare',contract}),/original/);
 await writeFile(continuity.file,'broken');const broken=createPrimaryDelivery(root,join(root,'broken'),goal,Date.now()+60000,true,deps,undefined,undefined,continuity);
 await assert.rejects(broken.call({action:'resume'}),/valid previous/);await assert.rejects(broken.call({action:'prepare',contract}),/original/);
});

test('primary goal restores delivery before starting the model and blocks corrupt continuity',async()=>{
 const {primaryAgentWorker}=await import('../src/primary-agent.js');const {createGoalBudget,openGoalBudget}=await import('../src/primary-goal-budget.js');const {defaultChatOptions}=await import('../src/chat-options.js');const {mkdir}=await import('node:fs/promises');
 const root=await mkdtemp(join(tmpdir(),'primary-goal-contract-')),budgetId=randomUUID(),deadline=Date.now()+60000,budgetDir=join(root,'goal-budgets',budgetId),continuity={file:join(budgetDir,'delivery.json'),objective:goal};
 await createGoalBudget(budgetDir,{id:budgetId,objective:goal,deadline,workers:1,checks:1});
 const first=createPrimaryDelivery(root,join(root,'old'),goal,deadline,false,{challenger,run:runner},undefined,undefined,continuity);await first.call({action:'prepare',contract});
 const attempt=join(root,'attempt');await mkdir(attempt);
 // A nonexistent command is intentional: the contract is restored before any transport launch.
 const run=primaryAgentWorker(root,join(root,'missing-command'),{...defaultChatOptions,delegation:{mode:'off',count:1}},join(root,'tasks'),async()=>{});
 await run({workspace:root,attemptDir:attempt,prompt:'continue',timeoutMs:1000,continuousGoal:{objective:goal,deadline,budgetId}});
 const restored=JSON.parse(await readFile(join(attempt,'delivery','delivery.json'),'utf8'));assert.deepEqual(restored.contract.acceptance,contract.acceptance);assert.equal(restored.acceptance.status,'pending');
 await writeFile(continuity.file,'corrupt');await assert.rejects(run({workspace:root,attemptDir:join(root,'another'),prompt:'continue',timeoutMs:1000,continuousGoal:{objective:goal,deadline,budgetId}}),/valid previous/);
 const reopened=await openGoalBudget(budgetDir,{id:budgetId,objective:goal,deadline});await reopened.close();
});

test('unrelated task can prepare fresh requirements and malformed historical checks cannot poison registration',async()=>{
 const root=await mkdtemp(join(tmpdir(),'delivery-history-'));const file=join(root,'old.json');
 await writeFile(file,JSON.stringify({contract:{...contract,originalRequirement:goal},acceptance:{status:'accepted',uncovered:[],detail:'historical only'},versions:[],challenge:{checks:[],limitations:[]}}));
 const service=createPrimaryDelivery(root,join(root,'new'),'New task',Date.now()+60000,true,{challenger,run:runner},undefined,file);
 await assert.rejects(service.call({action:'resume'}),/criterion/);
 const fresh=await service.call({action:'prepare',contract:{...contract,goal:'New task'}});assert.equal(fresh.contract?.originalRequirement,'New task');
 assert.equal(fresh.acceptance.status,'pending');
});

test('chat retains the last delivery reference across an unrelated conversational turn',async()=>{
 const {createChatService}=await import('../src/chat-service.js');
 const {mkdir}=await import('node:fs/promises');let round=0;
 const root=await mkdtemp(join(tmpdir(),'delivery-chat-history-'));
 const service=createChatService(root,async request=>{
  round++;if(round===1){await mkdir(join(request.attemptDir,'delivery'));await writeFile(join(request.attemptDir,'delivery','delivery.json'),JSON.stringify({contract,acceptance:{status:'rejected',uncovered:[],detail:'failed'},versions:[]}));}
  await writeFile(join(request.attemptDir,'stdout.jsonl'),JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'reply'}}));
  return {status:'completed',durationMs:1,usage:[]};
 });
 const chat=await service.send({text:'work'});while(service.isActive())await new Promise(r=>setTimeout(r,5));
 const first=await service.detail(chat.id);assert.ok(first.lastDeliveryTurn);
 await service.send({id:chat.id,text:'谢谢'});while(service.isActive())await new Promise(r=>setTimeout(r,5));
 const next=await service.detail(chat.id);assert.equal(next.lastDeliveryTurn,first.lastDeliveryTurn);assert.notEqual(next.reviewTurn,first.reviewTurn);
 const restored=createChatService(root);assert.equal((await restored.detail(chat.id)).lastDeliveryTurn,first.lastDeliveryTurn);
});

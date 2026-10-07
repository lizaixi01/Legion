import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runWorker,type Result} from '../src/worker-pool.js';
import {deliveryAttemptOutcome} from '../scripts/reviewer/cann-delivery-status.js';

const limits={max_input_output_tokens:500000,max_run_ms:600000,max_feedback_rounds:1};
const finalText=JSON.stringify({delivery_status:'complete',result_verified:true,host_accepted:false});
const normalUsage={input_tokens:198912,cached_input_tokens:159360,output_tokens:7150,reasoning_output_tokens:2082};
const overUsage={input_tokens:528005,cached_input_tokens:446720,output_tokens:15171,reasoning_output_tokens:3413};

async function fixture(mode:'normal'|'over-budget-return'|'over-budget-cancel'|'save-error'){
 const root=await mkdtemp(join(tmpdir(),'cann-delivery-evidence-'));
 const script=join(root,'fixture.cjs'),logDir=join(root,'logs');
 const output=join(root,mode==='save-error'?'missing-parent/delivery.json':'delivery.json');
 const usage=mode.startsWith('over-budget')?overUsage:normalUsage;
 await writeFile(script,`
  const fs=require('node:fs');
  const output=process.argv[process.argv.indexOf('--output-last-message')+1];
  console.log(JSON.stringify({type:'thread.started',thread_id:'offline-fixture'}));
  console.log(JSON.stringify({type:'item.completed',item:{id:'commentary',type:'agent_message',text:'This is commentary, not the JSON delivery.'}}));
  console.log(JSON.stringify({type:'item.completed',item:{id:'final',type:'agent_message',text:${JSON.stringify(finalText)}}}));
  console.log(JSON.stringify({type:'turn.completed',usage:${JSON.stringify(usage)}}));
  console.error('offline fixture diagnostic');
  ${mode==='normal'?`fs.writeFileSync(output,${JSON.stringify(finalText+'\n')});`:''}
  ${mode==='over-budget-cancel'?'setInterval(()=>{},1000);':''}
 `);
 const controller=new AbortController();
 // Simulate the actual race: cancel only after the full terminal event is on disk,
 // while the CLI process has not persisted its --output-last-message artifact.
 const timer=mode==='over-budget-cancel'?setInterval(()=>{
  void readFile(join(logDir,'stdout.jsonl'),'utf8').then(text=>{
   if(text.includes('"type":"turn.completed"'))controller.abort();
  }).catch(()=>{});
 },10):undefined;
 let calls=0;
 const invoke=async()=>{
  calls++;
  return runWorker({backend:'codex',command:process.execPath,prefix:[script],model:'offline-fixture',effort:'xhigh',outputPath:output},
   {id:'offline-fixture',workspace:root,logDir,prompt:'simulation only',timeoutMs:5000},controller.signal);
 };
 let result:Result;
 try{result=await invoke();}finally{if(timer)clearInterval(timer);}
 return {result,root,logDir,output,usage,invoke,calls:()=>calls};
}

test('normal completion preserves CLI output, usage, terminal status and diagnostics',async()=>{
 const f=await fixture('normal');
 assert.equal(f.result.status,'completed');
 assert.equal(f.result.execution?.status,'completed');
 assert.equal(f.result.terminalEvent,'turn.completed');
 assert.equal(f.result.finalText,finalText);
 assert.equal(await readFile(f.output,'utf8'),finalText+'\n'); // Existing CLI bytes are not replaced.
 assert.equal(f.result.outputPersistence?.status,'existing');
 assert.deepEqual(f.result.usage,normalUsage);
 const state=deliveryAttemptOutcome(f.result,null,limits,200,1,true,true);
 assert.equal(state.usage_cumulative?.total_tokens,206062);
 assert.equal(state.budget_compliant,true);
 assert.equal(state.delivery_completed,true);
 assert.equal(state.qualified,true);
 assert.equal(state.followup_allowed,false);
 assert.match(await readFile(join(f.logDir,'stderr.log'),'utf8'),/offline fixture diagnostic/);
 assert.deepEqual(JSON.parse(await readFile(join(f.logDir,'result.json'),'utf8')),JSON.parse(JSON.stringify(f.result)));
});

for(const mode of ['over-budget-return','over-budget-cancel'] as const){
 test(`${mode}: save received evidence, fail budget, and do not call again`,async()=>{
  const f=await fixture(mode);
  assert.equal(f.result.status,mode==='over-budget-cancel'?'cancelled':'completed');
  assert.equal(f.result.execution?.status,f.result.status);
  assert.equal(f.result.terminalEvent,'turn.completed');
  assert.equal(f.result.finalText,finalText);
  assert.equal(await readFile(f.output,'utf8'),finalText); // No commentary prefix.
  assert.equal(f.result.outputPersistence?.status,'recovered');
  assert.deepEqual(f.result.usage,overUsage);
  // Even a failed content grade (which would normally request repair) must not
  // trigger another call. The real experiment loop uses this same decision.
  const state=deliveryAttemptOutcome(f.result,normalUsage,limits,427181,1,false,true);
  if(state.followup_allowed)await f.invoke();
  if(!state.stop_experiment)await f.invoke(); // Also block the next planned independent run.
  assert.equal(f.calls(),1);
  assert.equal(state.usage_cumulative?.total_tokens,543176); // New terminal usage wins over stale polling.
  assert.equal(state.evidence_saved,true);
  assert.equal(state.budget_compliant,false);
  assert.equal(state.budget_stop,'token_budget');
  assert.equal(state.stop_experiment,true);
  assert.equal(state.followup_allowed,false);
  assert.equal(state.qualified,false);
  assert.equal(state.delivery_completed,mode==='over-budget-return');
  const correctContent=deliveryAttemptOutcome(f.result,null,limits,427181,2,true,true);
  assert.equal(correctContent.content_qualified,true);
  assert.equal(correctContent.qualified,false);
  assert.deepEqual(JSON.parse(await readFile(join(f.logDir,'result.json'),'utf8')),JSON.parse(JSON.stringify(f.result)));
  assert.match(await readFile(join(f.logDir,'stderr.log'),'utf8'),/offline fixture diagnostic/);
  if(mode==='over-budget-cancel')assert.match(f.result.detail!,/Exit|signal/);
 });
}

test('persistence failure retains received text, usage and the write error in result.json',async()=>{
 const f=await fixture('save-error');
 assert.equal(f.result.status,'error');
 assert.equal(f.result.execution?.status,'completed');
 assert.equal(f.result.terminalEvent,'turn.completed');
 assert.equal(f.result.finalText,finalText);
 assert.deepEqual(f.result.usage,normalUsage);
 assert.equal(f.result.outputPersistence?.status,'error');
 assert.match(f.result.outputPersistence!.detail!,/ENOENT/);
 assert.match(f.result.detail!,/Cannot persist final message/);
 assert.deepEqual(JSON.parse(await readFile(join(f.logDir,'result.json'),'utf8')),JSON.parse(JSON.stringify(f.result)));
});

test('unchanged limits stop exactly at the token cap and allow at most one repair',()=>{
 const result:Result={status:'completed',sessionId:'offline-fixture',durationMs:1,text:'',usage:normalUsage};
 assert.equal(deliveryAttemptOutcome(result,null,limits,1,1,false,true).followup_allowed,true);
 assert.equal(deliveryAttemptOutcome(result,null,limits,1,2,false,true).followup_allowed,false);
 const capped=deliveryAttemptOutcome({...result,usage:{input_tokens:490000,output_tokens:10000}},null,limits,1,1,false,true);
 assert.equal(capped.budget_compliant,true);
 assert.equal(capped.budget_stop,'token_budget');
 assert.equal(capped.followup_allowed,false);
 assert.equal(deliveryAttemptOutcome(result,null,limits,600001,1,false,true).budget_compliant,false);
 assert.equal(deliveryAttemptOutcome({...result,usage:null},null,limits,1,1,false,true).followup_allowed,false);
});

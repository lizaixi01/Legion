import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sumUsage,researchSummary} from '../src/research-summary.js';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {ResearchState} from '../src/management/candidate-types.js';
test('usage totals include cached tokens once and expose missing records',()=>{
 assert.deepEqual(sumUsage([{input_tokens:100,cached_input_tokens:80,output_tokens:20},{input_tokens:50,output_tokens:5},{error:'no usage'}]),{inputTokens:150,cachedInputTokens:80,outputTokens:25,totalTokens:175,records:2});
});
test('summary includes failed and retry usage, and exposes attempts with missing usage',async()=>{
 const root=await mkdtemp(join(tmpdir(),'research-summary-'));
 await writeFile(join(root,'state.json'),JSON.stringify({status:'error',best:'baseline',spentMs:100,baseline:null,history:[{}],candidates:[],config:{}}));
 for(const [name,usage] of [['round-1-0',[{input_tokens:100,cached_input_tokens:80,output_tokens:20}]],['round-1-0-retry-fixture',[{input_tokens:200,cached_input_tokens:100,output_tokens:40}]],['round-2-1',null]] as const){
  const dir=join(root,name);await mkdir(dir);if(usage!==null)await writeFile(join(dir,'usage.json'),JSON.stringify({completed:name.includes('retry'),usage}));
 }
 const report=await researchSummary(root);assert.equal(report.usageCoverage.managerDecisions,1);assert.equal(report.usageCoverage.managerAttemptDirectories,3);assert.equal(report.usageCoverage.managerAttemptsWithUsage,2);assert.equal(report.usageCoverage.managerAttemptsWithoutUsage,1);assert.equal(report.manager.totalTokens,360);assert.equal(report.manager.cachedInputTokens,180);assert.equal(report.manager.records,2);
});

test('current failed checkpoint diagnostics and queue timings retain retry usage coverage',async()=>{
 const root=await mkdtemp(join(tmpdir(),'research-summary-merged-'));
 const current:ResearchState={version:1,status:'error',error:'Checkpoint write failed',best:'baseline',spentMs:250,startedAt:'2026-10-03T00:00:00Z',round:0,baseline:null as unknown as ResearchState['baseline'],history:[],candidates:[],config:{goal:'Offline summary',maxRounds:1,maxWorkers:1,concurrency:1,verificationConcurrency:2,totalMs:1000,manager:{model:'fixture',effort:'high',timeoutSeconds:600},worker:{model:'fixture',effort:'high'}},cleanup:{status:'error',at:'2026-10-03T00:00:01Z',detail:'Cleanup failed'},persistenceErrors:['Checkpoint write failed'],verificationBatches:[{round:1,concurrency:2,queuedAt:'2026-10-03T00:00:00Z',endedAt:'2026-10-03T00:00:00.100Z',wallMs:100,executionMsSum:180,maxActive:2,started:2,finished:2}]};
 await writeFile(join(root,'state.json'),JSON.stringify({...current,status:'running',spentMs:1,error:undefined}));
 const attempt=join(root,'round-1-0-retry-fixture');await mkdir(attempt);await writeFile(join(attempt,'usage.json'),JSON.stringify({usage:[{input_tokens:100,output_tokens:20}]}));
 const report=await researchSummary(root,current);
 assert.equal(report.status,'error');assert.equal(report.error,current.error);assert.equal(report.wallMs,250);assert.deepEqual(report.cleanup,current.cleanup);assert.deepEqual(report.persistenceErrors,current.persistenceErrors);
 assert.equal(report.verification.concurrency,2);assert.equal(report.verification.batchWallMsSum,100);assert.equal(report.verification.executionMsSum,180);
 assert.equal(report.usageCoverage.managerAttemptDirectories,1);assert.equal(report.usageCoverage.managerAttemptsWithUsage,1);assert.equal(report.manager.totalTokens,120);assert.equal(report.config.manager.timeoutSeconds,600);
});

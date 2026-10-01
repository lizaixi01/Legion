import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sumUsage,researchSummary} from '../src/research-summary.js';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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

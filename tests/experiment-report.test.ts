import test from 'node:test';
import assert from 'node:assert/strict';
import {reportExperiment,validateExperimentStudy,type ExperimentStudy,type ExperimentRun,type ExperimentCost} from '../src/experiment-report.js';
const hash='a'.repeat(64);
const costs:ExperimentCost={inputTokens:100,cachedInputTokens:80,outputTokens:20,wallMs:1000,moneyUsd:null,humanMinutes:null};
const empty:ExperimentCost={inputTokens:null,cachedInputTokens:null,outputTokens:null,wallMs:null,moneyUsd:null,humanMinutes:null};
function study():ExperimentStudy{return {schemaVersion:1,studyId:'fixture-only',phase:'pilot',frozen:true,protocolSha256:hash,taskSetSha256:hash,tasks:['t1','t2'].map(id=>({id,baselineCommit:'a'.repeat(40),inputsSha256:hash,evaluatorSha256:hash})),runs:[]};}
function run(taskId:string,arm:ExperimentRun['arm'],grade:ExperimentRun['grade']='pass'):ExperimentRun{return {taskId,arm,state:'graded',termination:'completed',grade,evidence:'fixture/final-grade.json',failure:null,costs:{...costs},recoveryAttempts:[]};}

test('pending planned runs do not create a pass@1 or zero-cost experiment',()=>{
 const report=reportExperiment(study());for(const arm of report.arms){assert.equal(arm.planned,2);assert.equal(arm.pending,2);assert.equal(arm.endToEndPassAt1,null);assert.deepEqual(arm.costs.allObserved.totalTokens,{knownSum:null,knownRecords:0,unknownRecords:2});}
});
test('all arms use final grades, retain paired task identities and separate infra failures',()=>{
 const s=study();s.runs=[run('t1','single'),run('t2','single','fail'),run('t1','multi','fail'),run('t2','multi'),run('t1','multi_verified'),{...run('t2','multi_verified',null),state:'infrastructure_failure'}];
 s.runs[1]!.failure={category:'integration',evidence:'fixture/integration.log'};
 const report=reportExperiment(s);assert.deepEqual(report.arms.map(a=>a.endToEndPassAt1),[.5,.5,.5]);
 const c=report.arms[2]!;assert.equal(c.solutionFailures,0);assert.equal(c.infrastructureFailures,1);assert.equal(c.gradedSolutionPassRate,1);assert.equal(c.failureAttribution.infrastructure,1);
 assert.equal(report.arms[0]!.failureAttribution.integration,1);assert.equal(report.pairs[0]!.onlyFirstPass,1);assert.equal(report.pairs[0]!.onlySecondPass,1);assert.deepEqual(report.pairs[1]!.excludedTasks,['t2']);
});
test('unverified output and evaluator crashes cannot become successful solutions',()=>{
 const s=study();s.runs=[run('t1','single','unverified'),run('t2','single','error')];const arm=reportExperiment(s).arms[0]!;
 assert.equal(arm.endToEndPassAt1,0);assert.equal(arm.gradedSolutionPassRate,null);assert.equal(arm.solutionFailures,0);assert.equal(arm.unverified,1);assert.equal(arm.evaluationErrors,1);assert.equal(arm.failureAttribution.unverified,1);
});
test('budget termination remains a budget result even when the retained final candidate passes',()=>{
 const s=study();s.runs=[{...run('t1','multi_verified'),termination:'budget'},run('t2','multi_verified','fail')];const arm=reportExperiment(s).arms[2]!;
 assert.equal(arm.passes,1);assert.equal(arm.endToEndPassAt1,.5);assert.equal(arm.terminations.budget,1);assert.equal(arm.terminations.completed,1);
});
test('cache is not double counted, retries consume cost and cannot replace primary outcomes',()=>{
 const s=study();const failed={...run('t1','single',null),state:'infrastructure_failure' as const};failed.recoveryAttempts=[{reason:'Recorded infrastructure recovery',evidence:'fixture/recovery.json',costs:{...costs}}];
 s.runs=[failed,run('t2','single')];const arm=reportExperiment(s).arms[0]!;
 assert.equal(arm.endToEndPassAt1,.5);assert.equal(arm.recoveryAttempts,1);assert.equal(arm.costs.primary.totalTokens.knownSum,240);assert.equal(arm.costs.allObserved.totalTokens.knownSum,360);assert.equal(arm.costs.allObserved.uncachedInputTokens.knownSum,60);assert.equal(arm.costs.allObserved.moneyUsd.knownSum,null);
 s.runs.push(run('t1','single'));assert.throws(()=>reportExperiment(s),/duplicate primary/);
});
test('partial usage remains unknown instead of inferred from cache or other arms',()=>{
 const s=study();s.runs=[{...run('t1','single'),costs:{...empty,outputTokens:20}},run('t2','single')];const arm=reportExperiment(s).arms[0]!;
 assert.deepEqual(arm.costs.primary.totalTokens,{knownSum:120,knownRecords:1,unknownRecords:1});assert.equal(arm.costs.primary.outputTokens.knownSum,40);assert.equal(arm.costs.recoveries.totalTokens.knownSum,null);
});
test('draft observations never create a frozen primary pass@1',()=>{
 const s=study();s.frozen=false;s.runs=[run('t1','single'),run('t2','single')];assert.equal(reportExperiment(s).arms[0]!.endToEndPassAt1,null);
 s.frozen=true;s.tasks[0]!.evaluatorSha256=null;assert.throws(()=>validateExperimentStudy(s),/frozen tasks/);
});
test('reject ambiguous status, unknown tasks, missing evidence and impossible usage',()=>{
 const s=study();s.runs=[run('t1','single')];s.runs[0]!.costs.cachedInputTokens=101;assert.throws(()=>reportExperiment(s),/cached input/);
 s.runs[0]!.costs={...costs};s.runs[0]!.evidence=null;assert.throws(()=>reportExperiment(s),/evidence/);
 s.runs[0]!.evidence='fixture';s.runs[0]!.state='pending';assert.throws(()=>reportExperiment(s),/only a final graded/);
 s.runs[0]=run('not-planned','single');assert.throws(()=>reportExperiment(s),/unknown task/);
 s.runs[0]=run('t1','single');s.runs[0]!.costs.inputTokens=Number.NaN;assert.throws(()=>reportExperiment(s),/finite/);
});
test('reject extra success claims and attribution unsupported by a final failed grade',()=>{
 const s=study();assert.throws(()=>reportExperiment({...s,completed:true}),/fields/);s.runs=[run('t1','single')];s.runs[0]!.failure={category:'implementation',evidence:'fixture'};assert.throws(()=>reportExperiment(s),/requires a final fail/);
 s.tasks.push({...s.tasks[0]!});assert.throws(()=>reportExperiment(s),/duplicate task/);
});

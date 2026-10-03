import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {hash} from '../src/provenance.js';
import {runOrdinaryHwe} from '../src/hwe-ordinary.js';
import {nativeArmStatus} from '../src/hwe-native.js';
import type {ResearchConfig,ResearchDeps,Evidence} from '../src/research-loop.js';
import {classifyHweEvidence} from '../src/hwe.js';
import {archivedHwe,engineErrorHwe} from './fixtures/hwe-evidence.js';

const config:ResearchConfig={goal:'Improve the frozen baseline fitness',maxRounds:1,maxWorkers:1,concurrency:1,totalMs:10000,manager:{model:'test',effort:'high'},worker:{model:'test',effort:'medium'}};
const evidence:Evidence={status:'pass',checks:{formal:true},metrics:{fitness:110,fmax_mhz:100,lut4:1000,cycles:100},limitations:['bounded']};

/** A usage-limit interruption must not be recorded as a completed task outcome. */
function deps(workerStatus:'completed'|'error'):ResearchDeps{
 return {
  baseline:async dir=>{await mkdir(dir,{recursive:true});const path=join(dir,'rtl.tar.gz');await writeFile(path,'baseline');return {id:'baseline',round:0,hypothesis:{id:'baseline',parent:'',claim:'Pinned baseline',experiment:'Verify',expected:'Pass',workerSeconds:30},status:'verified',snapshot:{path,sha256:hash('baseline')},evidence};},
  decide:async()=>{throw Error('ordinary must not call the manager');},
  work:async(_h,_p,dir)=>{const path=join(dir,'rtl.tar.gz');await writeFile(path,'candidate');return {snapshot:{path,sha256:hash('candidate')},worker:{status:workerStatus,usage:[],durationMs:1,report:'report',detail:workerStatus==='error'?'usage-limit: hit usage limit':undefined}};},
  verify:async()=>evidence,
  stop:async()=>{},
 };
}
test('ordinary arm reports an infrastructure error and stays ineligible',async()=>{
 const root=join(await mkdtemp(join(tmpdir(),'ordinary-')),'run');
 const report=await runOrdinaryHwe(root,config,600,new AbortController().signal,deps('error'));
 assert.equal(report.status,'error');
 assert.equal(report.eligible,false);
 assert.equal(report.candidate?.status,'error');
});
test('ordinary arm reports completion when the candidate passes external checks',async()=>{
 const root=join(await mkdtemp(join(tmpdir(),'ordinary-')),'run');
 const report=await runOrdinaryHwe(root,config,600,new AbortController().signal,deps('completed'));
 assert.equal(report.status,'completed');
 assert.equal(report.eligible,true);
});
test('native arm status treats transport or verifier faults as infrastructure',()=>{
 assert.equal(nativeArmStatus('usage-limit: hit usage limit',undefined),'error');
 assert.equal(nativeArmStatus(undefined,evidence),'completed');
 assert.equal(nativeArmStatus(undefined,{...evidence,status:'error'}),'error');
});
test('ordinary and native arms stop for simultaneous confirmed failure and verifier fault',async()=>{
 const raw=archivedHwe();raw.checks.formal={...(raw.checks.formal as object),classification:{outcomes:[{name:'reg_ch0',status:'fail',tool_statuses:['FAIL','ERROR'],preunsat:false}],diagnostics:[]}};
 const result=classifyHweEvidence(raw),injected=deps('completed');injected.verify=async()=>result;
 const root=join(await mkdtemp(join(tmpdir(),'ordinary-')),'run');
 const report=await runOrdinaryHwe(root,config,600,new AbortController().signal,injected);
 assert.equal(report.status,'error');assert.equal(report.eligible,false);assert.equal(report.candidate?.evidence?.status,'fail');
 assert.equal(nativeArmStatus(undefined,result),'error');
 const timeout=engineErrorHwe();timeout.checks.formal={passed:false,failed_check:'timeout'};
 assert.equal(nativeArmStatus(undefined,classifyHweEvidence(timeout)),'error');
});

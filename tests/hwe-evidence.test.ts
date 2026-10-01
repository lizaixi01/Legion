import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classifyHweEvidence,fingerprintMatches} from '../src/hwe.js';
import type {Evidence} from '../src/research-loop.js';
import {archivedHwe,passingHwe,engineErrorHwe} from './fixtures/hwe-evidence.js';
import {verificationHasInfrastructureError} from '../src/research-loop.js';
test('unwaived formal engine ERROR is undetermined and preserves raw checks despite attached metrics',()=>{
 const raw=engineErrorHwe();raw.metrics=passingHwe().metrics;
 const result=classifyHweEvidence(raw);
 assert.equal(result.status,'error');assert.equal((result.checks.formal as {detail:string}).detail,(raw.checks.formal as {detail:string}).detail);
 assert.match(result.detail!,/undetermined|incomplete/i);
});
test('batch-3 explicit reg_ch0 assertion FAIL must not be hidden by the ch1 engine ERROR',()=>{
 const raw=archivedHwe(),result=classifyHweEvidence(raw);
 assert.equal(result.status,'fail');assert.equal((result.checks.formal as {detail:string}).detail,(raw.checks.formal as {detail:string}).detail);
});
test('all required HWE gates passed, but missing or malformed formal is never a pass',()=>{
 assert.equal(classifyHweEvidence(passingHwe()).status,'pass');
 for(const formal of [undefined,{}, {passed:true}, {passed:false,failed_check:'reg_ch0',detail:'unparsed output'}, {passed:true,checks_passed:1}]){
  const e=passingHwe();if(formal===undefined)delete e.checks.formal;else e.checks.formal=formal;
  assert.equal(classifyHweEvidence(e).status,'error');
 }
 const e=passingHwe();e.checks.formal={passed:false,failed_check:'timeout',detail:'run_all.sh exceeded 2700s wall-clock'};
 assert.equal(classifyHweEvidence(e).status,'timeout');
});
test('HWE separates verifier faults and timeouts from a demonstrated divergence',()=>{
 const result=(field:string):Evidence=>({status:'fail',checks:{cosim:{passed:false,failed_elf:'selftest.elf',detail:{field}}},limitations:[]});
 assert.equal(classifyHweEvidence(result('error')).status,'error');
 assert.equal(classifyHweEvidence(result('timeout')).status,'timeout');
 assert.equal(classifyHweEvidence(result('divergence')).status,'fail');
 assert.equal(classifyHweEvidence({status:'fail',checks:{fpga:{reason:'fpga_report_unparsed: no LUT4'}},limitations:[]}).status,'error');
});
test('readiness is reused only while the recorded environment fingerprint is unchanged',()=>{
 const saved={oss:'/opt/oss',image:'sha256:abc',filesSha256:'deadbeef'};
 assert.equal(fingerprintMatches(saved,{oss:'/opt/oss',image:'sha256:abc',filesSha256:'deadbeef'}),true);
 assert.equal(fingerprintMatches(saved,{oss:'/opt/oss',image:'sha256:def',filesSha256:'deadbeef'}),false);
 assert.equal(fingerprintMatches(saved,{oss:'/opt/oss',image:'sha256:abc'}),false);
});

test('structured task statuses override a misleading aggregate while retaining FAIL and ERROR together',()=>{
 const e=passingHwe();
 e.checks.formal={passed:true,checks_passed:50,classification:{outcomes:Array.from({length:50},(_,i)=>({name:`check_${i}`,status:'pass',tool_statuses:[i===0?'ERROR':'PASS'],preunsat:false})),diagnostics:[]}};
 assert.equal(classifyHweEvidence(e).status,'error');
 const raw=archivedHwe();raw.checks.formal={...(raw.checks.formal as object),classification:{outcomes:[{name:'reg_ch0',status:'fail',tool_statuses:['FAIL','ERROR'],preunsat:false}],diagnostics:[]}};
 const result=classifyHweEvidence(raw);assert.equal(result.status,'fail');assert.equal(verificationHasInfrastructureError(result),true);
 const interrupted=archivedHwe();interrupted.status='error';interrupted.detail='Verifier process could not finish archiving';
 assert.equal(verificationHasInfrastructureError(classifyHweEvidence(interrupted)),true);
 const timed=archivedHwe();timed.checks.formal={...(timed.checks.formal as object),classification:{outcomes:[{name:'reg_ch0',status:'fail',tool_statuses:['FAIL'],preunsat:false},{name:'unfinished',status:'timeout',tool_statuses:['TIMEOUT'],preunsat:false}],diagnostics:[]}};
 assert.equal(classifyHweEvidence(timed).status,'fail');assert.equal(verificationHasInfrastructureError(classifyHweEvidence(timed)),true);
});
test('malformed metadata cannot erase a tool-reported assertion failure, and classifications are idempotent',()=>{
 const raw=archivedHwe();raw.checks.formal={...(raw.checks.formal as object),classification:{outcomes:'unparsed'}};
 const classified=classifyHweEvidence(raw);assert.equal(classified.status,'fail');assert.equal(verificationHasInfrastructureError(classified),true);
 assert.deepEqual(classifyHweEvidence(classified),classified);
});
test('an ambiguous non-pass result and missing simulation markers remain undetermined',()=>{
 const e=passingHwe();e.status='fail';delete e.checks.fpga;delete e.checks.synthesis;
 assert.equal(classifyHweEvidence(e).status,'error');
 for(const field of ['malformed_marker','no_output','unknown_format']){
  const raw=archivedHwe();delete raw.checks.formal;raw.checks.cosim={passed:false,failed_elf:'coremark.elf',detail:{field}};
  assert.equal(classifyHweEvidence(raw).status,'error');
 }
});
test('malformed task metadata preserves confirmed FAIL but never waives ERROR using a non-boolean field',()=>{
 const e=archivedHwe();e.checks.formal={passed:false,failed_check:'reg_ch0',classification:{outcomes:[{name:'reg_ch0',status:'fail',tool_statuses:['FAIL',null],preunsat:false}],diagnostics:[]}};
 const result=classifyHweEvidence(e);assert.equal(result.status,'fail');assert.equal(verificationHasInfrastructureError(result),true);
 const waived=passingHwe();waived.checks.formal={passed:true,checks_passed:50,classification:{outcomes:Array.from({length:50},(_,i)=>({name:`test_${i}_ch1`,status:'pass',tool_statuses:[i===0?'ERROR':'PASS'],preunsat:i===0?'false':false})),diagnostics:[]}};
 assert.equal(classifyHweEvidence(waived).status,'error');
});
test('classification remains stable for PASS, ERROR and timeout and ignores unrelated ERROR prose',()=>{
 const timeout=engineErrorHwe();timeout.checks.formal={passed:false,failed_check:'timeout',detail:'run_all.sh exceeded 2700s wall-clock'};
 for(const raw of [passingHwe(),engineErrorHwe(),timeout]){
  const once=classifyHweEvidence(raw);assert.deepEqual(classifyHweEvidence(once),once);
 }
 const pass=passingHwe();(pass.checks.formal as {detail?:string}).detail='ERROR mentioned in diagnostic documentation only';
 assert.equal(classifyHweEvidence(pass).status,'pass');
});

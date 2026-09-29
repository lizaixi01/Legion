import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classifyHweEvidence,fingerprintMatches} from '../src/hwe.js';
import type {Evidence} from '../src/research-loop.js';
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

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reviewReplayConsistency} from '../src/benchmarks/hwe-replay-review.js';
const tail='\nFormal: 104 passed, 1 failed\nFailed: reg_ch0\nSBY 1:00:00 [reg_ch0] engine_0: Value for anyconst register_index: 14\nSBY 1:00:00 [reg_ch0] summary: failed assertion foo at check.sv:42 step 20\n';
function row(after:string){return [{id:'fixed',hashMatches:true,consistent:false,differences:[{path:'checks.formal.detail',before:'partial older parallel log'+tail,after,explained:false,kind:'formal-log-clock'}]}];}
test('bounded parallel prefix and clocks are reviewed while original differences stay visible',()=>{
 const input=row('different parallel prefix'+tail.replaceAll('1:00:00','2:00:00')),before=structuredClone(input),review=reviewReplayConsistency(input);assert.equal(review.consistent,true);assert.equal(review.literalConsistent,false);assert.deepEqual(input,before);assert.equal(review.rows[0]!.differences[0]!.before,input[0]!.differences[0]!.before);
});
test('changed failure assertion, step, counterexample, structured status or snapshot remains inconsistent',()=>{
 for(const after of [tail.replace('step 20','step 21'),tail.replace('index: 14','index: 15'),tail.replace('check.sv:42','check.sv:43'),tail.replace('104 passed','103 passed')])assert.equal(reviewReplayConsistency(row(after)).consistent,false);
 const input=row(tail);input[0]!.differences.push({path:'checks.formal.tasks.reg_ch0.status',before:'FAIL',after:'PASS',explained:false,kind:'unexplained'});assert.equal(reviewReplayConsistency(input).consistent,false);
 input[0]!.consistent=true;assert.equal(reviewReplayConsistency(input).consistent,false);
 const changed=row(tail);changed[0]!.hashMatches=false;assert.equal(reviewReplayConsistency(changed).consistent,false);
});

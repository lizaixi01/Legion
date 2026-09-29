import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sumUsage} from '../src/research-summary.js';
test('usage totals include cached tokens once and expose missing records',()=>{
 assert.deepEqual(sumUsage([{input_tokens:100,cached_input_tokens:80,output_tokens:20},{input_tokens:50,output_tokens:5},{error:'no usage'}]),{inputTokens:150,cachedInputTokens:80,outputTokens:25,totalTokens:175,records:2});
});

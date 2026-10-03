import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hweServiceTier,hweModelPayload} from '../src/hwe-runtime.js';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
test('HWE speed selection preserves backend default and validates explicit Fast aliases',()=>{
 const saved=process.env.PROACTIVE_HWE_SERVICE_TIER;
 try{
  delete process.env.PROACTIVE_HWE_SERVICE_TIER;
  assert.equal(hweServiceTier(),undefined);
  for(const tier of ['fast','priority'] as const){process.env.PROACTIVE_HWE_SERVICE_TIER=tier;assert.equal(hweServiceTier(),tier);}
  for(const value of ['','standard','ultrafast','typo'])assert.throws(()=>hweServiceTier(value),/must be fast or priority/);
 }finally{if(saved===undefined)delete process.env.PROACTIVE_HWE_SERVICE_TIER;else process.env.PROACTIVE_HWE_SERVICE_TIER=saved;}
});
test('isolated HWE launch freezes supported official metadata and preserves explicit values',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'hwe-model-')),source=join(dir,'source.json');
 const bytes=JSON.stringify({models:[{slug:'gpt-6.1-sol',supported_reasoning_levels:[{effort:'xhigh'}],service_tiers:[{id:'priority'}]}]});
 await writeFile(source,bytes);
 for(const decisionSchema of [undefined,{type:'object'}]){
  const payload=await hweModelPayload({model:'gpt-6.1-sol',effort:'xhigh',decisionSchema},dir,{PROACTIVE_HWE_SERVICE_TIER:'priority',PROACTIVE_HWE_MODEL_CATALOG:source});
  assert.equal(payload.serviceTier,'priority');assert.equal(payload.model,'gpt-6.1-sol');assert.equal(payload.effort,'xhigh');
  assert.equal(await readFile(join(dir,'model-catalog.json'),'utf8'),bytes);
 }
 const payload=await hweModelPayload({model:'gpt-6.1-sol',effort:'xhigh',serviceTier:'fast',modelCatalog:source},dir,{PROACTIVE_HWE_SERVICE_TIER:'priority'});
 assert.equal(payload.serviceTier,'fast');
 await assert.rejects(hweModelPayload({model:'missing',effort:'xhigh',modelCatalog:source},dir,{}),/does not contain/);
 await assert.rejects(hweModelPayload({model:'gpt-6.1-sol',effort:'low',modelCatalog:source},dir,{}),/requested effort/);
});
test('omitted speed and metadata preserve backend defaults',async()=>{
 const payload={model:'existing-model',effort:'existing-effort'};
 assert.deepEqual(await hweModelPayload(payload,'unused',{}),payload);
});

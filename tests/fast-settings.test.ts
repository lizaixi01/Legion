import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {ServiceTierSchema,advertisesFast} from '../src/service-tier.js';
import {ChatOptionsSchema,managerSelection,modelCatalog,validateChatOptions} from '../src/chat-options.js';
import {ResearchConfigSchema,normalizeResearchConfig} from '../src/management/candidate-types.js';
import {workerArgs} from '../src/worker-pool.js';
import {codexAppServerWorker} from '../src/codex-app-server.js';

test('Manager and Worker Fast preferences are independent; omitted legacy values stay omitted',()=>{
 const legacy=ChatOptionsSchema.parse({});assert.ok(!Object.hasOwn(legacy,'serviceTier'));
 const options=ChatOptionsSchema.parse({serviceTier:'fast',worker:{model:'gpt-6.1-sol',effort:'xhigh',serviceTier:'default'}});
 assert.equal(managerSelection(options).serviceTier,'fast');assert.equal(options.worker!.serviceTier,'default');
 assert.throws(()=>ServiceTierSchema.parse('ultrafast'));
 assert.equal(advertisesFast({additional_speed_tiers:['fast']}),true);assert.equal(advertisesFast({service_tiers:[{id:'priority'}]}),true);assert.equal(advertisesFast({}),false);
 const base={goal:'Fixture',maxRounds:1,maxWorkers:4,concurrency:2,totalMs:1000,manager:{model:'fixture',effort:'high'},worker:{model:'fixture',effort:'high'}};
 assert.ok(!Object.hasOwn(ResearchConfigSchema.parse(base).manager,'serviceTier'));
 const explicit={...base,manager:{...base.manager,serviceTier:'fast' as const},worker:{...base.worker,serviceTier:'default' as const}};
 assert.equal(normalizeResearchConfig(explicit).worker.serviceTier,'default');assert.notDeepEqual(normalizeResearchConfig(base),normalizeResearchConfig(explicit));
});
test('catalog advertises Fast by metadata and validates each role without inventing support',async t=>{
 const root=await mkdtemp(join(tmpdir(),'fast-catalog-')),saved=process.env.CODEX_HOME;
 t.after(()=>{if(saved===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=saved;});
 process.env.CODEX_HOME=root;
 await writeFile(join(root,'models_cache.json'),JSON.stringify({models:[{slug:'fixture-fast',display_name:'Fixture Fast',visibility:'list',supported_reasoning_levels:[{effort:'xhigh'}],service_tiers:[{id:'priority'}]},{slug:'fixture-standard',display_name:'Fixture Standard',visibility:'list',supported_reasoning_levels:[{effort:'high'}]}]}));
 assert.deepEqual((await modelCatalog()).map(m=>m.fastSupported),[true,false]);
 const result=await validateChatOptions({model:'fixture-fast',effort:'xhigh',serviceTier:'fast',worker:{model:'fixture-standard',effort:'high',serviceTier:'default'}});assert.equal(result.worker!.serviceTier,'default');
 await assert.rejects(validateChatOptions({model:'fixture-standard',effort:'high',serviceTier:'fast'}),/Manager/);
 await assert.rejects(validateChatOptions({model:'fixture-fast',effort:'xhigh',worker:{model:'fixture-standard',effort:'high',serviceTier:'fast'}}),/Worker/);
});

test('Worker Fast on and off reach initial and resumed CLI without changing model or effort',()=>{
 for(const sessionId of [undefined,'saved'])for(const serviceTier of ['fast','default'] as const){
  const args=workerArgs({backend:'codex',command:'unused',prefix:[],model:'gpt-6.1-sol',effort:'xhigh',serviceTier},{id:'fixture',prompt:'',workspace:'.',logDir:'.',timeoutMs:1000,sessionId});
  assert.ok(args.includes(`service_tier="${serviceTier}"`));assert.ok(args.includes('fast_mode'));assert.ok(args.includes('model_reasoning_effort="xhigh"'));assert.ok(args.includes('gpt-6.1-sol'));if(sessionId)assert.ok(args.indexOf(`service_tier="${serviceTier}"`)<args.indexOf('resume'));
 }
});

test('Fast buttons persist only their own role and do not label requested Fast as confirmed',async()=>{
 const {bindFastSetting}=await import(pathToFileURL(join(process.cwd(),'desktop/fast-setting.js')).href);
 const manager:{serviceTier?:string}={},worker:{serviceTier?:string}={};let changes=0;
 const button=()=>({textContent:'',disabled:false,title:'',onclick:()=>{},attributes:{} as Record<string,string>,setAttribute(k:string,v:string){this.attributes[k]=v;}});
 const m=button(),w=button();const paint=()=>{changes++;bindFastSetting(m,manager,true,paint);bindFastSetting(w,worker,true,paint);};paint();
 m.onclick();assert.equal(manager.serviceTier,'fast');assert.equal(worker.serviceTier,undefined);assert.equal(m.attributes['aria-pressed'],'true');assert.match(m.title,/实际档位以响应审计/);
 w.onclick();m.onclick();assert.equal(manager.serviceTier,'default');assert.equal(worker.serviceTier,'fast');assert.ok(changes>=4);
 const unsupported=button();bindFastSetting(unsupported,{},false,()=>{});assert.equal(unsupported.disabled,true);
});

test('app-server applies explicit Manager tier on start, resume and turn; off clears prior Fast',async()=>{
 for(const serviceTier of ['fast','default'] as const)for(const sessionId of [undefined,'thread']){
  const root=await mkdtemp(join(tmpdir(),'fast-rpc-'));
  await writeFile(join(root,'app-server'),`const fs=require('fs'),rl=require('readline').createInterface({input:process.stdin});const send=x=>console.log(JSON.stringify(x));rl.on('line',line=>{const m=JSON.parse(line);fs.appendFileSync('wire.jsonl',line+'\\n');if(!m.method||m.method==='initialized')return;if(m.method==='initialize')send({id:m.id,result:{}});if(['thread/start','thread/resume'].includes(m.method))send({id:m.id,result:{thread:{id:'thread'}}});if(m.method==='turn/start'){send({id:m.id,result:{turn:{id:'turn'}}});send({method:'item/completed',params:{threadId:'thread',item:{id:'answer',type:'agentMessage',text:'READY'}}});send({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed'}}});}});`);
  const result=await codexAppServerWorker(process.execPath,'gpt-6.1-sol',{workspace:root,attemptDir:root,prompt:'READY',timeoutMs:10000,sessionId},{effort:'xhigh',serviceTier,permission:'read-only',instructions:'Fixture'});
  assert.equal(result.status,'completed',result.detail??'');
  const messages=(await readFile(join(root,'wire.jsonl'),'utf8')).trim().split('\n').map(l=>JSON.parse(l));
  for(const method of [sessionId?'thread/resume':'thread/start','turn/start'])assert.equal(messages.find(m=>m.method===method).params.serviceTier,serviceTier);
 }
});

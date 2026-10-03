import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {assessSpeedAcceptance} from '../src/benchmarks/hwe-speed-acceptance.js';
import {hash} from '../src/provenance.js';
const catalog=Buffer.from('same catalog'),catalogHash=hash(catalog),parent=hash('baseline');
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'speed-qualification-')),save=(path:string,v:unknown)=>writeFile(join(root,path),JSON.stringify(v));
 const audit={containers:[],processes:[],sockets:[]};
 await save('qualification.json',{version:1,mode:'development-qualification',pairedTiming:false,sources:[2,4].map(concurrency=>({concurrency,directory:`source-${concurrency}`,sourceBatch:'original-'+concurrency}))});
 await save('cancel-result.json',{status:'cancelled',verificationStarted:2,queuedNotStarted:2,audit});
 for(const concurrency of [2,4]){
  const prefix=`source-${concurrency}/`;await mkdir(join(root,prefix));
  await save(prefix+'result.json',{managerCalls:0,workerCalls:concurrency,formalBenchmark:false,results:[{concurrency,complete:true,consistent:true,activity:{maxWorkers:concurrency,maxVerification:2,overlapMs:5}}]});
  await save(prefix+'model-output-audit.json',{workers:Array.from({length:4},(_,i)=>i<concurrency?{id:`accept-${concurrency}-${i+1}`,modelCalled:true,tinyExactCommentOnly:true,modelArchiveHashMatches:true,catalogSha256:catalogHash,lintExecutions:[{exitCode:0}],session:{status:'completed',exitCode:0,turnCompleted:true}}:{id:`accept-${concurrency}-${i+1}`,modelCalled:false,replayOnly:true})});
  await save(prefix+'state.json',{status:'budget',config:{maxWorkers:4,concurrency,allocationsPerRound:4,verificationConcurrency:2,verificationScheduling:'worker-ready'},candidates:Array.from({length:4},()=>({status:'rejected'})),cleanup:{status:'completed'}});
  await save(prefix+'owner-audit.jsonl',audit);await save(prefix+'ready.json',{sha256:parent});await writeFile(join(root,prefix+'model-catalog.json'),catalog);
  await save(prefix+'implementation-hashes.json',Object.fromEntries(['candidate-loop.ts','candidate-types.ts','hwe.ts','hwe-runtime.ts','bridge.py','session_runner.py','evaluate.py','formal_result.py'].map(n=>[n,hash(n)])));
 }
 return {root,save};
}
test('separate short phases qualify real Worker 2/4 and explicit copies without a paired timing claim',async()=>{
 const {root}=await fixture(),result=await assessSpeedAcceptance(root,catalogHash,parent);assert.equal(result.passed,true);assert.equal(result.pairedTiming,false);assert.equal(result.mode,'separate-development-phases');
});
test('a claimed complete summary cannot hide resumed state, residuals, or changed frozen inputs',async()=>{
 const {root,save}=await fixture();await save('source-2/state.json',{resumed:true});await save('source-4/owner-audit.jsonl',{containers:['leftover'],processes:[],sockets:[]});
 await writeFile(join(root,'source-4/model-catalog.json'),'drift');const result=await assessSpeedAcceptance(root,catalogHash,parent);assert.equal(result.passed,false);assert.match(result.reasons.join('\n'),/state incomplete/);assert.match(result.reasons.join('\n'),/owner audit/);assert.match(result.reasons.join('\n'),/catalog differs/);
});
test('same scheduler implementation and bounded model coverage are required for qualification',async()=>{
 const {root,save}=await fixture();await save('source-4/result.json',{managerCalls:0,workerCalls:9,formalBenchmark:false,results:[{concurrency:4,complete:true,consistent:true,activity:{maxWorkers:4,maxVerification:2,overlapMs:5}}]});await save('source-4/implementation-hashes.json',{});
 const result=await assessSpeedAcceptance(root,catalogHash,parent);assert.equal(result.passed,false);assert.match(result.reasons.join('\n'),/call bound/);assert.match(result.reasons.join('\n'),/candidate-loop.ts/);
});

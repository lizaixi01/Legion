import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {readDecisionHistory,decisionMemory} from '../src/primary-decision-history.js';
import {createPrimaryStrategy} from '../src/primary-strategy.js';

test('history survives turns but never restores dispatch authority and bounds model context',async()=>{
 const root=await mkdtemp(join(tmpdir(),'decision-memory-')),old=randomUUID(),current=randomUUID(),id=randomUUID(),evidenceId=randomUUID();
 const folder=join(root,old,'decisions');await mkdir(folder,{recursive:true});
 await writeFile(join(folder,id+'.json'),JSON.stringify({id,at:new Date().toISOString(),action:'continue',reason:'previous failure',evidenceIds:[evidenceId],nextExperiment:'another hypothesis'}));
 await writeFile(join(folder,id+'.execution.json'),JSON.stringify({decisionId:id,workerSeconds:1800,allocations:[{id:randomUUID(),taskId:randomUUID(),work:{backend:'codex',prompt:'x'.repeat(50000)},status:'launching'}]}));
 const rows=await readDecisionHistory(root,current);assert.equal(rows[0]!.historyOnly,true);assert.equal(rows[0]!.execution!.allocations[0]!.status,'interrupted');
 const memory=await decisionMemory(root,current);assert.ok(JSON.stringify(memory).length<2000);assert.equal(memory[0]!.reason,'previous failure');
 const strategy=createPrimaryStrategy(join(root,current,'decisions'),{ids:()=>[],inspect:async()=>{throw Error('not issued');}},undefined,()=>decisionMemory(root,current));
 const state=await strategy.call({action:'read'}) as {history:unknown[]};assert.equal(state.history.length,1);
 await assert.rejects(strategy.call({action:'execute',decisionId:id}),/Unknown/);
 await assert.rejects(strategy.call({action:'select',reason:'reuse old pass',evidenceIds:[evidenceId],selectedId:evidenceId}),/not issued/);await strategy.close();
});

test('malformed and mismatched history records do not become visible decisions',async()=>{
 const root=await mkdtemp(join(tmpdir(),'decision-bad-history-')),turn=randomUUID(),folder=join(root,turn,'decisions');await mkdir(folder,{recursive:true});
 await writeFile(join(folder,randomUUID()+'.json'),'{');await writeFile(join(folder,randomUUID()+'.json'),JSON.stringify({id:randomUUID(),at:'now',action:'select',reason:'spoof',evidenceIds:[]}));
 assert.deepEqual(await readDecisionHistory(root),[]);
});

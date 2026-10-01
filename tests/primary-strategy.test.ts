import {tarGz} from './fixtures/rtl-archive.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createHweCheck} from '../src/primary-hwe-check.js';
import {createPrimaryStrategy} from '../src/primary-strategy.js';
import {digest} from '../src/challenge.js';

async function setup(){
 const root=await mkdtemp(join(tmpdir(),'strategy-'));await mkdir(join(root,'.local/hwe-readiness'),{recursive:true});
 await writeFile(join(root,'.local/hwe-readiness/baseline.tar.gz'),'baseline');await writeFile(join(root,'.local/hwe-readiness/ready.json'),JSON.stringify({environment:{image:'fixed'},sha256:digest('baseline')}));await writeFile(join(root,'rtl.tar.gz'),tarGz([{name:'core.sv'}]));
 const check=createHweCheck(root,root,join(root,'checks'),Date.now()+60000,undefined,{fingerprint:async()=>({image:'fixed'}),verify:async()=>({status:'pass',checks:{},metrics:{fitness:1,fmax_mhz:2,lut4:3,cycles:4},limitations:['bounded']}),stop:async()=>{}});
 return {root,check,strategy:createPrimaryStrategy(join(root,'decisions'),check)};
}
test('decisions require host evidence, preserve metrics and reject changed candidates',async()=>{
 const {root,check,strategy}=await setup();
 await assert.rejects(strategy.call({action:'select',reason:'invented',evidenceIds:[randomUUID()],selectedId:randomUUID()}),/Unknown evidence/);
 const result=await check({archive:'rtl.tar.gz'});result.evidence!.metrics!.fitness=999;
 const decision={action:'select',reason:'Measured candidate meets the public checks',evidenceIds:[result.id],selectedId:result.id};
 await strategy.call(decision);const files=await readdir(join(root,'decisions'));const saved=JSON.parse(await readFile(join(root,'decisions',files[0]!),'utf8'));assert.equal(saved.evidence[0].evidence.metrics.fitness,1);
 assert.equal((await strategy.finalize()).status,'valid');
 await writeFile(join(root,'rtl.tar.gz'),'changed');await assert.rejects(strategy.call(decision),/candidate changed/);
 assert.equal((await strategy.finalize()).status,'stale');
 assert.equal(JSON.parse(await readFile(join(root,'decisions','selection.json'),'utf8')).status,'stale');
 const state=await strategy.call({action:'read'}) as {evidence:{status:string}[]};assert.equal(state.evidence[0]!.status,'stale');await check.close();
});
test('tampered reports are refused and continuation requires an explicit hypothesis',async()=>{
 const {check,strategy}=await setup();const result=await check({archive:'rtl.tar.gz'});
 await assert.rejects(strategy.call({action:'continue',reason:'more work',evidenceIds:[result.id]}),/hypothesis/);
 await strategy.call({action:'continue',reason:'test timing tradeoff',evidenceIds:[result.id],nextExperiment:'Measure a smaller combinational path'});
 await writeFile(result.report,'{}');await assert.rejects(strategy.call({action:'discard',reason:'discard',evidenceIds:[result.id]}),/report changed/);await check.close();
});
test('rejected evidence cannot be selected and environments cannot be mixed',async()=>{
 const root=await mkdtemp(join(tmpdir(),'strategy-policy-')),a=randomUUID(),b=randomUUID();
 let rejected=true;const strategy=createPrimaryStrategy(root,{ids:()=>[a,b],inspect:async(id)=>({id,status:rejected?'rejected':'verified',environment:{image:id}})});
 const input={action:'select',reason:'compare',evidenceIds:[a,b],selectedId:a};
 await assert.rejects(strategy.call(input),/verified/);rejected=false;await assert.rejects(strategy.call(input),/different verification environments/);
});

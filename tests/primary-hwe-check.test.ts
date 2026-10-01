import {tarGz} from './fixtures/rtl-archive.js';
const candidate=tarGz([{name:'core.sv'}]);
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHweCheck} from '../src/primary-hwe-check.js';
import {digest} from '../src/challenge.js';
import type {Evidence} from '../src/research-loop.js';
import {randomUUID} from 'node:crypto';
import {createGoalBudget,openGoalBudget,readGoalBudget} from '../src/primary-goal-budget.js';
import {classifyHweEvidence} from '../src/hwe.js';
import {archivedHwe,engineErrorHwe,passingHwe} from './fixtures/hwe-evidence.js';
import {createPrimaryStrategy} from '../src/primary-strategy.js';
const good:Evidence={status:'pass',checks:{},metrics:{fitness:1,fmax_mhz:2,lut4:3,cycles:4},limitations:['bounded checks only']};
async function setup(){const root=await mkdtemp(join(tmpdir(),'primary-hwe-'));await mkdir(join(root,'.local/hwe-readiness'),{recursive:true});await writeFile(join(root,'.local/hwe-readiness/baseline.tar.gz'),'baseline');await writeFile(join(root,'.local/hwe-readiness/ready.json'),JSON.stringify({environment:{image:'fixed'},sha256:digest('baseline')}));await writeFile(join(root,'rtl.tar.gz'),candidate);return root;}

test('host HWE reports undetermined engine faults distinctly from confirmed assertion failures',async()=>{
 for(const [raw,status,description] of [[engineErrorHwe(),'error',/验证未完成|工具异常/],[archivedHwe(),'rejected',/Confirmed|property failure/],[passingHwe(),'verified',/./]] as const){
  const root=await setup(),evidence=classifyHweEvidence(raw);let calls=0;
  const check=createHweCheck(root,root,join(root,'checks'),Date.now()+60000,undefined,{fingerprint:async()=>({image:'fixed'}),verify:async()=>{calls++;return evidence;},stop:async()=>{}});
  try {const r=await check({archive:'rtl.tar.gz'});assert.equal(r.status,status);assert.deepEqual((await check.inspect(r.id)).evidence,evidence);assert.equal(calls,1);
   if(status!=='verified'){
    assert.match(check.failures()[0]!,description);
    const strategy=createPrimaryStrategy(join(root,'strategy'),check);
    await assert.rejects(strategy.call({action:'select',reason:'Attempt selection',evidenceIds:[r.id],selectedId:r.id}),/verified/);
    assert.equal((await strategy.finalize()).status,'none');
   }else assert.deepEqual(check.failures(),[]);
  }finally{await check.close();}
 }
});

test('relocated snapshot reaches host verifier without rewriting legacy readiness',async()=>{
 const root=await setup(),readyPath=join(root,'.local/hwe-readiness/ready.json');
 const environment=JSON.parse(await readFile(new URL('./fixtures/hwe-environment-legacy.json',import.meta.url),'utf8'));
 const original=JSON.stringify({environment,sha256:digest('baseline')});await writeFile(readyPath,original);
 const relocated=structuredClone(environment);relocated.additionalInputs=Object.fromEntries(Object.entries(environment.additionalInputs).map(([path,hash])=>[path.replace('/mnt/d/Projects/Proactive Agent/.local/hwe-bench/','/mnt/d/Projects/New Snapshot/.local/hwe-bench/'),hash]));
 let calls=0;
 const check=createHweCheck(root,root,join(root,'checks'),Date.now()+60000,undefined,{fingerprint:async()=>relocated,verify:async()=>{calls++;return good;},stop:async()=>{}});
 try{
  assert.equal((await check({archive:'rtl.tar.gz'})).status,'verified');assert.equal(calls,1);
  assert.equal(await readFile(readyPath,'utf8'),original);
  const key=Object.keys(relocated.additionalInputs).find(path=>path.endsWith('/Makefile'))!;relocated.additionalInputs[key]='f'.repeat(64);
  const changed=await check({archive:'rtl.tar.gz'});assert.equal(changed.status,'error');assert.match(changed.detail!,/additionalInputs/);assert.equal(calls,1);
 }finally{await check.close();}
});

test('host HWE failure blocks completion until a real subsequent check succeeds',async()=>{
 const root=await setup();let calls=0;
 const check=createHweCheck(root,root,join(root,'checks'),Date.now()+60000,undefined,{fingerprint:async()=>({image:'fixed'}),verify:async()=>{if(++calls===1)throw Error('WSL access denied');return good;},stop:async()=>{}});
 try{assert.equal((await check({archive:'rtl.tar.gz'})).status,'error');assert.match(check.failures()[0]!,/access denied/);
 assert.equal((await check({archive:'rtl.tar.gz'})).status,'verified');assert.deepEqual(check.failures(),[]);}finally{await check.close();}
});
test('HWE tool pins candidate and environment, keeps metrics and cleans its own owner',async()=>{
 const root=await setup();let owner='';const stopped:string[]=[];
 const check=createHweCheck(root,root,join(root,'checks'),Date.now()+60000,undefined,{fingerprint:async()=>({image:'fixed'}),verify:async(file,_dir,id)=>{assert.deepEqual(await readFile(file),candidate);owner=id;return good;},stop:async(_dir,id)=>{stopped.push(id);}});
 const result=await check({archive:'rtl.tar.gz'});assert.equal(result.status,'verified');assert.equal(result.sha256,digest(candidate));assert.deepEqual(stopped,[owner]);assert.equal(result.evidence?.metrics?.fitness,1);assert.equal(JSON.parse(await readFile(result.report,'utf8')).status,'verified');await check.close();
});
test('HWE refuses stale environments and changed artifacts and never accepts missing metrics',async()=>{
 for(const mode of ['environment','artifact','metrics','cleanup']){
  const root=await setup();let called=false;
  const check=createHweCheck(root,root,join(root,'checks'),Date.now()+60000,undefined,{fingerprint:async()=>({image:mode==='environment'?'changed':'fixed'}),verify:async()=>{called=true;if(mode==='artifact')await writeFile(join(root,'rtl.tar.gz'),'modified');return mode==='metrics'?{...good,metrics:undefined}:good;},stop:async()=>{if(mode==='cleanup')throw Error('cleanup failure');}});
  assert.equal((await check({archive:'rtl.tar.gz'})).status,'error');assert.equal(check.failures().length,1);assert.equal(called,mode!=='environment');await check.close();
 }
});
test('HWE check shares cancellation lifecycle and prevents overlapping verification',async()=>{
 const root=await setup();let started=false,cleaned=false;
 const check=createHweCheck(root,root,join(root,'checks'),Date.now()+60000,undefined,{fingerprint:async()=>({image:'fixed'}),verify:async(_f,_d,_o,signal)=>{started=true;await new Promise<void>(r=>{if(signal.aborted)r();else signal.addEventListener('abort',()=>r(),{once:true});});return good;},stop:async()=>{cleaned=true;}});
 const running=check({archive:'rtl.tar.gz'});const waitDeadline=Date.now()+5000;while(!started&&Date.now()<waitDeadline)await new Promise(r=>setTimeout(r,5));assert.ok(started,'verifier must start within 5 seconds');await assert.rejects(check({archive:'rtl.tar.gz'}),/capacity/);await check.close();assert.equal((await running).status,'error');assert.equal(cleaned,true);
});

test('HWE consumes a goal check across connections and keeps failed cleanup unresolved',async()=>{
 for(const cleanupFails of [false,true]){
  const root=await setup(),directory=join(root,'budget'),config={id:randomUUID(),objective:'test',deadline:Date.now()+60000,workers:1,checks:1};await createGoalBudget(directory,config);let budget=await openGoalBudget(directory,config),calls=0;
  const deps={fingerprint:async()=>({image:'fixed'}),verify:async()=>{calls++;return good;},stop:async()=>{if(cleanupFails)throw Error('unknown process');}};
  const check=createHweCheck(root,root,join(root,'checks'),config.deadline,undefined,deps,budget);
  assert.equal((await check({archive:'rtl.tar.gz'})).status,cleanupFails?'error':'verified');await check.close();await budget.close();
  const state=await readGoalBudget(directory);assert.equal(state.checksUsed,1);assert.equal(Object.keys(state.inflight).length,cleanupFails?1:0);
  if(cleanupFails)await assert.rejects(openGoalBudget(directory,config),/unknown/);
  else{budget=await openGoalBudget(directory,config);const next=createHweCheck(root,root,join(root,'next'),config.deadline,undefined,deps,budget);await assert.rejects(next({archive:'rtl.tar.gz'}),/capacity/);await next.close();await budget.close();}
  assert.equal(calls,1);
 }
});

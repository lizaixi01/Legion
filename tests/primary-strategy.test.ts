import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createPrimaryStrategy} from '../src/primary-strategy.js';
import {digest} from '../src/challenge.js';

async function setup(){
 const root=await mkdtemp(join(tmpdir(),'strategy-'));await writeFile(join(root,'artifact.json'),'{}');
 const records=new Map<string,{id:string;status:string;environment:{policy:string};path:string;sha256:string;report:string;reportHash:string;evidence:{metrics:{score:number}}}>();
 const check=Object.assign(async({path}:{path:string})=>{
  const id=randomUUID(),report=join(root,id+'.json'),candidate=join(root,path);
  const evidence={metrics:{score:1}},bytes=JSON.stringify(evidence);await writeFile(report,bytes);
  const record={id,status:'verified',environment:{policy:'fixture-v1'},path:candidate,sha256:digest(await readFile(candidate)),report,reportHash:digest(bytes),evidence};
  records.set(id,record);return structuredClone(record);
 },{ids:()=>[...records.keys()],inspect:async(id:string)=>{
  const record=records.get(id);if(!record)throw Error('Unknown evidence');
  if(digest(await readFile(record.path))!==record.sha256)throw Error('candidate changed');
  if(digest(await readFile(record.report))!==record.reportHash)throw Error('report changed');
  return structuredClone(record);
 },close:async()=>{}});
 return {root,check,strategy:createPrimaryStrategy(join(root,'decisions'),check)};
}
test('decisions require host evidence, preserve metrics and reject changed candidates',async()=>{
 const {root,check,strategy}=await setup();
 await assert.rejects(strategy.call({action:'select',reason:'invented',evidenceIds:[randomUUID()],selectedId:randomUUID()}),/Unknown evidence/);
 const result=await check({path:'artifact.json'});result.evidence.metrics.score=999;
 const decision={action:'select',reason:'Measured candidate meets the public checks',evidenceIds:[result.id],selectedId:result.id};
 await strategy.call(decision);const files=await readdir(join(root,'decisions'));const saved=JSON.parse(await readFile(join(root,'decisions',files[0]!),'utf8'));assert.equal(saved.evidence[0].evidence.metrics.score,1);
 assert.equal((await strategy.finalize()).status,'valid');
 await writeFile(join(root,'artifact.json'),'changed');await assert.rejects(strategy.call(decision),/candidate changed/);
 assert.equal((await strategy.finalize()).status,'stale');
 assert.equal(JSON.parse(await readFile(join(root,'decisions','selection.json'),'utf8')).status,'stale');
 const state=await strategy.call({action:'read'}) as {evidence:{status:string}[]};assert.equal(state.evidence[0]!.status,'stale');await check.close();
});
test('tampered reports are refused and continuation requires an explicit hypothesis',async()=>{
 const {check,strategy}=await setup();const result=await check({path:'artifact.json'});
 await assert.rejects(strategy.call({action:'continue',reason:'more work',evidenceIds:[result.id]}),/hypothesis/);
 await strategy.call({action:'continue',reason:'test quality tradeoff',evidenceIds:[result.id],nextExperiment:'Measure a smaller output'});
 await writeFile(result.report,'{}');await assert.rejects(strategy.call({action:'discard',reason:'discard',evidenceIds:[result.id]}),/report changed/);await check.close();
});
test('rejected evidence cannot be selected and environments cannot be mixed',async()=>{
 const root=await mkdtemp(join(tmpdir(),'strategy-policy-')),a=randomUUID(),b=randomUUID();
 let rejected=true;const strategy=createPrimaryStrategy(root,{ids:()=>[a,b],inspect:async(id)=>({id,status:rejected?'rejected':'verified',environment:{image:id}})});
 const input={action:'select',reason:'compare',evidenceIds:[a,b],selectedId:a};
 await assert.rejects(strategy.call(input),/verified/);rejected=false;await assert.rejects(strategy.call(input),/different verification environments/);
});

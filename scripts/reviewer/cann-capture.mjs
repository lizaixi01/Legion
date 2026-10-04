// Explicit, opt-in regression for the existing CANN evidence. No evaluator commands.
import assert from 'node:assert/strict';
import {readFile,writeFile,lstat,readdir,mkdir} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,relative,isAbsolute,join} from 'node:path';
import {createPrimaryDelivery} from '../../src/primary-delivery.ts';
import {runWorker} from '../../src/worker-pool.ts';

const [projectArg,previousArg,invocationArg,destinationArg]=process.argv.slice(2);
if(!destinationArg)throw Error('Usage: node --import tsx scripts/reviewer/cann-capture.mjs PROJECT PREVIOUS_DELIVERY REVIEWER_INVOCATION NEW_OUTPUT_DIRECTORY');
const project=resolve(projectArg),previous=resolve(previousArg),destination=resolve(destinationArg);
const inside=(root,path)=>{const r=relative(root,path);return !isAbsolute(r)&&r!=='..'&&!r.startsWith('..\\')&&!r.startsWith('../');};
assert.ok(!inside(project,destination),'Regression output must be outside the evidence project');
const json=async path=>JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
const plan=await json(new URL('./cann-capture.json',import.meta.url));
const old=await json(previous),invocation=await json(invocationArg);
assert.deepEqual(old.contract.outputs,[plan.candidate,'results/experiments/iter1-cache8192',plan.run]);
assert.equal(invocation.backend,'codex');
assert.equal(typeof invocation.command,'string');
const contract={goal:old.contract.goal,outputs:plan.outputs,acceptance:old.contract.acceptance};

// Inventory every original output byte, including excluded ranking history. Refuse
// links, unbounded traversal, and oversized source trees instead of silently skipping.
async function inventory(){
 const files=[];let entries=0,total=0;
 async function visit(path,depth=0){
  assert.ok(++entries<=4096&&depth<=64,'Source inventory entry/depth limit');
  const s=await lstat(path);assert.ok(!s.isSymbolicLink(),'Source inventory refuses links');
  if(s.isDirectory()){for(const name of (await readdir(path)).sort())await visit(join(path,name),depth+1);return;}
  assert.ok(s.isFile(),'Source inventory requires regular files');
  total+=s.size;assert.ok(s.size<=64*1024*1024&&total<=1024*1024*1024,'Source inventory byte limit');
  const hash=createHash('sha256');let bytes=0;
  for await(const chunk of createReadStream(path)){bytes+=chunk.length;assert.ok(bytes<=s.size,'Source grew during inventory');hash.update(chunk);}
  assert.equal(bytes,s.size);
  files.push({path:relative(project,path).replaceAll('\\','/'),size:s.size,sha256:hash.digest('hex')});
 }
 for(const output of [...old.contract.outputs,'results/evaluator/runs/v2-baseline'])await visit(join(project,output));
 return files;
}
const before=await inventory();
for(const output of contract.outputs){const f=before.find(f=>f.path===output);assert.ok(f,'Missing selected file: '+output);assert.ok(f.size<=4194304,'Selected file exceeds unchanged capture limit: '+output);}
assert.ok(contract.outputs.length<=30);
const report=await json(join(project,plan.run,'report.json'));
assert.equal(report.submission_id,'6ac234bf694b590c3cce5152');
assert.equal(report.status,'Pass');assert.equal(report.passed_cases,15);assert.equal(report.official_total_score,26.64);assert.equal(report.time_unit,'us');
// The selected raw responses must be the ones actually referenced by the report.
for(const path of [report.raw_response,report.ranking_response,report.time_unit_evidence.saved_path])assert.ok(contract.outputs.includes(relative(project,path).replaceAll('\\','/')));
await mkdir(destination); // Fresh run only: never overwrite a historical delivery.
const save=async(name,value)=>writeFile(join(destination,name),JSON.stringify(value,null,2),{flag:'wx'});
await save('source-inventory-before.json',before);
await save('contract-correction.json',{previous,original:old.contract,corrected:contract,reason:'File-only runtime: explicit evidence files replace directory outputs; acceptance text unchanged.',excluded:before.filter(f=>!contract.outputs.includes(f.path)),authority:'Local retained evidence, not a newly issued trusted-verifier acceptance'});
await save('external-evidence-retained.json',{status:'retained',submission_id:report.submission_id,result:report.status,passed_cases:report.passed_cases,official_total_score:report.official_total_score,time_unit:report.time_unit,files:before.filter(f=>contract.outputs.includes(f.path))});
const service=createPrimaryDelivery(project,join(destination,'delivery'),old.contract.originalRequirement,Date.now()+600000,true,{
 challenger:{backend:'codex',command:invocation.command,prefix:[],model:invocation.model,effort:invocation.effort},
 run:runWorker,
});
await service.call({action:'prepare',contract});
const checked=await service.call({action:'check'});
const after=await inventory();await save('source-inventory-after.json',after);
assert.deepEqual(after,before,'Original evidence changed during regression');
const summary={capture:checked.versions[0]?.functional?'completed':'blocked',externalEvidence:'retained',acceptance:await service.finalize(),reviewer:checked.versions[0]?.reviewer??null,sourceBytesUnchanged:true};
await save('summary.json',summary);console.log(JSON.stringify(summary,null,2));
assert.equal(summary.capture,'completed','Capture must reach functional verification');
assert.ok(summary.reviewer?.result?.execution?.started,'Real reviewer process must start');

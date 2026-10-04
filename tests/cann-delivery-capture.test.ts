import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createPrimaryDelivery} from '../src/primary-delivery.js';
import {snapshotOutputs} from '../src/challenge.js';

test('CANN regression uses explicit files without changing acceptance or snapshot limits',async t=>{
 const root=await mkdtemp(join(tmpdir(),'cann-contract-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const plan=JSON.parse(await readFile(new URL('../scripts/reviewer/cann-capture.json',import.meta.url),'utf8')) as {outputs:string[];candidate:string;run:string};
 assert.equal(plan.outputs.length,30);assert.equal(new Set(plan.outputs).size,30);
 const workspace=join(root,'project');
 for(const path of plan.outputs){await mkdir(dirname(join(workspace,path)),{recursive:true});await writeFile(join(workspace,path),'synthetic fixture, not CANN evidence');}
 // Historical unselected evidence remains present, including an oversized file.
 const oversized=join(workspace,plan.run,'unrelated-ranking.json');
 const bytes=Buffer.alloc(4*1024*1024+1,65);await writeFile(oversized,bytes);
 await assert.rejects(snapshotOutputs(workspace,[plan.candidate],join(root,'old')),/Output missing or too large/);
 await assert.rejects(snapshotOutputs(workspace,[plan.run+'/unrelated-ranking.json'],join(root,'large')),/Output missing or too large/);
 const contract={goal:'Fixture regression',outputs:plan.outputs,acceptance:['original requirement one','original requirement two']};
 let reviewed=0;
 const service=createPrimaryDelivery(workspace,join(root,'delivery'),'original user requirement',Date.now()+60000,true,{
  challenger:{backend:'codex',command:'fixture',prefix:[],model:'fixture',effort:'medium'},
  run:async(_spec,job)=>{
   reviewed++;
   for(const output of plan.outputs)assert.equal(await readFile(join(job.workspace,output),'utf8'),'synthetic fixture, not CANN evidence');
   await assert.rejects(readFile(join(job.workspace,plan.run,'unrelated-ranking.json')),/ENOENT/);
   return {status:'timeout',durationMs:180000,text:'',usage:null,detail:'synthetic reviewer timeout'};
  },
 });
 await service.call({action:'prepare',contract});const result=await service.call({action:'check'});
 assert.equal(reviewed,1);assert.deepEqual(result.contract?.acceptance,contract.acceptance);
 assert.equal(result.contract?.originalRequirement,'original user requirement');
 assert.equal(result.acceptance.status,'unverified');assert.equal(result.acceptance.reviewStatus,'infrastructure_failure');
 assert.ok(result.versions[0]?.functional);assert.deepEqual(await readFile(oversized),bytes);
});

import {mkdir,readFile,writeFile,lstat,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {hash} from './provenance.js';
import {inspectRtlArchive} from './hwe-archive.js';
import {eligible,type Candidate,type ResearchContext} from './research-loop.js';

/** Stage only this round's pinned versions. No host paths or log directories enter the bundle. */
export async function prepareHweManagerContext(ctx:ResearchContext,root:string,dir:string){
 const input=join(dir,'manager-context-input'),output=join(dir,'manager-context');
 try{
  await mkdir(input);
  const ids=new Set<string>();
  for(const c of ctx.records){
   if(!/^[a-z][a-z0-9-]{0,39}$/.test(c.id)||ids.has(c.id)||c.hypothesis.id!==c.id)throw Error('Candidate identity conflict: '+c.id);
   ids.add(c.id);
  }
  const baseline=ctx.records.find(c=>c.id==='baseline'),best=ctx.records.find(c=>c.id===ctx.best);
  if(!baseline||baseline.round!==0||baseline.hypothesis.parent!==''||!eligible(baseline))throw Error('Invalid baseline identity or verification');
  if(!best||!eligible(best))throw Error('Current best is not a verified candidate: '+ctx.best);
  const parent=best.id==='baseline'?undefined:ctx.records.find(c=>c.id===best.hypothesis.parent);
  if(best.id!=='baseline'&&(!parent||parent.round>=best.round))throw Error('Current best parent identity conflict');
  const realRoot=await realpath(root);
  async function stage(c:Candidate,role:string){
   const expected=resolve(root,c.id,'rtl.tar.gz'),snapshot=c.snapshot;
   if(!snapshot||resolve(snapshot.path)!==expected||await realpath(expected)!==join(realRoot,c.id,'rtl.tar.gz')||!(await lstat(expected)).isFile())throw Error('Snapshot identity/path conflict: '+c.id);
   const bytes=await readFile(expected);
   if(hash(bytes)!==snapshot.sha256)throw Error('Snapshot hash mismatch: '+c.id);
   const layout=inspectRtlArchive(bytes);if(!layout.ok)throw Error('Invalid RTL archive for '+c.id+': '+layout.detail);
   const archive=role+'.tar.gz';await writeFile(join(input,archive),bytes);
   return {id:c.id,sha256:snapshot.sha256,parentId:c.hypothesis.parent||null,status:c.status,verified:eligible(c),archive,
    externalVerification:c.evidence??null,workerReport:c.worker?.report??null};
  }
  const versions={baseline:await stage(baseline,'baseline'),best:best.id==='baseline'?null:await stage(best,'best'),
   parent:parent&&parent.id!=='baseline'?await stage(parent,'parent'):null};
  const metadata=JSON.stringify({version:1,round:ctx.round,bestId:best.id,parentId:parent?.id??null,versions},null,2);
  await writeFile(join(input,'input.json'),metadata);
  return {input,output,sha256:hash(metadata),baselineArchive:join(input,'baseline.tar.gz')};
 }catch(e){
  await writeFile(join(dir,'manager-context-error.json'),JSON.stringify({status:'error',stage:'manager-context',best:ctx.best,detail:String(e)},null,2));
  throw e;
 }
}

import {readFile,writeFile,mkdir,copyFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execute} from '../src/process.js';
import {hash} from '../src/provenance.js';
import {linuxPath} from '../src/programbench.js';

// Re-evaluate frozen submissions without invoking prepare(), a model, or a Worker.
for(const original of process.argv.slice(2)){
 const source=resolve(original),selected=JSON.parse(await readFile(join(source,'selection.json'),'utf8'));
 const bytes=await readFile(selected.path);if(hash(bytes)!==selected.sha256)throw Error('Original submission changed');
 const entries=(await readdir(join(source,'host'))).filter(n=>n.endsWith('-grade')||n.endsWith('-grade-recovery')).sort((a,b)=>parseInt(a)-parseInt(b));
 const prior=JSON.parse(await readFile(join(source,'host',entries.at(-1)!,'request.json'),'utf8'));
 const root=resolve('.runs','programbench-regrade-'+randomUUID());await mkdir(join(root,'adapter'),{recursive:true});
 for(const file of ['bridge.py','model_proxy.py','relay.py'])await copyFile(resolve('scripts/programbench',file),join(root,'adapter',file));
 const artifact=join(root,'scoring',prior.settings.instance,'submission.tar.gz');await mkdir(join(root,'scoring',prior.settings.instance),{recursive:true});await writeFile(artifact,bytes,{flag:'wx'});
 const provenance={originalRun:source,sha256:selected.sha256,method:'pip-only proxy; identical frozen submission; no Worker calls',startedAt:new Date().toISOString()};
 await writeFile(join(root,'provenance.json'),JSON.stringify(provenance,null,2));
 await writeFile(join(root,'selection.json'),JSON.stringify({path:artifact,sha256:selected.sha256},null,2));
 const settings={...prior.settings,root:linuxPath(root),scripts:linuxPath(join(root,'adapter'))};
 const request=join(root,'request.json');await writeFile(request,JSON.stringify({settings,payload:{submission:linuxPath(artifact)}}));
 let state:Record<string,unknown>={status:'grading',...provenance};
 const save=()=>writeFile(join(root,'execution.json'),JSON.stringify(state,null,2));await save();console.log('Regrade: '+root);
 const call=async(action:string,timeoutMs:number)=>{const logs=join(root,action);await mkdir(logs);return execute({command:'wsl.exe',args:['-d',settings.distro,'--',settings.python,join(settings.scripts,'bridge.py').replaceAll('\\','/'),action,linuxPath(request)],cwd:process.cwd(),logDir:logs,timeoutMs});};
 try{
  const result=await call('grade',1800000);if(result.status!=='completed')throw Error('Grade failed: '+JSON.stringify(result)+' '+await readFile(join(root,'grade','stderr.log'),'utf8'));
  if(hash(await readFile(artifact))!==selected.sha256||hash(await readFile(selected.path))!==selected.sha256)throw Error('Submission changed during regrade');
  const grade=JSON.parse(await readFile(join(root,'grade','stdout.jsonl'),'utf8'));await writeFile(join(root,'grade.json'),JSON.stringify(grade,null,2));state={...state,status:'evaluated',grade};console.log(JSON.stringify(grade));
 }catch(error){state={...state,status:'error',error:String(error)};process.exitCode=1;}
 finally{const cleanup=await call('stop',60000);if(cleanup.status!=='completed'){state={...state,status:'error',cleanup};process.exitCode=1;}state.endedAt=new Date().toISOString();await save();}
 if(process.exitCode)break;
}

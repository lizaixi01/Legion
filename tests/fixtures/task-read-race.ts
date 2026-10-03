import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {join} from 'node:path';
import {createPrimaryTasks} from '../../src/primary-agent.js';
import {defaultChatOptions} from '../../src/chat-options.js';

const [root,mode]=process.argv.slice(2) as [string,string];
const nativeRead=fs.readFile,nativeRename=fs.rename;
const releases=new Map<string,()=>void>();
const tasks=await createPrimaryTasks(root,join(root,'tasks'),root,{...defaultChatOptions,delegation:{mode:'fixed',count:2}},undefined,async(_spec,job,signal)=>{
 await new Promise<void>(resolve=>{releases.set(job.id,resolve);if(signal?.aborted)resolve();else signal?.addEventListener('abort',()=>resolve(),{once:true});});
 return {status:'completed',text:'unverified worker claim',durationMs:1,usage:null};
});
let target='',armed=false,injected=false,reads=0;
// Delay delivery of bytes already read from the old task.json. Let the real worker
// finish its atomic rename and release its slot before returning those old bytes.
fs.readFile=(async(...args:Parameters<typeof nativeRead>)=>{
 const bytes=await nativeRead(...args);
 if(armed&&String(args[0])===target&&!injected&&++reads===(mode==='batch'?2:1)){
  injected=true;
  const id=target.split(/[\\/]/).at(-2)!;
  if(mode==='continue')await tasks.call('legion_tasks',{action:'continue',id,prompt:'second attempt'});
  else if(mode==='cancel'||mode==='completed-cancel'){
   const cancelled=tasks.call('legion_tasks',{action:'cancel',id});
   releases.get(id)!();await cancelled;
  }else{
   releases.get(id)!();await tasks.call('legion_tasks',{action:'wait',id});
  }
 }
 return bytes;
}) as typeof nativeRead;
syncBuiltinESMExports();
try{
 const a=await tasks.call('legion_dispatch',{backend:'codex',prompt:'first'}) as {id:string};
 target=join(root,'tasks',a.id,'task.json');
 let statuses:string[];
 if(mode==='orphan'){
  releases.get(a.id)!();await tasks.call('legion_tasks',{action:'wait',id:a.id});
  const record=JSON.parse(await nativeRead(target,'utf8'));
  record.status='running';record.history[0].status='running';delete record.result;
  await fs.writeFile(target,JSON.stringify(record));
  const state=await tasks.call('legion_tasks',{action:'read',id:a.id}) as {status:string;history:{status:string}[]};
  statuses=[state.status];if(state.history[0]?.status!=='interrupted')throw Error('Orphan history must remain unknown');
 }else if(mode==='save-failure'||mode==='transient-save-failure'){
  // A failed final rename leaves durable state running; a finished model is not
  // sufficient to fabricate a successful task record.
  fs.rename=(async(...args:Parameters<typeof nativeRename>)=>{
   if(String(args[1])===target&&(!injected||mode==='save-failure')){injected=true;throw Object.assign(Error('fixture final rename failure'),mode==='transient-save-failure'?{code:'EPERM'}:{});}
   return nativeRename(...args);
  }) as typeof nativeRename;
  syncBuiltinESMExports();
  const waiting=tasks.call('legion_tasks',{action:'wait',id:a.id});
  releases.get(a.id)!();
  if(mode==='transient-save-failure')await waiting;
  else {try{await waiting;throw Error('Expected persistence failure');}catch(error){if(!String(error).includes('fixture final rename failure'))throw error;}}
  const state=await tasks.call('legion_tasks',{action:'read',id:a.id}) as {status:string};statuses=[state.status];
 }else if(mode==='batch'){
  const b=await tasks.call('legion_dispatch',{backend:'commandcode',prompt:'second'}) as {id:string};
  releases.get(b.id)!();await tasks.call('legion_tasks',{action:'wait',id:b.id});
  armed=true;
  const result=await tasks.call('legion_tasks',{action:'wait',ids:[a.id,b.id],timeoutMs:1000}) as {tasks:{status:string}[]};
  statuses=result.tasks.map(task=>task.status);
 }else{
  if(mode==='continue'||mode==='completed-cancel'){releases.get(a.id)!();await tasks.call('legion_tasks',{action:'wait',id:a.id});}
  armed=true;
  const state=await tasks.call('legion_tasks',{action:'read',id:a.id}) as {status:string};statuses=[state.status];
 }
 const diskStatus=JSON.parse(await nativeRead(target,'utf8')).status as string;
 console.log(JSON.stringify({statuses,diskStatus,injected}));
}finally{
 fs.readFile=nativeRead;fs.rename=nativeRename;syncBuiltinESMExports();
 for(const release of releases.values())release();
 await tasks.close();
}

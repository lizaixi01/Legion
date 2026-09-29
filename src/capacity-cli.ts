import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {WorkerPool,type Backend} from './worker-pool.js';
import {workerSpecs,accountCapacities} from './account-capacity.js';
const root=process.cwd(),batch=join(root,'.capacity','probe-'+Date.now());
await mkdir(batch,{recursive:true});
const controller=new AbortController();process.on('SIGINT',()=>controller.abort());
const modes=['commandcode','codex','mixed'] as const;
const max=Number(process.argv[2]??64);if(![1,2,4,8,16,32,64].includes(max))throw Error('Use a ladder ceiling up to 64');
const report:{mode:string;level:number;wave:number;results:unknown[];passed:boolean;durationMs:number}[]=[];
await writeFile(join(batch,'accounts-before.json'),JSON.stringify(await accountCapacities(root),null,2));
for(const mode of modes.filter(m=>!process.argv[3]||process.argv[3].split(",").includes(m))){
 for(const level of [1,2,4,8,16,32,64].filter(n=>n<=max&&(mode!=="mixed"||n>=2))){
  let passed=true;
  for(let wave=0;wave<3&&passed&&!controller.signal.aborted;wave++){
   const pool=new WorkerPool({codex:level,commandcode:level},level),started=Date.now();
   const results=await Promise.all(Array.from({length:level},async(_,i)=>{
    const backend:Backend=mode==='mixed'?(i%2?'codex':'commandcode'):mode;
    const id=randomUUID(),nonce=randomUUID();
    const result=await pool.submit({...workerSpecs[backend],modPath:join(root,"scripts/capacity/probe-mod.mjs")},{id,prompt:`Do not use tools or delegate. Reply with exactly this string, without quotes: ${nonce}`,workspace:join(batch,id,'workspace'),logDir:join(batch,id,'logs'),timeoutMs:120000},controller.signal);
    return {backend,id,...result,valid:result.status==='completed'&&result.text.trim()===nonce};
   }));
   passed=results.every(r=>r.valid);report.push({mode,level,wave,results,passed,durationMs:Date.now()-started});
   await writeFile(join(batch,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({mode,level,wave,passed,statuses:results.map(r=>r.status),batch}));
  }
  if(!passed||controller.signal.aborted)break;
 }
 if(controller.signal.aborted)break;
}
await writeFile(join(batch,'accounts-after.json'),JSON.stringify(await accountCapacities(root),null,2));



